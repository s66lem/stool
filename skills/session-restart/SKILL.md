---
name: session-restart
description: Use at every phase boundary or when a session has grown long - runs a retrospective (token/time waste, fixes) into the project's fix log, updates the handoff, then clears this session and injects the resume prompt through the stool restart_session tool.
---

# Session restart

Run this at every phase end, when the user asks to restart, when the restart clock says a restart is due, or when the session has clearly grown long. Do every step; don't skip the retrospective.

## 1. Retrospective
Review this session for what was inefficient, time-wise and token-wise: agent runs that were large for what they returned, rework loops, project rules that were broken, waits that were serial but could have been parallel, tests that were hard to drive, lead work that should have been delegated (or the reverse).
- Write it to `docs/FIXES.md` in the project (create it if missing): a dated section `## <date> - <session/phase name>` with **Waste** (ranked, with rough numbers) and **Fixes** (concrete rule or tool changes).
- Apply the cheap fixes now: rules go into the project's `CLAUDE.md`, tool/task work goes into the project's TODO and the top of its handoff file.
- If the user hasn't written anything in the last ~15 minutes (not watching) and the project defines a notify command, send a one-line summary with it. No secrets, ids or file contents.

## 2. Handoff
- Update the project's handoff file (a "RESUME HERE" block: state, published versions/tags, what's unverified, the next task first) and its TODO. With no such file, use the `handoff` skill.
- Commit, run the project's check, and push if the project has a remote and a push rule (scan for secrets first).

## 2b. Context at 65% or more
A long session's handoff misses things the lead no longer has in view. When the context sits at 65% or more (or the user asks), before the restart dispatch one read-only agent (a strong model) with the path of the handoff and the session transcript (the newest `.jsonl` under `~/.claude/projects/<project slug>/`). Ask for four lists: **A** facts in the transcript missing from the handoff; **B** contradictions and stale lines in the handoff; **C** the twelve facts that must not be lost; **D** user instructions never acted on. Fold the findings into the handoff (rewrite the block, don't append), commit, then go on. No `/compact` is needed: the clear replaces it.

## 3. Fresh session
The restart reuses this session: `mcp__stool__restart_session` clears it and injects the resume prompt when the turn ends, so it stays a normal interactive session with its permission mode and Remote Control.
- Call `mcp__stool__restart_session` with a self-contained `prompt`:
  "In <absolute repo path>: read CLAUDE.md and the handoff file, then continue with the first task in RESUME HERE."
- Tell the user in one line that the restart is queued, then end the turn. When the turn ends the plugin runs `/clear` and submits the prompt as the next user message.
- Not these: a scheduled task (starts an unattended session in ask mode with Remote Control off), a cron job paired with a clear (the cron dies with the cleared context), computer use (it cannot control the Claude app).
- If the tool is missing (plugin not loaded), give the user the resume prompt and ask them to start a new session with it.
