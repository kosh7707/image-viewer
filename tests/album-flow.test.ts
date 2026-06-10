import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { entriesToDTO, executeAlbumLoad, executeAlbumLoadRequests } from '../src/main/album-flow';
import type { WalkEntry } from '../src/main/walk';
import type { AlbumLoadPayload, AlbumProgressPayload } from '../src/preload/api';

type SentMessage =
  | { channel: 'album:load'; payload: AlbumLoadPayload }
  | { channel: 'album:progress'; payload: AlbumProgressPayload }
  | { channel: string; payload: unknown };

function sourceText(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function fakeWindow(messages: SentMessage[]): Parameters<typeof executeAlbumLoad>[1] {
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        messages.push({ channel, payload });
      },
    },
  } as Parameters<typeof executeAlbumLoad>[1];
}

test('entriesToDTO emits stat-only DTOs before renderer-side metadata is known', () => {
  const entries: WalkEntry[] = [
    { path: '/p/static.webp', mtimeMs: 1, encodedBytes: 123 },
    { path: '/p/animated.gif', mtimeMs: 2, encodedBytes: 456 },
    { path: '/p/vector.eps', mtimeMs: 3, encodedBytes: 789 },
  ];

  assert.deepEqual(entriesToDTO(entries), [
    { path: '/p/static.webp', mtimeMs: 1, encodedBytes: 123 },
    { path: '/p/animated.gif', mtimeMs: 2, encodedBytes: 456 },
    { path: '/p/vector.eps', mtimeMs: 3, encodedBytes: 789 },
  ]);
});

test('executeAlbumLoad broadcasts discovered files without reading every image first', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-album-flow-'));
  const messages: SentMessage[] = [];
  try {
    const a = path.join(root, 'a.png');
    const b = path.join(root, 'b.jpg');
    fs.writeFileSync(a, 'not a real png');
    fs.writeFileSync(b, 'not a real jpg');

    await executeAlbumLoad(root, fakeWindow(messages), b);

    const load = messages.find((msg): msg is Extract<SentMessage, { channel: 'album:load' }> => {
      return msg.channel === 'album:load';
    });
    assert.ok(load, 'album:load should be emitted after file discovery alone');
    assert.equal(load.payload.folder, path.resolve(root));
    assert.deepEqual(
      load.payload.entries.map((entry) => entry.path),
      [a, b],
    );
    assert.deepEqual(
      load.payload.entries.map((entry) => Object.keys(entry).sort()),
      [
        ['encodedBytes', 'mtimeMs', 'path'],
        ['encodedBytes', 'mtimeMs', 'path'],
      ],
    );
    assert.deepEqual(
      load.payload.entries.map((entry) => entry.encodedBytes),
      [14, 14],
    );
    assert.equal(load.payload.currentIndex, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executeAlbumLoadRequests merges multiple folders into one path-sorted album', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-album-flow-multi-'));
  const messages: SentMessage[] = [];
  try {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    const a1 = path.join(a, 'image001.png');
    const a2 = path.join(a, 'image002.png');
    const b1 = path.join(b, 'image001.png');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(a2, 'a2');
    fs.writeFileSync(b1, 'b1');
    fs.writeFileSync(a1, 'a1');

    await executeAlbumLoadRequests(
      [
        { rootDir: b, selectedFile: null },
        { rootDir: a, selectedFile: null },
      ],
      fakeWindow(messages),
    );

    const loads = messages.filter(
      (msg): msg is Extract<SentMessage, { channel: 'album:load' }> => msg.channel === 'album:load',
    );
    assert.equal(loads.length, 1);
    assert.deepEqual(
      loads[0]!.payload.entries.map((entry) => entry.path),
      [a1, a2, b1],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('album flow source has no pre-preload capacity warning path', () => {
  const src = sourceText('src/main/album-flow.ts');
  for (const forbidden of [
    'estimateFromFile',
    'DEFAULT_SOFT_CAP_BYTES',
    'showMessageBox',
    'confirmOverCap',
    'measureFile',
    'formatMB',
  ]) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not be in album-flow`);
  }
});
