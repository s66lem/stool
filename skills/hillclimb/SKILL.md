---
name: hillclimb
description: Use when asked to tune something until a measured number lands in a target band or beats a baseline (a benchmark, a pass rate, a latency, a score). One metric at a time, one change per measurement, keep or revert, with a stop predicate. Only when the task says to tune; otherwise just report the numbers.
---

# Hillclimb

Adapted from pstack `hillclimb` and `benchmark-checklist` (MIT, (c) 2026 Lauren Tan, github.com/cursor/plugins/tree/main/pstack).

Contents: 0 Preconditions, 1 Target, 2 Harness, 3 Loop, 4 Stop, 5 Sanity checklist, 6 Reply.

## 0. Preconditions
Only when the task says to tune. Otherwise run the measurement once, report the numbers and change nothing. Start from a clean checkout of the main branch (a worktree starts with a merge of it), with the project's check green.

## 1. Pick ONE metric
Choose one metric and one direction ("pass rate 0.71 -> 0.55-0.65", "p95 latency 480 ms -> under 300 ms"). Write the stop predicate down: in band at the CONFIRM sample size AND at least 6 attempts made (so a lucky first change cannot end it). Cap total attempts (default 12).

## 2. Harness (frozen)
- Try: the quick measurement command at a small sample size (the project's benchmark, test run or load script).
- Confirm: a kept change is re-checked at about 4x the sample size. A swing seen at the small size is noise until the large one agrees.
- Baseline first: run it BEFORE any change, and the project's check green. Run it twice to see the noise: with the same seeds it should give the same numbers; if not, stop, the harness is broken.
- Do not edit the harness while climbing. Touch only the data or the one named constant per attempt.

## 3. Loop (one hypothesis per iteration)
1. Name the mechanism: "the metric is low because X dominates at step 6; lowering Y should fix it". Not "try numbers".
2. Make ONE change (one value). Never stack untested changes.
3. Measure at the small size. Accept only if the target moves toward the band by more than the noise AND the other tracked metrics stay in their bands. Else revert in full (`git checkout -- <file>`).
4. A kept change: re-check at the large size, run the project's check, then ONE commit of the named file (subject `tune: <what> <before> -> <after>`). Never `git add -A`.
5. Log a row per attempt in a scratch `hillclimb-log.tsv`: id, hypothesis, change, before, after, kept or reverted.
6. A change over about 25% of a value the user has already seen in use is their call: do not make it, report it. A stall of several rejects: change category, combine two near-misses, or re-read how the metric is computed.

## 4. Stop
Predicate met. Or attempts used. Or the band cannot be met without a change the limits forbid: that is a DESIGN FINDING: leave the value as on the main branch, report the best table and the cause. Do not relax the band. Do not extend the budget yourself.

## 5. Does the measurement measure what I claim? (before reporting)
- Limiter: what actually decides the result? Print a few samples' cause; a metric move with the same causes is noise.
- Right configuration: say which setup the band is defined for and which you ran.
- Did the work happen: every cell printed, check lines present, exit code 0.
- Does it match reality: a gain visible only in the harness is not a fix; say so.
- Noise: small and large samples agree on the direction.

## 6. Reply
The metric and band; baseline to final numbers; attempts kept vs reverted with each kept change on one line; the log path; any design finding; the best next idea.
