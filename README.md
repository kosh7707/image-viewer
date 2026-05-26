# ImageViewer

Minimal fullscreen Electron image viewer for Windows. Black canvas, no chrome, five hotkeys total. Built for the use case "I just want to flip through a folder of JPEG/PNG/WebP/GIF — and please give me GIF speed control."

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

## Hotkeys (all 5)

| Key   | Action                          |
|-------|---------------------------------|
| `F`   | Toggle borderless fullscreen    |
| `←`   | Previous image                  |
| `→`   | Next image                      |
| `[`   | GIF speed −0.1× (min 0.1×)      |
| `]`   | GIF speed +0.1× (max 4.0×)      |

Right-click anywhere for the context menu: Open File…, Open Folder…, `Speed: N.N×` (label-only, updates live), Exit.

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

Runs `tsc` then `node --test dist/tests/*.test.js`. The `CacheGovernor` unit tests cover the count cap, the byte cap, LRU touch, full eviction, re-admit accounting, and the warm flag (via injected warmer).

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
  - `main.ts` — `BrowserWindow` setup (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), argv parsing (`argv[1]` or `argv[2]`), IPC wiring.
  - `folder.ts` — `listImages(dir)` reads + filters + locale-aware-sorts.
  - `window.ts` — `toggleFullscreen()`.
  - `menu.ts` — right-click context menu built from `Menu.buildFromTemplate`.
  - `rss.ts` — 1 s `process.getProcessMemoryInfo()` poll → `rss:update` IPC.
- **Preload** (`src/preload/preload.ts`) — `contextBridge.exposeInMainWorld('api', {...})`. Only the explicitly listed methods cross the bridge.
- **Renderer** (`src/renderer/`)
  - `album.ts` — current folder + index state.
  - `canvas.ts` — black-background letterboxed `drawImage`.
  - `cache-governor.ts` — **the** LRU policy: `count ≤ 20 AND projectedBytes ≤ 3 GB`. Test-friendly: no DOM dependency in the class itself. GPU pre-warm is injected separately via `warmEntry()`.
  - `preload-queue.ts` — fetches `[idx-10, idx+10]` via IPC, decodes with `createImageBitmap`, admits to the governor, then pre-warms via 1×1 `drawImage` to an `OffscreenCanvas`.
  - `gif-host.ts` — `requestAnimationFrame` driver, `[/]` keys, hot-swappable speed, clamp `[0.1, 4.0]`.
  - `workers/gif-decoder.worker.ts` — `gifuct-js` parse + per-frame `createImageBitmap` (inside the Worker) → `postMessage` with transfer list.
  - `toast.ts` — RSS toast, fires once per 4 GB crossing, auto-dismiss after 5 s.
  - `menu-host.ts` — right-click + speed-label push.
  - `input.ts` — `keydown` dispatch.

## Known limitations

- **No drag-drop** in v1. Use file association or the right-click "Open File…/Open Folder…" items.
- **GIFs > 100 MB** fall back to native `<img>` (no speed control). Tracked as a v1 known limitation; v2 may stream-decode.
- **RSS measurement** uses `process.getProcessMemoryInfo().resident`, which is accurate on Windows but may report differently on Linux/macOS. The 4 GB toast is informational; the real safety mechanism is `CacheGovernor` enforcing 3 GB projected.
- **Renderer crash loses the cache.** Documented limitation; restart the app.
- **Mac/Linux builds** are not supported in v1. The TypeScript compiles cross-platform; `npm test` runs anywhere; only the packaged binary is Windows-only.
- **GIF disposal mode 3** ("restore to previous") is not supported; such frames render as "keep" (mode 0). Rare in practice; affected GIFs will show minor compositing artifacts but will not crash.

## License

MIT
