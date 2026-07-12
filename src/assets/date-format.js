// Shared "Caught When" display formatting — used by any page that needs to
// stay behaviorally consistent about how catch dates read (currently
// catch-details.html and catches-listing.html). Extracted here after this
// exact logic drifted into two non-identical copies within a single session.

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// "Today"/"Yesterday" for a date, no time — calendar-day comparison in local
// time, not a rolling 24-hour window. So something from 11 PM last night
// reads as "Yesterday," not "23 hours ago."
function formatDateLabel(d) {
  const now = new Date();
  if (isSameLocalDay(d, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(d, yesterday)) return 'Yesterday';

  return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// True if `d` carries a real time-of-day. log-catch.js and the chat n8n
// workflow both default the time to local midnight when none is given
// (common for legacy/historical entries) — that's not a real "caught at
// 12:00 AM" moment, so callers should omit the time rather than display a
// fabricated one when this returns false.
function hasExplicitTime(d) {
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}
