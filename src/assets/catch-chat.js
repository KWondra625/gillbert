const CHAT_URL = API_BASE + 'catch-conversation';

const el = {
  messages: document.getElementById('chatMessages'),
  welcome:  document.getElementById('chatWelcome'),
  input:    document.getElementById('chatInput'),
  sendBtn:  document.getElementById('chatSendBtn'),
};

// ── Session ───────────────────────────────────────────────────────────────────

function getSessionId() {
  const key = 'gillbert_chat_session';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    sessionStorage.setItem(key, id);
  }
  return id;
}

const sessionId = getSessionId();

// ── Identity ──────────────────────────────────────────────────────────────────

const LOOKUP_URL = API_BASE + 'get-lookup-data';

// Fired immediately so it's resolved (or in flight) by the time the user sends
// their first message. Distinct from the "anglerId" the AI extracts from the
// conversation (who caught the fish) — this is who's holding the phone.
const loggedInAnglerIdPromise = (async () => {
  try {
    const res = await fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return null;
    const raw = await res.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    return await resolveMyAnglerId(data.anglers || []);
  } catch {
    return null;
  }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function linkCatchNumbers(htmlText) {
  return htmlText.replace(/(Saved as:\s*)(Catch\s+[A-Za-z0-9-]+)/gi, (_, prefix, catchNumber) => {
    const href = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;
    return `${prefix}<a class="chat-catch-link" href="${href}">${catchNumber}</a>`;
  });
}

// Converts the subset of markdown Gillbert uses: **bold**, *italic*, newlines
function renderMarkdown(text) {
  return linkCatchNumbers(
    escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/gs,     '<em>$1</em>')
  ).replace(/\n/g, '<br>');
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

// ── Message rendering ─────────────────────────────────────────────────────────

function hideWelcome() {
  if (el.welcome) el.welcome.style.display = 'none';
}

function appendMessage(role, text) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = `message message--${role}`;

  const bubbleContent = role === 'gillbert'
    ? renderMarkdown(text)
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

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendMessage() {
  const text = el.input.value.trim();
  if (!text) return;

  el.input.value = '';
  el.input.style.height = 'auto';
  el.sendBtn.disabled = true;

  appendMessage('user', text);
  const thinkingEl = appendThinking();

  try {
    const loggedInAnglerId = await loggedInAnglerIdPromise;

    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ sessionId, chatInput: text, loggedInAnglerId }),
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
    console.error('Chat error:', err);
  } finally {
    el.sendBtn.disabled = false;
    el.input.focus();
  }
}

// ── Input behaviour ───────────────────────────────────────────────────────────

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

window.addEventListener('DOMContentLoaded', () => el.input.focus());
