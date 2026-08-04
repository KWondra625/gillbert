const ADMIN_PIN = '2751';
const ADMIN_EMAILS = ['kurt.wondra@outlook.com', 'kurt.wondra@yahoo.com'];
const ADMIN_UNLOCK_STORAGE_KEY = 'gillbert_admin_unlock_expires';
const ADMIN_TOAST_DATE_KEY = 'gillbert_admin_toast_date';
const ADMIN_UNLOCK_DAYS = 14;
const ADMIN_TAP_COUNT = 5;
const ADMIN_TAP_WINDOW_MS = 3000;

// Expose for me.html's inline diagnostic script
window.ADMIN_EMAILS = ADMIN_EMAILS;

function isAdminUnlocked() {
  const expires = Number(localStorage.getItem(ADMIN_UNLOCK_STORAGE_KEY) || 0);
  if (Date.now() > expires) {
    localStorage.removeItem(ADMIN_UNLOCK_STORAGE_KEY);
    return false;
  }
  return true;
}

function unlockAdmin() {
  const expires = Date.now() + ADMIN_UNLOCK_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(ADMIN_UNLOCK_STORAGE_KEY, String(expires));
  revealAdminSection();
}

// Shows the home page's Admin section once unlocked. No-op on pages that
// don't have this markup (currently index.html only).
function revealAdminSection() {
  const section = document.getElementById('adminSection');
  const grid = document.getElementById('adminSectionGrid');
  if (!section || !grid) return;
  if (isAdminUnlocked()) {
    section.classList.remove('hidden');
    grid.classList.remove('hidden');
  }
}

let _toastTimer = null;

function showUnlockToast() {
  const toast = document.getElementById('adminUnlockToast');
  if (!toast) return;
  toast.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function hasShownToastToday() {
  const today = new Date().toISOString().slice(0, 10);
  return localStorage.getItem(ADMIN_TOAST_DATE_KEY) === today;
}

function markToastShownToday() {
  localStorage.setItem(ADMIN_TOAST_DATE_KEY, new Date().toISOString().slice(0, 10));
}

async function checkCloudflareIdentity() {
  try {
    const res = await fetch('/cdn-cgi/access/get-identity', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    window.cloudflareIdentity = data;
    if (ADMIN_EMAILS.includes((data.email || '').toLowerCase())) {
      unlockAdmin();
      if (!hasShownToastToday()) {
        showUnlockToast();
        markToastShownToday();
      }
    }
  } catch {
    // Local dev or no Cloudflare Access session — silent no-op, PIN fallback still works
  }
}

// Fire immediately so the promise is in flight while page-specific scripts load
window.adminIdentityCheck = checkCloudflareIdentity();

// Resolves the current Cloudflare identity to an angler_id by matching its email
// against each angler's loginEmails (from get-lookup-data). Returns null if there's
// no Cloudflare session or no angler has this email registered.
async function resolveMyAnglerId(anglers) {
  await window.adminIdentityCheck;
  const email = (window.cloudflareIdentity && window.cloudflareIdentity.email || '').toLowerCase();
  if (!email || !Array.isArray(anglers)) return null;
  const match = anglers.find(a => (a.loginEmails || []).some(e => e.toLowerCase() === email));
  return match ? match.id : null;
}
window.resolveMyAnglerId = resolveMyAnglerId;

// Wires up the tap-to-reveal PIN modal. No-op on pages that don't have
// the trigger element and modal markup (currently index.html only).
function initAdminTapTrigger() {
  const target = document.getElementById('adminTapTarget');
  const modal = document.getElementById('adminPinModal');
  if (!target || !modal) return;

  const input = document.getElementById('adminPinInput');
  const submit = document.getElementById('adminPinSubmit');
  const close = document.getElementById('adminPinClose');
  const error = document.getElementById('adminPinError');

  let tapCount = 0;
  let tapTimer = null;

  function openModal() {
    error.classList.add('hidden');
    input.value = '';
    modal.classList.add('open');
    input.focus();
  }

  function closeModal() {
    modal.classList.remove('open');
  }

  function trySubmit() {
    if (input.value === ADMIN_PIN) {
      unlockAdmin();
      closeModal();
      showUnlockToast(); // always show for manual PIN entry — no day-throttle
    } else {
      error.classList.remove('hidden');
      input.value = '';
      input.focus();
    }
  }

  target.addEventListener('click', () => {
    tapCount += 1;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, ADMIN_TAP_WINDOW_MS);

    if (tapCount >= ADMIN_TAP_COUNT) {
      tapCount = 0;
      clearTimeout(tapTimer);
      openModal();
    }
  });

  close.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  submit.addEventListener('click', trySubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trySubmit();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });
}

document.addEventListener('DOMContentLoaded', initAdminTapTrigger);
document.addEventListener('DOMContentLoaded', revealAdminSection);
