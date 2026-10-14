---
name: project-setup
description: Set a repo up for long multi-session work with stool - docs/HANDOFF.md (one RESUME HERE block), docs/HANDOFF-history.md, docs/TODO.md, docs/FIXES.md, and a bookkeeping section in CLAUDE.md, matched to the restart-clock options. Use when the user runs /project-setup or asks to set a project up for handoffs, session restarts or the stool workflow.
argument-hint: "[one line on what the project is]"
disable-model-invocation: true
---

Set this repo up so any fresh session can pick it up from files alone, and so `stool:session-restart` and the restart clock have what they expect. Project note from the user: `$ARGUMENTS`.

## 1. Look first

- Run `git rev-parse --show-toplevel` and `date -u +"%Y-%m-%d %H:%MZ"` (every time written below comes from that command).
- Check which of `CLAUDE.md`, `docs/HANDOFF.md`, `docs/HANDOFF-history.md`, `docs/TODO.md`, `docs/FIXES.md` exist. **Never overwrite one that exists**: for an existing file, add only the missing section and say so. An existing handoff under another name or heading: keep it, and tell the user which `restartHandoffFile` / `restartHandoffHeading` options to set instead.
- Read the README, the package manifest and `git log --oneline -15` to fill the templates with real facts. Unknowns are written as `unknown` (never invented).

## 2. Write the files (Write tool, under `docs/` unless the repo keeps docs elsewhere)

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

Append (or create the file with a one-line project summary first) a `## Bookkeeping` section, skipped line by line where CLAUDE.md already says the same:

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
