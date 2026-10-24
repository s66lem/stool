#!/usr/bin/env node
// Cost bench: runs the fixed tasks headless with stool off and on, checks each result, prices each run from its
// transcripts and reports $ per passed task. Spends real usage: see bench/README.md before running `full`.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { sessionCost } from './lib/cost.mjs'
import { score, verdict } from './lib/score.mjs'
import { runCheck } from './lib/check.mjs'
import { claudeArgs, estimateFor, invalidReason, overBudget, parseResult, planRuns } from './lib/runner.mjs'

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

function freshCopy(name) {
  const dir = mkdtempSync(join(tmpdir(), `bench-${name}-`))
  cpSync(join(BENCH, 'fixture'), dir, { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'fixture')
  return dir
}

let spent = 0
// One unscored call per setup first. stool adds tools, so the two setups have different prompt prefixes; whichever
// prefix another session cached lately would start warm and the other cold (~$0.15 of cache writes on the first run).
for (const setup of ['off', 'on']) {
  const dir = freshCopy(`warm-${setup}`)
  const p = spawnSync('claude', claudeArgs(setup, { prompt: 'Reply with the word ok.', model: o.model, stoolDir: o.stool, debugFile: join(dir, '.warm-debug.txt') }), { cwd: dir, env, encoding: 'utf8', timeout: 300_000 })
  const res = parseResult(p.stdout ?? '')
  if (res) spent += sessionCost(projects, res.sessionId).usd
  rmSync(dir, { recursive: true, force: true })
}
console.error(`warm-up: $${spent.toFixed(2)}`)

const runs = []
let stoppedAtBudget = false
for (const r of planRuns(o.mode, tasks)) {
  const task = tasks.find(t => t.id === r.task)
  if (overBudget(spent, estimateFor(task, runs), budget)) {
    stoppedAtBudget = true
    break
  }
  const dir = freshCopy(`${r.task}-${r.setup}`)
  const debugFile = join(dir, '..', `${dir.split(/[\\/]/).pop()}.debug.txt`)
  const sessionId = randomUUID()
  const started = Date.now()
  // one run's error must not lose the runs already paid for: it is recorded as a failed run and the batch goes on
  try {
    const p = spawnSync('claude', claudeArgs(r.setup, { prompt: task.prompt, model: o.model, stoolDir: o.stool, debugFile, sessionId }), {
      cwd: dir,
      env,
      encoding: 'utf8',
      timeout: Number(o['timeout-min']) * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    const res = parseResult(p.stdout ?? '')
    const cost = sessionCost(projects, sessionId)
    const pass = !!res && !res.isError && runCheck(dir, join(BENCH, 'checks', task.check))
    const invalid = invalidReason(r.setup, existsSync(debugFile) ? readFileSync(debugFile, 'utf8') : null)
    const run = { ...r, usd: cost.usd, pass, invalid, msgs: cost.msgs, agents: cost.agents, leadMaxCtx: cost.leadMaxCtx, agentMaxCtx: cost.agentMaxCtx, minutes: (Date.now() - started) / 60_000, timedOut: p.error?.code === 'ETIMEDOUT' }
    runs.push(run)
    spent += run.usd
    console.error(`${r.task} ${r.setup} #${r.rep}: ${pass ? 'pass' : 'FAIL'} $${run.usd.toFixed(2)} ${run.msgs} msgs, lead ctx ${run.leadMaxCtx}, agent ctx ${run.agentMaxCtx}${invalid ? ` INVALID (${invalid})` : ''}${run.timedOut ? ' TIMED OUT' : ''}${o.keep ? ` ${dir}` : ''}`)
  } catch (e) {
    let usd = 0
    try {
      usd = sessionCost(projects, sessionId).usd
    } catch {}
    runs.push({ ...r, usd, pass: false, error: String(e?.message ?? e) })
    spent += usd
    console.error(`${r.task} ${r.setup} #${r.rep}: ERROR ${e?.message ?? e}`)
  }
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
