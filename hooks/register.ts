// stool: one module that registers each bundled mod's hooks (sources under hooks/<mod>/)
import type { EngineInterface, Register, ToolSpec } from 'claude-code'

import { OUTCOMES_TOOL, USAGE_SINCE_TOOL, register as agentMeter } from './agent-meter/register'
import { register as permission } from './permission/register'
import { register as dispatchGuard } from './dispatch-guard/register'
import { RELOAD_TOOL, RESTART_TOOL, register as freshRestart } from './fresh-restart/register'
import { KEEP_WARM_TOOL, register as keepWarm } from './keep-warm/register'
import { register as leadGuard } from './lead-guard/register'
import { register as restartClock } from './restart-clock/register'
import { register as planProgress } from './plan-progress/register'
import { register as captureGuard } from './capture-guard/register'
import { AGENT_CAP_TOOL, register as usagePace } from './usage-pace/register'
import { inScope, roots } from './config'

// The tools the parts offer at session.start. A session that resumes (after a reboot, 2026-10-20) can lose the ones whose
// registration is the first thing a handler does: they run before the session binds and nothing says so. Each prompt
// checks the model's tool list and offers again whichever is missing (a tool offered anew shows from the next prompt).
const TOOLS: { spec: ToolSpec; isScoped?: boolean }[] = [
  { spec: AGENT_CAP_TOOL },
  { spec: RESTART_TOOL },
  { spec: RELOAD_TOOL },
  { spec: USAGE_SINCE_TOOL },
  { spec: OUTCOMES_TOOL },
  { spec: KEEP_WARM_TOOL, isScoped: true },
]

async function offerMissing($: EngineInterface, projectRoots: string[], isKeepWarmOn: boolean) {
  const [list, cwd] = [await $.tool.list().catch(() => []), await $.session.cwd()]
  const have = new Set(list.map(t => t.name))
  for (const { spec, isScoped } of TOOLS) {
    if (have.has(`mcp__stool__${spec.name}`)) continue
    if (isScoped && (!isKeepWarmOn || !inScope(cwd, projectRoots))) continue
    await $.tool.register(spec).catch(() => undefined)
  }
}

export const register: Register = (on, options) => {
  planProgress(on, options)
  usagePace(on, options)
  freshRestart(on, options)
  keepWarm(on, options)
  dispatchGuard(on, options)
  leadGuard(on, options)
  restartClock(on, options)
  agentMeter(on, options)
  captureGuard(on, options)
  permission(on, options)

  on('prompt.submit', { text: /[^]*|a{35}/ }, async ($, e, next) => {
    await offerMissing($, roots(options), options?.keepWarm !== false)
    return next(e)
  })
}
