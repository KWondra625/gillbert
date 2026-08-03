// Shared identity resolution for chat pages (Catch Chat, Ask Gillbert).
// Fired immediately so it's resolved (or in flight) by the time the user
// sends their first message. Distinct from the "anglerId" the AI extracts
// from conversation (who caught the fish) — this is who's holding the phone.
const LOOKUP_URL = API_BASE + 'get-lookup-data';

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
