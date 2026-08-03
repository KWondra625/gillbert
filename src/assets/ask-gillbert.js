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
  return linkifyCatchNumbers(DOMPurify.sanitize(marked.parse(text)));
}

initChatShell({
  apiPath: 'ask-gillbert',
  sessionKey: 'gillbert_ask_session',
  renderGillbertReply,
  logLabel: 'Ask',
  getExtraBody: async () => ({ loggedInAnglerId: await loggedInAnglerIdPromise }),
});
