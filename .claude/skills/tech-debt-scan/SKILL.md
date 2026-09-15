---
name: Tech Debt Scan
description: Scan this repo for small, self-contained cleanup candidates — dead code, leftover debug logging, TODO/FIXME comments, drifted duplicated business logic, and wasteful DOM/fetch patterns. Use when asked to look for tech debt, cleanup, quick wins, or code quality issues across the codebase — not for reviewing a specific diff or hunting correctness bugs (see /code-review for that).
---

## Purpose

Find "quick hitter" cleanup items in this vanilla HTML/CSS/JS repo (no build
step, no module system) — the kind that can be fixed and verified in the same
session, not things that need a design conversation or a dedicated focus
session.

## What counts

- Dead code: unused functions, variables, or entire files no longer
  referenced (e.g. a script tag left in after the feature it wired up
  changed shape).
- Leftover debug artifacts: stray `console.log`s that don't match the file's
  established logging pattern, commented-out code, TODO/FIXME/HACK/XXX
  comments.
- Duplicated **business logic** that has demonstrably drifted into
  non-identical copies, or is actively evolving — not trivial 1-2 line
  helpers. This repo has an explicit, deliberate policy that small
  duplicated snippets (e.g. `escapeHtml`) stay duplicated across pages on
  purpose, since every page is meant to be readable in isolation. Only flag
  duplication that meets the project's real bar: it's already drifted, it's
  changed more than once recently, it's shared by flows that must behave
  identically, or it's correctness/security-sensitive.
- Wasteful patterns: rebuilding DOM/re-attaching listeners on every
  interaction instead of once, redundant fetches, obvious O(n^2) work on
  data that's already in hand — the same category as a rebuild-on-every-
  filter-click bug fixed earlier in this project's history.
- Small, self-contained correctness risks — not new features, not anything
  requiring a product/UX decision.

## What NOT to flag

- Purely subjective/stylistic preferences.
- Anything that requires a design or scoping conversation before it could be
  implemented.
- Anything already known and currently deferred/held/declined per this
  project's own memory — check current session memory (project/feedback
  entries) for items already marked "don't raise unprompted," "on hold," or
  "deliberately deferred" before finalizing the list, and drop those. If
  memory isn't available in this context, note that the list hasn't been
  cross-checked against known exceptions.

## Process

1. Spawn a fork (Agent tool, `subagent_type: "fork"`) to do the actual
   legwork: grep for TODO/FIXME/console.log across `src/`, cross-reference
   every top-level function's call sites to find dead code, compare
   structurally similar page-pairs (e.g. pages that are supposed to behave
   the same way) for logic that looks like it silently diverged, and look
   for DOM-rebuild-on-every-interaction or redundant-fetch patterns. Tell
   the fork to report raw candidates with file:line, a one-sentence
   description, and why each is low-risk/self-contained — it should not
   filter for relevance against project history, since it won't have that
   context.
2. Once the fork reports back, filter its candidates yourself against
   current project memory (deferred items, already-fixed items, explicitly
   declined items) and drop anything already known and excluded.
3. Present the surviving candidates as a short prioritized list (3-6 items
   max) — file:line, the issue, and why it's a quick hitter. This is a
   survey, not an auto-fix: report findings and let the user decide what (if
   anything) to act on. Don't implement or commit changes as part of running
   this skill.
