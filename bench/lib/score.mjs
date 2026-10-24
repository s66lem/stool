// $ per passed task by task and setup; failed runs keep their cost, invalid runs (wrong hooks loaded) are dropped.

export function score(runs) {
  const rows = new Map()
  for (const r of runs) {
    if (r.invalid) continue
    const key = `${r.task}\t${r.setup}`
    const row = rows.get(key) ?? { task: r.task, setup: r.setup, runs: 0, passes: 0, usd: 0, usdPerPass: Infinity }
    row.runs++
    row.passes += r.pass ? 1 : 0
    row.usd += r.usd
    row.usdPerPass = row.passes ? row.usd / row.passes : Infinity
    rows.set(key, row)
  }
  return [...rows.values()]
}

// real = on is cheaper per pass than off by more than off's spread (max - min of its runs) on more than half the tasks
export function verdict(rows, runs) {
  const total = setup => {
    const rs = rows.filter(r => r.setup === setup)
    const passes = rs.reduce((s, r) => s + r.passes, 0)
    return passes ? rs.reduce((s, r) => s + r.usd, 0) / passes : Infinity
  }
  const totalOff = total('off')
  const totalOn = total('on')
  const tasks = [...new Set(rows.map(r => r.task))]
  const perTask = tasks.map(task => {
    const off = rows.find(r => r.task === task && r.setup === 'off')
    const on = rows.find(r => r.task === task && r.setup === 'on')
    const usds = runs.filter(r => !r.invalid && r.task === task && r.setup === 'off').map(r => r.usd)
    const spread = usds.length > 1 ? Math.max(...usds) - Math.min(...usds) : 0
    const isBeyond = !!off && !!on && off.usdPerPass - on.usdPerPass > spread
    return { task, saving: off && on ? 1 - on.usdPerPass / off.usdPerPass : NaN, isBeyond }
  })
  return {
    totalOff,
    totalOn,
    saving: 1 - totalOn / totalOff,
    real: perTask.filter(t => t.isBeyond).length > tasks.length / 2,
    perTask: perTask.map(({ task, saving }) => ({ task, saving })),
  }
}
