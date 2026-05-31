#!/usr/bin/env node
/**
 * Bundles renderer-side code for Chromium.
 *
 * `tsc` intentionally emits CommonJS for Electron main/preload. That output is
 * not directly runnable from `index.html` because sandboxed renderers do not
 * have CommonJS globals such as `require` or `exports`. This script overwrites
 * only the browser-loaded renderer entrypoints with self-contained bundles.
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DIST_RENDERER = path.join(ROOT, 'dist', 'src', 'renderer');

async function bundle() {
  const common = {
    bundle: true,
    platform: 'browser',
    target: 'chrome124',
    format: 'iife',
    sourcemap: true,
    logLevel: 'info',
  };

  fs.rmSync(path.join(DIST_RENDERER, 'chunks'), { recursive: true, force: true });

  await esbuild.build({
    bundle: true,
    platform: 'browser',
    target: 'chrome124',
    format: 'esm',
    splitting: true,
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'renderer.ts')],
    outdir: DIST_RENDERER,
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
  });

  await esbuild.build({
    ...common,
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'workers', 'gif-decoder.worker.ts')],
    outfile: path.join(ROOT, 'dist', 'src', 'renderer', 'workers', 'gif-decoder.worker.js'),
  });
}

bundle().catch((err) => {
  console.error('[bundle-renderer] failed');
  console.error(err);
  process.exitCode = 1;
});
