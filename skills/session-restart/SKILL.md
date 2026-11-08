---
name: session-restart
description: Use when the restart clock says a restart is due (the context threshold), when the user asks to restart, or at a phase end when the restartAtPhaseEnd option is on - runs a retrospective (token/time waste, fixes) into the project's fix log, updates the handoff, then clears or compacts this session (restartMode option) and injects the resume prompt through the stool restart_session tool.
---

# Session restart

Run this when the restart clock says a restart is due (context at `restartContextAt` percent or `restartContextTokens` tokens), when the user asks to restart, or when the session has clearly grown long. Phase ends trigger it only when the `restartAtPhaseEnd` option is on (the system prompt then says so); otherwise keep working through phase ends, since each restart costs a fresh setup. Do every step; don't skip the retrospective.

## 1. Retrospective
Review this session for what was inefficient, time-wise and token-wise: agent runs that were large for what they returned, rework loops, project rules that were broken, waits that were serial but could have been parallel, tests that were hard to drive, lead work that should have been delegated (or the reverse).
- Write it to `docs/FIXES.md` in the project (create it if missing): a dated section `## <date> - <session/phase name>` with **Waste** (ranked, with rough numbers), **Foot-guns** (what slowed the work, each with its evidence: a time, a token count, a commit; each fixed now or assigned) and **Fixes** (concrete rule or tool changes).
- Lessons pass (every restart; the review tiers below run it deeper): each mistake made more than once becomes a dated one-line lesson in the `## Lessons` list of the project skill for that area (`.claude/skills/<area>/SKILL.md`; newest first, at most ~15). Where an area keeps needing the same instructions and has no skill, propose a new project skill to the user. A lesson hit twice becomes a check script, not more prose.
- Apply the cheap fixes now: rules go into the project's `CLAUDE.md`, tool/task work goes into the project's TODO and the top of its handoff file.
- If the user hasn't written anything in the last ~15 minutes (not watching) and the project defines a notify command, send a one-line summary with it. No secrets, ids or file contents.

## 2. Handoff
- Update the project's handoff file (a "RESUME HERE" block: state, published versions/tags, what's unverified, the next task first) and its TODO. With no such file, use the `handoff` skill.
- Commit, run the project's check, and push if the project has a remote and a push rule (scan for secrets first).

## 2a. Review tiers (every Nth restart)
Keep a restart counter in the project (`docs/restart_count.txt`, one integer; create it at 1). Bump it in every restart's handoff commit, before calling `restart_session`. The tool reads it and, when a review tier is due, puts that tier's instructions in front of your resume prompt (its result says which): don't write them into the prompt yourself. Tiers come from the `reviewTiers` option (`/config` or the settings window's Restarts section), one line each, `[name:] <type> every <N>` (0 = off); a count that is a multiple of several intervals runs each of them. Defaults:
- `why-behind every 5`: goal against gap. Each goal metric now vs its target in absolute units, how long since it last moved, whether the work attacks the measured gap or only tunes; rethink the approach if it cannot reach the goal at its rate, and tell the user the decision.
- `deep every 10`: the deep review. The last ~10 restarts' handoff history, the fix log, the project's skills and Lessons, the results; where time, tokens and tries went against the progress they bought, rules broken twice with no check script, tools that broke or stalled, drift into small tuning. Writes `docs/research/deep_review_<n>.md` with ranked fixes, applies the cheap ones, sends the user the top 3. Run inline; strong-model agents for it need the user's OK.
Both include the lessons pass, consolidated (merge duplicate lessons, fold durable ones into the skill's rules, drop stale ones), and a foot-guns section. If the tool is missing, add the due tier's work as the resume prompt's first task yourself.

## 2b. Context at 65% or more
A long session's handoff misses things the lead no longer has in view. When the context sits at 65% or more (or the user asks), before the restart dispatch one read-only agent (a strong model) with the path of the handoff and the session transcript (the newest `.jsonl` under `~/.claude/projects/<project slug>/`). Ask for four lists: **A** facts in the transcript missing from the handoff; **B** contradictions and stale lines in the handoff; **C** the twelve facts that must not be lost; **D** user instructions never acted on. Fold the findings into the handoff (rewrite the block, don't append), commit, then go on. No `/compact` of your own is needed: the restart's clear or compaction replaces it.

## 3. Fresh session
The restart reuses this session, so it stays a normal interactive session with its permission mode and Remote Control. `mcp__stool__restart_session` uses whichever `restartMode` option is set (its result says which); steps 1, 2 and 2a are the same in both modes:
- `clear`: when the turn ends it runs `/clear` and submits the prompt as the next user message.
- `compact` (default): when the turn ends it runs `/compact` with a short focus (keep the task state and open items), then injects the prompt, the restart number and the `RESUME HERE` block of `resumeFile` (default `docs/HANDOFF.md`, read from disk then) as context after the summary, and starts the next turn with a background-task notification ("stool restart wake"), not a user message. The process survives, so background tasks and other plugins keep running. The handoff must be committed before the call, since the injected block is read at the compaction. Claude Code's own auto-compact threshold must sit above `restartContextTokens` (`/autocompact <tokens>`), or it compacts first without the resume context.
- Call `mcp__stool__restart_session` with a self-contained `prompt`:
  "In <absolute repo path>: read CLAUDE.md and the handoff file, then continue with the first task in RESUME HERE."
- Pass `model` (e.g. "sonnet", "opus", or a full id) only when the next phase should run on a different, usually cheaper, model; it switches the session after the clear or compaction and before the prompt.
- Tell the user in one line that the restart is queued, then end the turn.
- Not these: a scheduled task (starts an unattended session in ask mode with Remote Control off), a cron job paired with a clear (the cron dies with the cleared context), computer use (it cannot control the Claude app).
- If the tool is missing (plugin not loaded), give the user the resume prompt and ask them to start a new session with it.
