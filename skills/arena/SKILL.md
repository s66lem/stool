---
name: arena
description: Use only for a hard design or generator where one attempt would lock in the wrong shape and the user wants candidates compared (/arena, "arena this"). Runs N parallel candidates in worktrees, cross-judges, picks a base, grafts the best of the rest. Expensive; manual only.
disable-model-invocation: true
---

# Arena

Adapted from pstack `arena` (MIT, (c) 2026 Lauren Tan, github.com/cursor/plugins/tree/main/pstack).

Contents: Cost first, A Frame, B Fan out, C Cross-judge, D Pick, E Graft, F Verify, Output.

## Cost first
N full agent runs plus a judge, all at once. The cheaper default is "three or four cheap variants" (one preview each, side by side, the user reacts). Use arena only when variants will not do: a hard model, generator or algorithm where the structure of the answer matters, not its colour. Check `mcp__stool__agent_cap`; N must not exceed it. Say the estimated cost to the user before launching; cap N at 3 unless they ask for more.

## A. Frame
Every candidate gets the same prompt; the prompt is the contract.
1. State the artifact each candidate produces.
2. Derive a rubric of 3-6 gradeable criteria for THIS task. The judge sees it; candidates see only the task.
3. Pick runners: mix `model: "opus"` / `"sonnet"` and, for a non-Claude shot, a Codex agent if installed. Same model N times when the work is generation-bound, not judgment-bound.
4. Give each its own output place: `isolation: "worktree"` (first step: merge the main branch), or a named scratch dir.

## B. Fan out
Spawn all in one message, `run_in_background: true`, each told: the task, the shared grounding paths, its output path, and to return the artifact plus a short rationale naming alternatives rejected. A dropout: continue with N-1 and note it. Put a tool-call cap and a hard stop in every prompt.

## C. Cross-judge
After ALL candidates finish, spawn one read-only judge (a different model family from the lead when possible). It sees the rubric and candidates by label, scores each criterion, recommends a base. It runs while you read in D.

## D. Pick a base
Read every candidate end to end. Score per criterion, not by feel; compare with the judge. Disagreement means someone is biased or the rubric was ambiguous: read both rationales. Pick the base easiest to extend without breaking invariants; on a tie, the cleaner boundary or smaller surface.

## E. Graft
Walk each loser once for what is worth porting, usually one or two things each. Fold them in by hand so the result stays coherent. If candidates converge, ship the consensus; no graft. If they wildly diverge, the frame was under-specified: reframe and re-run once, do not average.

## F. Verify
Check the synthesized artifact like any output: the project's check, the tests, a look at the result. A miss means the frame was wrong (reframe) or you skipped a graft (back to E).

## Output
The artifact plus a note: base and why, the judge's verdict, each graft and its source, what was rejected, convergence or dropouts, verification result, and tokens spent.
