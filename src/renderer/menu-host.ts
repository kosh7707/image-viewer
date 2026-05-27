/**
 * menu-host.ts — bridges the renderer's GIF speed to the main-process
 * context menu label, and triggers context-menu popup on right-click.
 */

export function installContextMenu(getSpeed: () => number): () => void {
  let lastOpenAt = 0;

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const now = performance.now();
    if (now - lastOpenAt < 250) return;
    lastOpenAt = now;

    // Push current speed before the menu opens so the label is fresh.
    void window.api
      .updateSpeed(getSpeed())
      .catch((err) => console.warn('[menu] failed to persist speed:', err));
    void window.api.showContextMenu({ x: e.clientX, y: e.clientY });
  };

  const contextListener = (e: MouseEvent) => {
    openMenu(e);
  };

  const mouseUpListener = (e: MouseEvent) => {
    if (e.button !== 2) return;
    openMenu(e);
  };

  window.addEventListener('contextmenu', contextListener, { capture: true });
  window.addEventListener('mouseup', mouseUpListener, { capture: true });
  return () => {
    window.removeEventListener('contextmenu', contextListener, { capture: true });
    window.removeEventListener('mouseup', mouseUpListener, { capture: true });
  };
}

export function pushSpeed(speed: number): void {
  void window.api
    .updateSpeed(speed)
    .catch((err) => console.warn('[menu] failed to persist speed:', err));
}
