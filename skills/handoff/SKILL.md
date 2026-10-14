---
name: handoff
description: Write a handoff document capturing this session's task, decisions, state, and next steps so a fresh session can continue. Use when the user runs /handoff or asks for a handoff/continuation doc before clearing or ending a session.
argument-hint: "[focus or note for the next session]"
disable-model-invocation: true
allowed-tools: Bash(git status:*) Bash(git diff:*) Bash(git log:*) Bash(git branch:*) Write
---

Write a handoff document for this session so a fresh Claude session can pick up cold. Local only; nothing leaves this machine.

## Gather (facts, don't guess)

Run once, in parallel where possible: `git branch --show-current`, `git status --short`, `git log --oneline -8`, `git diff --stat`. Skip if not a git repo.

## Write

Save to `~/.claude/handoffs/<project-dir-name>-<YYYYMMDD-HHMM>.md` (create the folder via the Write tool). Extra focus from the user: `$ARGUMENTS`.

Sections, in this order. Omit a section only if truly empty; keep every bullet specific (file paths, commands, error text), no narration.

1. **Goal**: what the user is trying to accomplish, in their terms.
2. **State**: done / in progress / not started. Include branch and uncommitted files from git.
3. **Decisions**: choices made and why, including approaches rejected. These are what a fresh session would otherwise re-litigate.
4. **Key files**: paths touched or that matter, with one line on each one's role.
5. **Gotchas**: failed attempts, errors seen, env quirks, things that look wrong but are intentional.
6. **Open questions**: anything awaiting the user's call.
7. **Next steps**: ordered, concrete, first one immediately actionable.
8. **Verify**: exact commands to confirm the current state works (tests, build, run).

Rules: derive from this conversation and the git output only; mark anything uncertain as "unverified". Never include secrets, tokens, or credential values. Don't restate what the repo already records (code structure, git history).

## Reply

Show only: the saved path, then this paste-ready line for the next session:

`Read <path> and continue from its Next steps.`

If the session is being cleared next, the `session-restart` skill can do the clear itself; otherwise remind the user to `/clear` (or open a new session) themselves.
