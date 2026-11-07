// Catch Notifications page: fills in this environment's ntfy server and the subscribe link.
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
