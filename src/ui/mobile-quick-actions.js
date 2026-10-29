// Event wiring for the compact mobile action bar.
// All dashboard-specific behavior is injected so the controller can be tested without a browser.
export function bindMobileQuickActions({
  bar,
  documentRef,
  windowRef,
  isImportRunning = () => false,
  requestImportCancel = () => {},
  fileInput = null,
  applyQuestionPreset = () => {},
  resizeStudioCharts = () => {},
  advancedToggle = null
} = {}) {
  if (!bar || typeof bar.querySelectorAll !== 'function') return () => {};

  const listeners = [];
  const schedule = typeof windowRef?.setTimeout === 'function'
    ? windowRef.setTimeout.bind(windowRef)
    : (callback, delay) => setTimeout(callback, delay);

  const scrollToTarget = element => {
    if (!element || typeof element.scrollIntoView !== 'function') return;
    const reduceMotion = typeof windowRef?.matchMedia === 'function'
      && windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const bind = (button, handler) => {
    if (!button || typeof button.addEventListener !== 'function') return;
    button.addEventListener('click', handler);
    listeners.push(() => button.removeEventListener?.('click', handler));
  };

  for (const button of bar.querySelectorAll('[data-mobile-action]')) {
    const action = button.dataset?.mobileAction;
    if (action === 'import') {
      bind(button, () => {
        if (isImportRunning()) {
          requestImportCancel();
          return;
        }
        fileInput?.click?.();
      });
    } else if (action === 'charts') {
      bind(button, () => {
        let plot = documentRef?.querySelector?.('.chartcard:not(.panel-hidden) .plot');
        if (!plot) {
          applyQuestionPreset('price-flow', true);
          plot = documentRef?.querySelector?.('.chartcard:not(.panel-hidden) .plot');
        }
        scrollToTarget(plot?.closest?.('.chartcard') || documentRef?.querySelector?.('.sectionhead'));
        schedule(resizeStudioCharts, 180);
      });
    } else if (action === 'replay') {
      bind(button, () => scrollToTarget(documentRef?.querySelector?.('.replay-box')));
    } else if (action === 'filters') {
      bind(button, () => {
        advancedToggle?.click?.();
        const expanded = Boolean(documentRef?.body?.classList?.contains('show-advanced'));
        button.setAttribute?.('aria-expanded', expanded ? 'true' : 'false');
        if (expanded) scrollToTarget(documentRef?.querySelector?.('.controls'));
      });
    }
  }

  return () => {
    for (const remove of listeners.splice(0)) remove();
  };
}
