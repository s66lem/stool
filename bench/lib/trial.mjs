// The in-the-wild trial's arithmetic: $ per commit by arm, and a bootstrap interval for how much cheaper the levers-on arm is.
// A session is { arm: 'on'|'off', usd, commits }.

export const ratio = rows => {
  const usd = rows.reduce((a, r) => a + r.usd, 0)
  const commits = rows.reduce((a, r) => a + r.commits, 0)
  return { n: rows.length, usd, commits, perCommit: commits > 0 ? usd / commits : NaN }
}

// seeded so a report is repeatable
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// resamples whole sessions inside each arm; returns the saving of "on" against "off" as a fraction of off's $/commit
export function compare(sessions, { resamples = 2000, seed = 1 } = {}) {
  const on = sessions.filter(s => s.arm === 'on')
  const off = sessions.filter(s => s.arm === 'off')
  const a = ratio(on)
  const b = ratio(off)
  const saving = 1 - a.perCommit / b.perCommit
  if (on.length < 2 || off.length < 2 || Number.isNaN(saving)) return { on: a, off: b, saving: Number.isNaN(saving) ? undefined : saving, ci: undefined }
  const r = rng(seed)
  const pick = rows => Array.from({ length: rows.length }, () => rows[Math.floor(r() * rows.length)])
  const draws = []
  for (let i = 0; i < resamples; i++) {
    const s = 1 - ratio(pick(on)).perCommit / ratio(pick(off)).perCommit
    if (!Number.isNaN(s)) draws.push(s)
  }
  draws.sort((x, y) => x - y)
  const ci = draws.length ? [draws[Math.floor(draws.length * 0.025)], draws[Math.floor(draws.length * 0.975)]] : undefined
  return { on: a, off: b, saving, ci }
}
