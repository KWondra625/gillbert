// Shared "Caught When" display formatting — used by any page that needs to
// stay behaviorally consistent about how catch dates read (currently
// catch-details.html, catches-listing.html and media-upload.html). Extracted here
// after this exact logic drifted into two non-identical copies within a single
// session, and the upload page's own copy later drifted too (it showed "12:00 AM"
// for catches logged without a time).

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

// Full "Caught When" text, as the catch detail page shows it: "October 24, 2026 at 12:27 PM"
// (or Today/Yesterday), and just the date for a catch logged without a time.
function formatCaughtWhenFull(d) {
  if (!hasExplicitTime(d)) return formatDateLabel(d);
  return `${formatDateLabel(d)} at ${d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

// Compact form for tight spots like the Catches Listing cards: short month, and the year only
// when the date is more than about six months back ("Oct 24", "Jun 24, 2025"). Within six
// months the date can only mean the recent one, so the year adds nothing but width.
const SHORT_DATE_RECENT_DAYS = 183;

function formatShortDate(d) {
  const ageDays = (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000);
  const recent = ageDays > -1 && ageDays < SHORT_DATE_RECENT_DAYS;
  return d.toLocaleString('en-US', recent
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Today"/"Yesterday" like formatDateLabel, otherwise the compact date
function formatShortDateLabel(d) {
  const label = formatDateLabel(d);
  return label === 'Today' || label === 'Yesterday' ? label : formatShortDate(d);
}

// True if `d` carries a real time-of-day. log-catch.js and the chat n8n
// workflow both default the time to local midnight when none is given
// (common for legacy/historical entries) — that's not a real "caught at
// 12:00 AM" moment, so callers should omit the time rather than display a
// fabricated one when this returns false.
function hasExplicitTime(d) {
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}
