import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { entriesToDTO, executeAlbumLoad } from '../src/main/album-flow';
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

test('entriesToDTO emits path-only DTOs before renderer-side metadata is known', () => {
  const entries: WalkEntry[] = [
    { path: '/p/static.webp', mtimeMs: 1 },
    { path: '/p/animated.gif', mtimeMs: 2 },
  ];

  assert.deepEqual(entriesToDTO(entries), [
    { path: '/p/static.webp', mtimeMs: 1 },
    { path: '/p/animated.gif', mtimeMs: 2 },
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
        ['mtimeMs', 'path'],
        ['mtimeMs', 'path'],
      ],
    );
    assert.equal(load.payload.currentIndex, 1);
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
