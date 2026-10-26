#!/usr/bin/env node
// Reads the in-the-wild trial (the `trial` option): ~/.claude/stool/trial.jsonl says which arm each session was in; each
// session's $ comes from its transcript and its commits from git (every branch in the session's folder, between its first
// and last message). Prints $ per commit by arm and a bootstrap interval for the saving.  node bench/trial.mjs [--since 14d]
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

import { sessionCost } from './lib/cost.mjs'
import { compare } from './lib/trial.mjs'

const { values: o } = parseArgs({ options: { since: { type: 'string', default: '14d' }, log: { type: 'string', default: join(homedir(), '.claude', 'stool', 'trial.jsonl') } } })
const days = Number(/^(\d+)d$/.exec(o.since)?.[1] ?? 14)
const from = Date.now() - days * 86_400_000
const projects = join(homedir(), '.claude', 'projects')
if (!existsSync(o.log)) {
  console.log(`no trial log at ${o.log}: turn on the stool option "trial" and use stool for a week or two`)
  process.exit(0)
}
const sessions = []
for (const line of readFileSync(o.log, 'utf8').split('\n').filter(Boolean)) {
  const e = JSON.parse(line)
  if (e.t < from) continue
  const cost = sessionCost(projects, e.session)
  if (cost.msgs === 0) continue
  const git = spawnSync('git', ['-C', e.cwd, 'log', '--all', `--since=${new Date(e.t).toISOString()}`, '--oneline'], { encoding: 'utf8' })
  // ponytail: commits since the session started, not until it ended; two sessions in one folder share commits
  const commits = git.status === 0 ? git.stdout.split('\n').filter(Boolean).length : 0
  sessions.push({ arm: e.arm, usd: cost.usd, commits })
}
const r = compare(sessions)
const f = x => (Number.isFinite(x) ? x.toFixed(2) : '-')
console.log(`levers on : ${r.on.n} sessions, $${f(r.on.usd)}, ${r.on.commits} commits, $${f(r.on.perCommit)}/commit`)
console.log(`levers off: ${r.off.n} sessions, $${f(r.off.usd)}, ${r.off.commits} commits, $${f(r.off.perCommit)}/commit`)
console.log(r.saving === undefined ? 'not enough commits in both arms yet' : `saving with levers on: ${(r.saving * 100).toFixed(0)}%${r.ci ? ` (95% interval ${(r.ci[0] * 100).toFixed(0)}% to ${(r.ci[1] * 100).toFixed(0)}%)` : ' (too few sessions for an interval)'}`)
console.log('Claim a saving only when the whole interval is above zero; sessions are not matched for task size, so it takes many of them.')
