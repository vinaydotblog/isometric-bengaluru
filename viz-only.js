// Press "/" (or tap the "Hide menus" button) to hide every menu, panel and caption and leave only the visualization.
// Press "/" again, Esc, or tap "Show menus" to bring them back. The CSS for the hidden state lives in shared.css.
(() => {
  const root = document.documentElement;
  let hint = null, btn = null;
  function toast(msg) {
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'viz-hint';
      hint.setAttribute('role', 'status');
      document.body.appendChild(hint);
    }
    hint.textContent = msg;
    hint.classList.add('show');
    clearTimeout(hint.timer);
    hint.timer = setTimeout(() => hint.classList.remove('show'), 2200);
  }
  function set(on) {
    root.classList.toggle('viz-only', on);
    if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Show menus' : 'Hide menus'; }
    toast(on ? 'Menus hidden · press / or tap Show menus to bring them back' : 'Menus back · press / or tap Hide menus to hide them');
    dispatchEvent(new Event('resize'));
  }
  // a visible button for touch screens and anyone who doesn't know the shortcut; only on pages with a visualization
  function addButton() {
    if (!document.querySelector('.stage, .figure, #cv, #app')) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn viz-toggle';
    btn.title = 'Hide or show menus (/)';
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Hide menus';
    btn.addEventListener('click', () => set(!root.classList.contains('viz-only')));
    document.body.appendChild(btn);
    root.classList.add('has-viz-toggle');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
  addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
      (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); set(!root.classList.contains('viz-only')); }
    else if (e.key === 'Escape' && root.classList.contains('viz-only')) set(false);
  });
})();
