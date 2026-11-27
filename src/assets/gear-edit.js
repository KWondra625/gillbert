// Add a tip-up (no ?id), or change one's name, owner, model, color or status (?id=7).
// Adding goes straight on to its setup. Name uniqueness is checked by the database; the
// list here only gives an early warning while typing.
const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];
const editId = new URLSearchParams(location.search).get('id');
const isEdit = /^\d+$/.test(editId || '');

const el = {
  formHeading: document.getElementById('formHeading'),
  headTile:    document.getElementById('headTile'),
  form:        document.getElementById('gearForm'),
  name:        document.getElementById('name'),
  nameError:   document.getElementById('nameError'),
  owner:       document.getElementById('owner'),
  ownerError:  document.getElementById('ownerError'),
  model:       document.getElementById('model'),
  color:       document.getElementById('color'),
  statusGroup: document.getElementById('statusGroup'),
  statusPills: document.getElementById('statusPills'),
  noteGroup:   document.getElementById('noteGroup'),
  retiredNote: document.getElementById('retiredNote'),
  notes:       document.getElementById('notes'),
  formError:   document.getElementById('formError'),
  saveBtn:     document.getElementById('saveBtn'),
  cancelLink:  document.getElementById('cancelLink'),
  deleteGroup: document.getElementById('deleteGroup'),
  deleteBtn:   document.getElementById('deleteBtn'),
  deleteConfirm: document.getElementById('deleteConfirm'),
  deleteYes:   document.getElementById('deleteYes'),
  deleteNo:    document.getElementById('deleteNo'),
  errorMsg:    document.getElementById('errorMsg'),
  retryBtn:    document.getElementById('retryBtn'),
};

let options = {};
let allTipUps = [];
let myAnglerId = null;
let status = 'Active';

const modelPicker = createOptionPicker({ input: el.model, box: document.getElementById('modelSuggestions'),
  getPool: () => options.model || [], newLabel: 'model' });
const colorPicker = createOptionPicker({ input: el.color, box: document.getElementById('colorSuggestions'),
  getPool: () => options.color || [], newLabel: 'color' });

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

function setStatus(s) {
  status = s;
  el.statusPills.querySelectorAll('.status-pill').forEach(b => b.classList.toggle('selected', b.dataset.status === s));
  el.noteGroup.classList.toggle('hidden', s !== 'Retired');
}

// The same rule as the database: capitals and extra spaces don't count
function nameTakenBy(name) {
  const k = gearKey(name);
  return k ? allTipUps.find(t => gearKey(t.name) === k && String(t.id) !== String(editId)) : null;
}

function checkName() {
  const taken = nameTakenBy(el.name.value);
  el.nameError.textContent = taken ? `"${taken.name}" is already taken (${taken.ownerName}'s). Names must be unique.` : '';
  el.nameError.classList.toggle('hidden', !taken);
  return !taken;
}

function notFound() {
  el.errorMsg.textContent = "That tip-up isn't here any more. It may have been deleted.";
  el.retryBtn.classList.add('hidden');
  showState('errorState');
}

async function load() {
  showState('loadingState');
  try {
    const [gear, people] = await Promise.all([gearLoad(), gearLoadAnglers()]);
    options = gear.options;
    allTipUps = gear.tipUps;
    myAnglerId = people.myAnglerId;
    const anglers = [...people.anglers].sort((a, b) => a.name.localeCompare(b.name));
    el.owner.innerHTML = '<option value="">Choose an angler…</option>'
      + anglers.map(a => `<option value="${a.id}">${gearEsc(a.name)}</option>`).join('');

    if (isEdit) {
      const t = allTipUps.find(x => String(x.id) === editId);
      if (!t) { notFound(); return; }
      document.title = `Edit ${t.name} · Gillbert`;
      el.formHeading.textContent = `Edit ${t.name}`;
      el.headTile.innerHTML = '<img class="tipup-ico" src="./assets/tipup-icon.svg" alt="" />';
      el.headTile.classList.remove('page-head-tile--plus');
      GillbertTopbar.setBack(`./gear-tipup.html?id=${t.id}`, t.name);
      el.cancelLink.href = `./gear-tipup.html?id=${t.id}`;
      el.name.value = t.name;
      // An owner who's no longer on the angler list stays choosable
      if (!anglers.some(a => a.id === t.ownerAnglerId)) {
        el.owner.insertAdjacentHTML('beforeend', `<option value="${t.ownerAnglerId}">${gearEsc(t.ownerName)}</option>`);
      }
      el.owner.value = String(t.ownerAnglerId);
      modelPicker.setValue(t.model);
      colorPicker.setValue(t.color);
      el.retiredNote.value = t.retiredNote || '';
      el.notes.value = t.notes || '';
      el.statusGroup.classList.remove('hidden');
      setStatus(t.status);
      el.saveBtn.textContent = 'Save';
      el.deleteGroup.classList.toggle('hidden', Number(t.catchCount) > 0);
    } else {
      setStatus('Active');
      if (myAnglerId != null) el.owner.value = String(myAnglerId);   // the owner defaults to you
    }
    showState('formState');
  } catch (err) {
    console.error('Failed to load:', err);
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

function fail(message) {
  showState('formState');
  el.formError.textContent = message;
  el.formError.classList.remove('hidden');
  el.formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submit(e) {
  e.preventDefault();
  el.formError.classList.add('hidden');
  const hasName = !!el.name.value.trim();
  if (!hasName) {
    el.nameError.textContent = 'Please enter a name.';
    el.nameError.classList.remove('hidden');
  }
  const hasOwner = !!el.owner.value;
  el.ownerError.classList.toggle('hidden', hasOwner);
  if (!hasName || !checkName() || !hasOwner) return;

  showState('submittingState');
  try {
    const data = await gearSave(GEAR_SAVE_URL, {
      id: isEdit ? Number(editId) : null,
      name: el.name.value,
      ownerAnglerId: Number(el.owner.value),
      model: modelPicker.getValue(),
      color: colorPicker.getValue(),
      notes: el.notes.value,
      status,
      retiredNote: status === 'Retired' ? el.retiredNote.value : '',
      byAnglerId: myAnglerId,
    });
    location.href = isEdit ? `./gear-tipup.html?id=${data.id}` : `./gear-setup.html?id=${data.id}&new=1`;
  } catch (err) {
    console.warn('Save refused:', err.message);
    fail(err.message);
  }
}

async function remove() {
  showState('submittingState');
  try {
    await gearSave(GEAR_SAVE_URL, { id: Number(editId), delete: true, byAnglerId: myAnglerId });
    location.href = './gear.html';
  } catch (err) {
    console.warn('Delete refused:', err.message);
    fail(err.message);
  }
}

el.form.addEventListener('submit', submit);
el.name.addEventListener('input', () => {
  if (el.name.value.trim()) checkName(); else el.nameError.classList.add('hidden');
});
el.owner.addEventListener('change', () => el.ownerError.classList.toggle('hidden', !!el.owner.value));
el.statusPills.querySelectorAll('.status-pill').forEach(b => b.addEventListener('click', () => setStatus(b.dataset.status)));
el.deleteBtn.addEventListener('click', () => { el.deleteBtn.classList.add('hidden'); el.deleteConfirm.classList.remove('hidden'); });
el.deleteNo.addEventListener('click', () => { el.deleteConfirm.classList.add('hidden'); el.deleteBtn.classList.remove('hidden'); });
el.deleteYes.addEventListener('click', remove);
el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
