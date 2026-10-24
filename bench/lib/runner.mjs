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
export function claudeArgs(setup, { prompt, model, stoolDir, debugFile }) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json', '--strict-mcp-config', '--setting-sources', '', '--dangerously-skip-permissions', '--debug-file', debugFile]
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
