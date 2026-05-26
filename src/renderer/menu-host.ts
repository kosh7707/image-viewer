/**
 * menu-host.ts — bridges the renderer's GIF speed to the main-process
 * context menu label, and triggers context-menu popup on right-click.
 */

export function installContextMenu(getSpeed: () => number): () => void {
  const listener = (e: MouseEvent) => {
    e.preventDefault();
    // Push current speed before the menu opens so the label is fresh.
    void window.api.updateSpeed(getSpeed());
    void window.api.showContextMenu();
  };
  window.addEventListener('contextmenu', listener);
  return () => window.removeEventListener('contextmenu', listener);
}

export function pushSpeed(speed: number): void {
  void window.api.updateSpeed(speed);
}
