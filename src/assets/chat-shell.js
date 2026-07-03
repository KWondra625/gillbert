// ── Shared chat shell behavior ────────────────────────────────────────────────
// Common send/render/scroll/focus logic for Gillbert's full-screen chat pages
// (Catch Chat, Ask Gillbert). Each page calls initChatShell() with a small
// config describing its API endpoint, session key, and how to render
// Gillbert's replies — everything else lives here so the two chat
// experiences can't drift apart.
function initChatShell(config) {
  const {
    apiPath,
    sessionKey,
    renderGillbertReply,
    logLabel = 'Chat',
  } = config;

  const chatUrl = API_BASE + apiPath;

  const el = {
    messages: document.getElementById('chatMessages'),
    welcome:  document.getElementById('chatWelcome'),
    input:    document.getElementById('chatInput'),
    sendBtn:  document.getElementById('chatSendBtn'),
  };

  // ── Session ──────────────────────────────────────────────────────────────

  function getSessionId() {
    let id = sessionStorage.getItem(sessionKey);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      sessionStorage.setItem(sessionKey, id);
    }
    return id;
  }

  const sessionId = getSessionId();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  // ── Message rendering ────────────────────────────────────────────────────

  function hideWelcome() {
    if (el.welcome) el.welcome.style.display = 'none';
  }

  function appendMessage(role, text) {
    hideWelcome();
    const div = document.createElement('div');
    div.className = `message message--${role}`;

    const bubbleContent = role === 'gillbert'
      ? renderGillbertReply(text)
      : escapeHtml(text).replace(/\n/g, '<br>');

    div.innerHTML = `
      <div class="message-avatar">${role === 'gillbert' ? '🤖' : '👤'}</div>
      <div class="message-bubble">${bubbleContent}</div>
    `;

    el.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendThinking() {
    hideWelcome();
    const div = document.createElement('div');
    div.className = 'message message--gillbert message--thinking';
    div.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-bubble">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    `;
    el.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendError(msg) {
    const div = document.createElement('div');
    div.className = 'message message--gillbert message--error';
    div.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-bubble">${escapeHtml(msg)}</div>
    `;
    el.messages.appendChild(div);
    scrollToBottom();
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = el.input.value.trim();
    if (!text) return;

    el.input.value = '';
    el.input.style.height = 'auto';
    el.sendBtn.disabled = true;

    appendMessage('user', text);
    const thinkingEl = appendThinking();

    try {
      const res = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ sessionId, chatInput: text }),
      });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const data = await res.json();
      const arr   = Array.isArray(data) ? data : [data];
      const reply = arr[0]?.reply ?? '…';

      thinkingEl.remove();
      appendMessage('gillbert', reply);
    } catch (err) {
      thinkingEl.remove();
      const userMsg = err.message.toLowerCase().includes('fetch')
        ? 'Gillbert is having trouble connecting. Check your connection and try again.'
        : `Something went wrong — ${err.message}`;
      appendError(userMsg);
      console.error(`${logLabel} error:`, err);
    } finally {
      el.sendBtn.disabled = false;
      el.input.focus();
    }
  }

  // ── Input behaviour ──────────────────────────────────────────────────────

  el.input.addEventListener('input', () => {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
  });

  el.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  el.sendBtn.addEventListener('click', sendMessage);

  window.addEventListener('DOMContentLoaded', () => {
    const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (isDesktop) el.input.focus();
  });
}
