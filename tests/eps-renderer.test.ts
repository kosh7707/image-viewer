import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderEpsToPng } from '../src/main/eps-renderer';

test('renderEpsToPng renders EPS to PNG without modifying the source file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-eps-render-'));
  const epsPath = path.join(dir, 'sample.eps');
  const eps = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: 0 0 120 70',
    '%%Title: ImageViewer EPS smoke',
    '%%EndComments',
    '1 1 1 setrgbcolor 0 0 120 70 rectfill',
    '0.1 0.3 0.9 setrgbcolor 15 15 90 40 rectfill',
    '/Helvetica findfont 12 scalefont setfont',
    '0 0 0 setrgbcolor 20 35 moveto (EPS OK) show',
    'showpage',
    '%%EOF',
    '',
  ].join('\n');

  try {
    fs.writeFileSync(epsPath, eps, 'utf8');
    const before = {
      bytes: fs.readFileSync(epsPath),
      mtimeMs: fs.statSync(epsPath).mtimeMs,
    };

    const result = await renderEpsToPng(epsPath, { timeoutMs: 10_000 });

    assert.equal(isPng(result.data), true);
    assert.equal(result.width, 240);
    assert.equal(result.height, 140);
    assert.equal(result.data.byteLength > 0, true);
    assert.deepEqual(fs.readFileSync(epsPath), before.bytes);
    assert.equal(fs.statSync(epsPath).mtimeMs, before.mtimeMs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderEpsToPng reports invalid EPS as a render failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-eps-invalid-'));
  const epsPath = path.join(dir, 'bad.eps');
  try {
    fs.writeFileSync(
      epsPath,
      ['%!PS-Adobe-3.0 EPSF-3.0', '%%BoundingBox: 0 0 100 100', 'NOT_A_COMMAND', '%%EOF'].join(
        '\n',
      ),
      'utf8',
    );

    await assert.rejects(() => renderEpsToPng(epsPath, { timeoutMs: 10_000 }), /Ghostscript/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}
