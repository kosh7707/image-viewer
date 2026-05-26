/**
 * input.ts — keydown dispatch for the 5 sacred hotkeys.
 *   F         → toggle fullscreen
 *   ArrowLeft → prev image
 *   ArrowRight→ next image
 *   [         → GIF speed -= 0.1
 *   ]         → GIF speed += 0.1
 */

export interface InputHandlers {
  onPrev: () => void;
  onNext: () => void;
  onFullscreen: () => void;
  onSpeedDown: () => void;
  onSpeedUp: () => void;
}

export function installKeyboard(handlers: InputHandlers): () => void {
  const listener = (e: KeyboardEvent) => {
    // Ignore when modifier keys are involved.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        handlers.onPrev();
        break;
      case 'ArrowRight':
        e.preventDefault();
        handlers.onNext();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        handlers.onFullscreen();
        break;
      case '[':
        e.preventDefault();
        handlers.onSpeedDown();
        break;
      case ']':
        e.preventDefault();
        handlers.onSpeedUp();
        break;
      default:
        break;
    }
  };
  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
