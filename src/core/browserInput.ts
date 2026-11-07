/** Prevent host-page scrolling while keeping menus, form fields and keyboard controls usable. */
export function installCommonFixes(): void {
  window.addEventListener('wheel', (e) => {
    // UI panels need native scrolling; the canvas handles zooming itself.
    if (e.target instanceof Element && e.target.closest('#ui, dialog')) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    const control = e.target instanceof Element && e.target.closest('input, textarea, button, select, summary, [contenteditable="true"]');
    if (!control && [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  });
}
