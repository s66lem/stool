---
name: setup
description: Set a project up for stool, asking first - a short menu of which parts to turn on (progress bars, usage strip, keep-warm, guards, restart review tiers and their intervals, restart threshold, handoff/TODO/FIXES files), then it applies the picks. Writes docs/HANDOFF.md (one RESUME HERE block), HANDOFF-history.md, TODO.md, FIXES.md, restart_count.txt and a bookkeeping section in CLAUDE.md; on a project that already has such files it proposes only the missing pieces. Use when the user runs /stool:setup or asks to set a project up for stool. /stool:quicksetup does the same with defaults and no questions.
argument-hint: "[one line on what the project is]"
disable-model-invocation: true
---

Set this repo up so any fresh session can pick it up from files alone, and so `stool:session-restart` and the restart clock have what they expect. Project note from the user: `$ARGUMENTS`. Write nothing until the user has answered step 0.

## 0. Ask first

Look only enough to fill the defaults (`git rev-parse --show-toplevel`; which of the files in step 2 already exist; the current stool options in `/config`). Then show ONE short menu, as AskUserQuestion choices (multi-select, defaults pre-marked) where that tool is available, else a numbered list the user answers with numbers ("reply `all`, `defaults`, or the numbers"). Each item is one line with its default:

1. **Progress bars** (`planProgress`, on): live plan bars and agent strips above the prompt. Off: no bars, and the `plan_progress` tool is never offered, so it costs no calls.
2. **Usage strip** (`usageStrip`, on): agents/cap, weekly and 5-hour usage with pace, context percent.
3. **Keep-warm** (`keepWarm`, on): pings a big idle session so its prompt cache stays warm.
4. **Guards** (off): `leadGuard` (blocks `git add -A`, `cd` out of the project, shell writes to docs), `dispatchGuard` (standing orders on every agent prompt, the agent cap across sessions), `captureGuard` (breaker on a slow screen-capture tool).
5. **Restart review tiers** (`reviewTiers`: why-behind every 5th restart, deep review every 10th): say what each does (step 4 below) and ask for the intervals (0 = off).
6. **Restart threshold**: `restartContextAt` (65 %) and `restartContextTokens` (150000); `restartAtPhaseEnd` (off) adds a restart at each phase end.
7. **Project files**: `docs/HANDOFF.md`, `HANDOFF-history.md`, `TODO.md`, `FIXES.md`, `restart_count.txt` and the CLAUDE.md bookkeeping lines (steps 2 and 3).

Then apply only what was picked:
- Options: merge just the changed keys into the user's `~/.claude/settings.json` under `pluginConfigs` → the installed stool entry (`stool@<marketplace>`, as `/plugin` names it; create `{"options": {}}` if absent) → `options`, keeping every other key; show the changed keys in the report. stool reloads on an option change. A user who would rather set them by hand gets the `/config` rows (or the ⚙ settings window, where every one of these is a switch or button).
- Files: steps 1 to 3 below, only for item 7.

## 1. Look first

- Run `git rev-parse --show-toplevel` and `date -u +"%Y-%m-%d %H:%MZ"` (every time written below comes from that command).
- Find what the project already has, by role, not only by name: agent instructions (`CLAUDE.md` at any level, `.claude/CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`), a state or handoff doc (`HANDOFF*`, `STATUS*`, `PROGRESS*`, `NOTES*`, `CONTEXT*`, `docs/*state*`), a task list (`TODO*`, `TASKS*`, `ROADMAP*`, `BACKLOG*`), a lessons or decisions log (`FIXES*`, `LESSONS*`, `DECISIONS*`, `CHANGELOG*`, `docs/adr/`). Read each one found.
- Read the README, the package manifest and `git log --oneline -15` to fill the templates with real facts. Unknowns are written as `unknown` (never invented).
- **Fresh project** (none of the four roles exists): go to step 2 and write everything.
- **Existing setup** (any role exists): go to step 1b. Nothing in an existing file is changed, moved or deleted without the user's yes.

## 1b. Existing setup: suggest, don't write

For each role, compare what exists with the templates in steps 2 and 3, and sort every difference into one of:

- **Missing**: the role has no file (e.g. no fix log): proposes creating it from the template.
- **Gap**: the file exists but lacks a piece the workflow needs (no single "current state" block at the top, no rule to update the handoff and TODO at each task end, no "rewrite, don't stack" rule, no archive for old state blocks, no restart rule): proposes the exact lines to add and where (after which heading).
- **Mapped**: the project already does it under another name or shape (a `STATUS.md` with a "Current" section, a `LESSONS.md`): keep it; propose only the stool options that point at it (`restartHandoffFile`, `restartHandoffHeading`) and, if useful, one line in the instructions file naming it. Never propose renaming or moving the user's files.
- **Conflict**: an existing rule contradicts the workflow (e.g. "append a dated entry to STATUS.md each session" vs rewriting one block): show both, recommend one, and leave the existing rule unless the user picks the change.
- **Already there**: say nothing about it beyond a count.

Then show the user ONE proposal, grouped by file, each item numbered with its kind, a one-line why, and the exact text to add (a short fenced block, with the heading it goes under). Ask which to apply (one AskUserQuestion, multi-select, recommended items first; or "reply with the numbers"). Apply only the chosen items, with Edit (inserting at the named place, never rewriting the file) or Write for new files. Items not chosen are listed once in the report and not asked again.

Keep proposals proportional: a project whose instructions file is short and casual gets the short versions (one-line rules); never paste the whole bookkeeping block into a file that already covers half of it, only the missing lines.

## 2. Write the files (fresh project, or the new files the user picked; Write tool, under `docs/` unless the repo keeps docs elsewhere)

**`docs/HANDOFF.md`**: exactly one block, rewritten (never appended to) at each restart:

```markdown
# Handoff

## RESUME HERE (rewritten <date -u> ; this block is the whole current state)

**State.** <what is built and working, the branch, what is released or deployed, anything that must NOT be shipped yet and why>

**Waiting on the user:** <numbered questions or picks still open, or "nothing">

**Running work:** <agents or sessions still running: branch, files they own, next step; or "none">

**Next task (first):** <one concrete, immediately actionable step>

**History:** older RESUME blocks are in `docs/HANDOFF-history.md`, newest first; grep it, never read it whole.
```

**`docs/HANDOFF-history.md`**: `# Handoff history` and one line: "Each demoted RESUME HERE block goes to the TOP of this file under a `## Before (<date>)` heading, in the same edit that rewrites HANDOFF.md."

**`docs/TODO.md`**:

```markdown
# TODO

## Now
- [ ] <the next task from HANDOFF>

## Next
- [ ] <known follow-ups>

## Later / ideas

## Done
<!-- move finished items here with the date, newest first -->
```

**`docs/FIXES.md`**: `# Fixes` and one line: "One dated section per session (`## <date> - <session or phase>`) with **Waste** (ranked, with rough numbers), **Foot-guns** (what slowed the work, with evidence, each fixed or assigned) and **Fixes** (rules or tool changes made). Written by `stool:session-restart`."

**`docs/restart_count.txt`**: `0`. `stool:session-restart` bumps it at each restart; the review tiers key off it.

## 3. CLAUDE.md

Fresh project: create the file with a one-line project summary, then this `## Bookkeeping` section. Existing instructions file (CLAUDE.md or another agent's file the project uses instead): never append on your own; its missing lines are Gap items in the step 1b proposal, worded to match the file's voice and pointing at the project's real file names:

```markdown
## Bookkeeping
- Current state: `docs/HANDOFF.md` (the RESUME HERE block). Read it first in every session.
- Update `docs/TODO.md` and `docs/HANDOFF.md` every time a task finishes and when stopping mid-task; commit them with the work.
- RESUME HERE is rewritten, never stacked: the old block moves to the top of `docs/HANDOFF-history.md` in the same edit. Times come from `date -u`.
- When the restart clock says a restart is due (or the user asks): run `stool:session-restart` (retrospective and lessons pass into `docs/FIXES.md` and the skills' `## Lessons`, handoff, fresh session). `docs/restart_count.txt` counts restarts; every 5th adds a why-behind review and every 10th a deep review in front of the resume prompt (stool option `reviewTiers`).
- Mistakes made twice become dated one-line lessons in the area's project skill (`## Lessons`, newest first, at most ~15); a lesson hit twice becomes a check script.
- A rule broken twice goes into a check script, not only into this file.
```

## 4. Review tiers (say this plainly, then offer to set them)

Tell the user in a short block, in these terms:

> **Restart reviews.** Every restart already runs a retrospective with a lessons pass (repeated mistakes become one-line lessons in the area's skill, foot-guns get fixed or assigned). On top of that, stool puts a deeper review in front of the resume prompt on a schedule, counted in `docs/restart_count.txt`:
> - **why-behind, every 5th restart**: is the main metric closing the gap to its target (in absolute units, and how long since it moved), or is the work just tuning? If the approach can't reach the goal, rethink it and tell you.
> - **deep, every 10th restart**: a review of the last ~10 restarts (where time and tokens went, rules broken twice with no check, stalled tools, drift), written to `docs/research/deep_review_<n>.md` with the top 3 fixes sent to you.
> Change the intervals (0 = off), rename or add tiers in `/config` → stool → `reviewTiers` (lines like `why-behind every 5`, `goal check: why-behind every 3`), or with the buttons in the settings window's Restarts section. Restarts follow the context threshold; `restartAtPhaseEnd` adds a restart at each phase end.

This is menu item 5; its answer becomes the `reviewTiers` lines (for example `why-behind every 3`, `deep every 0`), applied as in step 0.

## 5. Options and report

- If the handoff file or heading differs from the defaults (`HANDOFF.md`, `RESUME HERE`), or the project has a deploy/publish command worth counting, name the options that fit (`restartHandoffLint`, `restartHandoffFile`, `restartHandoffHeading`, `restartPublishCounter` + `restartPublishPattern`) and set them as in step 0 if the user says yes.
- Do not commit unless the user asks. Report in a few lines: options changed, files created, sections added to existing files, anything marked `unknown` for the user to fill.
