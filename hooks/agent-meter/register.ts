// agent-meter: per-agent tool-call count vs the cap its prompt states, and a ledger line per finished agent
//. Spike: tool.call and turn.complete carry agentId; turn.complete carries
// durationMs and usage (4 token counts); agent.spawn answers agentId. Live token counts need a turn.step stream hook: skipped.
import type { Register } from 'claude-code'

import { expand, inScope, roots, text } from '../config'

export const LEDGER = '~/.claude/stool/agent-ledger.tsv'
const HEADER = 'time\tcwd\ttype\tmodel\tdescription\tcalls\ttokens\tseconds\tcap'

// the first "N tool calls" in the prompt is the cap (dispatch-guard appends its default after it)
export const capOf = (prompt: string): number | undefined => {
  const m = /(\d+)\s+tool[- ]calls?\b/i.exec(prompt)
  return m ? Number(m[1]) : undefined
}

export type Meter = { type: string; model: string; description: string; cap?: number; calls: number; warned: boolean }
const meters = new Map<string, Meter>() // ponytail: module map, a reload forgets running agents (they then count from 0 without a cap)

export const row = (m: Meter, o: { time: string; cwd: string; tokens: number; ms: number }) =>
  [o.time, o.cwd, m.type, m.model, m.description, m.calls, o.tokens, Math.round(o.ms / 1000), m.cap ?? '']
    .map(v => String(v).replace(/[\t\r\n]+/g, ' '))
    .join('\t')

const STRIP = { plugin: 'stool', key: 'meter' } as const
export const strip = () => ({ agents: [...meters].map(([id, m]) => ({ id, desc: m.description, calls: m.calls, cap: m.cap ?? null })) })

export const register: Register = (on, options) => {
  const ledger = text(options, 'agentLedger', LEDGER)
  on('agent.spawn', { prompt: /[^]*|a{1}/ }, async ($, e, next) => {
    const r = await next(e)
    if (r.agentId && !e.workflow && inScope(await $.session.cwd(), roots(options)))
      meters.set(r.agentId, { type: e.subagentType, model: r.model ?? e.model ?? '', description: e.description, cap: capOf(e.prompt), calls: 0, warned: false })
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /[^]*|a{2}/ }, async ($, e, next) => {
    const m = e.agentId ? meters.get(e.agentId) : undefined
    if (m) {
      m.calls++
      if (m.cap !== undefined && m.calls > m.cap && !m.warned) {
        m.warned = true
        $.ui.toast(`agent-meter: "${m.description}" passed its cap (${m.calls}/${m.cap} tool calls)`)
      }
      await $.state.set(STRIP, strip())
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', { reason: /[^]*|a{3}/ }, async ($, e, next) => {
    const m = e.agentId ? meters.get(e.agentId) : undefined
    if (m && e.agentId) {
      meters.delete(e.agentId)
      const u = e.usage
      const tokens = u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
      const line = row(m, { time: new Date(await $.clock.now()).toISOString(), cwd: await $.session.cwd(), tokens, ms: e.durationMs })
      // ponytail: read-modify-write, two sessions ending in the same instant can drop a line
      const file = expand(ledger.startsWith("~") ? ((await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))) : undefined, ledger)
      const old = await $.fs.read(file).catch(() => '')
      await $.fs.write(file, (old || HEADER + '\n') + line + '\n')
      await $.state.set(STRIP, strip())
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
