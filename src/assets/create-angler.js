const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

const el = {
  loadingState:    document.getElementById('loadingState'),
  errorState:      document.getElementById('errorState'),
  formState:       document.getElementById('formState'),
  submittingState: document.getElementById('submittingState'),
  errorMsg:        document.getElementById('errorMsg'),
  retryBtn:        document.getElementById('retryBtn'),
  name:            document.getElementById('name'),
  nameError:       document.getElementById('nameError'),
  statusPills:     document.getElementById('statusPills'),
  aliases:         document.getElementById('aliases'),
  loginEmails:     document.getElementById('loginEmails'),
  loginEmailsError: document.getElementById('loginEmailsError'),
  formError:       document.getElementById('formError'),
  createBtn:       document.getElementById('createBtn'),
};

let selectedStatus = 'Active';
let hasAttemptedSubmit = false;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseLoginEmails() {
  return el.loginEmails.value.split(',').map(e => e.trim()).filter(Boolean);
}

function showState(stateId) {
  STATE_IDS.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
}

function setStatus(status) {
  selectedStatus = status;
  el.statusPills.querySelectorAll('.status-pill').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.status === status);
  });
}

// ── Load ──────────────────────────────────────────────────────────────────

async function load() {
  showState('loadingState');

  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  setStatus('Active');
  showState('formState');
}

// ── Submit ────────────────────────────────────────────────────────────────

function validate() {
  return {
    name: !el.name.value.trim(),
    loginEmails: parseLoginEmails().some(e => !EMAIL_PATTERN.test(e)),
  };
}

async function submit() {
  hasAttemptedSubmit = true;
  el.formError.classList.add('hidden');

  const errors = validate();
  el.nameError.classList.toggle('hidden', !errors.name);
  el.loginEmailsError.classList.toggle('hidden', !errors.loginEmails);
  if (errors.name) {
    el.name.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (errors.loginEmails) {
    el.loginEmails.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  showState('submittingState');

  const aliasesArr = el.aliases.value.split(',').map(a => a.trim()).filter(Boolean);
  const loginEmailsArr = parseLoginEmails();

  const payload = {
    name: el.name.value.trim(),
    status: selectedStatus,
    aliases: aliasesArr,
    loginEmails: loginEmailsArr,
  };

  try {
    const res = await fetch(`${ANGLERS_SAVE_URL}?action=create`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to create this angler. Please try again.');
    }

    // Jump straight into editing the new record so the admin can keep going
    window.location.href = data.id
      ? `./edit-angler.html?id=${encodeURIComponent(data.id)}`
      : './anglers-listing.html';
  } catch (err) {
    console.error('Create angler failed:', err);
    showState('formState');
    el.formError.textContent = err.message || 'Something went wrong. Please try again.';
    el.formError.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

el.statusPills.querySelectorAll('.status-pill').forEach(btn => {
  btn.addEventListener('click', () => setStatus(btn.dataset.status));
});

el.name.addEventListener('input', () => {
  if (hasAttemptedSubmit && el.name.value.trim()) el.nameError.classList.add('hidden');
});

el.loginEmails.addEventListener('input', () => {
  if (hasAttemptedSubmit && !parseLoginEmails().some(e => !EMAIL_PATTERN.test(e))) {
    el.loginEmailsError.classList.add('hidden');
  }
});

el.createBtn.addEventListener('click', submit);
el.retryBtn.addEventListener('click', load);

window.addEventListener('DOMContentLoaded', load);
