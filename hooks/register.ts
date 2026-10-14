// stool: one module that registers each bundled mod's hooks (sources under hooks/<mod>/)
import type { Register } from 'claude-code'

import { register as agentMeter } from './agent-meter/register'
import { register as dispatchGuard } from './dispatch-guard/register'
import { register as freshRestart } from './fresh-restart/register'
import { register as keepWarm } from './keep-warm/register'
import { register as leadGuard } from './lead-guard/register'
import { register as restartClock } from './restart-clock/register'
import { register as planProgress } from './plan-progress/register'
import { register as captureGuard } from './capture-guard/register'
import { register as usagePace } from './usage-pace/register'

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
}
