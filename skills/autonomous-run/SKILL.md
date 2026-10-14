---
name: autonomous-run
description: Use when the user is away and asks to "keep going until X", "run overnight", "babysit this", or hands over a goal with a checkable end state. Drives work to a predicate with /loop or a notifying background sleep, chaining on agent notifications. Manual only.
disable-model-invocation: true
---

# Autonomous run

Adapted from pstack `autonomous-run`, `autopilot-*` and `babysit` playbooks (MIT, (c) 2026 Lauren Tan, github.com/cursor/plugins/tree/main/pstack). PR-stack and forge parts dropped.

Contents: 1 Predicate, 2 Wake, 3 Each round, 4 Scope of autonomy, 5 Stop, 6 Reply.

You own the exit condition. Define done, then drive to it without stopping to ask.

## 1. State the predicate first
A command whose output is checkable: the check exits 0, a repro no longer fails, a metric is inside a band, N items on the list are ticked. Write it, plus a HARD STOP (max rounds or max wall time or token ceiling) in the project's handoff file before round one, so a clear or crash can resume it. Never relax the predicate to declare victory.

## 2. Pick the wake mechanism
- Waiting on an agent: end your turn; its completion notification wakes you. Notifications still arrive after a clear, but an agent from before a clear cannot be resumed.
- Waiting on an event (build, deploy, a file appearing): a background Bash `until <check>; do sleep 30; done` (run_in_background) that exits when the event happens, which re-invokes you.
- No event, just time: `/loop` self-paced (omit the interval), or a background `sleep N` sized to when the result is worth re-checking.
- While waiting on the user, a cheap background `while true; do sleep 600; done` keeps the session from being archived.

## 3. Each round (one change, one check)
1. `mcp__stool__agent_cap`; if it says 0 or the 5-hour window is near 95%, stop dispatching, write the handoff, wait for the reset (or `mcp__stool__restart_session`).
2. Make the smallest change the evidence justifies (or dispatch one agent with a self-contained prompt, a tool-call cap and a hard stop). Verify against the predicate. Passed: commit named paths. No help: revert it. "Might help" changes are reverted, not left.
3. Log one line per round (what changed, did the predicate move) in the handoff or a scratch `run-log.tsv`. Read it before the next round.

## 4. Scope of autonomy
Mid-run discoveries (flaky check, related bug, stale doc) are yours to fix if reversible and small; give a big one its own commit or a spawned task. Surface to the user only: irreversible actions (production deploys, deletes), money, accounts, security, a taste call no experiment settles, a real dead end. Notify them once (the project's notify command, if it names one) only for those or a failed build. Overnight, pick work that does not depend on their answers: small, and listed for review.

## 5. Stop
Predicate met; or the hard stop hit (report where you are, do not extend it); or a dead end. A plateau is not a stop: pivot approach once or twice. Several rounds with no movement: stop and report instead of spinning.

## 6. Reply
Exit condition, rounds run, what landed (commits), what was discarded, final predicate state, and what needs the user.
