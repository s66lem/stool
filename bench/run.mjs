#!/usr/bin/env node
// Cost bench: runs the fixed tasks headless with stool off and on, checks each result, prices each run from its
// transcripts and reports $ per passed task. Spends real usage: see bench/README.md before running `full`.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { sessionCost } from './lib/cost.mjs'
import { score, verdict } from './lib/score.mjs'
import { runCheck } from './lib/check.mjs'
import { claudeArgs, overBudget, parseResult, planRuns, stoolLoaded } from './lib/runner.mjs'

const BENCH = fileURLToPath(new URL('.', import.meta.url))
const USAGE = `node bench/run.mjs --mode smoke|full [--model sonnet] [--budget-usd 50] [--rate 0.075] [--stool <dir>] [--out <file>] [--timeout-min 30] [--keep]

  smoke  the first small task once with stool off and once on (a cheap check of the bench itself)
  full   3 small tasks x 2 repeats + the long task once, each with stool off and on
  --rate      weekly-limit percent per list-price dollar, for the w% column
  --stool     the stool plugin folder for the "on" runs (default: this repo)
  --keep      keep each run's folder (printed) instead of deleting it`

const { values: o } = parseArgs({
  options: {
    mode: { type: 'string' },
    model: { type: 'string', default: 'sonnet' },
    'budget-usd': { type: 'string', default: '50' },
    rate: { type: 'string', default: '0.075' },
    stool: { type: 'string', default: join(BENCH, '..') },
    out: { type: 'string' },
    'timeout-min': { type: 'string', default: '30' },
    keep: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})
if (o.help || !['smoke', 'full'].includes(o.mode)) {
  console.log(USAGE)
  process.exit(o.help ? 0 : 1)
}

const tasks = JSON.parse(readFileSync(join(BENCH, 'tasks.json'), 'utf8'))
const budget = Number(o['budget-usd'])
const projects = join(homedir(), '.claude', 'projects')
// the "off" run must not inherit a plugin folder from the caller's environment
const { CLAUDE_CODE_PLUGIN_DIRS, CLAUDE_CODE_PLUGIN_DIR_WATCH, ...env } = process.env
const git = (dir, ...a) => spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', ...a], { cwd: dir })

const runs = []
let spent = 0
let stoppedAtBudget = false
for (const r of planRuns(o.mode, tasks)) {
  const task = tasks.find(t => t.id === r.task)
  const same = runs.filter(x => x.task === r.task)
  const estimate = (same.length ? same : runs).reduce((s, x) => s + x.usd, 0) / Math.max(1, (same.length ? same : runs).length)
  if (overBudget(spent, estimate, budget)) {
    stoppedAtBudget = true
    break
  }
  const dir = mkdtempSync(join(tmpdir(), `bench-${r.task}-${r.setup}-`))
  cpSync(join(BENCH, 'fixture'), dir, { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'fixture')
  const debugFile = join(dir, '..', `${dir.split(/[\\/]/).pop()}.debug.txt`)
  const started = Date.now()
  const p = spawnSync('claude', claudeArgs(r.setup, { prompt: task.prompt, model: o.model, stoolDir: o.stool, debugFile }), {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: Number(o['timeout-min']) * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const res = parseResult(p.stdout ?? '')
  const cost = res ? sessionCost(projects, res.sessionId) : { usd: 0, msgs: 0, leadMaxCtx: 0, agentMaxCtx: 0, agents: 0 }
  const pass = !!res && !res.isError && runCheck(dir, join(BENCH, 'checks', task.check))
  const debug = existsSync(debugFile) ? readFileSync(debugFile, 'utf8') : ''
  const loaded = stoolLoaded(debug)
  const invalid = r.setup === 'off' && loaded ? 'stool hooks in an off run' : r.setup === 'on' && !loaded ? 'stool hooks missing in an on run' : undefined
  const run = { ...r, usd: cost.usd, pass, invalid, msgs: cost.msgs, agents: cost.agents, leadMaxCtx: cost.leadMaxCtx, agentMaxCtx: cost.agentMaxCtx, minutes: (Date.now() - started) / 60_000, timedOut: p.error?.code === 'ETIMEDOUT' }
  runs.push(run)
  spent += run.usd
  console.error(`${r.task} ${r.setup} #${r.rep}: ${pass ? 'pass' : 'FAIL'} $${run.usd.toFixed(2)} ${run.msgs} msgs, lead ctx ${run.leadMaxCtx}, agent ctx ${run.agentMaxCtx}${invalid ? ` INVALID (${invalid})` : ''}${run.timedOut ? ' TIMED OUT' : ''}${o.keep ? ` ${dir}` : ''}`)
  if (!o.keep) rmSync(dir, { recursive: true, force: true })
  rmSync(debugFile, { force: true })
}

const rows = score(runs)
const v = verdict(rows, runs)
const version = f => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')).version
  } catch {
    return '?'
  }
}
const meta = {
  date: new Date().toISOString().slice(0, 10),
  mode: o.mode,
  model: o.model,
  stoolVersion: version(join(o.stool, '.claude-plugin', 'plugin.json')),
  claudeVersion: (spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout ?? '').trim(),
  rate: Number(o.rate),
  budgetUsd: budget,
  spentUsd: spent,
  stoppedAtBudget,
}
const { markdown } = await import('./lib/report.mjs')
const text = markdown(rows, v, meta)
if (o.out) writeFileSync(o.out, text)
else console.log(text)
