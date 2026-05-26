import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

test('portable package shows a splash bitmap during self-extraction', () => {
  const config = fs.readFileSync('electron-builder.yml', 'utf8');
  assert.match(config, /portable:\s*\n(?: {2}.+\n)* {2}splashImage: build\/portable-splash\.bmp/);

  const splash = fs.readFileSync('build/portable-splash.bmp');
  assert.equal(splash.subarray(0, 2).toString('ascii'), 'BM');
  assert.ok(splash.byteLength > 1000, 'splash bitmap should be a real BMP asset');
});
