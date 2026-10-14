// dispatch-guard (opt-in `dispatchGuard`): dispatch rules enforced where the Agent tool spawns, instead of left in prose.
import type { EngineInterface, Register } from 'claude-code'

import { SLOT_DEFAULT, expand, flag, inScope, pattern, roots, text } from '../config'

// one file shared by every session: the running agents that count against the cap
// a slot older than this is a crashed agent, never counted
export const EXPIRE_MS = 3 * 3600_000

export type Slot = { id: string; at: number }
export const live = (slots: Slot[], now: number) => slots.filter(s => now - s.at < EXPIRE_MS)

// cheap agents (a Haiku model, or one of the `dispatchCheapAgents` types) are not counted against the cap
export const isCheap = (e: { model?: string; subagentType: string }, cheap: readonly string[]) =>
  /haiku/i.test(e.model ?? '') || cheap.includes(e.subagentType)

const MARK = 'STANDING ORDERS (dispatch-guard)'
export const hasCap = (p: string) => /\b\d+\s+tool[- ]calls?\b|tool[- ]call (cap|limit|budget)/i.test(p)

export type Orders = { text: string; capPattern: RegExp | undefined; capText: string }

export function orders(prompt: string, o: Orders): string {
  const lines = o.text.split('\n').map(l => l.trim()).filter(Boolean)
  lines.push(hasCap(prompt) ? '- Keep to the tool-call cap stated above; when it runs out, stop and report.' : '- Tool-call cap: about 100; when it runs out, stop and report what you have.')
  if (o.capPattern?.test(prompt)) lines.push(...o.capText.split('\n').map(l => l.trim()).filter(Boolean))
  return `\n\n${MARK}\n${lines.join('\n')}`
}

const SLOTS = (t: string): Slot[] => {
  try {
    const v = JSON.parse(t)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// ponytail: read-modify-write with no lock, so two sessions spawning in the same instant can lose a slot;
// the count then runs one low for up to 3 hours. A lock file if that ever matters.
async function load($: EngineInterface, file: string) {
  return $.fs.read(expand(file.startsWith("~") ? ((await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))) : undefined, file)).then(SLOTS, () => [] as Slot[])
}

export const register: Register = (on, options) => {
  if (!flag(options, 'dispatchGuard')) return
  const slotFile = text(options, 'slotFile', SLOT_DEFAULT)
  const cheap = (Array.isArray(options?.dispatchCheapAgents) ? (options.dispatchCheapAgents as string[]) : [])
  const o: Orders = {
    text: text(options, 'dispatchOrders'),
    capPattern: text(options, 'dispatchCapPattern') ? pattern(text(options, 'dispatchCapPattern'), 'i') : undefined,
    capText: text(options, 'dispatchCapOrders'),
  }

  on('agent.spawn', { prompt: /[^]*|a{4}/ }, async ($, e, next) => {
    if (e.workflow || e.fork || !inScope(await $.session.cwd(), roots(options))) return next(e)

    if (o.capPattern?.test(e.prompt) && !hasCap(e.prompt))
      return { deny: 'dispatch-guard: this task needs a tool-call cap in its prompt. Add e.g. "about 120 tool calls: when they run out, stop and report" and dispatch again.' }

    const counted = !isCheap(e, cheap)
    const now = await $.clock.now()
    if (counted) {
      // the cap is the usage strip's number (its state), else its agent_cap tool; no reading, no cap check
      const fromState = Number((await $.state.get({ plugin: 'stool', key: 'usage' }).catch(() => undefined))?.value?.cap ?? NaN)
      const cap = !Number.isNaN(fromState)
        ? fromState
        : await $.tool
            .call({ tool: 'mcp__stool__agent_cap' } as never)
            .then(r => Number(/Agent cap (\d+)/.exec(String((r as { text?: string }).text ?? ''))?.[1] ?? NaN), () => NaN)
      const running = live(await load($, slotFile), now).length
      if (running >= cap)
        return { deny: `dispatch-guard: ${running} agents are running across sessions and agent_cap is ${cap}. Wait for one to finish, or use a cheap agent.` }
    }

    const r = await next(e.prompt.includes(MARK) ? e : { ...e, prompt: e.prompt + orders(e.prompt, o) })
    if (counted && r.agentId)
      await $.fs.write(expand(slotFile.startsWith("~") ? ((await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))) : undefined, slotFile), JSON.stringify([...live(await load($, slotFile), now), { id: r.agentId, at: now }]))
    return r
  })

  on('turn.complete', { reason: /[^]*|a{5}/ }, async ($, e, next) => {
    if (e.agentId && inScope(await $.session.cwd(), roots(options))) {
      const slots = await load($, slotFile)
      if (slots.some(s => s.id === e.agentId))
        await $.fs.write(expand(slotFile.startsWith("~") ? ((await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))) : undefined, slotFile), JSON.stringify(live(slots, await $.clock.now()).filter(s => s.id !== e.agentId)))
    }
    return next(e)
  })
}
