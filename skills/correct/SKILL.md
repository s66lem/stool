---
name: correct
description: Use when the user says /correct, or after they correct a mistake an agent has made before. Mines the project's fix log, retros and git log for mistakes that happened twice and moves each fix from prose into a check that fails. Manual only.
disable-model-invocation: true
---

# Correct

Adapted from pstack `correct` (MIT, (c) 2026 Lauren Tan, github.com/cursor/plugins/tree/main/pstack).

Contents: 1 Find classes, 2 Fix at the highest level, 3 Prove, 4 Rule table, 5 Reply.

Premise: every contributor is an agent that sees only the files it opened, copies the nearest example and takes the shortest path. Make the repo so a change that looks right from one file is right everywhere.

## 1. Find the mistake classes
Read the project's fix log (`docs/FIXES.md` or similar), the retro paragraphs in CLAUDE.md, `git log` (reverts, "fix:", "again"), and comments that explain workarounds. Group into classes. A class counts once it has happened twice. Skip one-offs.

## 2. Fix each class at the highest level that works
1. **Architecture**: one owner per piece of state, one supported way per task, one source of truth instead of hand-synced lists, delete old paths an agent would copy.
2. **Types / a check**: if bad code still compiles, add a check to the project's one gate (its check or lint script; strict types count) whose error NAMES the file or function to use instead. If the pattern is already common, fail only when a change adds more.
3. **A test**: a test that fails by assertion. Delete any test that would pass if every function it calls returned nothing.
4. **Docs last**, only for judgment calls nothing can fail (taste, preferences).

Examples of checkable rules: a forbidden call in a pure module, a file over a size limit, scratch files not formatted, an untracked file blocking a merge, a "do not publish" marker in the handoff.

## 3. Fix and prove
Fix the most frequent classes now, one commit each (named paths, never `git add -A`). Prove each new check fails on a REAL past mistake: re-create it (or check out the old bad commit in a scratch worktree) and show the check's failing output, then show it pass on the main branch. Exceptions go on the offending line with a reason and an expiry.

## 4. Keep the rule-to-enforcer table
In the shared rules file or the project CLAUDE.md: `rule | enforced by (check name / test / nothing)`. A rule marked "nothing" that was already broken once is a repeat: fix it at a higher level in the same change. Drop a rule once its mistake cannot happen. If another agent is editing those files, put the proposed lines in your reply instead.

## 5. Reply
Each class with its evidence (commit or log line), the level chosen, and why a higher one did not work; the proof output; the table diff.
