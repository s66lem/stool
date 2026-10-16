// The agent ledger as numbers: parse its lines, weigh them in cost units, and turn units into weekly-percent points
// at a rate calibrated from the weekly meter. Pure: no engine calls (agent-meter's register.ts does the reading).

export const HEADER_OLD = 'time\tcwd\ttype\tmodel\tdescription\tcalls\ttokens\tseconds\tcap'
export const HEADER = `${HEADER_OLD}\tagent\tinput\toutput\tcache_read\tcache_write\tsession`

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Row = Tokens & { at: number; type: string; model: string; tokens: number; agent: string; session: string; isSplit: boolean }

/** The columns after `cap`: who it was, the four token counts, the session. */
export const extraCols = (agent: string, t: Tokens, session: string) => [agent, t.input, t.output, t.cacheRead, t.cacheWrite, session].join('\t')

/** A ledger file's text with its header brought up to date (rows written before the extra columns keep their shape). */
export const withHeader = (text: string) => (text ? (text.startsWith(`${HEADER_OLD}\n`) ? HEADER + text.slice(HEADER_OLD.length) : text) : `${HEADER}\n`)

export function parse(text: string): Row[] {
  return text
    .split('\n')
    .slice(1)
    .flatMap(line => {
      const c = line.split('\t')
      const at = Date.parse(c[0] ?? '')
      if (Number.isNaN(at)) return []
      const n = (i: number) => Number(c[i]) || 0
      return [{ at, type: c[2] ?? '', model: c[3] ?? '', tokens: n(6), agent: c[9] ?? '', input: n(10), output: n(11), cacheRead: n(12), cacheWrite: n(13), session: c[14] ?? '', isSplit: c.length > 13 }]
    })
}

// the owner's cost weights: a model's price relative to Haiku, and what each token kind costs against plain input
export const weight = (model: string) => (/opus/i.test(model) ? 5 : /haiku/i.test(model) ? 1 : 3)
export const units = (r: Row) => weight(r.model) * (r.input + 0.1 * r.cacheRead + 1.25 * r.cacheWrite + 5 * r.output)

export type Sum = { runs: number; tokens: number; units: number; unsplit: number }
const empty = (): Sum => ({ runs: 0, tokens: 0, units: 0, unsplit: 0 })

/** The main conversation's turns apart from the agents', over the rows that pass `keep`. */
export function sum(rows: Row[], keep: (r: Row) => boolean): { lead: Sum; agents: Sum } {
  const out = { lead: empty(), agents: empty() }
  for (const r of rows.filter(keep)) {
    const s = r.type === 'main' ? out.lead : out.agents
    s.runs++
    s.tokens += r.tokens
    if (r.isSplit) s.units += units(r)
    else s.unsplit++
  }
  return out
}

export type Anchor = { at: number; pct: number }

/** Weekly-percent points per million units: the weekly meter's climb since the anchor over the units logged since. */
export function rate(rows: Row[], anchor: Anchor, pctNow: number, now: number) {
  const u = sum(rows, r => r.at >= anchor.at && r.at <= now)
  const total = u.lead.units + u.agents.units
  const pts = pctNow - anchor.pct
  return { pts, units: total, perM: total > 0 && pts > 0 ? (pts / total) * 1e6 : undefined, hasLead: u.lead.runs > 0 }
}

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
export const fmtW = (w: number) => `${w >= 10 ? w.toFixed(0) : w >= 1 ? w.toFixed(1) : w.toFixed(2)}w%`

/** "10m", "2h", "1d" before now, or any date text. */
export function since(arg: string, now: number): number | undefined {
  const m = /^(\d+)\s*([mhd])$/i.exec(arg.trim())
  if (m) return now - Number(m[1]) * { m: 60_000, h: 3600_000, d: 86_400_000 }[m[2].toLowerCase() as 'm' | 'h' | 'd']
  const t = Date.parse(arg)
  return Number.isNaN(t) ? undefined : t
}
