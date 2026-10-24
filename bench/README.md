# Cost bench

Measures what stool saves on real work: the same coding tasks, run headless with stool off and with stool on, each result checked by a hidden test. The score is **cost per passed task**, so a run that stops early or does half the job counts as a failure and its cost still counts.

## What it runs
- `fixture/`: a small book-inventory library (no dependencies) copied fresh for every run.
- `tasks.json`: three small tasks (a bug fix, a feature, a cross-file rename) and one long one (five modules from a long spec, built with one subagent per module, so agents pass 100k tokens of context and the lead passes 150k).
- `checks/`: the hidden tests, copied in only after a run finishes. `solutions/` holds reference solutions; `test/fixture.test.mjs` proves every check fails on the untouched fixture and passes on its solution.
- Both setups use a clean profile: no MCP servers, no user or project settings (so no other plugins); "on" adds `--plugin-dir` with this repo. A run whose debug log shows the wrong hooks loaded is marked invalid and left out.

## Running
```bash
node bench/run.mjs --mode smoke
node bench/run.mjs --mode full --out bench-result.md
```
- `smoke`: the first small task once each way, a check of the bench itself (about $1-2 at list price).
- `full`: small tasks twice each way, the long task once each way (14 runs). It **spends real usage**; `--budget-usd` (default 50) stops it early, and the report says so.
- Costs are read from each run's transcripts under `~/.claude/projects` (subagents included) and priced at API list price. `--rate` turns dollars into a weekly-limit percent for your plan.

## Reading the result
`Saving per passed task` compares total cost over total passes, stool on vs off. It is marked `real` only when stool is cheaper on more than half the tasks by more than the spread between the "off" repeats; otherwise `within noise`.

## Tests
`node --test "bench/test/*.test.mjs"` (no claude runs, free).
