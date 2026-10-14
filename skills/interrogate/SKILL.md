---
name: interrogate
description: Use when the user says "interrogate", "panel review", "adversarial review" or "multi-model review" of a diff, or at a phase end on trust-boundary or data-loss code. Several reviewer agents on different models attack the diff; the lead verifies and writes one verdict. Costs 3-4 agents; manual only.
disable-model-invocation: true
---

# Interrogate

Adapted from pstack `interrogate` (MIT, (c) 2026 Lauren Tan, github.com/cursor/plugins/tree/main/pstack).

Contents: 1 Scope, 2 Intent, 3 Spawn, 4 Synthesize, 5 Verify and judge, 6 Output, Cost.

Model diversity is the adversarial signal; do not assign personas. Do NOT apply fixes.

## 1. Scope
Diff = `git diff <base>...HEAD` (or named files) plus the few context files a reviewer needs. Never include secrets or env files: a non-Claude reviewer sends the diff off this machine.

## 2. Intent
One paragraph from the user's message, commit messages and code. Reviewers challenge execution, not the goal. Unsure: ask first.

## 3. Spawn (one message, parallel, read-only)
Call `mcp__stool__agent_cap` first and stay under it. Tell each "read-only, do not edit":
- A: `Agent` with `model: "opus"`
- B: `Agent` with `model: "sonnet"`
- C (optional, cheap): `model: "haiku"`
- D (optional, if the Codex plugin is installed): its rescue agent, review only: the non-Claude view
Fill `references/reviewer-prompt.md` with the intent, the diff and `references/rubric.md`. Also point them at the project's CLAUDE.md conventions.

## 4. Synthesize
Merge duplicates and record who raised each. Two or more independent hits = strongest signal. A lone finding is still read. Note disagreements.

## 5. Verify and judge
You are the lead, not an aggregator. VERIFY each finding in the code (trace the call path; never act on a claim unread). Apply `references/lead-judgment.md`. Buckets: **Act on** (would block a real merge; over 5 means filter harder), **Consider**, **Noted**, **Dismissed** (with a reason: it is the trust record).

## 6. Output
Intent; reviewers (model, finding count); the four buckets, each item with who raised it; agreement map. Fixes go to an implementer after the lead or the user decides.

## Cost and when it is worth it
About 3-4 agent runs each reading the whole diff (Opus is the expensive one). Worth it for trust-boundary code (network handlers, input validation, auth), data-loss handling, and once per phase end. Not for routine diffs: use a single cheap review pass instead.
