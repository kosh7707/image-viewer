#!/usr/bin/env node
/**
 * Electron runtime smoke probe for the real built renderer/preload pair.
 *
 * The normal node:test suite can prove pure logic, but it cannot prove that the
 * browser-loaded renderer is executable in a sandboxed Chromium renderer or
 * that the GIF worker can create/transfer ImageBitmaps. This script runs under
 * Electron and intentionally keeps the window hidden while probing those facts.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'src');
const TWO_FRAME_GIF = Buffer.from(
  '47494638396101000100F00000FFFFFF00000021F90404640000002C000000000100010000020244010021F90404640000002C0000000001000100000202440100' +
    '3B',
  'hex',
);

let tempDir = null;

function writeResult(status, details) {
  const resultPath = process.env.IMAGE_VIEWER_SMOKE_RESULT;
  if (!resultPath) return;
  try {
    fs.writeFileSync(resultPath, JSON.stringify({ status, details }, null, 2));
  } catch {
    // ignore result-write failures; the parent process timeout will report it.
  }
}

function trace(message) {
  const tracePath = process.env.IMAGE_VIEWER_SMOKE_TRACE;
  if (!tracePath) return;
  try {
    fs.appendFileSync(tracePath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // ignore
  }
}

function cleanup() {
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function fail(message, details) {
  if (details) console.error(details);
  console.error(`SMOKE_FAIL ${message}`);
  writeResult('fail', { message, details });
  cleanup();
  app.exit(1);
}

function installIpc() {
  ipcMain.handle('window:toggleFullscreen', () => false);
  ipcMain.handle('menu:show', () => undefined);
  ipcMain.handle('speed:update', () => undefined);
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('dialog:openFile', () => undefined);
  ipcMain.handle('dialog:openFolder', () => undefined);
  ipcMain.handle('fs:readFile', async (_event, filePath) => {
    return await fs.promises.readFile(filePath);
  });
}

async function waitFor(win, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await win.webContents.executeJavaScript(expression, true);
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

function writeUInt24LE(buf, value, offset) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new Error(`uint24 out of range: ${value}`);
  }
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
}

function makeChunk(fourcc, payload) {
  if (fourcc.length !== 4) throw new Error(`invalid FourCC: ${fourcc}`);
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return payload.length % 2 === 0
    ? Buffer.concat([header, payload])
    : Buffer.concat([header, payload, Buffer.from([0])]);
}

function extractWebpFrameChunks(webp) {
  if (
    webp.length < 12 ||
    webp.toString('ascii', 0, 4) !== 'RIFF' ||
    webp.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('renderer did not produce a RIFF/WEBP frame');
  }

  const chunks = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const fourcc = webp.toString('ascii', offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + size;
    const paddedEnd = payloadEnd + (size % 2);
    if (payloadEnd > webp.length || paddedEnd > webp.length) {
      throw new Error(`truncated WebP chunk ${fourcc}`);
    }
    if (fourcc === 'ALPH' || fourcc === 'VP8 ' || fourcc === 'VP8L') {
      chunks.push(webp.subarray(offset, paddedEnd));
    }
    offset = paddedEnd;
  }
  if (chunks.length === 0) throw new Error('no VP8/VP8L frame chunk found');
  return Buffer.concat(chunks);
}

function makeAnimatedWebp(frameWebps, width, height, durationMs) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // Animation flag.
  writeUInt24LE(vp8x, width - 1, 4);
  writeUInt24LE(vp8x, height - 1, 7);

  const anim = Buffer.alloc(6);
  // Transparent black BGRA background and loop-count 0 (infinite).
  anim.writeUInt32LE(0, 0);
  anim.writeUInt16LE(0, 4);

  const frames = frameWebps.map((webp) => {
    const header = Buffer.alloc(16);
    writeUInt24LE(header, 0, 0); // X
    writeUInt24LE(header, 0, 3); // Y
    writeUInt24LE(header, width - 1, 6);
    writeUInt24LE(header, height - 1, 9);
    writeUInt24LE(header, durationMs, 12);
    header[15] = 0; // Blend + do not dispose; full opaque frames make this deterministic.
    return makeChunk('ANMF', Buffer.concat([header, extractWebpFrameChunks(webp)]));
  });

  const body = Buffer.concat([makeChunk('VP8X', vp8x), makeChunk('ANIM', anim), ...frames]);
  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 4, 'ascii');
  riffHeader.writeUInt32LE(body.length + 4, 4);
  riffHeader.write('WEBP', 8, 4, 'ascii');
  return Buffer.concat([riffHeader, body]);
}

async function renderStaticWebpFrame(win, color) {
  const b64 = await win.webContents.executeJavaScript(
    `
    (() => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const ctx = c.getContext('2d');
      ctx.fillStyle = ${JSON.stringify(color)};
      ctx.fillRect(0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/webp');
      if (!dataUrl.startsWith('data:image/webp;base64,')) {
        throw new Error('canvas did not produce image/webp');
      }
      return dataUrl.split(',')[1];
    })()
  `,
    true,
  );
  return Buffer.from(b64, 'base64');
}

async function writeRendererGeneratedStaticWebp(win, dir) {
  const filePath = path.join(dir, 'native-route.webp');
  fs.writeFileSync(filePath, await renderStaticWebpFrame(win, '#00ff00'));
  return filePath;
}

async function writeRendererGeneratedAnimatedWebp(win, dir) {
  const red = await renderStaticWebpFrame(win, '#ff0000');
  const blue = await renderStaticWebpFrame(win, '#0000ff');
  const filePath = path.join(dir, 'animated-route.webp');
  fs.writeFileSync(filePath, makeAnimatedWebp([red, blue], 4, 4, 120));
  return filePath;
}

async function main() {
  trace('main:start');
  installIpc();
  await app.whenReady();
  trace('app:ready');

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-smoke-'));
  const gifPath = path.join(tempDir, 'two-frame.gif');
  fs.writeFileSync(gifPath, TWO_FRAME_GIF);

  const win = new BrowserWindow({
    show: true,
    width: 640,
    height: 480,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(DIST, 'preload', 'preload.js'),
    },
  });
  trace('window:created');

  win.webContents.on('render-process-gone', (_event, details) => {
    fail('render process gone', JSON.stringify(details));
  });
  win.webContents.on('did-start-loading', () => trace('event:did-start-loading'));
  win.webContents.on('dom-ready', () => trace('event:dom-ready'));
  win.webContents.on('did-finish-load', () => trace('event:did-finish-load'));
  win.webContents.on('did-fail-load', (_event, code, description) => {
    trace(`event:did-fail-load:${code}:${description}`);
    fail('did-fail-load', `${code} ${description}`);
  });

  await win.loadFile(path.join(DIST, 'renderer', 'index.html'));
  trace('window:loaded');
  await waitFor(win, 'Boolean(window.__viewer && window.api)', 5_000, 'viewer bootstrap');
  trace('viewer:ready');

  win.webContents.send('album:load', {
    folder: tempDir,
    entries: [{ path: gifPath, mtimeMs: Date.now() }],
    currentIndex: 0,
  });

  const decoded = await waitFor(
    win,
    '(() => { const h = window.__viewer && window.__viewer.gifHost; return h && h.gif && h.gif.frames.length >= 2; })()',
    7_000,
    'GIF decode',
  );
  trace('gif:decoded');
  if (!decoded) throw new Error('GIF did not decode');

  const advanced = await waitFor(
    win,
    '(() => { const h = window.__viewer && window.__viewer.gifHost; return h && h.currentFrameIdx > 0; })()',
    3_000,
    'GIF frame advance',
  );
  trace('gif:advanced');
  if (!advanced) throw new Error('GIF did not advance frames');

  const webpSupport = await win.webContents.executeJavaScript(
    `(
      async () => ({
        hasImageDecoder: typeof ImageDecoder !== 'undefined',
        secure: isSecureContext,
        supported: typeof ImageDecoder !== 'undefined'
          ? await ImageDecoder.isTypeSupported('image/webp')
          : false
      })
    )()`,
    true,
  );
  trace(`webp:support:${JSON.stringify(webpSupport)}`);
  if (!webpSupport.hasImageDecoder || !webpSupport.supported) {
    throw new Error(`ImageDecoder image/webp unsupported: ${JSON.stringify(webpSupport)}`);
  }

  const animatedWebpPath = await writeRendererGeneratedAnimatedWebp(win, tempDir);
  trace('webp:animated-fixture');
  win.webContents.send('album:load', {
    folder: tempDir,
    entries: [
      {
        path: animatedWebpPath,
        mtimeMs: Date.now(),
        width: 4,
        height: 4,
        frameCount: 2,
        estimatedBytes: 4 * 4 * 4 * 2,
      },
    ],
    currentIndex: 0,
  });
  const escapedAnimatedWebpPath = JSON.stringify(animatedWebpPath);
  await waitFor(
    win,
    `(() => {
      const img = document.getElementById('fallback-gif');
      const h = window.__viewer && window.__viewer.gifHost;
      const governor = window.__viewer && window.__viewer.governor;
      return Boolean(
        img &&
          !img.classList.contains('active') &&
          img.hidden === true &&
          h &&
          h.gif &&
          h.gif.frames.length >= 2 &&
          governor &&
          !governor.has(${escapedAnimatedWebpPath})
      );
    })()`,
    7_000,
    'animated WebP WebCodecs route',
  );
  trace('webp:animated-decoded');

  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`,
    true,
  );
  await waitFor(
    win,
    `(() => {
      const hud = document.querySelector('.speed-hud');
      const h = window.__viewer && window.__viewer.gifHost;
      return Boolean(
        hud &&
          hud.classList.contains('active') &&
          hud.textContent === '1.1×' &&
          h &&
          h.speedMultiplier === 1.1
      );
    })()`,
    2_000,
    'animated WebP speed HUD',
  );
  trace('webp:speed-hud');

  trace(
    `webp:animated-state:${JSON.stringify(
      await win.webContents.executeJavaScript(
        `(() => {
          const h = window.__viewer && window.__viewer.gifHost;
          return {
            idx: h && h.currentFrameIdx,
            advances: h && h.frameAdvanceCount,
            delays: h && h.gif && h.gif.delays,
            speed: h && h.speedMultiplier,
            elapsed: h && h.elapsedSinceLastFrame,
            lastTimestamp: h && h.lastTimestamp
          };
        })()`,
        true,
      ),
    )}`,
  );

  const slowStart = await win.webContents.executeJavaScript(
    `(() => {
      const h = window.__viewer && window.__viewer.gifHost;
      h.speedMultiplier = 0.1;
      return h.frameAdvanceCount;
    })()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const slowEnd = await win.webContents.executeJavaScript(
    `(() => {
      const h = window.__viewer && window.__viewer.gifHost;
      return h.frameAdvanceCount;
    })()`,
    true,
  );
  const slowDelta = slowEnd - slowStart;
  trace(
    `webp:slow-state:${JSON.stringify(
      await win.webContents.executeJavaScript(
        `(() => {
          const h = window.__viewer && window.__viewer.gifHost;
          return {
            idx: h && h.currentFrameIdx,
            advances: h && h.frameAdvanceCount,
            speed: h && h.speedMultiplier,
            elapsed: h && h.elapsedSinceLastFrame,
            lastTimestamp: h && h.lastTimestamp
          };
        })()`,
        true,
      ),
    )}:delta=${slowDelta}`,
  );

  const fastStart = await win.webContents.executeJavaScript(
    `(() => {
      const h = window.__viewer && window.__viewer.gifHost;
      h.speedMultiplier = 4;
      return h.frameAdvanceCount;
    })()`,
    true,
  );
  await waitFor(
    win,
    `(() => {
      const h = window.__viewer && window.__viewer.gifHost;
      return h.frameAdvanceCount - ${JSON.stringify(fastStart)} > ${JSON.stringify(slowDelta)};
    })()`,
    1_500,
    'animated WebP fast speed advances more than slow speed',
  );
  trace('webp:animated-speed');

  const staticWebpPath = await writeRendererGeneratedStaticWebp(win, tempDir);
  trace('webp:static-fixture');
  win.webContents.send('album:load', {
    folder: tempDir,
    entries: [
      {
        path: staticWebpPath,
        mtimeMs: Date.now(),
        width: 4,
        height: 4,
        frameCount: 1,
        estimatedBytes: 4 * 4 * 4,
      },
    ],
    currentIndex: 0,
  });
  const escapedStaticWebpPath = JSON.stringify(staticWebpPath);
  await waitFor(
    win,
    `(() => {
      const img = document.getElementById('fallback-gif');
      const h = window.__viewer && window.__viewer.gifHost;
      const governor = window.__viewer && window.__viewer.governor;
      return Boolean(
        img &&
          !img.classList.contains('active') &&
          img.hidden === true &&
          h &&
          !h.gif &&
          governor &&
          governor.has(${escapedStaticWebpPath})
      );
    })()`,
    5_000,
    'static WebP canvas/cache route',
  );
  trace('webp:static-cache-route');

  writeResult('ok', {
    message:
      'renderer booted, GIF advanced, animated WebP speed HUD worked, and static WebP used canvas/cache',
  });
  console.log(
    'SMOKE_OK renderer booted, GIF advanced, animated WebP speed HUD worked, and static WebP used canvas/cache',
  );
  cleanup();
  app.exit(0);
}

main().catch((err) => {
  fail('exception', err && err.stack ? err.stack : String(err));
});
