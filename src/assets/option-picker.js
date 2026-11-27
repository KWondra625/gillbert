// One-value type-ahead for the gear pages (line, leader, hook, model, color): matches show as
// you type, and anything new is fine too: it becomes a choice for everyone once saved.
// Beads and flash take several values and use tag-input.js instead.
//
// createOptionPicker({ input, box, getPool, newLabel })
//   input:    the <input type="text">
//   box:      an element under it for the matches
//   getPool:  () => string[], the existing choices (read on every keystroke)
//   newLabel: e.g. "line", for the "＋ Use "…" as a new line" row
//
// Returns { getValue(): string, setValue(string): void }. When what's typed matches a choice
// apart from capitals and spaces, the choice's own spelling is used, so "dacron  30 LB" saves as
// "Dacron 30 lb" instead of becoming a near-duplicate.

function gearKey(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function createOptionPicker({ input, box, getPool, newLabel }) {
  const esc = s => String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function known(value) {
    const k = gearKey(value);
    return k ? (getPool() || []).find(p => gearKey(p) === k) : undefined;
  }

  function hide() {
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  function show() {
    const q = gearKey(input.value);
    if (!q) { hide(); return; }
    const matches = (getPool() || [])
      .filter(p => gearKey(p).includes(q))
      .sort((a, b) => (gearKey(a).startsWith(q) ? 0 : 1) - (gearKey(b).startsWith(q) ? 0 : 1) || a.localeCompare(b))
      .slice(0, 6);
    const typed = input.value.trim().replace(/\s+/g, ' ');
    const rows = matches.map(m => `<button type="button" class="tag-suggestion" data-value="${esc(m)}">${esc(m)}</button>`);
    if (!known(typed)) {
      rows.push(`<button type="button" class="tag-suggestion tag-suggestion--new" data-value="${esc(typed)}">＋ Use "${esc(typed)}" as a new ${esc(newLabel)}</button>`);
    }
    box.innerHTML = rows.join('');
    box.classList.remove('hidden');
  }

  function choose(value) {
    input.value = value;
    hide();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') hide();
    if (e.key === 'Enter') { e.preventDefault(); choose(known(input.value) || input.value.trim().replace(/\s+/g, ' ')); }
  });
  input.addEventListener('blur', e => {
    if (e.relatedTarget && box.contains(e.relatedTarget)) return;
    setTimeout(() => {
      const match = known(input.value);
      if (match) input.value = match;
      hide();
    }, 150);
  });
  // mousedown (not click) so the input's blur doesn't hide the row first; click covers keyboard
  box.addEventListener('mousedown', e => {
    const b = e.target.closest('.tag-suggestion');
    if (!b) return;
    e.preventDefault();
    choose(b.dataset.value);
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('.tag-suggestion');
    if (b && e.detail === 0) choose(b.dataset.value);
  });

  return {
    getValue: () => known(input.value) || input.value.trim().replace(/\s+/g, ' '),
    setValue: v => { input.value = v || ''; },
  };
}
