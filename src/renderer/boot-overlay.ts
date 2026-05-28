export function hideBootOverlay(doc: Document = document): void {
  const overlay = doc.getElementById('boot-overlay');
  if (!overlay) return;
  overlay.classList.add('boot-overlay--hidden');
  overlay.setAttribute('aria-hidden', 'true');
}
