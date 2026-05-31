import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readBuiltAsset(relativePath: string): string {
  const full = path.join(process.cwd(), relativePath);
  assert.equal(fs.existsSync(full), true, `${relativePath} must exist after npm run build`);
  return fs.readFileSync(full, 'utf8');
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function runtimeSourceImports(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('import type '))
    .join('\n');
}

function rendererChunks(): Array<{ name: string; text: string }> {
  const chunkDir = path.join(process.cwd(), 'dist', 'src', 'renderer', 'chunks');
  assert.equal(fs.existsSync(chunkDir), true, 'renderer chunks directory must exist');
  return fs
    .readdirSync(chunkDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({
      name,
      text: fs.readFileSync(path.join(chunkDir, name), 'utf8'),
    }));
}

test('renderer source lazy-loads rare dialogs instead of statically importing them', () => {
  const src = readSource('src/renderer/renderer.ts');
  const runtimeImports = runtimeSourceImports(src);

  assert.equal(runtimeImports.includes("from './sort-dialog'"), false);
  assert.equal(runtimeImports.includes("from './settings-dialog'"), false);
  assert.match(src, /import\(['"]\.\/sort-dialog['"]\)/);
  assert.match(src, /import\(['"]\.\/settings-dialog['"]\)/);
});

test('renderer build is configured for ESM code splitting', () => {
  const src = readSource('scripts/bundle-renderer.js');

  assert.match(src, /format:\s*['"]esm['"]/);
  assert.match(src, /splitting:\s*true/);
  assert.match(src, /outdir:/);
  assert.match(src, /chunkNames:\s*['"]chunks\//);
  assert.match(src, /rmSync\(.*chunks/);
});

test('renderer browser bundle is ESM, split, and not raw CommonJS output', () => {
  const js = readBuiltAsset(path.join('dist', 'src', 'renderer', 'renderer.js'));
  const chunks = rendererChunks();

  assert.match(js, /import\(["'][^"']*chunks\//);
  assert.doesNotMatch(js, /(class|var) SortDialog/);
  assert.doesNotMatch(js, /(class|var) SettingsDialog/);
  assert.ok(
    chunks.some((chunk) => /(class|var) SortDialog/.test(chunk.text)),
    'SortDialog implementation must live in a lazy chunk',
  );
  assert.ok(
    chunks.some((chunk) => /(class|var) SettingsDialog/.test(chunk.text)),
    'SettingsDialog implementation must live in a lazy chunk',
  );
  assert.doesNotMatch(js, /^"use strict";\s*Object\.defineProperty\s*\(\s*exports/m);
  assert.doesNotMatch(js, /^Object\.defineProperty\s*\(\s*exports/m);
});

test('GIF worker browser bundle is not raw CommonJS output', () => {
  const js = readBuiltAsset(
    path.join('dist', 'src', 'renderer', 'workers', 'gif-decoder.worker.js'),
  );
  assert.match(js, /\(\(\) => \{/);
  assert.doesNotMatch(js, /^"use strict";\s*Object\.defineProperty\s*\(\s*exports/m);
  assert.doesNotMatch(js, /^Object\.defineProperty\s*\(\s*exports/m);
});
