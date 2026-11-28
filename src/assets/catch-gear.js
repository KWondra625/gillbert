// "Caught on" (a tip-up) and "Bait" on Log a Catch and Edit Catch (gear stage 2).
// Both are optional, and both are type-aheads:
//   - Caught on: type part of a tip-up's name or its owner ("24-02", "Dave"); matches show with
//     their owner, the catch's angler's own first. Only existing tip-ups can be picked. Retired
//     ones are left out unless this catch was already caught on one. The setup shows underneath.
//   - Bait (option-picker.js): anything new becomes a choice for everyone.
//
// If gear/get can't be reached, both fields stay hidden and payload() sends nothing, so the
// catch saves as before and an edited catch keeps its tip-up and bait.
//
// CatchGear.setup({ anglerSelect, current })   current = { caughtOn, bait } from the catch (Edit)
// CatchGear.payload()                          { gearId, bait } to add to the save, or {}
// CatchGear.reset()                            clears both (Save and Add Another)

const CatchGear = (() => {
  const el = {
    gearGroup: document.getElementById('gearGroup'),
    gear:      document.getElementById('gearSearch'),
    gearBox:   document.getElementById('gearSuggestions'),
    gearHint:  document.getElementById('gearHint'),
    baitGroup: document.getElementById('baitGroup'),
    bait:      document.getElementById('bait'),
    baitBox:   document.getElementById('baitSuggestions'),
  };
  const MAX_MATCHES = 8;
  let loaded = false;
  let tipUps = [];
  let baits = [];
  let current = {};
  let anglerSelect = null;
  let selected = null;   // the picked tip-up, or null
  let wired = false;

  const baitPicker = createOptionPicker({ input: el.bait, box: el.baitBox, getPool: () => baits, newLabel: 'bait' });
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const key = gearKey;   // option-picker.js: the same name match as the database

  // "Dacron 30 lb · Fluoro 10 lb · #8 Octopus · Glow, Red"
  function summary(s) {
    if (!s) return '';
    return [s.line, s.leader, s.hook, (s.beads || []).join(', '), (s.flash || []).join(', ')].filter(Boolean).join(' · ');
  }

  function label(t) {
    return t.status === 'Retired' ? `${t.name} (retired)` : t.name;
  }

  // Tip-ups that can be picked: active ones, plus a retired one this catch already uses
  function pool() {
    const currentId = current.caughtOn ? current.caughtOn.gearId : null;
    return tipUps.filter(t => t.status === 'Active' || t.id === currentId);
  }

  function hideMatches() {
    el.gearBox.classList.add('hidden');
    el.gearBox.innerHTML = '';
  }

  // Matches on name or owner; the catch's angler's tip-ups first, then by name
  function showMatches() {
    const q = key(el.gear.value.replace(/ \(retired\)$/, ''));
    if (selected && q === key(selected.name)) { hideMatches(); return; }
    const anglerId = anglerSelect ? Number(anglerSelect.value) : null;
    const matches = pool()
      .filter(t => !q || key(t.name).includes(q) || key(t.ownerName).includes(q))
      .sort((a, b) => (a.ownerAnglerId === anglerId ? 0 : 1) - (b.ownerAnglerId === anglerId ? 0 : 1)
        || (key(a.name).startsWith(q) ? 0 : 1) - (key(b.name).startsWith(q) ? 0 : 1)
        || a.name.localeCompare(b.name))
      .slice(0, MAX_MATCHES);
    el.gearBox.innerHTML = matches.length
      ? matches.map(t => `<button type="button" class="tag-suggestion" data-id="${t.id}">${esc(label(t))} · ${esc(t.ownerName || '')}</button>`).join('')
      : `<p class="tag-suggestion">No tip-up matches "${esc(el.gear.value.trim())}"</p>`;
    el.gearBox.classList.remove('hidden');
  }

  function choose(t) {
    selected = t || null;
    el.gear.value = t ? label(t) : '';
    hideMatches();
    hint();
  }

  // Under the box: the setup as caught (Edit, same tip-up) or the tip-up's setup now
  function hint() {
    let text = '';
    if (selected && current.caughtOn && current.caughtOn.gearId === selected.id) {
      const s = summary(current.caughtOn);
      text = s ? `Setup when caught: ${s}` : 'Setup when caught: not entered';
    } else if (selected) {
      const s = summary(selected.setup);
      text = s ? `Setup now: ${s}` : 'No setup entered yet';
    }
    el.gearHint.textContent = text;
    el.gearHint.classList.toggle('hidden', !text);
  }

  // Leaving the box: an exact name picks that tip-up, blank means none, anything else goes
  // back to what was picked (only real tip-ups can be saved)
  function settle() {
    const q = key(el.gear.value.replace(/ \(retired\)$/, ''));
    if (!q) { choose(null); return; }
    const exact = pool().find(t => key(t.name) === q);
    choose(exact || selected);
  }

  function wire() {
    // While typing, the earlier pick stands (its setup line hides); leaving the box settles it
    el.gear.addEventListener('input', () => { el.gearHint.classList.add('hidden'); showMatches(); });
    el.gear.addEventListener('focus', showMatches);
    el.gear.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideMatches();
      if (e.key === 'Enter') {
        e.preventDefault();
        // An empty box means "none": Enter mustn't quietly pick the first tip-up on the list
        const first = key(el.gear.value) && el.gearBox.querySelector('button.tag-suggestion');
        if (first) choose(tipUps.find(t => String(t.id) === first.dataset.id)); else settle();
      }
    });
    el.gear.addEventListener('blur', e => {
      if (e.relatedTarget && el.gearBox.contains(e.relatedTarget)) return;
      setTimeout(settle, 150);
    });
    // mousedown (not click) so the box's blur doesn't hide the row first; click covers keyboard
    el.gearBox.addEventListener('mousedown', e => {
      const b = e.target.closest('button.tag-suggestion');
      if (!b) return;
      e.preventDefault();
      choose(tipUps.find(t => String(t.id) === b.dataset.id));
    });
    el.gearBox.addEventListener('click', e => {
      const b = e.target.closest('button.tag-suggestion');
      if (b && e.detail === 0) choose(tipUps.find(t => String(t.id) === b.dataset.id));
    });
  }

  async function setup(opts) {
    anglerSelect = opts.anglerSelect || null;
    current = opts.current || {};
    try {
      const res = await fetch(GEAR_GET_URL, { headers: { 'X-API-Key': API_KEY } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
      tipUps = data.tipUps || [];
      baits = (data.options || {}).bait || [];
    } catch (err) {
      console.warn('Gear list unavailable; Caught on and Bait are hidden:', err);
      return;
    }
    loaded = true;
    if (!wired) { wired = true; wire(); }  // a Try Again reload calls setup again
    choose(current.caughtOn ? tipUps.find(t => t.id === current.caughtOn.gearId) : null);
    baitPicker.setValue(current.bait || '');
    el.gearGroup.classList.remove('hidden');
    el.baitGroup.classList.remove('hidden');
  }

  function payload() {
    if (!loaded) return {};
    settle();  // Save can be tapped straight from the box, before its blur settles it
    return { gearId: selected ? selected.id : null, bait: baitPicker.getValue() || null };
  }

  function reset() {
    choose(null);
    baitPicker.setValue('');
  }

  return { setup, payload, reset };
})();
