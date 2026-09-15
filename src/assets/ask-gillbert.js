// Ask Gillbert — page-specific reply rendering. Shared send/scroll/focus
// behavior lives in chat-shell.js via initChatShell(); identity resolution
// (loggedInAnglerIdPromise) comes from chat-identity.js.

marked.use({ breaks: true });

function linkifyCatchNumbers(html) {
  return html.replace(/\bCatch\s+\d{2,}-\d+\b/gi, match => {
    const href = `./catch-details.html?catchNumber=${encodeURIComponent(match)}&from=ask-gillbert`;
    return `<a class="chat-catch-link" href="${href}">${match}</a>`;
  });
}

function renderGillbertReply(text) {
  // Sanitize LAST: linkifyCatchNumbers does a naive regex replace over the
  // whole HTML string (including inside tag attributes), which can produce
  // malformed markup if a catch number appears somewhere other than plain
  // text. Running DOMPurify after linkification, not before, guarantees the
  // final output is still safe even if that replace corrupts intermediate
  // structure.
  return DOMPurify.sanitize(linkifyCatchNumbers(marked.parse(text)));
}

initChatShell({
  apiPath: 'ask-gillbert',
  sessionKey: 'gillbert_ask_session',
  renderGillbertReply,
  logLabel: 'Ask',
  getExtraBody: async () => ({ loggedInAnglerId: await loggedInAnglerIdPromise }),
});
