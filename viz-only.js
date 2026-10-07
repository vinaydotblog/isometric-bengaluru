// Press "/" to hide every menu, panel and caption and leave only the visualization.
// Press "/" again, or Esc, to bring them back. The CSS for the hidden state lives in shared.css.
(() => {
  const root = document.documentElement;
  let hint = null;
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
    toast(on ? 'Menus hidden · press / to bring them back' : 'Menus back · press / to hide them');
    dispatchEvent(new Event('resize'));
  }
  addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
      (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); set(!root.classList.contains('viz-only')); }
    else if (e.key === 'Escape' && root.classList.contains('viz-only')) set(false);
  });
})();
