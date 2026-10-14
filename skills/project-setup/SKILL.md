---
name: project-setup
description: Set a repo up for long multi-session work with stool (on a project that already has CLAUDE.md, handoff, TODO or notes files it reviews them and proposes only the missing blocks for the user to pick) - docs/HANDOFF.md (one RESUME HERE block), docs/HANDOFF-history.md, docs/TODO.md, docs/FIXES.md, and a bookkeeping section in CLAUDE.md, matched to the restart-clock options. Use when the user runs /project-setup or asks to set a project up for handoffs, session restarts or the stool workflow.
argument-hint: "[one line on what the project is]"
disable-model-invocation: true
---

Set this repo up so any fresh session can pick it up from files alone, and so `stool:session-restart` and the restart clock have what they expect. Project note from the user: `$ARGUMENTS`.

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

**`docs/FIXES.md`**: `# Fixes` and one line: "One dated section per session (`## <date> - <session or phase>`) with **Waste** (ranked, with rough numbers) and **Fixes** (rules or tool changes made). Written by `stool:session-restart`."

## 3. CLAUDE.md

Fresh project: create the file with a one-line project summary, then this `## Bookkeeping` section. Existing instructions file (CLAUDE.md or another agent's file the project uses instead): never append on your own; its missing lines are Gap items in the step 1b proposal, worded to match the file's voice and pointing at the project's real file names:

```markdown
## Bookkeeping
- Current state: `docs/HANDOFF.md` (the RESUME HERE block). Read it first in every session.
- Update `docs/TODO.md` and `docs/HANDOFF.md` every time a task finishes and when stopping mid-task; commit them with the work.
- RESUME HERE is rewritten, never stacked: the old block moves to the top of `docs/HANDOFF-history.md` in the same edit. Times come from `date -u`.
- At each phase boundary, after a big feedback dump, or when the restart clock says so: run `stool:session-restart` (retrospective into `docs/FIXES.md`, handoff, fresh session).
- A rule broken twice goes into a check script, not only into this file.
```

## 4. Options and report

- If the handoff file or heading differs from the defaults (`HANDOFF.md`, `RESUME HERE`), or the project has a deploy/publish command worth counting, tell the user the `/config` options to set: `restartHandoffLint`, `restartHandoffFile`, `restartHandoffHeading`, `restartPublishCounter` + `restartPublishPattern`. Do not edit settings files yourself.
- Do not commit unless the user asks. Report in a few lines: files created, sections added to existing files, anything marked `unknown` for the user to fill.
