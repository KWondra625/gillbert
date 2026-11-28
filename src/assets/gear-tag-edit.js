// Admin: one gear tag. Rename it, hide or show it, merge it into another tag of the same kind,
// or delete it when nothing uses it. The rules live in gear_tag_save() in the database.
const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];
const tagId = new URLSearchParams(location.search).get('id');

const el = {
  kindLabel:      document.getElementById('kindLabel'),
  tagName:        document.getElementById('tagName'),
  tagUses:        document.getElementById('tagUses'),
  form:           document.getElementById('tagForm'),
  name:           document.getElementById('name'),
  statusPills:    document.getElementById('statusPills'),
  formError:      document.getElementById('formError'),
  mergeGroup:     document.getElementById('mergeGroup'),
  mergeInto:      document.getElementById('mergeInto'),
  mergeBtn:       document.getElementById('mergeBtn'),
  mergeConfirm:   document.getElementById('mergeConfirm'),
  mergeConfirmText: document.getElementById('mergeConfirmText'),
  mergeYes:       document.getElementById('mergeYes'),
  mergeNo:        document.getElementById('mergeNo'),
  deleteGroup:    document.getElementById('deleteGroup'),
  deleteBtn:      document.getElementById('deleteBtn'),
  deleteConfirm:  document.getElementById('deleteConfirm'),
  deleteYes:      document.getElementById('deleteYes'),
  deleteNo:       document.getElementById('deleteNo'),
  errorMsg:       document.getElementById('errorMsg'),
  retryBtn:       document.getElementById('retryBtn'),
};

let tag = null;
let others = [];   // the same kind's other tags (merge targets)
let status = 'Active';

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

function setStatus(s) {
  status = s;
  el.statusPills.querySelectorAll('.status-pill').forEach(b => b.classList.toggle('selected', b.dataset.status === s));
}

function showError(message) {
  el.formError.textContent = message;
  el.formError.classList.remove('hidden');
  showState('formState');
}

function render() {
  const kindLabel = GEAR_TAG_KIND_LABEL[tag.kind] || tag.kind;
  document.title = `${tag.name} · Gillbert`;
  el.kindLabel.textContent = `Admin · ${kindLabel}`;
  el.tagName.textContent = tag.name;
  el.tagUses.textContent = `Used on: ${gearTagUses(tag)}`;
  el.name.value = tag.name;
  setStatus(tag.status === 'Hidden' ? 'Hidden' : 'Active');
  el.formError.classList.add('hidden');

  el.mergeInto.innerHTML = '<option value="">Merge into…</option>' + others.map(o =>
    `<option value="${o.id}">${gearEsc(o.name)} (${gearEsc(gearTagUses(o))})</option>`).join('');
  el.mergeBtn.disabled = true;
  el.mergeConfirm.classList.add('hidden');
  el.mergeGroup.classList.toggle('hidden', others.length === 0);

  const unused = !tag.tipUps && !tag.catches;
  el.deleteGroup.classList.toggle('hidden', !unused);
  el.deleteConfirm.classList.add('hidden');
  el.deleteBtn.classList.remove('hidden');
}

async function load() {
  showState('loadingState');
  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  if (!/^\d+$/.test(tagId || '')) {
    el.errorMsg.textContent = "This link doesn't say which tag to show.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  try {
    const all = await gearLoadTags();
    tag = all.find(t => String(t.id) === tagId);
    if (!tag) {
      el.errorMsg.textContent = "That tag isn't here any more. It may have been merged or deleted.";
      el.retryBtn.classList.add('hidden');
      showState('errorState');
      return;
    }
    others = all.filter(t => t.kind === tag.kind && t.id !== tag.id);
    render();
    showState('formState');
  } catch (err) {
    console.error('Failed to load gear tag:', err);
    el.errorMsg.textContent = 'Unable to load this tag. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

// Save: a rename and/or a hide/show, then back to the list
el.form.addEventListener('submit', async e => {
  e.preventDefault();
  const name = el.name.value.trim().replace(/\s+/g, ' ');
  if (!name) { showError('Give it a name.'); return; }
  const renamed = name !== tag.name;
  const restatus = status !== (tag.status === 'Hidden' ? 'Hidden' : 'Active');
  if (!renamed && !restatus) { window.location.href = './gear-tags.html'; return; }
  showState('submittingState');
  try {
    if (renamed) await gearSave(GEAR_TAG_SAVE_URL, { id: tag.id, action: 'rename', name });
    if (restatus) await gearSave(GEAR_TAG_SAVE_URL, { id: tag.id, action: status === 'Hidden' ? 'hide' : 'show' });
    window.location.href = './gear-tags.html';
  } catch (err) {
    const wanted = status;
    await load();          // shows what did save (a rename can succeed before a hide fails)
    if (!document.getElementById('errorState').classList.contains('hidden')) return;  // the reload failed: its error shows
    if (tag.name !== name) el.name.value = name;          // the rename didn't happen: keep what was typed
    setStatus(wanted);
    showError(err.message);
  }
});

el.statusPills.addEventListener('click', e => {
  const b = e.target.closest('.status-pill');
  if (b) setStatus(b.dataset.status);
});

// Merge: pick the other tag, then confirm (it can't be undone)
el.mergeInto.addEventListener('change', () => {
  el.mergeBtn.disabled = !el.mergeInto.value;
  el.mergeConfirm.classList.add('hidden');
  el.mergeBtn.classList.remove('hidden');
});
el.mergeBtn.addEventListener('click', () => {
  const into = others.find(o => String(o.id) === el.mergeInto.value);
  if (!into) return;
  el.mergeConfirmText.textContent = `Everything using "${tag.name}" (${gearTagUses(tag)}) will use "${into.name}" instead, `
    + `and "${tag.name}" goes away. This can't be undone.`;
  el.mergeBtn.classList.add('hidden');
  el.mergeConfirm.classList.remove('hidden');
});
el.mergeNo.addEventListener('click', () => {
  el.mergeConfirm.classList.add('hidden');
  el.mergeBtn.classList.remove('hidden');
});
el.mergeYes.addEventListener('click', async () => {
  const intoId = Number(el.mergeInto.value);
  showState('submittingState');
  try {
    await gearSave(GEAR_TAG_SAVE_URL, { id: tag.id, action: 'merge', intoId });
    window.location.href = `./gear-tag-edit.html?id=${encodeURIComponent(intoId)}`;  // the merged tag, with its uses
  } catch (err) {
    showError(err.message);
  }
});

el.deleteBtn.addEventListener('click', () => { el.deleteBtn.classList.add('hidden'); el.deleteConfirm.classList.remove('hidden'); });
el.deleteNo.addEventListener('click', () => { el.deleteConfirm.classList.add('hidden'); el.deleteBtn.classList.remove('hidden'); });
el.deleteYes.addEventListener('click', async () => {
  showState('submittingState');
  try {
    await gearSave(GEAR_TAG_SAVE_URL, { id: tag.id, action: 'delete' });
    window.location.href = './gear-tags.html';
  } catch (err) {
    showError(err.message);
  }
});

el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
