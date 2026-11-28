// Shared by the gear pages (gear, gear-tipup, gear-edit, gear-setup, and the admin's gear-tags and
// gear-tag-edit): loading and saving
// through the gear endpoints, and the words for a setup and for a history line.
// The rules (unique names, versions, history) live in the database; this only shows them.

const LOOKUP_DATA_URL = API_BASE + 'get-lookup-data';

function gearEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// n8n may wrap a single object in an array
function gearUnwrap(raw) {
  return Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
}

// { tipUps, options, history? }; with an id, tipUps holds just that one and history is filled
async function gearLoad(id) {
  const url = id ? `${GEAR_GET_URL}?id=${encodeURIComponent(id)}` : GEAR_GET_URL;
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = gearUnwrap(await res.json());
  return { tipUps: data.tipUps || [], options: data.options || {}, history: data.history || [] };
}

// The anglers (for the owner list) and which one is using the page (null when unknown)
async function gearLoadAnglers() {
  const res = await fetch(LOOKUP_DATA_URL, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const anglers = gearUnwrap(await res.json()).anglers || [];
  const myAnglerId = await resolveMyAnglerId(anglers);
  return { anglers, myAnglerId };
}

// Admin (gear-tags, gear-tag-edit): every tag with its uses,
// [{ id, kind, name, status, tipUps, catches }], sorted by kind then name
async function gearLoadTags() {
  const res = await fetch(GEAR_TAGS_URL, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  return Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
}

// The tag kinds, in the order the admin pages show them
const GEAR_TAG_KINDS = [
  ['line', 'Line'], ['leader', 'Leader'], ['hook', 'Hook'], ['bead', 'Beads'], ['flash', 'Flash'],
  ['bait', 'Bait'], ['model', 'Model'], ['color', 'Color'],
];
const GEAR_TAG_KIND_LABEL = Object.fromEntries(GEAR_TAG_KINDS);

// "3 tip-ups", "1 catch", "3 tip-ups · 2 catches", or "Not used"
function gearTagUses(t) {
  const parts = [];
  if (t.tipUps) parts.push(`${t.tipUps} tip-up${t.tipUps === 1 ? '' : 's'}`);
  if (t.catches) parts.push(`${t.catches} catch${t.catches === 1 ? '' : 'es'}`);
  return parts.length ? parts.join(' · ') : 'Not used';
}

// Posts a save; returns the answer, or throws with a message the page can show
async function gearSave(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = gearUnwrap(await res.json()); } catch { data = {}; }
  if (!res.ok || !data.success) throw new Error(data.message || 'Unable to save changes. Please try again.');
  return data;
}

// "#10 Treble · Red, Glow · Gold blade": the hook, beads and flash, the parts that tell
// tip-ups apart at a glance. Line and leader are on the tip-up's own page.
function gearSetupSummary(setup) {
  if (!setup) return 'No setup yet';
  const parts = [setup.hook, (setup.beads || []).join(', '), (setup.flash || []).join(', ')].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No frills';
}

const GEAR_FIELD_LABELS = { line: 'Line', leader: 'Leader', hook: 'Hook', beads: 'Beads', flash: 'Flash' };

// One history row in words, e.g. "Hook: #8 Octopus → #10 Treble"
function gearHistoryText(h) {
  const was = h.oldValue || 'none';
  const now = h.newValue || 'none';
  switch (h.eventType) {
    case 'created':  return `Added ${h.newValue}`;
    case 'setup':    return `${GEAR_FIELD_LABELS[h.field] || h.field}: ${was} → ${now}`;
    case 'fix':      return `${GEAR_FIELD_LABELS[h.field] || h.field} fixed: ${was} → ${now}`;   // corrected in place
    case 'rename':   return `Renamed ${was} → ${now}`;
    case 'owner':    return `Owner: ${was} → ${now}`;
    case 'model':    return `Model: ${was} → ${now}`;
    case 'color':    return `Color: ${was} → ${now}`;
    case 'notes':    return h.newValue ? `Notes: ${h.newValue}` : 'Notes cleared';
    case 'retire':   return h.field === 'note' ? `Retired note: ${was} → ${now}`
                                               : `Retired${h.newValue ? `: ${h.newValue}` : ''}`;
    case 'unretire': return 'Back in service';
    case 'photo':    return `Photo ${h.newValue || 'changed'}`;   // added / replaced / removed
    default:         return h.eventType;
  }
}

// "Nov 22" this year, "Nov 22, 2025" before
function gearShortDate(iso) {
  const d = new Date(iso);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
