#!/usr/bin/env node
/**
 * Copies static renderer assets (HTML, CSS) into the dist tree so that
 * `loadFile('dist/src/renderer/index.html')` works after `tsc`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer');
const DST = path.join(ROOT, 'dist', 'src', 'renderer');

const STATIC_FILES = ['index.html', 'styles.css'];

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function copy() {
  ensureDir(DST);
  for (const name of STATIC_FILES) {
    const from = path.join(SRC, name);
    const to = path.join(DST, name);
    if (!fs.existsSync(from)) {
      console.warn(`[copy-assets] skip missing: ${from}`);
      continue;
    }
    fs.copyFileSync(from, to);
    console.log(`[copy-assets] ${path.relative(ROOT, from)} -> ${path.relative(ROOT, to)}`);
  }
}

copy();
