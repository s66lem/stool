import type { EngineInterface, Register, ToolSpec } from 'claude-code'

import { type Tier, dueTiers, parseTiers } from '../config'
import { RELOAD_STAMP } from '../reload-stamp'

type $T = EngineInterface

const TOOL = 'mcp__stool__restart_session'

// The prompt waiting for the turn to end; module state is fine, /clear doesn't reload the module.
let pending: string | undefined
// optional model for /model, run after the clear and before the prompt
let model: string | undefined
let cleared = false // /clear (and /model) already ran for this restart; a retry only submits
let tries = 0 // submits made
let clearFails = 0
let trying = false
let busy = false // a (non-agent) turn is running
const MAX_TRIES = 5
const RETRY_MS = 4000
// Other plugins read this to hold their own wake-ups until the resume prompt is in (tripwire does; no import needed).
// { pending: true, at: ms } from the restart_session call until the prompt is submitted (or given up); then { pending: false }.
export const PENDING_FILE = '~/.claude/stool/restart-pending.json'
async function mark($: $T, pendingNow: boolean) {
  const home = ((await $.env.get('USERPROFILE').catch(() => undefined)) ?? (await $.env.get('HOME').catch(() => undefined))) as string | undefined
  const file = PENDING_FILE.startsWith('~') && home ? home.split(String.fromCharCode(92)).join('/') + PENDING_FILE.slice(1) : PENDING_FILE
  const at = await $.clock.now().catch(() => Date.now())
  await $.fs.write(file, JSON.stringify({ pending: pendingNow, at })).catch(() => undefined)
}
async function finish($: $T) {
  pending = undefined
  model = undefined
  cleared = false
  tries = 0
  clearFails = 0
  await mark($, false).catch(() => undefined)
}
// reload_plugins rewrites hooks/reload-stamp.ts: the plugin watcher (CLAUDE_CODE_PLUGIN_DIR_WATCH) reloads the module
// when a source file changes, before the next stool tool or at turn end. Works over Remote Control, where
// /reload-plugins is refused. ($.config.set cannot do it: the engine lists no row for the plugin's options, so
// 'stool.reloadNonce' is rejected; found 2026-11-07.)
const RELOAD = 'mcp__stool__reload_plugins'
// local runtime state (skip-worktree in git); the number means nothing, only that the file changed
const WRITE_STAMP = "require('fs').writeFileSync(process.argv[1], 'export const RELOAD_STAMP = ' + Date.now() + ' // rewritten by reload_plugins')"

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
    'Reloads stool once the current turn ends by rewriting a source file the plugin watcher reloads on (works locally and over Remote Control), so stool edits load without the user typing /reload-plugins. Reloads stool only, not other plugins. Call it only when the user asked for a reload or for a stool change to take effect.',
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

  on('tool.call', { tool: RELOAD }, async $ => {
    const res = await $.process.run(['node', '-e', WRITE_STAMP, $.plugin.root + '/hooks/reload-stamp.ts']).catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
    if (res.exitCode !== 0) return { result: `Reload failed: could not rewrite reload-stamp.ts (${String(res.stderr).trim().slice(0, 200)}).` }
    return { result: `Reload queued: stool reloads (reload-stamp rewritten, was ${RELOAD_STAMP}) before the next stool tool call or when this turn ends.` }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = (e as unknown as { prompt?: unknown }).prompt
    if (typeof prompt !== 'string' || !prompt.trim()) return { deny: 'restart_session: prompt is required.' }
    // the restart's number, bumped by session-restart in its handoff commit; a due tier goes in front of the prompt
    const cwd = await Promise.resolve().then(() => $.session.cwd()).catch(() => '.')
    const n = parseInt(await Promise.resolve().then(() => $.fs.read(`${cwd}/${COUNT_FILE}`)).catch(() => ''), 10)
    const r = withReviews(prompt, tiers, Number.isFinite(n) ? n : 0)
    pending = r.text
    cleared = false
    tries = 0
    clearFails = 0
    await mark($, true).catch(() => undefined)
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

  on('turn.start', { turnId: /[^]*|a{45}/ }, async (_$, e, next) => {
    if (e.agentId === undefined) busy = true
    return next(e)
  })

  on('turn.complete', { reason: /[^]*|a{7}/ }, async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    busy = false
    if (pending === undefined) return done
    // outside the turn's hooks: command.run and prompt.submit refuse to run inside a hook the turn waits on
    $.clock.after(1000, () => void attempt($))
    return done
  })
}

// One try at the restart: /clear and /model once, then the prompt. The prompt stays pending until a submit takes it, so a
// turn that started after the clear (a tripwire wake, 2026-11-08 restart #119) cannot lose it: the failed or refused
// submit is retried when that turn completes, or on a timer, MAX_TRIES times in all.
async function attempt($: $T) {
  const text = pending
  if (text === undefined || trying) return
  if (busy) return // a turn runs: its turn.complete tries again
  trying = true
  try {
    if (!cleared) {
      await $.command.run({ command: 'clear' })
      cleared = true
      // an unknown model must not block the restart; /model answers with text or throws
      if (model) await $.command.run({ command: 'model', args: model }).catch(err => $.ui.toast(`model not changed: ${String(err)}`))
    }
    if (busy) return // a wake turn began after the clear: its turn.complete submits
    tries++
    const r = (await $.prompt.submit({ text, asUser: true })) as { drop?: unknown } | undefined
    if (r && typeof r.drop === 'string') throw new Error(`dropped: ${r.drop}`)
    await finish($)
  } catch (err) {
    if (tries >= MAX_TRIES || (!cleared && ++clearFails >= MAX_TRIES)) {
      $.ui.toast(`fresh-restart failed, the resume prompt was NOT delivered: ${String(err)}`)
      await finish($)
    } else {
      $.ui.toast(`fresh-restart: ${String(err).slice(0, 120)}; trying again`)
      $.clock.after(RETRY_MS, () => void attempt($))
    }
  } finally {
    trying = false
  }
}
