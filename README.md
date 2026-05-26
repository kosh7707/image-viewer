# ImageViewer

Minimal fullscreen Electron image viewer for Windows. Black canvas, no chrome, six hotkeys total. Built for the use case "I just want to flip through a folder of JPEG/PNG/WebP/GIF — and please give me animated-image speed control."

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

## Hotkeys (all 6)

| Key   | Action                                  |
| ----- | --------------------------------------- |
| `F`   | Toggle borderless fullscreen            |
| `←`   | Previous image                          |
| `→`   | Next image                              |
| `[`   | GIF/WebP speed −0.1× (min 0.1×)         |
| `]`   | GIF/WebP speed +0.1× (max 4.0×)         |
| `Esc` | Exit immediately when no dialog is open |

Right-click anywhere for the context menu: Open File…, Open Folder…, Sort…, `Speed: N.N×` (label-only, updates live), Exit. Pressing `[` / `]` also shows a brief translucent speed HUD in the upper-right corner.

## Cache & preload policy (v2)

- "Open Folder…" recursively walks the chosen directory up to depth 4 (deeper levels are silently dropped) and collects every supported image.
- Before loading, headers are parsed to estimate the _decoded_ RAM footprint:
  - JPEG/PNG/static WebP → `width × height × 4`
  - GIF → `width × height × 4 × frame_count` (each frame becomes a full-canvas `ImageBitmap` in the decoder worker)
  - Animated WebP → `width × height × 4 × ANMF_frame_count` (parsed from the WebP RIFF container)
- If the total exceeds **4 GiB** the user gets a confirm dialog ("이 폴더는 약 N MB 사용 예상…"). "Cancel" keeps the previously loaded album; "Proceed" continues.
- Approved static bitmap entries (JPEG/PNG/static WebP) are preloaded into the renderer's `CacheGovernor` (entry/byte caps set to `MAX_SAFE_INTEGER`; the 4 GB dialog is the real RAM gate). Background concurrency is capped at 8 simultaneous decodes. GIF and animated WebP stay on animated/native playback paths instead of being collapsed through `createImageBitmap`.
- A single progress toast at the bottom-right shows `측정 중 X / N` then `로딩 중 X / N (P%)`. It auto-dismisses after the final phase.
- The right-click **Sort…** dialog lists every image in the loaded album and lets you sort by filename or modification time, ascending or descending. Clicking a row jumps to that image. Re-sorting preserves the currently displayed image.

## Installation

```sh
npm install
```

WSL note: Electron's postinstall may emit warnings about missing display libs (e.g., `libgtk`). Those are harmless for building and running tests — they only affect interactive `npm start` inside WSL without an X server.

## Development

```sh
# Compile TypeScript once
npm run build

# Compile in watch mode AND launch Electron (one shell)
npm run dev
```

`npm run dev` runs `tsc -w` in the background and `electron .` together. On WSL without an X server, the renderer window will not appear but the main process still starts.

## Testing

```sh
npm test
```

Runs `tsc` then `node --test dist/tests/*.test.js`. Suite covers:

- `cache-governor` — count cap, byte cap, LRU touch, full eviction, re-admit accounting, warm flag.
- `canvas-painter` — fullscreen-resize redraw replay.
- `walk` — recursive collection, depth cap, symlink skip, hidden-dir skip, case-insensitive ext.
- `measure` — PNG/JPEG/static WebP delegate to `image-size`; GIF and animated WebP count frames for RAM estimates; corrupt GIFs return a safe zero estimate.
- `album-sort` — filename/mtime × asc/desc, current-path preservation, no input mutation.
- `album-loader` — IDENTIFYING → MEASURING → CONFIRMING state machine with mocked walker/measurer.
- `animated-webp-decoder` — WebCodecs feature detection, frame-index decoding, duration conversion, and cleanup/fallback behavior.
- `renderer-runtime-smoke` - real Electron sandbox/preload/renderer boot, GIF frame advance, animated WebP speed HUD, and static WebP canvas/cache route.
- `speed-hud` — transient upper-right speed display, latest-value reuse, and auto-hide behavior.

## Windows packaging

```sh
npm run dist
```

Requires running on Windows for a native portable `.exe`. In WSL, `electron-builder` cannot run the Windows packager directly; the `electron-builder.yml` config is valid but you need a Windows shell (or wine) to actually produce the artifact.

The portable EXE registers the four image extensions for Windows "Open with…" via the `fileAssociations` block. After install, right-click any supported image in Explorer → Open with… → choose ImageViewer.

### Icon placeholder

The plan calls for `build/icon.ico`. This repo intentionally does NOT ship a binary icon file (we don't generate binaries inside the codebase). Before running `npm run dist` on Windows, drop a 256×256 multi-resolution `.ico` at `build/icon.ico`. Without it `electron-builder` will fall back to its default icon.

## Architecture

- **Main process** (`src/main/`)
  - `main.ts` — `BrowserWindow` setup (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), argv parsing, IPC wiring, defense-in-depth path allowlist for `fs:readFile`.
  - `walk.ts` — recursive image walker, depth cap = 4, symlink + hidden-dir skip.
  - `measure.ts` — header-based RAM estimator. `image-size` for static formats; `gifuct-js` for GIF frame count; WebP RIFF `ANMF` counting for animated WebP.
  - `album-loader.ts` — pure state machine: walk → measure → confirm-if-over-cap → ready. Per-file measure errors silently drop that file.
  - `album-flow.ts` — wires `loadAlbum` to the Electron `BrowserWindow`: confirm dialog, progress IPC, `album:load` broadcast.
  - `folder.ts` — just the `SUPPORTED_EXTS` constant.
  - `window.ts` — `toggleFullscreen()`.
  - `menu.ts` — right-click context menu; Sort… item sends `menu:sort-request` to renderer.
  - `rss.ts` — 1 s `process.getProcessMemoryInfo()` poll → `rss:update` IPC.
- **Preload** (`src/preload/`) — `contextBridge.exposeInMainWorld('api', {...})`. Shared types live in `api.ts` (single source of truth for both preload and renderer).
- **Renderer** (`src/renderer/`)
  - `album.ts` - entry list (path + mtime + optional measured metadata) + current index + reorder support.
  - `album-sort.ts` — pure sort helper (filename/mtime × asc/desc); preserves current path.
  - `canvas.ts` — black-background letterboxed `drawImage`; caches last bitmap and replays on resize so fullscreen toggles don't blank the canvas.
  - `cache-governor.ts` — count + byte cap LRU; v2 instantiated with `MAX_SAFE_INTEGER` caps because the 4 GB confirm gate happens upstream.
  - `preload-queue.ts` - `scheduleAll()` decodes every measured static bitmap path with bounded concurrency (8). GPU pre-warm via 1x1 drawImage to an `OffscreenCanvas`. GIF, animated WebP, and metadata-less WebP are skipped because they need animated/native playback paths.
  - `animated-webp-decoder.ts` — WebCodecs `ImageDecoder` path for animated WebP: frame-index decode, microsecond-duration conversion, `VideoFrame` cleanup, `ImageBitmap` ownership.
  - `gif-host.ts` — decoded-animation `requestAnimationFrame` driver, `[/]` keys, hot-swappable speed, clamp `[0.1, 4.0]`.
  - `speed-hud.ts` - transient upper-right HUD shown after `[` / `]` speed changes for GIF and animated WebP.
  - `workers/gif-decoder.worker.ts` — `gifuct-js` parse + per-frame `createImageBitmap` (inside the Worker) → `postMessage` with transfer list. Image-bomb guard rejects > 64 MP / > 5000 frames.
  - `native-image-host.ts` - browser-native `<img>` overlay for unsupported WebCodecs fallback, metadata-less WebP fallback, and large-GIF fallback; owns Blob URL revoke/hide/show lifecycle.
  - `progress-toast.ts` — single sticky toast that reports measure + preload progress.
  - `sort-dialog.ts` — modal table; sort selector + clickable rows that jump to the picked image.
  - `toast.ts` — RSS toast (4 GiB crossing warning), auto-dismiss after 5 s.
  - `menu-host.ts` — right-click + speed-label push.
  - `input.ts` — `keydown` dispatch.

## Known limitations

- **No drag-drop** in v1. Use file association or the right-click "Open File…/Open Folder…" items.
- **GIFs > 100 MB** fall back to native `<img>` (no speed control). Tracked as a v1 known limitation; v2 may stream-decode.
- **Recursion is capped at depth 4** and silently drops deeper subtrees. Useful for a typical "Photos/year/month/event" layout; unusable for deeply nested archives.
- **RSS measurement** uses `process.getProcessMemoryInfo().resident`, which is accurate on Windows but may report differently on Linux/macOS. The 4 GiB toast is informational; the real RAM gate is the upstream confirm dialog driven by header-based estimates.
- **Renderer crash loses the cache.** Documented limitation; restart the app.
- **Mac/Linux builds** are not supported in v1. The TypeScript compiles cross-platform; `npm test` runs anywhere; only the packaged binary is Windows-only.
- **Animated WebP speed control requires Chromium WebCodecs.** In the packaged Electron runtime this uses `ImageDecoder` and the same `[` / `]` speed host as GIF. Static WebP loaded through the normal album flow uses the canvas/cache path; metadata-less, unsupported, or corrupt WebP falls back to Chromium's native `<img>` playback.

## License

MIT
