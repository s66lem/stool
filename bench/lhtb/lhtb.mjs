#!/usr/bin/env node
// LHTB part of the bench: runs LHTB tasks through Harbor (inside the "bench" WSL distro) with stool off and on, prices
// each run from the transcript Claude Code left in the task's container logs, and prints $ and reward per task.
//   node bench/lhtb/lhtb.mjs --tasks t1,t2 [--model sonnet-id] [--mult 0.25] [--budget-usd 40] [--jobs G:/bench-work/lhtb-jobs] [--out file]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { sessionCost } from '../lib/cost.mjs'
import { toLinux } from '../lib/runner.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const { values: o } = parseArgs({
  options: {
    tasks: { type: 'string' },
    model: { type: 'string', default: 'claude-sonnet-5-5' },
    mult: { type: 'string', default: '0.25' },
    'budget-usd': { type: 'string', default: '40' },
    jobs: { type: 'string', default: 'G:/bench-work/lhtb-jobs' },
    stool: { type: 'string', default: join(HERE, '..', '..') },
    out: { type: 'string' },
  },
})
if (!o.tasks) {
  console.log('node bench/lhtb/lhtb.mjs --tasks <task,task> [--model id] [--mult 0.25] [--budget-usd 40] [--jobs dir] [--out file]\nTask names are folders under tasks/ in the LHTB clone (or harbor/examples/tasks/<name>).')
  process.exit(1)
}
mkdirSync(o.jobs, { recursive: true })
const budget = Number(o['budget-usd'])
const rows = []
let spent = 0

// the newest result folder's reward and Claude Code transcript
function collect(jobsDir) {
  const job = readdirSync(jobsDir).filter(d => /^\d{4}-/.test(d)).sort().at(-1)
  const trial = readdirSync(join(jobsDir, job)).find(d => existsSync(join(jobsDir, job, d, 'verifier')))
  const base = join(jobsDir, job, trial)
  const rew = join(base, 'verifier', 'reward.txt')
  const reward = existsSync(rew) ? Number(readFileSync(rew, 'utf8').trim()) : 0
  const projects = join(base, 'agent', 'sessions', 'projects')
  const sessionDir = existsSync(projects) ? join(projects, readdirSync(projects)[0]) : ''
  const sessionId = sessionDir ? readdirSync(sessionDir).find(f => f.endsWith('.jsonl'))?.replace('.jsonl', '') : undefined
  const cost = sessionId ? sessionCost(projects, sessionId) : { usd: 0, msgs: 0, leadMaxCtx: 0, agentMaxCtx: 0, agents: 0 }
  const debug = join(base, 'agent', 'claude-debug.txt')
  const stool = existsSync(debug) && /hooks module stool@\S+ loaded/.test(readFileSync(debug, 'utf8'))
  return { reward, stool, ...cost }
}

for (const task of o.tasks.split(',')) {
  for (const setup of ['off', 'on']) {
    if (spent >= budget) break
    const dir = join(o.jobs, `${task.replace(/\W+/g, '-')}-${setup}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const path = existsSync(join(HERE, '..', '..', 'dev')) && task.startsWith('examples/') ? `harbor/${task}` : `tasks/${task}`
    const p = spawnSync('wsl.exe', ['-d', 'bench', '-u', 'root', '--', 'bash', toLinux(join(HERE, 'run-lhtb.sh')), path, setup, o.model, o.mult, toLinux(dir), toLinux(o.stool)], { encoding: 'utf8', timeout: 5 * 3600_000, maxBuffer: 64 * 1024 * 1024 })
    let r
    try {
      r = collect(dir)
    } catch (e) {
      r = { reward: 0, stool: false, usd: 0, msgs: 0, leadMaxCtx: 0, agentMaxCtx: 0, agents: 0, error: String(e.message) }
    }
    const invalid = r.stool !== (setup === 'on') ? `stool ${r.stool ? 'loaded' : 'missing'} in an ${setup} run` : undefined
    rows.push({ task, setup, ...r, invalid })
    spent += r.usd
    console.error(`${task} ${setup}: reward ${r.reward} $${r.usd.toFixed(2)} ${r.msgs} msgs, lead ctx ${r.leadMaxCtx}, agent ctx ${r.agentMaxCtx}${invalid ? ` INVALID (${invalid})` : ''}${p.status ? ` (harbor exit ${p.status})` : ''}`)
  }
}

const lines = ['| Task | Setup | Reward | $ | Msgs | Lead max ctx | Agent max ctx |', '|---|---|---|---|---|---|---|', ...rows.map(r => `| ${r.task} | ${r.setup} | ${r.reward}${r.invalid ? ' (invalid)' : ''} | ${r.usd.toFixed(2)} | ${r.msgs} | ${r.leadMaxCtx} | ${r.agentMaxCtx} |`)]
const total = s => rows.filter(r => r.setup === s && !r.invalid).reduce((a, r) => ({ usd: a.usd + r.usd, reward: a.reward + r.reward }), { usd: 0, reward: 0 })
const [off, on] = [total('off'), total('on')]
lines.push('', `Cost per reward point: off $${(off.usd / (off.reward || NaN)).toFixed(2)}, on $${(on.usd / (on.reward || NaN)).toFixed(2)}; spent $${spent.toFixed(2)} (budget $${budget})`)
const text = lines.join('\n') + '\n'
if (o.out) writeFileSync(o.out, text)
else console.log(text)
