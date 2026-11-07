import type { Register, ToolSpec } from 'claude-code'

import { type Tier, dueTiers, parseTiers } from '../config'

const TOOL = 'mcp__stool__restart_session'

// The prompt waiting for the turn to end; module state is fine, /clear doesn't reload the module.
let pending: string | undefined
// optional model for /model, run after the clear and before the prompt
let model: string | undefined
// reload_plugins was called: the reloadNonce option is bumped when the turn ends, which reloads stool
// (/reload-plugins cannot be typed over Remote Control, and Claude cannot drive its own window)
const RELOAD = 'mcp__stool__reload_plugins'
let reload = false

export const RESTART_TOOL: ToolSpec = {
  name: 'restart_session',
  description:
    'Fresh context in this same session: once the current turn ends, runs /clear and submits `prompt` as the next user message. Permission mode, Remote Control and the session itself stay. Commit and write the handoff first; end the turn right after calling this. `model` is optional; switches this session to that model before the resume prompt.',
  inputSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Self-contained resume prompt for the fresh context' },
      model: { type: 'string', description: 'Optional; model alias or id ("sonnet", "opus", "claude-sonnet-5-5") to switch to before the prompt' },
    },
  },
  isDeferred: true,
}

export const RELOAD_TOOL: ToolSpec = {
  name: 'reload_plugins',
  description:
    'Reloads stool once the current turn ends by bumping its reloadNonce option (works locally and over Remote Control), so stool edits load without the user typing /reload-plugins. Reloads stool only, not other plugins. Call it only when the user asked for a reload or for a stool change to take effect.',
  inputSchema: { type: 'object', properties: {} },
  isDeferred: true,
}

// the standing lessons pass: every session-restart retrospective runs it; a review tier runs it deeper
export const LESSONS =
  "Lessons pass: turn each mistake made more than once into a dated one-line lesson in the `## Lessons` list of the project skill for that area (newest first, at most ~15: merge duplicates, fold durable ones into the skill's rules, drop stale ones). Where an area keeps needing the same instructions and has no skill, propose a new project skill to the user. A lesson hit twice becomes a check script, not more prose. Foot-guns: list what slows the work, each with its evidence (a time, a token count, a commit), and fix or assign each one."

const TIER_TEXT: Record<Tier['type'], (t: Tier, n: number) => string> = {
  'why-behind': (t, n) =>
    `Why-behind review ("${t.name}", restart ${n}, every ${t.every}): check the goal against the gap before continuing. For each goal metric the project tracks: its value now vs the target in absolute units, and how long since it last moved (handoff history, commits, results). Is the current work attacking the measured gap, or tuning around it? If the approach cannot reach the goal at its present rate, rethink the approach instead of tuning it. Tell the user the decision in two lines (with the project's notify command if they are away). Run the lessons pass over the last ${t.every} restarts.`,
  deep: (t, n) =>
    `Deep review ("${t.name}", restart ${n}, every ${t.every}): read the last ~${t.every} restarts' handoff history, the fix log, the project's skills with their Lessons, and the results. Find where time, tokens and tries went against the progress they bought, rules broken more than once that still have no check script, tools that broke or stalled, and work that drifted into small tuning. Write \`docs/research/deep_review_${n}.md\` with ranked fixes, the lessons pass (consolidate every skill's Lessons) and a foot-guns section; apply the cheap fixes, and send the user the top 3 with the project's notify command. Run it inline; dispatching strong-model agents for it needs the user's OK.`,
}

// the resume prompt with the review tiers due at restart `n` in front of it; unchanged when none is due
export function withReviews(prompt: string, tiers: Tier[], n: number) {
  const due = dueTiers(tiers, n)
  if (due.length === 0) return { text: prompt, due }
  const text = [`Restart ${n}: a review is due first (stool option reviewTiers), then the task below.`, ...due.map(t => TIER_TEXT[t.type](t, n)), LESSONS, `Then: ${prompt}`].join('\n\n')
  return { text, due }
}

export const COUNT_FILE = 'docs/restart_count.txt'

export const register: Register = (on, options) => {
  const tiers = parseTiers(options?.reviewTiers)
  on('session.start', { cwd: /[^]*|a{6}/ }, async ($, e, next) => {
    await $.tool.register(RESTART_TOOL)
    await $.tool.register(RELOAD_TOOL)
    return next(e)
  })

  on('tool.call', { tool: RELOAD }, async () => {
    reload = true
    return { result: 'Reload queued: stool reloads (reloadNonce bump) when this turn ends.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = (e as unknown as { prompt?: unknown }).prompt
    if (typeof prompt !== 'string' || !prompt.trim()) return { deny: 'restart_session: prompt is required.' }
    // the restart's number, bumped by session-restart in its handoff commit; a due tier goes in front of the prompt
    const cwd = await Promise.resolve().then(() => $.session.cwd()).catch(() => '.')
    const n = parseInt(await Promise.resolve().then(() => $.fs.read(`${cwd}/${COUNT_FILE}`)).catch(() => ''), 10)
    const r = withReviews(prompt, tiers, Number.isFinite(n) ? n : 0)
    pending = r.text
    const m = (e as unknown as { model?: unknown }).model
    model = undefined
    let note = ''
    if (typeof m === 'string' && m.trim()) {
      if (/^[\w.[\]-]+$/.test(m.trim())) {
        model = m.trim()
        note = ` The model switches to ${model} before the prompt.`
      } else note = ' The model was not changed (unrecognised model name).'
    }
    const review = r.due.length ? ` Restart ${n}: ${r.due.map(t => t.name).join(' + ')} review added in front of the prompt.` : ''
    return { result: `Restart queued: /clear and the resume prompt run when this turn ends.${review}${note} End the turn now.` }
  })

  on('turn.complete', { reason: /[^]*|a{7}/ }, async ($, e, next) => {
    const done = await next(e)
    if (reload) {
      reload = false
      // always bump the nonce: a changed option reloads stool, local or over Remote Control.
      // /reload-plugins is refused remotely and its refusal text never reached us (owner, 2026-11-07)
      $.clock.after(1000, async () => {
        const n = Math.floor((await $.clock.now()) / 1000)
        await $.config
          .set({ key: 'stool.reloadNonce', value: n })
          .then(r => $.ui.toast(r.deny ? `reload failed: ${r.deny}` : 'stool reloaded'))
          .catch((err: unknown) => $.ui.toast(`reload failed: ${String(err)}`))
      })
    }
    if (pending === undefined) return done
    const text = pending
    pending = undefined
    const m = model
    model = undefined
    // outside the turn's hooks: command.run and prompt.submit refuse to run inside a hook the turn waits on
    $.clock.after(1000, () => {
      void $.command
        .run({ command: 'clear' })
        .then(async () => {
          // an unknown model must not block the restart; /model answers with text or throws
          if (m) await $.command.run({ command: 'model', args: m }).catch(err => $.ui.toast(`model not changed: ${String(err)}`))
        })
        .then(() => $.prompt.submit({ text, asUser: true }))
        .catch(err => $.ui.toast(`fresh-restart failed: ${String(err)}`))
    })
    return done
  })
}
