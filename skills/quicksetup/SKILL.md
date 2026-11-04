---
name: quicksetup
description: Set a project up for stool with the defaults and no questions - creates the missing docs/HANDOFF.md, HANDOFF-history.md, TODO.md, FIXES.md and restart_count.txt, adds the bookkeeping lines to CLAUDE.md if it has none, keeps the default options (review tiers why-behind every 5th restart, deep every 10th), and prints what it did. Never overwrites an existing file. Use when the user runs /stool:quicksetup; /stool:setup asks first instead.
argument-hint: "[one line on what the project is]"
disable-model-invocation: true
---

Set this repo up for stool with every default and no questions. Project note from the user: `$ARGUMENTS`. Read the `setup` skill next to this one (`../setup/SKILL.md`) for the templates; follow its steps 1 to 3 with these differences:

- Ask nothing (skip its step 0 menu and its step 1b proposal question). Options stay as they are: the defaults already are progress bars, usage strip and keep-warm on, guards off, `reviewTiers` why-behind every 5 and deep every 10, restart at 65 % or 150k tokens of context, no phase-end restarts. Don't edit settings files.
- Create only the files that are missing: `docs/HANDOFF.md`, `docs/HANDOFF-history.md`, `docs/TODO.md`, `docs/FIXES.md`, `docs/restart_count.txt` (`0`). A project that already has a file in that role under another name (a `STATUS.md`, a `LESSONS.md`) keeps it: skip that file and say so.
- CLAUDE.md: missing, create it with the one-line summary and the `## Bookkeeping` section. Present but with no handoff/restart bookkeeping rules: append the `## Bookkeeping` section at the end. Present with such rules: leave it.
- Fill templates with real facts from the README, manifest and `git log --oneline -15`; unknowns are `unknown`.
- Don't commit.

Then print, in a few lines: each file created or skipped (and why), what went into CLAUDE.md, the review tiers in effect (why-behind every 5th restart: goal vs gap; deep every 10th: review of the last ten restarts) and that `/stool:setup` or the ⚙ settings window changes any of it.
