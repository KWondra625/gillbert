// Change a tip-up's setup: line, leader and hook (one each), beads and flash (zero or more).
// One Save button: the database decides whether to update the current version in place
// (no catch uses it yet) or to add a new version, and writes the history either way.
const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];
const params = new URLSearchParams(location.search);
const tipId = params.get('id');

const el = {
  formHeading: document.getElementById('formHeading'),
  form:        document.getElementById('setupForm'),
  newNote:     document.getElementById('newNote'),
  formError:   document.getElementById('formError'),
  cancelLink:  document.getElementById('cancelLink'),
  errorMsg:    document.getElementById('errorMsg'),
  retryBtn:    document.getElementById('retryBtn'),
};

let options = {};
let myAnglerId = null;

const pickers = Object.fromEntries(['line', 'leader', 'hook'].map(kind => [kind, createOptionPicker({
  input: document.getElementById(kind),
  box: document.getElementById(`${kind}Suggestions`),
  getPool: () => options[kind] || [],
  newLabel: kind,
})]));

const tags = {
  beads: createTagInput({
    wrapper: document.getElementById('beadsWrapper'), input: document.getElementById('beadsInput'),
    suggestionsBox: document.getElementById('beadsSuggestions'), getSuggestionPool: () => options.bead || [] }),
  flash: createTagInput({
    wrapper: document.getElementById('flashWrapper'), input: document.getElementById('flashInput'),
    suggestionsBox: document.getElementById('flashSuggestions'), getSuggestionPool: () => options.flash || [] }),
};

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

// A typed tag that matches a choice apart from capitals and spaces takes the choice's spelling
function tagValues(list, pool) {
  return list.map(v => (pool || []).find(p => gearKey(p) === gearKey(v)) || v.trim().replace(/\s+/g, ' '));
}

async function load() {
  showState('loadingState');
  if (!/^\d+$/.test(tipId || '')) {
    el.errorMsg.textContent = "This link doesn't say which tip-up to set up.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  try {
    const [gear, people] = await Promise.all([gearLoad(tipId), gearLoadAnglers()]);
    const t = gear.tipUps[0];
    if (!t) {
      el.errorMsg.textContent = "That tip-up isn't here any more. It may have been deleted.";
      el.retryBtn.classList.add('hidden');
      showState('errorState');
      return;
    }
    if (t.status === 'Retired') {
      el.errorMsg.textContent = `${t.name} is retired. Bring it back (Rename, owner or bring back) before changing its setup.`;
      el.retryBtn.classList.add('hidden');
      showState('errorState');
      return;
    }
    options = gear.options;
    myAnglerId = people.myAnglerId;
    document.title = `${t.name} setup · Gillbert`;
    // The name goes in the small label, so a long one never wraps the heading
    document.getElementById('headLabel').textContent = `Gear · ${t.name}`;
    el.formHeading.textContent = t.setup ? 'Change setup' : 'First setup';
    GillbertTopbar.setBack(`./gear-tipup.html?id=${t.id}`, t.name);
    el.cancelLink.href = `./gear-tipup.html?id=${t.id}`;
    el.newNote.classList.toggle('hidden', params.get('new') !== '1');
    const s = t.setup || {};
    pickers.line.setValue(s.line);
    pickers.leader.setValue(s.leader);
    pickers.hook.setValue(s.hook);
    tags.beads.setTags(s.beads || []);
    tags.flash.setTags(s.flash || []);
    showState('formState');
  } catch (err) {
    console.error('Failed to load setup:', err);
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

async function submit(e) {
  e.preventDefault();
  el.formError.classList.add('hidden');
  // Text still sitting in a tag box (typed, but no Enter) counts as one more tag
  for (const [key, input] of [['beads', 'beadsInput'], ['flash', 'flashInput']]) {
    const box = document.getElementById(input);
    if (box.value.trim()) { tags[key].setTags([...tags[key].getTags(), box.value.trim()]); box.value = ''; }
  }
  showState('submittingState');
  try {
    await gearSave(GEAR_SETUP_SAVE_URL, {
      gearId: Number(tipId),
      line: pickers.line.getValue(),
      leader: pickers.leader.getValue(),
      hook: pickers.hook.getValue(),
      beads: tagValues(tags.beads.getTags(), options.bead),
      flash: tagValues(tags.flash.getTags(), options.flash),
      byAnglerId: myAnglerId,
    });
    location.href = `./gear-tipup.html?id=${encodeURIComponent(tipId)}`;
  } catch (err) {
    console.warn('Setup save refused:', err.message);
    showState('formState');
    el.formError.textContent = err.message;
    el.formError.classList.remove('hidden');
    el.formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

el.form.addEventListener('submit', submit);
el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
