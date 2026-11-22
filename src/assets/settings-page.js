// Settings page (admin only). Everything here goes through GillbertSettings (settings.js), which
// today saves on this device; when settings move to n8n, this page keeps working unchanged.
const $ = id => document.getElementById(id);

let savedTimers = {};
function showSaved(id, text = 'Saved on this device') {
  const el = $(id);
  el.textContent = text;
  clearTimeout(savedTimers[id]);
  savedTimers[id] = setTimeout(() => { el.textContent = ''; }, 2500);
}

function fillSeason() {
  const override = GillbertSettings.get('waterOverride');
  for (const r of document.querySelectorAll('input[name="water"]')) r.checked = r.value === override;
  const calendar = GillbertWater.forDate(new Date()) === 'hard' ? 'hard water' : 'open water';
  $('waterAutoNow').textContent = `(today: ${calendar})`;
}

function fillWelcome() {
  $('welcomeInput').value = GillbertSettings.get('welcomeLine');
}

function fillTease() {
  const lines = GillbertSettings.get('teaseLines');
  $('teaseInput').value = Array.isArray(lines) ? lines.join('\n') : '';
}

function fillRemember() {
  const skip = Number(GillbertSettings.get('rememberWhenSkip')) || 0;
  $('rememberReset').disabled = skip === 0;
}

function wire() {
  for (const r of document.querySelectorAll('input[name="water"]')) {
    r.addEventListener('change', () => {
      if (r.value === 'auto') GillbertSettings.reset('waterOverride');
      else GillbertSettings.set('waterOverride', r.value);
      GillbertWater.apply();
      showSaved('seasonSaved');
    });
  }

  $('welcomeSave').addEventListener('click', () => {
    const text = $('welcomeInput').value.trim();
    if (!text) { showSaved('welcomeSaved', 'Type a line first'); return; }
    GillbertSettings.set('welcomeLine', text);
    showSaved('welcomeSaved');
  });
  $('welcomeReset').addEventListener('click', () => {
    GillbertSettings.reset('welcomeLine');
    fillWelcome();
    showSaved('welcomeSaved', 'Back to the default');
  });

  $('rememberNext').addEventListener('click', () => {
    GillbertSettings.set('rememberWhenSkip', (Number(GillbertSettings.get('rememberWhenSkip')) || 0) + 1);
    fillRemember();
    showSaved('rememberSaved', 'New pick: see the home page');
  });
  $('rememberReset').addEventListener('click', () => {
    GillbertSettings.reset('rememberWhenSkip');
    fillRemember();
    showSaved('rememberSaved', 'Back to the usual daily pick');
  });

  $('teaseSave').addEventListener('click', () => {
    const lines = $('teaseInput').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { showSaved('rememberSaved', 'Add at least one line'); return; }
    GillbertSettings.set('teaseLines', lines);
    fillTease();
    showSaved('rememberSaved');
  });
  $('teaseReset').addEventListener('click', () => {
    GillbertSettings.reset('teaseLines');
    fillTease();
    showSaved('rememberSaved', 'Back to the defaults');
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    $('lockedCard').classList.remove('hidden');
    return;
  }
  fillSeason();
  fillWelcome();
  fillTease();
  fillRemember();
  wire();
  $('settingsBody').classList.remove('hidden');
});
