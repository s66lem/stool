---
name: ketchup
description: Use when the user says "ketchup", "catch me up", "what did I miss" or returns after hours away. Read-only plain-language recap of what changed since their last message, then only the items that need them. Manual only.
disable-model-invocation: true
---

# Ketchup

Adapted from pstack `ketchup` (MIT, (c) 2026 Lauren Tan, github.com/cursor/plugins/tree/main/pstack).

Contents: 1 Gather, 2 Write, 3 Action items, 4 Rules.

Read-only: change no code, start no agent or job, post nothing. The user remembers their last message and nothing after it. Agent notifications are not their messages.

## 1. Gather (cheap reads only)
- The project's handoff or status file if it has one (first 15 lines), `git log --oneline -15`, `git status -s | head`.
- Running or finished agents this session and what each returned.
- Anything built or deployed vs the main branch: anything unpublished, or marked do-not-publish?
- Picks, approvals and builds-to-test still waiting on the user, including ones raised before their last message.
- Check each number you quote against its source; say so if you corrected one.

## 2. Write (under 150 words total)
- Line 1: how many things need them, or "nothing needs you".
- Then up to 4 short lines, one per thing they asked for: what came of it, and whether it is done, still running, failed, or not checked. Plain words, as if saying it aloud: "Search was slow from a missing index", not "Search: done". No hashes, paths, commands or counts unless they need one to act. Name things the way the user does, not by internal names.
- Nothing happened and nothing waits: say so and stop.

## 3. Action items
Only decisions or steps only the user can take: a pick, an approval, an irreversible action, a build to test, access. Work you can do yourself is not one. Never invent one to fill the reply. Each gets two lines: the decision with your recommendation and why; what happens if they do not answer. For a choice list every option with what it gets them and what it costs. Show a look with a screenshot or link; write "no screenshot yet" if there is none. Link only things that exist.

## 4. Rules
- Never mark something done that still waits on the user.
- Work left that you can do yourself: one line.
