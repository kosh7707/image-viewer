import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  decodeAnimatedWebp,
  durationUsToMs,
  type CreateImageBitmapLike,
  type ImageDecoderConstructorLike,
} from '../src/renderer/animated-webp-decoder';

interface FakeTrack {
  animated: boolean;
  frameCount: number;
  repetitionCount: number;
  selected: boolean;
}

interface FakeVideoFrame {
  duration: number | null;
  displayWidth: number;
  displayHeight: number;
  closed: boolean;
  failBitmap?: boolean;
  close(): void;
}

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

class FakeDecoder {
  static supported = true;
  static supportChecks: string[] = [];
  static instances: FakeDecoder[] = [];
  static nextTrack: FakeTrack = {
    animated: true,
    frameCount: 2,
    repetitionCount: 0,
    selected: true,
  };
  static nextFrames: FakeVideoFrame[] = [];
  static failDecodeAt: number | null = null;

  completed = Promise.resolve();
  tracks: ImageTrackList;
  decodeCalls: number[] = [];
  closed = false;

  constructor(_init: ImageDecoderInit) {
    FakeDecoder.instances.push(this);
    this.tracks = {
      ready: Promise.resolve(),
      selectedTrack: FakeDecoder.nextTrack as unknown as ImageTrack,
    } as ImageTrackList;
  }

  static async isTypeSupported(type: string): Promise<boolean> {
    FakeDecoder.supportChecks.push(type);
    return FakeDecoder.supported;
  }

  async decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult> {
    const frameIndex = options?.frameIndex ?? 0;
    this.decodeCalls.push(frameIndex);
    if (FakeDecoder.failDecodeAt === frameIndex) throw new Error(`decode ${frameIndex}`);
    const image = FakeDecoder.nextFrames[frameIndex];
    if (!image) throw new Error(`missing frame ${frameIndex}`);
    return { complete: true, image: image as unknown as VideoFrame };
  }

  close(): void {
    this.closed = true;
  }

  reset(): void {
    // not used by these tests
  }

  static reset(): void {
    FakeDecoder.supported = true;
    FakeDecoder.supportChecks = [];
    FakeDecoder.instances = [];
    FakeDecoder.nextTrack = {
      animated: true,
      frameCount: 2,
      repetitionCount: 0,
      selected: true,
    };
    FakeDecoder.nextFrames = [];
    FakeDecoder.failDecodeAt = null;
  }
}

function makeFrame(duration: number | null, failBitmap = false): FakeVideoFrame {
  return {
    duration,
    displayWidth: 1,
    displayHeight: 1,
    closed: false,
    failBitmap,
    close() {
      this.closed = true;
    },
  };
}

function makeBitmap(): FakeBitmap {
  return {
    width: 1,
    height: 1,
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

function makeCreateImageBitmap(created: FakeBitmap[]): CreateImageBitmapLike {
  return async (source: ImageBitmapSource): Promise<ImageBitmap> => {
    const frame = source as unknown as FakeVideoFrame;
    if (frame.failBitmap) throw new Error('bitmap conversion failed');
    const bitmap = makeBitmap();
    created.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  };
}

test('durationUsToMs converts WebCodecs microseconds and defaults unsafe values', () => {
  assert.equal(durationUsToMs(120_000), 120);
  assert.equal(durationUsToMs(null), 100);
  assert.equal(durationUsToMs(0), 100);
  assert.equal(durationUsToMs(Number.NaN), 100);
});

test('decodeAnimatedWebp returns null without constructing a decoder when WebP is unsupported', async () => {
  FakeDecoder.reset();
  FakeDecoder.supported = false;

  const result = await decodeAnimatedWebp(new Uint8Array([1, 2, 3]), {
    imageDecoder: FakeDecoder as unknown as ImageDecoderConstructorLike,
    createImageBitmap: makeCreateImageBitmap([]),
  });

  assert.equal(result, null);
  assert.deepEqual(FakeDecoder.supportChecks, ['image/webp']);
  assert.equal(FakeDecoder.instances.length, 0);
});

test('decodeAnimatedWebp falls back for static WebP and closes the decoder', async () => {
  FakeDecoder.reset();
  FakeDecoder.nextTrack = {
    animated: false,
    frameCount: 1,
    repetitionCount: 0,
    selected: true,
  };

  const result = await decodeAnimatedWebp(new Uint8Array([1]), {
    imageDecoder: FakeDecoder as unknown as ImageDecoderConstructorLike,
    createImageBitmap: makeCreateImageBitmap([]),
  });

  assert.equal(result, null);
  assert.equal(FakeDecoder.instances.length, 1);
  assert.equal(FakeDecoder.instances[0]!.closed, true);
  assert.deepEqual(FakeDecoder.instances[0]!.decodeCalls, []);
});

test('decodeAnimatedWebp decodes animated frames, converts delays, and owns bitmap cleanup', async () => {
  FakeDecoder.reset();
  const frame0 = makeFrame(100_000);
  const frame1 = makeFrame(250_000);
  const bitmaps: FakeBitmap[] = [];
  FakeDecoder.nextFrames = [frame0, frame1];

  const result = await decodeAnimatedWebp(new Uint8Array([1]), {
    imageDecoder: FakeDecoder as unknown as ImageDecoderConstructorLike,
    createImageBitmap: makeCreateImageBitmap(bitmaps),
  });

  assert.ok(result);
  assert.deepEqual(result.delays, [100, 250]);
  assert.equal(result.frames.length, 2);
  assert.deepEqual(FakeDecoder.instances[0]!.decodeCalls, [0, 1]);
  assert.equal(frame0.closed, true);
  assert.equal(frame1.closed, true);
  assert.equal(FakeDecoder.instances[0]!.closed, true);

  result.dispose?.();
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [true, true],
  );
});

test('decodeAnimatedWebp closes accumulated resources when conversion fails', async () => {
  FakeDecoder.reset();
  const frame0 = makeFrame(100_000);
  const frame1 = makeFrame(100_000, true);
  const bitmaps: FakeBitmap[] = [];
  FakeDecoder.nextFrames = [frame0, frame1];

  const result = await decodeAnimatedWebp(new Uint8Array([1]), {
    imageDecoder: FakeDecoder as unknown as ImageDecoderConstructorLike,
    createImageBitmap: makeCreateImageBitmap(bitmaps),
  });

  assert.equal(result, null);
  assert.equal(frame0.closed, true);
  assert.equal(frame1.closed, true);
  assert.equal(bitmaps[0]!.closed, true);
  assert.equal(FakeDecoder.instances[0]!.closed, true);
});

test('decodeAnimatedWebp refuses to materialize frames beyond the decoded-byte cap', async () => {
  FakeDecoder.reset();
  const frame0 = makeFrame(100_000);
  const frame1 = makeFrame(100_000);
  const bitmaps: FakeBitmap[] = [];
  FakeDecoder.nextFrames = [frame0, frame1];

  const result = await decodeAnimatedWebp(new Uint8Array([1]), {
    imageDecoder: FakeDecoder as unknown as ImageDecoderConstructorLike,
    createImageBitmap: makeCreateImageBitmap(bitmaps),
    maxDecodedBytes: 4,
  });

  assert.equal(result, null);
  assert.equal(frame0.closed, true);
  assert.equal(frame1.closed, true);
  assert.equal(bitmaps[0]!.closed, true);
  assert.equal(FakeDecoder.instances[0]!.closed, true);
});
