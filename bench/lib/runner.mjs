// Pure helpers for bench/run.mjs: which runs to make, the claude command line, and reading what came back.

const SETUPS = ['off', 'on']

export function planRuns(mode, tasks) {
  const small = tasks.filter(t => t.size === 'small')
  if (mode === 'smoke') return SETUPS.map(setup => ({ task: small[0].id, setup, rep: 1 }))
  const runs = []
  for (const t of small) for (const rep of [1, 2]) for (const setup of SETUPS) runs.push({ task: t.id, setup, rep })
  for (const t of tasks.filter(t => t.size === 'long')) for (const setup of SETUPS) runs.push({ task: t.id, setup, rep: 1 })
  return runs
}

// a clean profile both ways (no MCP servers, no user or project settings, so no other plugins); stool only when on
// a pinned session id lets a run that times out or crashes (no result printed) still be priced from its transcript
export function claudeArgs(setup, { prompt, model, stoolDir, debugFile, sessionId }) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json', '--strict-mcp-config', '--setting-sources', '', '--dangerously-skip-permissions', '--debug-file', debugFile, ...(sessionId ? ['--session-id', sessionId] : [])]
  return setup === 'on' ? [...args, '--plugin-dir', stoolDir] : args
}

// the last JSON line with a session id (the result object), or null
export function parseResult(stdout) {
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const j = JSON.parse(line)
      if (j && typeof j.session_id === 'string') return { sessionId: j.session_id, isError: j.is_error === true }
    } catch {}
  }
  return null
}

export const stoolLoaded = debugText => /hooks module stool@\S+ loaded/.test(debugText)

export const overBudget = (spentUsd, nextEstimateUsd, budgetUsd) => spentUsd + nextEstimateUsd > budgetUsd

// the next run's cost guess for the budget stop: earlier runs of the task, else its own estimate, else all runs so far
export function estimateFor(task, runs) {
  const mean = xs => xs.reduce((s, r) => s + r.usd, 0) / xs.length
  const same = runs.filter(r => r.task === task.id)
  if (same.length) return mean(same)
  if (typeof task.estimateUsd === 'number') return task.estimateUsd
  return runs.length ? mean(runs) : 0
}

// no debug log (claude died at start) is a failed run, not an invalid one: dropping it would hide a crash stool caused
export function invalidReason(setup, debugText) {
  if (debugText === null) return undefined
  const loaded = stoolLoaded(debugText)
  if (setup === 'off' && loaded) return 'stool hooks in an off run'
  if (setup === 'on' && !loaded) return 'stool hooks missing in an on run'
  return undefined
}
