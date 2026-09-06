// Shared tagging-style input — used for the "Groups" field on both Create
// Angler and Edit Angler. Renders committed values as removable pills inside
// a text-input-styled box, with a suggestion dropdown drawn from whatever
// values are already in use elsewhere (to cut down on typo drift across
// free-text tags, e.g. "Ice Fishing Crew" vs "Ice fishing crew").
//
// createTagInput({ wrapper, input, suggestionsBox, getSuggestionPool })
//   wrapper:          the box that holds both the pills and the text input
//   input:            the inline <input type="text"> inside the wrapper
//   suggestionsBox:   an element below the wrapper to render matches into
//   getSuggestionPool: () => string[] — candidate values, evaluated fresh
//                      on each keystroke so late-arriving data still applies
//
// Returns { getTags(): string[], setTags(string[]): void }.

function createTagInput({ wrapper, input, suggestionsBox, getSuggestionPool }) {
  let tags = [];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function render() {
    wrapper.querySelectorAll('.tag-pill').forEach(p => p.remove());
    tags.forEach((tag, i) => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.innerHTML = `${escapeHtml(tag)} <button type="button" class="tag-pill-remove" aria-label="Remove ${escapeHtml(tag)}">&times;</button>`;
      pill.querySelector('.tag-pill-remove').addEventListener('click', () => {
        tags.splice(i, 1);
        render();
      });
      wrapper.insertBefore(pill, input);
    });
  }

  function addTag(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (tags.some(t => t.toLowerCase() === trimmed.toLowerCase())) return;
    tags.push(trimmed);
    render();
  }

  function hideSuggestions() {
    suggestionsBox.classList.add('hidden');
    suggestionsBox.innerHTML = '';
  }

  function showSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) { hideSuggestions(); return; }
    const pool = getSuggestionPool() || [];
    const options = Array.from(new Set(pool))
      .filter(t => t.toLowerCase().includes(q) && !tags.some(existing => existing.toLowerCase() === t.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 8);
    if (!options.length) { hideSuggestions(); return; }
    suggestionsBox.innerHTML = options.map(t =>
      `<div class="tag-suggestion" data-value="${escapeHtml(t)}">${escapeHtml(t)}</div>`
    ).join('');
    suggestionsBox.classList.remove('hidden');
  }

  input.addEventListener('input', () => showSuggestions(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input.value);
      input.value = '';
      hideSuggestions();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      render();
    }
  });

  input.addEventListener('blur', () => {
    // Delay so a mousedown on a suggestion still registers before it hides.
    setTimeout(hideSuggestions, 150);
  });

  suggestionsBox.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.tag-suggestion');
    if (!opt) return;
    e.preventDefault();
    addTag(opt.dataset.value);
    input.value = '';
    hideSuggestions();
    input.focus();
  });

  wrapper.addEventListener('click', (e) => {
    if (e.target === wrapper) input.focus();
  });

  return {
    getTags: () => tags.slice(),
    setTags: (arr) => { tags = (arr || []).slice(); render(); },
  };
}
