# Gillbert 🎣

Our crew's fishing record book — log catches, browse history, and ask an AI-powered fishing companion anything about the books.

Gillbert started as a single n8n chat window and a Raspberry Pi, and has slowly grown into a full self-hosted app for a small group of buddies (~8 anglers) to keep score, settle debates, and never lose track of who caught what, where, and how big.

## What it does

- **Log a catch by chatting** — describe your catch in plain English ("caught a 14in bass on Pine Lake this morning") and Gillbert captures the details and logs it for you. A manual form exists too, mainly for historical entries.
- **Ask Gillbert anything** — a separate chat that knows the entire record book and can answer questions about the full catch history.
- **Browse & search** the catch log, filter by angler / species / body of water, and view every photo and video attached to a catch.
- **Fish of Fame** — leaderboards for biggest catches of all time, per-species records, and top anglers by catch count.
- **Photos & videos just work** — upload straight from your phone; Apple's HEIC/MOV formats get automatically converted so everyone can actually view them, no matter what phone they're on.
- **Attribution, done lightly** — catches and media remember who logged and uploaded them, visible right on the record. Anglers can edit their own catches without needing an admin PIN, until a catch is marked verified.
- **Admin mode** hidden in plain sight, gating the handful of destructive actions (editing, deleting, verifying).

## How it's built

Deliberately simple — no framework, no build step, no bundler. Just HTML, CSS, and vanilla JS, one self-contained page per feature.

- **Frontend**: static pages hosted on Cloudflare Pages
- **Backend**: n8n workflows, self-hosted on a Raspberry Pi
- **AI**: Claude (Anthropic), doing the conversational catch-logging and the "ask about the records" chat
- **Database**: self-hosted PostgreSQL
- **Media**: Azure Blob Storage, with time-limited access links
- **Auth**: Cloudflare Zero Trust — only invited anglers get in

## Why

Because a group text thread is a terrible way to remember who actually caught the biggest fish of the season, and because building your buddies a slightly-too-elaborate fishing app is a pretty fun way to spend some evenings.
