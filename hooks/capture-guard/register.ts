// capture-guard (opt-in `captureGuard`): (1) a circuit breaker on a slow screen-capture tool (`captureTool`), (2) a
// `capture` strip value {ramFreeGB, appWindows} for the app process `captureProcess` (Windows only).
// Only in sessions under `projectRoots`.
import type { Register } from 'claude-code'
import type { CaptureStrip } from '../../types'

import { flag, inScope, roots, text } from '../config'

export const MAX_FAILS = 2
export const HOLD_MS = 10 * 60_000 // ponytail: a tripped breaker clears itself after 10 min so the lead is never stuck for good
export const STOP = 'capture-guard: two capture timeouts in a row: stop and report'
const STRIP_EVERY_MS = 30_000

// consecutive failures per agent; a success resets. Pure, so the test needs no engine.
export class Breaker {
  private s = new Map<string, { n: number; at: number }>()
  tripped(id: string, now: number): boolean {
    const x = this.s.get(id)
    if (!x) return false
    if (now - x.at > HOLD_MS) { this.s.delete(id); return false }
    return x.n >= MAX_FAILS
  }
  fail(id: string, now: number) { this.s.set(id, { n: (this.s.get(id)?.n ?? 0) + 1, at: now }) }
  ok(id: string) { this.s.delete(id) }
  reset() { this.s.clear() }
}

// free RAM (GB) and the app's process count, one PowerShell call
const ps = (proc: string) => `$o=Get-CimInstance Win32_OperatingSystem;"$($o.FreePhysicalMemory) $(@(Get-Process ${proc} -EA 0).Count)"`
export function parseStrip(out: string): CaptureStrip | undefined {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(out)
  return m ? { ramFreeGB: Math.round(Number(m[1]) / 1048576 * 10) / 10, appWindows: Number(m[2]) } : undefined
}

export const register: Register = (on, options) => {
  if (!flag(options, 'captureGuard')) return
  const tool = text(options, 'captureTool')
  const proc = text(options, 'captureProcess').replace(/[^\w.-]/g, '')
  const b = new Breaker()
  let scoped = false
  let lastStrip = 0
  let busy = false

  on('session.start', { cwd: /[^]*|a{27}/ }, ($, e, next) => {
    scoped = inScope(e.cwd, roots(options))
    b.reset()
    return next(e)
  })

  if (tool) on('tool.call', { tool }, async ($, e, next) => {
    if (!scoped) return next(e)
    const id = e.agentId ?? 'main'
    const now = await $.clock.now()
    if (b.tripped(id, now)) return { deny: STOP }
    let r
    try {
      r = await next(e)
    } catch (err) {
      b.fail(id, now)
      throw err
    }
    if (r.deny === undefined) r.isError ? b.fail(id, now) : b.ok(id)
    return r
  }).catch(($, e, next) => next(e)) // a bug here fails open

  // strip refresh: on any tool call, at most every 30 s, not awaited
  if (proc) on('tool.call', { tool: /[^]*|a{28}/ }, async ($, e, next) => {
    if (scoped && !busy) {
      const now = await $.clock.now()
      if (now - lastStrip >= STRIP_EVERY_MS) {
        busy = true
        lastStrip = now
        void $.process.run(['powershell', '-NoProfile', '-Command', ps(proc)], { timeoutMs: 10_000 })
          .then(r => { const s = parseStrip(r.stdout); if (s) void $.state.set({ plugin: 'stool', key: 'capture' }, s) })
          .catch(() => {})
          .finally(() => { busy = false })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
