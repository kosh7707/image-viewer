import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CacheGovernor } from '../src/renderer/cache-governor';
import { PreloadQueue, type PreloadProgress } from '../src/renderer/preload-queue';

interface RuntimeGlobals {
  window?: {
    api: {
      readFile(filePath: string): Promise<Uint8Array>;
    };
  };
  createImageBitmap?: (source: Blob) => Promise<ImageBitmap>;
}

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

function withRendererRuntime<T>(
  files: Record<string, Uint8Array>,
  run: (calls: { reads: string[]; decodes: Blob[]; bitmaps: FakeBitmap[] }) => Promise<T>,
): Promise<T> {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldWindow = globals.window;
  const oldCreateImageBitmap = globals.createImageBitmap;
  const calls = { reads: [] as string[], decodes: [] as Blob[], bitmaps: [] as FakeBitmap[] };

  globals.window = {
    api: {
      async readFile(filePath: string): Promise<Uint8Array> {
        calls.reads.push(filePath);
        const bytes = files[filePath];
        if (!bytes) throw new Error(`missing fixture: ${filePath}`);
        return bytes;
      },
    },
  };
  globals.createImageBitmap = async (source: Blob): Promise<ImageBitmap> => {
    calls.decodes.push(source);
    const bitmap: FakeBitmap = {
      width: 2,
      height: 3,
      closed: false,
      close(): void {
        this.closed = true;
      },
    };
    calls.bitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  };

  return run(calls).finally(() => {
    globals.window = oldWindow;
    globals.createImageBitmap = oldCreateImageBitmap;
  });
}

test('PreloadQueue scheduleAll preloads measured static WebP entries into the cache', async () => {
  await withRendererRuntime({ '/p/static.webp': new Uint8Array([1, 2, 3]) }, async (calls) => {
    const governor = new CacheGovernor();
    const queue = new PreloadQueue(governor);

    const final = await waitForPreload(queue, [
      { path: '/p/static.webp', mtimeMs: 1, frameCount: 1 },
      { path: '/p/animated.webp', mtimeMs: 1, frameCount: 2 },
      { path: '/p/unknown.webp', mtimeMs: 1 },
      { path: '/p/skip.gif', mtimeMs: 1 },
    ]);

    assert.deepEqual(calls.reads, ['/p/static.webp']);
    assert.equal(calls.decodes.length, 1);
    assert.equal(final.total, 1);
    assert.equal(final.completed, 1);
    assert.equal(governor.has('/p/static.webp'), true);
    assert.equal(governor.has('/p/animated.webp'), false);
    assert.equal(governor.has('/p/unknown.webp'), false);
    assert.equal(governor.has('/p/skip.gif'), false);
  });
});

test('PreloadQueue preloads path-only static images and leaves unknown animations off bitmap cache', async () => {
  await withRendererRuntime(
    {
      '/p/a.png': new Uint8Array([1, 2, 3]),
      '/p/b.jpg': new Uint8Array([4, 5, 6]),
    },
    async (calls) => {
      const governor = new CacheGovernor();
      const queue = new PreloadQueue(governor);

      const final = await waitForPreload(queue, [
        { path: '/p/a.png', mtimeMs: 1 },
        { path: '/p/unknown.webp', mtimeMs: 2 },
        { path: '/p/motion.gif', mtimeMs: 3 },
        { path: '/p/b.jpg', mtimeMs: 4 },
      ]);

      assert.deepEqual(calls.reads, ['/p/a.png', '/p/b.jpg']);
      assert.equal(final.total, 2);
      assert.equal(final.completed, 2);
      assert.equal(governor.has('/p/a.png'), true);
      assert.equal(governor.has('/p/b.jpg'), true);
      assert.equal(governor.has('/p/unknown.webp'), false);
      assert.equal(governor.has('/p/motion.gif'), false);
    },
  );
});

test('PreloadQueue refuses animated WebP bytes before createImageBitmap can collapse animation', async () => {
  await withRendererRuntime(
    { '/p/animated.webp': makeAnimatedWebpContainer(3, 2, 2) },
    async (calls) => {
      const governor = new CacheGovernor();
      const queue = new PreloadQueue(governor);

      const bitmap = await queue.fetchAndDecode('/p/animated.webp');

      assert.equal(bitmap, null);
      assert.deepEqual(calls.reads, ['/p/animated.webp']);
      assert.equal(calls.decodes.length, 0);
      assert.equal(governor.has('/p/animated.webp'), false);
    },
  );
});

test('PreloadQueue joins a matching in-flight decode instead of returning null', async () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldWindow = globals.window;
  const oldCreateImageBitmap = globals.createImageBitmap;
  const reads: string[] = [];
  const bitmaps: FakeBitmap[] = [];
  let releaseRead: ((bytes: Uint8Array) => void) | null = null;
  const readGate = new Promise<Uint8Array>((resolve) => {
    releaseRead = resolve;
  });

  globals.window = {
    api: {
      async readFile(filePath: string): Promise<Uint8Array> {
        reads.push(filePath);
        return await readGate;
      },
    },
  };
  globals.createImageBitmap = async (): Promise<ImageBitmap> => {
    const bitmap: FakeBitmap = {
      width: 2,
      height: 3,
      closed: false,
      close(): void {
        this.closed = true;
      },
    };
    bitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  };

  try {
    const governor = new CacheGovernor();
    const queue = new PreloadQueue(governor);
    const epoch = 1;
    queue.setEpochSupplier(() => epoch);

    const first = queue.fetchAndDecode('/p/a.png', epoch);
    await Promise.resolve();
    const second = queue.fetchAndDecode('/p/a.png', epoch);

    releaseRead!(new Uint8Array([1, 2, 3]));
    const [firstBitmap, secondBitmap] = await Promise.all([first, second]);

    assert.equal(firstBitmap, secondBitmap);
    assert.equal(firstBitmap, bitmaps[0]);
    assert.deepEqual(reads, ['/p/a.png']);
    assert.equal(governor.has('/p/a.png'), true);
  } finally {
    globals.window = oldWindow;
    globals.createImageBitmap = oldCreateImageBitmap;
  }
});

test('PreloadQueue schedules closest static entries that fit the RAM budget', async () => {
  await withRendererRuntime(
    {
      '/p/a.png': new Uint8Array([1]),
      '/p/b.png': new Uint8Array([1]),
      '/p/c.png': new Uint8Array([1]),
      '/p/d.png': new Uint8Array([1]),
      '/p/stale.png': new Uint8Array([1]),
    },
    async (calls) => {
      const governor = new CacheGovernor({ maxBytes: 12, maxEntries: Number.MAX_SAFE_INTEGER });
      governor.admit('/p/stale.png', {
        width: 1,
        height: 1,
        close() {
          // test fake
        },
      });
      const queue = new PreloadQueue(governor);

      const final = await waitForPreload(
        queue,
        [
          { path: '/p/a.png', mtimeMs: 1, estimatedBytes: 4 },
          { path: '/p/b.png', mtimeMs: 1, estimatedBytes: 4 },
          { path: '/p/c.png', mtimeMs: 1, estimatedBytes: 20 },
          { path: '/p/d.png', mtimeMs: 1, estimatedBytes: 4 },
        ],
        {
          currentIndex: 1,
          allowedPaths: new Set(['/p/a.png', '/p/b.png', '/p/d.png']),
        },
      );

      assert.deepEqual(calls.reads, ['/p/b.png', '/p/a.png', '/p/d.png']);
      assert.equal(final.total, 3);
      assert.equal(final.completed, 3);
      assert.equal(governor.has('/p/stale.png'), false);
    },
  );
});

test('PreloadQueue drops an in-flight scheduled decode after the RAM plan changes', async () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldWindow = globals.window;
  const oldCreateImageBitmap = globals.createImageBitmap;
  const reads: string[] = [];
  const bitmaps: FakeBitmap[] = [];
  let releaseRead: ((bytes: Uint8Array) => void) | null = null;
  const readGate = new Promise<Uint8Array>((resolve) => {
    releaseRead = resolve;
  });

  globals.window = {
    api: {
      async readFile(filePath: string): Promise<Uint8Array> {
        reads.push(filePath);
        return await readGate;
      },
    },
  };
  globals.createImageBitmap = async (): Promise<ImageBitmap> => {
    const bitmap: FakeBitmap = {
      width: 2,
      height: 3,
      closed: false,
      close(): void {
        this.closed = true;
      },
    };
    bitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  };

  try {
    const governor = new CacheGovernor({ maxBytes: 4, maxEntries: Number.MAX_SAFE_INTEGER });
    const queue = new PreloadQueue(governor);
    const firstDone = new Promise<PreloadProgress>((resolve) => {
      queue.scheduleAll(
        [{ path: '/p/a.png', mtimeMs: 1, estimatedBytes: 4 }],
        0,
        (progress) => {
          if (progress.completed >= progress.total) resolve(progress);
        },
        { currentIndex: 0, allowedPaths: new Set(['/p/a.png']) },
      );
    });
    await waitFor(() => reads.length === 1);

    queue.scheduleAll([{ path: '/p/a.png', mtimeMs: 1, estimatedBytes: 4 }], 0, undefined, {
      currentIndex: 0,
      allowedPaths: new Set(),
    });
    releaseRead!(new Uint8Array([1, 2, 3]));

    const final = await firstDone;
    assert.equal(final.completed, 1);
    assert.equal(governor.has('/p/a.png'), false);
    assert.equal(bitmaps[0]?.closed, true);
  } finally {
    globals.window = oldWindow;
    globals.createImageBitmap = oldCreateImageBitmap;
  }
});

test('PreloadQueue can protect an oversized current static decode from immediate eviction', async () => {
  await withRendererRuntime({ '/p/huge.png': new Uint8Array([1]) }, async () => {
    const governor = new CacheGovernor({ maxBytes: 4, maxEntries: Number.MAX_SAFE_INTEGER });
    governor.setOrder(['/p/huge.png']);
    governor.setCurrentIndex(0);
    const queue = new PreloadQueue(governor);

    const bitmap = await queue.fetchAndDecode('/p/huge.png', 0, { protectAdmitted: true });

    assert.ok(bitmap);
    assert.equal(governor.has('/p/huge.png'), true);
    assert.equal(governor.bytes(), 24);
  });
});

test('PreloadQueue upgrades an in-flight scheduled decode when current render joins it', async () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldWindow = globals.window;
  const oldCreateImageBitmap = globals.createImageBitmap;
  let releaseRead: ((bytes: Uint8Array) => void) | null = null;
  const readGate = new Promise<Uint8Array>((resolve) => {
    releaseRead = resolve;
  });

  globals.window = {
    api: {
      async readFile(): Promise<Uint8Array> {
        return await readGate;
      },
    },
  };
  globals.createImageBitmap = async (): Promise<ImageBitmap> =>
    ({ width: 2, height: 3, close() {} }) as unknown as ImageBitmap;

  try {
    const governor = new CacheGovernor({ maxBytes: 4, maxEntries: Number.MAX_SAFE_INTEGER });
    governor.setOrder(['/p/current.png']);
    governor.setCurrentIndex(0);
    const queue = new PreloadQueue(governor);
    const scheduled = waitForPreload(
      queue,
      [{ path: '/p/current.png', mtimeMs: 1, estimatedBytes: 4 }],
      { currentIndex: 0, allowedPaths: new Set(['/p/current.png']) },
    );
    await Promise.resolve();

    const current = queue.fetchAndDecode('/p/current.png', 0, { protectAdmitted: true });
    releaseRead!(new Uint8Array([1]));
    assert.ok(await current);
    await scheduled;

    assert.equal(governor.has('/p/current.png'), true);
    assert.equal(governor.bytes(), 24);
  } finally {
    globals.window = oldWindow;
    globals.createImageBitmap = oldCreateImageBitmap;
  }
});

test('PreloadQueue lets current render rescue a cancelled scheduled decode', async () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldWindow = globals.window;
  const oldCreateImageBitmap = globals.createImageBitmap;
  let releaseRead: ((bytes: Uint8Array) => void) | null = null;
  const readGate = new Promise<Uint8Array>((resolve) => {
    releaseRead = resolve;
  });

  globals.window = {
    api: {
      async readFile(): Promise<Uint8Array> {
        return await readGate;
      },
    },
  };
  globals.createImageBitmap = async (): Promise<ImageBitmap> =>
    ({ width: 2, height: 3, close() {} }) as unknown as ImageBitmap;

  try {
    const governor = new CacheGovernor({ maxBytes: 4, maxEntries: Number.MAX_SAFE_INTEGER });
    governor.setOrder(['/p/current.png']);
    governor.setCurrentIndex(0);
    const queue = new PreloadQueue(governor);
    const scheduled = waitForPreload(
      queue,
      [{ path: '/p/current.png', mtimeMs: 1, estimatedBytes: 4 }],
      { currentIndex: 0, allowedPaths: new Set(['/p/current.png']) },
    );
    await Promise.resolve();

    queue.cancelScheduled();
    const current = queue.fetchAndDecode('/p/current.png', 0, { protectAdmitted: true });
    releaseRead!(new Uint8Array([1]));

    assert.ok(await current);
    await scheduled;
    assert.equal(governor.has('/p/current.png'), true);
    assert.equal(governor.bytes(), 24);
  } finally {
    globals.window = oldWindow;
    globals.createImageBitmap = oldCreateImageBitmap;
  }
});

function waitForPreload(
  queue: PreloadQueue,
  paths: Parameters<PreloadQueue['scheduleAll']>[0],
  options?: Parameters<PreloadQueue['scheduleAll']>[3],
): Promise<PreloadProgress> {
  return new Promise((resolve) => {
    queue.scheduleAll(
      paths,
      0,
      (progress) => {
        if (progress.completed >= progress.total) resolve(progress);
      },
      options,
    );
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}

function makeAnimatedWebpContainer(width: number, height: number, frameCount: number): Uint8Array {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // Animation flag.
  writeUInt24LE(vp8x, width - 1, 4);
  writeUInt24LE(vp8x, height - 1, 7);

  const chunks = [makeChunk('VP8X', vp8x), makeChunk('ANIM', Buffer.alloc(6))];
  for (let i = 0; i < frameCount; i += 1) {
    chunks.push(makeChunk('ANMF', Buffer.alloc(16)));
  }

  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 4, 'ascii');
  return new Uint8Array(Buffer.concat([riff, body]));
}

function makeChunk(fourcc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return payload.length % 2 === 0
    ? Buffer.concat([header, payload])
    : Buffer.concat([header, payload, Buffer.from([0])]);
}

function writeUInt24LE(buf: Buffer, value: number, offset: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
}
