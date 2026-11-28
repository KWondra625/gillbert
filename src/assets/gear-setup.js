// Change a tip-up's setup: line, leader and hook (one each), beads and flash (zero or more).
// One Save button. A change normally saves a new version, so catches already logged keep the
// setup they were caught on. Within 2 hours of the setup's last save (or any time for an admin)
// Save first asks: fixing a mistake (the current version is corrected in place, catches on it
// too) or did the rig change (a new version)? The database checks the same 2 hours.
const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];
const params = new URLSearchParams(location.search);
const tipId = params.get('id');

const el = {
  formHeading: document.getElementById('formHeading'),
  form:        document.getElementById('setupForm'),
  newNote:     document.getElementById('newNote'),
  formError:   document.getElementById('formError'),
  choice:      document.getElementById('setupChoice'),
  choiceText:  document.getElementById('setupChoiceText'),
  cancelLink:  document.getElementById('cancelLink'),
  errorMsg:    document.getElementById('errorMsg'),
  retryBtn:    document.getElementById('retryBtn'),
};

let options = {};
let myAnglerId = null;
let loadedSetup = null;   // the setup as loaded, to tell whether Save changes anything
const FIX_WINDOW_MS = 120 * 60 * 1000;   // same 2 hours as gear_setup_save

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
    loadedSetup = t.setup;
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

function formSetup() {
  return {
    line: pickers.line.getValue(),
    leader: pickers.leader.getValue(),
    hook: pickers.hook.getValue(),
    beads: tagValues(tags.beads.getTags(), options.bead),
    flash: tagValues(tags.flash.getTags(), options.flash),
  };
}

// The same rule as the database: names match without capitals or extra spaces, tags in any order
function sameSetup(a, b) {
  const one = v => gearKey(v);
  const set = list => (list || []).map(gearKey).filter(Boolean).sort().join('|');
  return one(a.line) === one(b.line) && one(a.leader) === one(b.leader) && one(a.hook) === one(b.hook)
    && set(a.beads) === set(b.beads) && set(a.flash) === set(b.flash);
}

// Ask "fixing a mistake, or did the rig change?" when there's an entered setup that this save
// changes, and it was saved under 2 hours ago (or an admin is saving). Otherwise: a new setup.
function choiceNeeded(next) {
  const s = loadedSetup;
  if (!s || sameSetup(s, { line: null, leader: null, hook: null, beads: [], flash: [] })) return null;
  if (sameSetup(s, next)) return null;
  const recent = s.savedAt && Date.now() - new Date(s.savedAt).getTime() < FIX_WINDOW_MS;
  if (recent) return 'recent';
  return typeof isAdminUnlocked === 'function' && isAdminUnlocked() ? 'admin' : null;
}

const KEEP_NOTE = "(Fish already logged keep the setup they were caught on, unless it's a fix.)";

function askChoice(why) {
  el.choiceText.innerHTML = (why === 'recent'
    ? 'This setup was saved less than 2 hours ago. '
    : 'As an admin, you can fix the current setup at any time. ')
    + `Are you <strong>fixing a mistake</strong> in it, or did the <strong>rig change</strong>? ${KEEP_NOTE}`;
  el.choice.classList.remove('hidden');
  el.choice.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('fixBtn').focus();
}

async function submit(e) {
  e.preventDefault();
  el.formError.classList.add('hidden');
  // Text still sitting in a tag box (typed, but no Enter) counts as one more tag
  for (const [key, input] of [['beads', 'beadsInput'], ['flash', 'flashInput']]) {
    const box = document.getElementById(input);
    if (box.value.trim()) { tags[key].setTags([...tags[key].getTags(), box.value.trim()]); box.value = ''; }
  }
  const why = choiceNeeded(formSetup());
  if (why) { askChoice(why); return; }
  await save('new');
}

async function save(mode) {
  el.choice.classList.add('hidden');
  showState('submittingState');
  try {
    await gearSave(GEAR_SETUP_SAVE_URL, {
      gearId: Number(tipId),
      ...formSetup(),
      byAnglerId: myAnglerId,
      mode,
      // The admin gate is the page's (as on the other admin pages); the server only lets an
      // admin's fix past the 2 hours
      ...(mode === 'fix' && typeof isAdminUnlocked === 'function' && isAdminUnlocked() ? { admin: true } : {}),
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
document.getElementById('fixBtn').addEventListener('click', () => save('fix'));
document.getElementById('newSetupBtn').addEventListener('click', () => save('new'));
el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
