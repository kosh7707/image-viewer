export interface ClosableFrame {
  close?: () => void;
}

export function disposeFrames(frames: readonly ClosableFrame[]): void {
  for (const frame of frames) {
    try {
      frame.close?.();
    } catch {
      // A frame may already be detached/closed; disposal must remain best-effort.
    }
  }
}
