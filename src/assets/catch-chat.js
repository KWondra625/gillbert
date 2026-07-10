// Catch Chat — page-specific reply rendering. Shared send/scroll/focus
// behavior lives in chat-shell.js via initChatShell().

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function linkCatchNumbers(htmlText) {
  return htmlText.replace(/\bCatch\s+\d{2,}-\d+\b/gi, match => {
    const href = `./catch-details.html?catchNumber=${encodeURIComponent(match)}&from=catch-chat`;
    return `<a class="chat-catch-link" href="${href}">${match}</a>`;
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

initChatShell({
  apiPath: 'catch-conversation',
  sessionKey: 'gillbert_chat_session',
  renderGillbertReply: renderMarkdown,
  logLabel: 'Chat',
  getExtraBody: async () => ({ loggedInAnglerId: await loggedInAnglerIdPromise }),
});
