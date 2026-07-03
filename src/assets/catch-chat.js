// Catch Chat — page-specific reply rendering. Shared send/scroll/focus
// behavior lives in chat-shell.js via initChatShell().

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

initChatShell({
  apiPath: 'catch-conversation',
  sessionKey: 'gillbert_chat_session',
  renderGillbertReply: renderMarkdown,
  logLabel: 'Chat',
});
