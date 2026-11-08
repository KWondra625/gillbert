// Catch Notifications page: fills in this environment's ntfy server and the subscribe link.
// The HTML carries production's values, so the page still works if this script doesn't run.
// The live site uses production's ntfy; every other copy uses Staging's, matching config.js.
// Neither the server address nor the topic is a secret: anyone may read the topic, only n8n may post.
const NTFY_SERVERS = {
  production: 'ntfy.builtbykw.net',
  staging:    'ntfy-lab01.builtbykw.net',
};
const NTFY_TOPIC = 'gillbert-catches';
const NTFY_HOST  = NTFY_SERVERS[IS_PRODUCTION ? 'production' : 'staging'];

document.getElementById('subscribeLink').href = `ntfy://${NTFY_HOST}/${NTFY_TOPIC}`;
document.getElementById('topicName').textContent = NTFY_TOPIC;
document.getElementById('serverUrl').textContent = `https://${NTFY_HOST}`;

document.querySelectorAll('.copy-button').forEach((button) => {
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });
});

// Easter egg: the App Store badge opens a little roast first. Its href stays real, so without
// this script it just goes to the App Store; with it, the App Store is still the primary button.
(() => {
  const badge = document.getElementById('appStoreBadge');
  const modal = document.getElementById('appleModal');
  const close = document.getElementById('appleModalClose');
  const store = document.getElementById('appleModalStore');

  const openModal  = () => { modal.classList.add('open'); store.focus(); };
  const closeModal = () => { modal.classList.remove('open'); badge.focus(); };

  badge.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
  close.addEventListener('click', closeModal);
  store.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });
})();
