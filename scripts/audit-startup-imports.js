#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_FORBIDDEN_LOCAL_MODULES = [
  'src/main/album-flow.ts',
  'src/main/measure.ts',
  'src/main/album-loader.ts',
  'src/main/walk.ts',
  'src/main/preferences.ts',
  'src/shared/user-preferences.ts',
  'src/main/rss.ts',
];
const DEFAULT_FORBIDDEN_PACKAGES = ['gifuct-js', 'image-size'];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function relativeToRoot(rootDir, filePath) {
  return toPosixPath(path.relative(rootDir, filePath));
}

function resolveFromRoot(rootDir, target) {
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(rootDir, target);
}

function normalizeForbiddenLocalModules(rootDir, forbiddenLocalModules) {
  return new Set(forbiddenLocalModules.map((target) => resolveFromRoot(rootDir, target)));
}

function isRelativeSpecifier(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === '.' ||
    specifier === '..'
  );
}

function packageRoot(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

function isForbiddenPackage(specifier, forbiddenPackages) {
  return forbiddenPackages.some(
    (forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
  );
}

function resolveSourceFile(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const ext = path.extname(base);
  if (ext && fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  for (const sourceExt of SOURCE_EXTENSIONS) {
    const candidate = `${base}${sourceExt}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  for (const sourceExt of SOURCE_EXTENSIONS) {
    const candidate = path.join(base, `index${sourceExt}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  return null;
}

function scriptKindForFile(filePath) {
  switch (path.extname(filePath)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function textOfModuleSpecifier(node) {
  const moduleSpecifier = node.moduleSpecifier;
  if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) return moduleSpecifier.text;
  return null;
}

function collectRuntimeStaticSpecifiers(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(filePath),
  );
  const specifiers = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause && statement.importClause.isTypeOnly) continue;
      const specifier = textOfModuleSpecifier(statement);
      if (specifier) specifiers.push(specifier);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const specifier = textOfModuleSpecifier(statement);
      if (specifier) specifiers.push(specifier);
    }
  }

  return specifiers;
}

function makeLocalViolation(rootDir, importer, specifier, resolved, chain) {
  const target = relativeToRoot(rootDir, resolved);
  return {
    kind: 'local',
    target,
    specifier,
    importer: relativeToRoot(rootDir, importer),
    chain: [...chain.map((file) => relativeToRoot(rootDir, file)), target],
  };
}

function makePackageViolation(rootDir, importer, specifier, forbiddenPackage, chain) {
  return {
    kind: 'package',
    target: forbiddenPackage,
    specifier,
    importer: relativeToRoot(rootDir, importer),
    chain: chain.map((file) => relativeToRoot(rootDir, file)),
  };
}

function auditStartupImports(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const entry = resolveFromRoot(rootDir, options.entry ?? 'src/main/main.ts');
  const forbiddenLocalModules = normalizeForbiddenLocalModules(
    rootDir,
    options.forbiddenLocalModules ?? DEFAULT_FORBIDDEN_LOCAL_MODULES,
  );
  const forbiddenPackages = options.forbiddenPackages ?? DEFAULT_FORBIDDEN_PACKAGES;
  const visited = new Set();
  const violations = [];
  const violationKeys = new Set();

  function addViolation(violation) {
    const key = `${violation.kind}:${violation.importer}:${violation.specifier}:${violation.target}`;
    if (violationKeys.has(key)) return;
    violationKeys.add(key);
    violations.push(violation);
  }

  function visit(filePath, chain) {
    const resolvedFile = path.resolve(filePath);
    if (visited.has(resolvedFile)) return;
    visited.add(resolvedFile);

    for (const specifier of collectRuntimeStaticSpecifiers(resolvedFile)) {
      if (!isRelativeSpecifier(specifier)) {
        if (isForbiddenPackage(specifier, forbiddenPackages)) {
          addViolation(
            makePackageViolation(rootDir, resolvedFile, specifier, packageRoot(specifier), chain),
          );
        }
        continue;
      }

      const resolvedImport = resolveSourceFile(resolvedFile, specifier);
      if (!resolvedImport) continue;
      if (forbiddenLocalModules.has(resolvedImport)) {
        addViolation(makeLocalViolation(rootDir, resolvedFile, specifier, resolvedImport, chain));
        continue;
      }
      visit(resolvedImport, [...chain, resolvedImport]);
    }
  }

  visit(entry, [entry]);

  return {
    status: violations.length === 0 ? 'ok' : 'fail',
    entry: relativeToRoot(rootDir, entry),
    rootDir,
    visited: Array.from(visited).map((file) => relativeToRoot(rootDir, file)),
    violations,
  };
}

function parseList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--root') {
      options.rootDir = next;
      index += 1;
    } else if (arg === '--entry') {
      options.entry = next;
      index += 1;
    } else if (arg === '--forbid-local') {
      options.forbiddenLocalModules = parseList(next);
      index += 1;
    } else if (arg === '--forbid-package') {
      options.forbiddenPackages = parseList(next);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    'usage: node scripts/audit-startup-imports.js [--root <dir>] [--entry <file>]',
    '       [--forbid-local <file[,file...]>] [--forbid-package <pkg[,pkg...]>]',
  ].join('\n');
}

function runCli(argv) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const result = auditStartupImports(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'ok' ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv);
}

module.exports = {
  auditStartupImports,
  collectRuntimeStaticSpecifiers,
};
