# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-05-28
- Primary product surfaces: fullscreen image viewer canvas, transient HUDs, right-click dialogs, preload/status overlays.
- Evidence reviewed: `README.md`, `src/renderer/styles.css`, `src/renderer/speed-hud.ts`, `src/renderer/progress-toast.ts`, `src/renderer/sort-dialog.ts`, `src/renderer/settings-dialog.ts`.

## Brand

- Personality: minimal, fast, quiet, image-first.
- Trust signals: responsive navigation, visible-but-subtle status, no surprise blocking chrome during viewing.
- Avoid: permanent heavy panels, centered overlays during image viewing, raw byte counts in normal UI.

## Product goals

- Goals: make local image viewing feel immediate; support GIF/WebP playback and preload visibility without breaking focus.
- Non-goals: DAM/catalog management, editing, annotations, multi-pane asset browser.
- Success signals: users can navigate normally without black-frame waits and can understand current position/preload readiness at a glance.

## Personas and jobs

- Primary personas: Windows users browsing local image folders, including animated GIF/WebP-heavy folders.
- User jobs: open a file/folder, navigate sorted images, adjust animation speed, understand whether nearby images are ready.
- Key contexts of use: fullscreen/dark viewing, keyboard navigation, large local folders.

## Information architecture

- Primary navigation: keyboard arrows and right-click menu.
- Core routes/screens: single viewer surface; modal sort/settings dialogs; transient HUD/status overlays.
- Content hierarchy: image first; transient position/speed second; right-side preload status third.

## Design principles

- Principle 1: Never cover the image center for routine feedback.
- Principle 2: Status should be glanceable, translucent, and dismiss itself unless pinned.
- Tradeoffs: more operational visibility is allowed only at edges and with low opacity by default.

## Visual language

- Color: black canvas, white text, blue accent for current/ready state, red only for warnings.
- Typography: system UI for dialogs, monospace for numeric HUD/status.
- Spacing/layout rhythm: 24px viewport margins for HUDs; compact rows and rounded translucent panels.
- Shape/radius/elevation: soft rounded pills/panels, subtle border and shadow.
- Motion: short fade/translate transitions around 160ms; auto-hide for transient HUDs.
- Imagery/iconography: text markers over icons (`●`, `✓`, `…`) to avoid asset dependency.

## Components

- Existing components to reuse: speed HUD timing/opacity pattern, toast host, dialog host, right-click modal style.
- New/changed components: position HUD (`index / total`), pin-capable preload panel (`Ready` nearby list).
- Variants and states: transient, active, pinned, hover, current, ready, loading.
- Token/component ownership: repo-native CSS in `src/renderer/styles.css`; no new design-system dependency.

## Accessibility

- Target standard: keyboard-first behavior and readable contrast for overlays.
- Keyboard/focus behavior: viewer shortcuts remain primary; preload panel pin is mouse-accessible and should not block Escape/dialog behavior.
- Contrast/readability: overlay text must be readable while remaining translucent.
- Screen-reader semantics: minimal status UI; future work may add ARIA live regions if needed.
- Reduced motion and sensory considerations: motion is brief and non-essential.

## Responsive behavior

- Supported breakpoints/devices: Windows desktop viewport, fullscreen or windowed.
- Layout adaptations: right preload panel width clamps to viewport; HUDs stay at edges.
- Touch/hover differences: hover strengthens panel opacity; pin preserves visibility without hover.

## Interaction states

- Loading: `…` marker in preload panel.
- Empty: preload panel hides when no album/preload-relevant item exists.
- Error: existing memory/RSS toast remains warning surface.
- Success: `✓` marker for ready entries.
- Disabled: not applicable.
- Offline/slow network: not applicable for local files.

## Content voice

- Tone: terse, technical only when useful.
- Terminology: use “Ready” for preloaded/ready nearby media, not “cache internals”.
- Microcopy rules: prefer `12 / 384` and short filenames; avoid long explanations over the image.

## Implementation constraints

- Framework/styling system: Electron renderer, plain TypeScript, DOM APIs, plain CSS.
- Design-token constraints: no new dependency or framework.
- Performance constraints: status rendering must be bounded to nearby entries and must not enumerate huge folders on every frame.
- Compatibility constraints: Windows packaged Electron is the primary target.
- Test/screenshot expectations: unit-test HUD/panel DOM behavior; smoke test renderer boot path.

## Open questions

- [ ] Should preload panel pin state persist across app restarts? owner: product / impact: convenience vs preference surface growth.
