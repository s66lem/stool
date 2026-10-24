// A run's cost at API list price, read from its transcripts (lead file plus its subagents' files).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// $ per million tokens: [input, output, cache-read multiple of input]; cache writes are 1.25x (5 min) or 2x (1 h) input
const PRICE = { opus: [4, 20, 0.05], sonnet: [2, 10, 0.1], haiku: [0.1, 0.5, 0.1], fable: [10, 50, 0.025] }

export function priceUsage(model, u) {
  const key = Object.keys(PRICE).find(k => (model || '').includes(k))
  if (!key) return 0
  const [pin, pout, rd] = PRICE[key]
  const cc = u.cache_creation_input_tokens || 0
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens || 0
  return ((u.input_tokens || 0) * pin + (u.output_tokens || 0) * pout + (u.cache_read_input_tokens || 0) * pin * rd + (cc - w1h) * pin * 1.25 + w1h * pin * 2) / 1e6
}

const ctxOf = u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

export function sessionCost(projectsDir, sessionId) {
  const out = { usd: 0, msgs: 0, leadMaxCtx: 0, agentMaxCtx: 0, agents: 0 }
  const dir = readdirSync(projectsDir).map(d => join(projectsDir, d)).find(d => existsSync(join(d, `${sessionId}.jsonl`)))
  if (!dir) return out
  const subDir = join(dir, sessionId, 'subagents')
  const subs = existsSync(subDir) ? readdirSync(subDir).filter(f => f.endsWith('.jsonl')).map(f => join(subDir, f)) : []
  out.agents = subs.length
  const seen = new Set()
  for (const [file, isSub] of [[join(dir, `${sessionId}.jsonl`), false], ...subs.map(f => [f, true])]) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"usage"')) continue
      let r
      try {
        r = JSON.parse(line)
      } catch {
        continue
      }
      const u = r.message?.usage
      if (r.type !== 'assistant' || !u) continue
      const key = `${r.message.id}:${r.requestId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.msgs++
      out.usd += priceUsage(r.message.model, u)
      const k = isSub ? 'agentMaxCtx' : 'leadMaxCtx'
      out[k] = Math.max(out[k], ctxOf(u))
    }
  }
  return out
}
