// agent-meter: per-agent tool-call count vs the cap its prompt states, and a ledger line per finished agent
//. Spike: tool.call and turn.complete carry agentId; turn.complete carries
// durationMs and usage (4 token counts); agent.spawn answers agentId. Live token counts need a turn.step stream hook: skipped.
import type { EngineInterface, Register, ToolSpec } from 'claude-code'

import { expand, flag, inScope, num, roots, text, trialOff } from '../config'
import { WRITE_MULT, byProject, extraCols, fmtTokens, fmtW, parse, rate, since, sum, withHeader } from './ledger'
import type { Anchor } from './ledger'

export const TRIAL_LOG = '~/.claude/stool/trial.jsonl'
export const LEDGER = '~/.claude/stool/agent-ledger.tsv'

// the first "N tool calls" in the prompt is the cap (dispatch-guard appends its default after it)
export const capOf = (prompt: string): number | undefined => {
  const m = /(\d+)\s+tool[- ]calls?\b/i.exec(prompt)
  return m ? Number(m[1]) : undefined
}

// the default cap on an agent's tool calls when its prompt states none (a run past ~60 messages is 71% of subagent $,
// measured 2026-10-24); the hard stop sits a quarter above it. `agentCallCap` 0 = off
export const CALL_CAP = 80
// a cap already worded in the prompt (same test as dispatch-guard; parts are tested apart, so no import)
const hasCap = (p: string) => /\b\d+\s+tool[- ]calls?\b|tool[- ]call (cap|limit|budget)/i.test(p)
export const hardOf = (cap: number) => cap + Math.max(10, Math.ceil(cap / 4))

export type Meter = { type: string; model: string; description: string; cap?: number; calls: number; warned: boolean }
const meters = new Map<string, Meter>() // ponytail: module map, a reload forgets running agents (they then count from 0 without a cap)

export const row = (m: Meter, o: { time: string; cwd: string; tokens: number; ms: number }) =>
  [o.time, o.cwd, m.type, m.model, m.description, m.calls, o.tokens, Math.round(o.ms / 1000), m.cap ?? '']
    .map(v => String(v).replace(/[\t\r\n]+/g, ' '))
    .join('\t')

const STRIP = { plugin: 'stool', key: 'meter' } as const
export const strip = () => ({ agents: [...meters].map(([id, m]) => ({ id, desc: m.description, calls: m.calls, cap: m.cap ?? null })) })

const fileOf = async ($: EngineInterface, ledger: string) =>
  expand(ledger.startsWith("~") ? ((await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))) : undefined, ledger)

// the weekly meter as of the first ledger line of a weekly window: the rate's starting point, kept across sessions
async function ensureAnchor($: EngineInterface, now: number) {
  const week = (await $.session.usage()).rateLimits.find(l => l.kind === 'seven_day')
  if (!week?.resetsAt) return undefined
  const key = `usage-anchor:${week.resetsAt}`
  let anchor = (await $.store.get(key)) as Anchor | undefined
  if (!anchor) {
    anchor = { at: now, pct: week.percentUsed }
    await $.store.set(key, anchor)
  }
  return { anchor, pct: week.percentUsed, resetsAt: week.resetsAt }
}

export const USAGE_SINCE_TOOL: ToolSpec = {
  name: 'usage_since',
  description:
    'What the agents (and, when ledgerMainTurns is on, the main conversation) used since a time or by one agent: tokens and weekly-percent points, like "0.4w% (150k tokens)". Weekly points are an estimate at a rate calibrated from the weekly meter.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'How far back: 30m, 2h, 1d, or a date. Default 1h.' },
      agent: { type: 'string', description: 'Only this agent id (a prefix is enough).' },
      session: { type: 'string', description: 'Only this session id (a prefix is enough).' },
    },
  },
  isDeferred: true,
}

export const OUTCOMES_TOOL: ToolSpec = {
  name: 'outcomes',
  description:
    'What each project cost against what it shipped: weekly-percent points (an estimate) and git commits per project since a time, and the cost of one commit. Use it to see where the limit goes and whether it bought work.',
  inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'How far back: 12h, 3d, 7d, or a date. Default 7d.' } } },
  isDeferred: true,
}

export const register: Register = (on, options) => {
  const ledger = text(options, 'agentLedger', LEDGER)
  // the main conversation's turns too (a ledger write each turn), so usage_since can split lead from agents
  const mainTurns = flag(options, 'ledgerMainTurns')
  const writeMult = num(options, 'ledgerCacheWriteMult', WRITE_MULT)
  const base = num(options, 'agentCallCap', CALL_CAP)
  const governor = options?.governor !== false
  on('agent.spawn', { prompt: /[^]*|a{1}/ }, async ($, e, next) => {
    const isMine = !e.workflow && inScope(await $.session.cwd(), roots(options))
    const stated = capOf(e.prompt)
    // trial off arm: no default cap
    if (trialOff(options, await $.session.id())) return next(e)
    // the governor: the default cap shrinks while the 5-hour or weekly window runs hot (usage-pace's squeeze)
    const sq = governor && base > 0 ? Number((await $.state.get({ plugin: 'stool', key: 'usage' }).catch(() => undefined))?.value?.squeeze ?? 0) : 0
    const dflt = Math.max(Math.min(10, base), Math.round(base * [1, 0.75, 0.5][Math.min(2, Math.max(0, sq))]!))
    const useDefault = isMine && base > 0 && stated === undefined && !hasCap(e.prompt)
    const r = await next(useDefault ? { ...e, prompt: `${e.prompt}

- Tool-call cap: about ${dflt}; when it runs out, stop and report what you have.` } : e)
    if (r.agentId && isMine)
      meters.set(r.agentId, { type: e.subagentType, model: r.model ?? e.model ?? '', description: e.description, cap: stated ?? (useDefault ? dflt : undefined), calls: 0, warned: false })
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /[^]*|a{2}/ }, async ($, e, next) => {
    // relay, lead side: an agent that ran out of calls left a handoff; the work goes on in a fresh agent, whose
    // context starts small instead of carrying everything the first one read
    if (!e.agentId && (e.tool === 'Agent' || e.tool === 'Task')) {
      const r = await next(e)
      const handoff = /RELAY:\s*(\S+)/.exec(JSON.stringify(r.result ?? ''))?.[1]?.replace(/\\\\/g, '\\')
      return handoff ? { ...r, context: [...(r.context ?? []), `agent-meter: that agent relayed at its tool-call cap. If the task is not finished, dispatch a fresh agent of the same type to continue it: give it the original task and tell it to read the handoff at ${handoff} first.`] } : r
    }
    const m = e.agentId ? meters.get(e.agentId) : undefined
    if (!m) return next(e)
    m.calls++
    await $.state.set(STRIP, strip())
    if (m.cap !== undefined && m.calls > hardOf(m.cap)) return { deny: `agent-meter: tool-call limit reached (${m.calls - 1}). Stop now and report what you have; do not call more tools.` }
    const r = await next(e)
    if (m.cap === undefined || m.calls <= m.cap || m.warned) return r
    m.warned = true
    $.ui.toast(`agent-meter: "${m.description}" passed its cap (${m.calls}/${m.cap} tool calls)`)
    // relay, agent side: a short handoff file instead of a half-done stop, so a fresh agent can pick up from it
    const handoff = expand((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')), `~/.claude/stool/relay/${e.agentId}.md`)
    return {
      ...r,
      context: [
        ...(r.context ?? []),
        `agent-meter: you are past your ${m.cap} tool-call cap (tools stop at ${hardOf(m.cap)}). If the task is not finished, write a short handoff to ${handoff} (done so far, what is left, files touched, the next step), then end your report with the line "RELAY: ${handoff}". If it is finished, just report.`,
      ],
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', { reason: /[^]*|a{3}/ }, async ($, e, next) => {
    const m = e.agentId ? meters.get(e.agentId) : undefined
    const isMain = !e.agentId && mainTurns && e.usage !== undefined && inScope(await $.session.cwd(), roots(options))
    if ((m && e.agentId) || isMain) {
      if (m && e.agentId) meters.delete(e.agentId)
      const u = e.usage
      const t = { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0, cacheWrite: u?.cache_creation_input_tokens ?? 0 }
      const meter = m ?? { type: 'main', model: (u as { model?: string } | undefined)?.model ?? '', description: '', calls: 0, warned: false }
      const now = await $.clock.now()
      await ensureAnchor($, now).catch(() => undefined)
      const line = [
        row(meter, { time: new Date(now).toISOString(), cwd: await $.session.cwd(), tokens: t.input + t.output + t.cacheRead + t.cacheWrite, ms: e.durationMs }),
        extraCols(e.agentId ?? '', t, await $.session.id()),
      ].join('\t')
      // ponytail: read-modify-write, two sessions ending in the same instant can drop a line; main turns grow the file
      // by a line a turn, so trim it by hand when it gets large
      const file = await fileOf($, ledger)
      const old = await $.fs.read(file).catch(() => '')
      await $.fs.write(file, withHeader(old) + line + '\n')
      if (m) await $.state.set(STRIP, strip())
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', { cwd: /[^]*|a{31}/ }, async ($, e, next) => {
    await $.tool.register(USAGE_SINCE_TOOL)
    await $.tool.register(OUTCOMES_TOOL)
    // the trial: one line per session with its arm, for bench/trial.mjs to read
    if (flag(options, 'trial') && inScope(e.cwd, roots(options))) {
      const id = await $.session.id()
      const file = await fileOf($, TRIAL_LOG)
      const old = await $.fs.read(file).catch(() => '')
      if (!old.includes(`"${id}"`))
        await $.fs.write(file, old + JSON.stringify({ t: await $.clock.now(), session: id, cwd: e.cwd, arm: trialOff(options, id) ? 'off' : 'on' }) + '\n')
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__stool__usage_since' }, async ($, e) => {
    const input = ((e as { input?: Record<string, unknown> }).input ?? {}) as { since?: string; agent?: string; session?: string }
    const now = await $.clock.now()
    const from = since(input.since ?? '1h', now)
    if (from === undefined) return { result: `usage_since: cannot read "${input.since}" as a time (try 30m, 2h, 1d, or a date).` }
    const rows = parse(await $.fs.read(await fileOf($, ledger)).catch(() => ''))
    const pick = (r: { at: number; agent: string; session: string }) =>
      r.at >= from && r.at <= now && (!input.agent || r.agent.startsWith(input.agent)) && (!input.session || r.session.startsWith(input.session))
    const { lead, agents } = sum(rows, pick, writeMult)
    const week = await ensureAnchor($, now).catch(() => undefined)
    const cal = week ? rate(rows, week.anchor, week.pct, now, writeMult) : undefined
    const w = (usd: number) => (cal?.perUsd === undefined ? undefined : usd * cal.perUsd)
    const part = (name: string, s: typeof lead) => {
      const x = w(s.usd)
      return `${name}: ${s.runs} ${name === 'lead' ? 'turns' : 'runs'}, ${fmtTokens(s.tokens)} tokens${x === undefined ? '' : `, ${fmtW(x)}`}${s.unsplit ? `, ${s.unsplit} older lines without token splits not weighed` : ''}`
    }
    const totalW = w(lead.usd + agents.usd)
    const tokens = lead.tokens + agents.tokens
    const head = `${totalW === undefined ? '?w%' : fmtW(totalW)} (${fmtTokens(tokens)} tokens)`
    const notes = [
      cal === undefined
        ? 'No weekly meter reading (not on a subscription?): tokens only.'
        : cal.perUsd === undefined
          ? `No rate yet: the weekly meter has not moved since the ledger started counting (${new Date(week!.anchor.at).toLocaleString()}). Weekly points follow once it does.`
          : `Rate ${cal.perUsd.toFixed(3)} w% per $ (1 w% is about $${(1 / cal.perUsd).toFixed(1)}), from ${cal.pts} points over $${cal.usd.toFixed(2)} at list prices since ${new Date(week!.anchor.at).toLocaleString()}; the meter moves in whole points, so that is ±1 point${cal.pts < 3 ? ' (few points yet: rough)' : ''}.`,
      cal && !cal.hasLead ? 'No main-conversation turns logged since then (ledgerMainTurns is off): the rate counts agents only, so w% reads high.' : '',
      'Counts sessions under projectRoots on this machine; others use the weekly meter too.',
    ].filter(Boolean)
    return { result: [head, part('lead', lead), part('agents', agents), ...notes].join('\n') }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__stool__outcomes' }, async ($, e) => {
    const input = ((e as { input?: Record<string, unknown> }).input ?? {}) as { since?: string }
    const now = await $.clock.now()
    const from = since(input.since ?? '7d', now)
    if (from === undefined) return { result: `outcomes: cannot read "${input.since}" as a time (try 12h, 3d, 7d, or a date).` }
    const rows = parse(await $.fs.read(await fileOf($, ledger)).catch(() => ''))
    const week = await ensureAnchor($, now).catch(() => undefined)
    const cal = week ? rate(rows, week.anchor, week.pct, now, writeMult) : undefined
    const out: string[] = []
    for (const { project, usd } of byProject(rows, r => r.at >= from && r.at <= now, writeMult).slice(0, 12)) {
      const log = await $.process.run(['git', '-C', project, 'log', '--all', `--since=${new Date(from).toISOString()}`, '--oneline'], { timeoutMs: 10_000 }).catch(() => undefined)
      const commits = log === undefined ? undefined : log.stdout.split('\n').filter(Boolean).length
      const w = cal?.perUsd === undefined ? undefined : usd * cal.perUsd
      const cost = w === undefined ? `$${usd.toFixed(2)}` : `${fmtW(w)} ($${usd.toFixed(2)})`
      const per = commits === undefined ? 'not a git folder' : commits === 0 ? '0 commits' : `${commits} commits, ${w === undefined ? `$${(usd / commits).toFixed(2)}` : fmtW(w / commits)} per commit`
      out.push(`${project.split('/').slice(-2).join('/')}: ${cost}, ${per}`)
    }
    const notes = [
      cal?.perUsd === undefined ? 'No weekly-point rate yet: dollars at list price only.' : '',
      cal && !cal.hasLead ? 'ledgerMainTurns is off: only agents are counted, so lead work is missing.' : '',
      'Commits are every commit on any branch in that folder since the start time, whoever wrote them; only sessions with this plugin loaded are counted.',
    ].filter(Boolean)
    return { result: [out.length ? out.join('\n') : 'No ledger rows in that window.', ...notes].join('\n') }
  }).catch(($, e, next) => next(e))
}
