const ADMIN_PIN = '2751';
const ADMIN_UNLOCK_STORAGE_KEY = 'gillbert_admin_unlock_expires';
const ADMIN_UNLOCK_DAYS = 14;
const ADMIN_TAP_COUNT = 5;
const ADMIN_TAP_WINDOW_MS = 3000;

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
}

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
