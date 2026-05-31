import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface StartupAuditScript {
  auditStartupImports(options?: {
    rootDir?: string;
    entry?: string;
    forbiddenLocalModules?: string[];
    forbiddenPackages?: string[];
  }): {
    status: 'ok' | 'fail';
    entry: string;
    rootDir: string;
    visited: string[];
    violations: Array<{
      kind: 'local' | 'package';
      target: string;
      specifier: string;
      importer: string;
      chain: string[];
    }>;
  };
}

function loadScript(): StartupAuditScript {
  const requireFromHere = createRequire(__filename);
  return requireFromHere(
    path.join(process.cwd(), 'scripts', 'audit-startup-imports.js'),
  ) as StartupAuditScript;
}

function createTempGraph(files: Record<string, string>): { temp: string; rootDir: string } {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-startup-audit-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(temp, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { temp, rootDir: temp };
}

function auditTempGraph(
  files: Record<string, string>,
  options?: Partial<Parameters<StartupAuditScript['auditStartupImports']>[0]>,
): ReturnType<StartupAuditScript['auditStartupImports']> & { temp: string } {
  const { temp, rootDir } = createTempGraph(files);
  try {
    const { auditStartupImports } = loadScript();
    const result = auditStartupImports({
      rootDir,
      entry: 'src/main/main.ts',
      forbiddenLocalModules: ['src/main/forbidden.ts'],
      forbiddenPackages: ['heavy-package'],
      ...options,
    });
    return { ...result, temp };
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function cleanupTemp(result: { temp: string }): void {
  fs.rmSync(result.temp, { recursive: true, force: true });
}

test('startup import audit accepts an allowed static startup graph', () => {
  const result = auditTempGraph({
    'src/main/main.ts': "import { boot } from './boot';\nboot();\n",
    'src/main/boot.ts':
      "import { value } from './light';\nexport function boot() { return value; }\n",
    'src/main/light.ts': 'export const value = 1;\n',
  });
  try {
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.violations, []);
    assert.ok(result.visited.some((file) => file.endsWith('src/main/boot.ts')));
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit fails on a transitive forbidden local module and reports the chain', () => {
  const result = auditTempGraph({
    'src/main/main.ts': "import './boot';\n",
    'src/main/boot.ts':
      "import { forbidden } from './forbidden';\nexport const boot = forbidden;\n",
    'src/main/forbidden.ts': 'export const forbidden = true;\n',
  });
  try {
    assert.equal(result.status, 'fail');
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.kind, 'local');
    assert.equal(result.violations[0]?.target.replaceAll('\\\\', '/'), 'src/main/forbidden.ts');
    assert.deepEqual(
      result.violations[0]?.chain.map((file) => file.replaceAll('\\\\', '/')),
      ['src/main/main.ts', 'src/main/boot.ts', 'src/main/forbidden.ts'],
    );
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit fails on a forbidden package import and reports the importing chain', () => {
  const result = auditTempGraph({
    'src/main/main.ts': "import './boot';\n",
    'src/main/boot.ts':
      "import { decode } from 'heavy-package/subpath';\nexport const boot = decode;\n",
  });
  try {
    assert.equal(result.status, 'fail');
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.kind, 'package');
    assert.equal(result.violations[0]?.target, 'heavy-package');
    assert.equal(result.violations[0]?.specifier, 'heavy-package/subpath');
    assert.deepEqual(
      result.violations[0]?.chain.map((file) => file.replaceAll('\\\\', '/')),
      ['src/main/main.ts', 'src/main/boot.ts'],
    );
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit forbids preference modules by default', () => {
  const result = auditTempGraph(
    {
      'src/main/main.ts': "import { loadPreferences } from './preferences';\nloadPreferences();\n",
      'src/main/preferences.ts': 'export function loadPreferences() { return {}; }\n',
    },
    {
      forbiddenLocalModules: undefined,
      forbiddenPackages: [],
    },
  );
  try {
    assert.equal(result.status, 'fail');
    assert.equal(result.violations[0]?.target.replaceAll('\\\\', '/'), 'src/main/preferences.ts');
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit forbids the RSS monitor by default', () => {
  const result = auditTempGraph(
    {
      'src/main/main.ts': "import { startRssMonitor } from './rss';\nstartRssMonitor();\n",
      'src/main/rss.ts': 'export function startRssMonitor() {}\n',
    },
    {
      forbiddenLocalModules: undefined,
      forbiddenPackages: [],
    },
  );
  try {
    assert.equal(result.status, 'fail');
    assert.equal(result.violations[0]?.target.replaceAll('\\\\', '/'), 'src/main/rss.ts');
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit ignores dynamic imports, typeof imports, and type-only imports', () => {
  const result = auditTempGraph({
    'src/main/main.ts': [
      "import type { Forbidden } from './forbidden';",
      "export type { Forbidden } from './forbidden';",
      "type Lazy = typeof import('./forbidden');",
      "async function load() { return import('./forbidden'); }",
      'export const boot = 1;',
      '',
    ].join('\n'),
    'src/main/forbidden.ts': 'export type Forbidden = { x: number }; export const runtime = 1;\n',
  });
  try {
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.violations, []);
    assert.deepEqual(
      result.visited.map((file) => file.replaceAll('\\\\', '/')),
      ['src/main/main.ts'],
    );
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit fails on static side-effect imports', () => {
  const result = auditTempGraph({
    'src/main/main.ts': "import './forbidden';\n",
    'src/main/forbidden.ts': 'globalThis.sideEffect = true;\n',
  });
  try {
    assert.equal(result.status, 'fail');
    assert.equal(result.violations[0]?.specifier, './forbidden');
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit fails on runtime re-exports', () => {
  const result = auditTempGraph({
    'src/main/main.ts': "export { forbidden } from './forbidden';\n",
    'src/main/forbidden.ts': 'export const forbidden = true;\n',
  });
  try {
    assert.equal(result.status, 'fail');
    assert.equal(result.violations[0]?.specifier, './forbidden');
  } finally {
    cleanupTemp(result);
  }
});

test('startup import audit passes for the real main startup graph', () => {
  const { auditStartupImports } = loadScript();
  const result = auditStartupImports();

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.violations, []);
  assert.ok(result.visited.includes('src/main/main.ts'));
  assert.ok(result.visited.includes('src/main/menu.ts'));
  assert.ok(!result.visited.includes('src/main/album-flow.ts'));
  assert.ok(!result.visited.includes('src/main/preferences.ts'));
  assert.ok(!result.visited.includes('src/shared/user-preferences.ts'));
  assert.ok(!result.visited.includes('src/main/rss.ts'));
});

test('startup import audit CLI emits deterministic JSON and exit codes', () => {
  const { temp, rootDir } = createTempGraph({
    'src/main/main.ts': "import './forbidden';\n",
    'src/main/forbidden.ts': 'export const forbidden = true;\n',
  });
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'audit-startup-imports.js');
    const ok = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).status, 'ok');

    const fail = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--root',
        rootDir,
        '--entry',
        'src/main/main.ts',
        '--forbid-local',
        'src/main/forbidden.ts',
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(fail.status, 0);
    const parsed = JSON.parse(fail.stdout) as { status: string; violations: unknown[] };
    assert.equal(parsed.status, 'fail');
    assert.equal(parsed.violations.length, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('startup import audit script and package hook do not build, package, or write', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  const auditScript = pkg.scripts['startup:audit'];
  assert.equal(auditScript, 'node scripts/audit-startup-imports.js');
  assert.doesNotMatch(auditScript, /&&|electron-builder|npm run dist|npm run build/);

  const source = fs.readFileSync('scripts/audit-startup-imports.js', 'utf8');
  assert.doesNotMatch(source, /electron-builder/);
  assert.doesNotMatch(source, /npm\s+run\s+dist/);
  assert.doesNotMatch(source, /npm\s+run\s+build/);
  assert.doesNotMatch(source, /rmSync|cpSync|mkdirSync|writeFileSync/);
});
