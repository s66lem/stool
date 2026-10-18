import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SLOT_DEFAULT, expand, flag } from '../config'
import type { AgentRun, Plan, PlanStage, PlanState, PlanStep, StepStatus } from '../../types'

import { ribbonLines, stripCells, stripSvg as usageSvg, stripText as usageText, stripZones } from './strip'
import type { TermCell } from './strip'
import type { StripShow, Zone } from './strip'

const TOOL = 'mcp__stool__plan_progress'
const plans = atom({ plugin: 'stool', key: 'plans' } as const, [])
const MAX_BARS = 3
// a space as wide as a digit, so '  0%' and '100%' take the same room
const FIGURE_SPACE = String.fromCharCode(0x2007)
const isOpen = atom({ plugin: 'stool', key: 'isOpen' } as const, true)
const tick = atom({ plugin: 'stool', key: 'tick' } as const, 0)
// the usage strip's numbers, owned and written by the usage-pace and keep-warm mods
const usageRef = { plugin: 'stool', key: 'usage' } as const
const warmRef = { plugin: 'stool', key: 'warm' } as const
const restartRef = { plugin: 'stool', key: 'restart' } as const
const meterRef = { plugin: 'stool', key: 'meter' } as const
// dispatch-guard's slot file (every session); its entries older than 3 h are crashed agents. `slotFile` option.
let slotFile = SLOT_DEFAULT
const SLOT_EXPIRE_MS = 3 * 3600_000
async function liveSlots($: EngineInterface, now: number): Promise<{ used: number; cheap: number; codex: number } | undefined> {
  try {
    const v = JSON.parse(await $.fs.read(expand(slotFile.startsWith("~") ? ((await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))) : undefined, slotFile)))
    if (!Array.isArray(v)) return undefined
    const l = v.filter(s => now - Number(s?.at) < SLOT_EXPIRE_MS)
    const cheap = l.filter(s => s?.cheap === true).length
    const codex = l.filter(s => s?.codex === true).length
    return { used: l.length - cheap - codex, cheap, codex }
  } catch {
    return undefined // no file or no dispatch-guard: the strip shows the cap alone
  }
}
// the strip's inputs beyond usage-pace and keep-warm
// the `strip*` options (default on): which groups and details of the usage strip are drawn
const STRIP_OPTIONS: [keyof StripShow, string, string, string][] = [
  ['agents', 'stripAgents', 'Agents', 'running / cap'],
  ['weekly', 'stripWeekly', 'Weekly usage', 'percent used, time to reset'],
  ['five', 'stripFive', '5-hour usage', 'percent used, time to reset'],
  ['warm', 'stripWarm', 'Keep-warm', 'cache pings, or cold'],
  ['context', 'stripContext', 'Context', 'percent of the window used'],
  ['cheap', 'stripCheap', 'Cheap agents', 'the 1 in 1+2/4'],
  ['codex', 'stripCodex', 'Codex agents', 'cx1: Codex jobs running, not counted'],
  ['projection', 'stripProjection', 'Projection', 'where a window is heading, and when it runs out'],
  ['reset', 'stripReset', 'Time to reset', 'the | 2d3h after a percent'],
]
let stripShow: StripShow = {}
async function stripExtra($: EngineInterface, now: number) {
  return { ...(await liveSlots($, now)), restart: (await $.state.get(restartRef)).value, show: stripShow }
}
const STRIP_H = 16
const STRIP_GAP = 2
// rows of strips per bar, the "+N more" row included: the band above the prompt has room for about 300 px
const stripBudget = (bars: number) => (bars >= 3 ? 3 : bars === 2 ? 4 : 5)
const FOLD_MS = 5000 // finished strips stay this long, failed ones stay until the bar closes

// one lightness for every state (OKLCH L .55, hues of the desktop's violet, amber, red and green), so no state
// shouts louder than another, and white on each reads at 4.5:1 or better
const STATE_COLOR: Record<PlanState, string> = { running: '#7858CA', needs_input: '#AD6400', error: '#C5353E', done: '#18883A' }
const INK = '#FFFFFF'
const STATE_GLYPH: Record<PlanState, string> = { running: '●', needs_input: '?', error: '!', done: '✓' }
const STATUSES: StepStatus[] = ['pending', 'active', 'done', 'error', 'skipped']
const TRACK_H = 22
const NARROW = 360

const RULES = `# Progress bars
Tasks needing more than ~3 edits or commands get a bar via ${TOOL}: create it once with the full breakdown (2-7 stages of steps {title}, or kind "todo" for one flat list; titles of at most 4 words, in the user's language; the first open step becomes active), then move it with short calls: {id, next:true} when the active step is finished, or {id, done:[...], active:"..."}, {id, failed:"...", note}. When the plan changes, resend stages under the same id; steps sent without a status keep their done by title. Send state "needs_input" with a note before asking the user to decide. Never describe the bars to the user.`

type Raw = Record<string, unknown>
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const status = (v: unknown): StepStatus => (STATUSES.includes(v as StepStatus) ? (v as StepStatus) : 'pending')
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []) as Raw[]
const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// short updates: {next:true}, {done:[titles]}, {active:title}, {failed:title} against the stored plan;
// titles it cannot find come back in missing, so the call is refused instead of passing as a success
function applyOps(stages: PlanStage[], input: Raw, now: number): { stages: PlanStage[]; missing: string[] } {
  const next = stages.map(s => ({ ...s, steps: s.steps.map(st => ({ ...st })) }))
  const steps = next.flatMap(s => s.steps)
  const missing: string[] = []
  // a step finishing now remembers when, for the time its checkpoint shows
  const finish = (st: PlanStep) => {
    if (!isFinished(st.status)) Object.assign(st, { status: 'done', doneAt: now })
  }
  // a title used twice means the one still open
  const find = (title: string) => {
    const found = steps.find(st => same(st.title, title) && !isFinished(st.status)) ?? steps.find(st => same(st.title, title))
    if (!found) missing.push(title)
    return found
  }
  if (input.next === true) {
    const at = steps.findIndex(st => st.status === 'active') >= 0 ? steps.findIndex(st => st.status === 'active') : steps.findIndex(st => !isFinished(st.status))
    const cur = steps[at]
    if (cur) finish(cur)
    // past the last step, work goes back to one left open earlier
    const following = steps.slice(at + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
    if (following) following.status = 'active'
  }
  let lastDone = -1
  for (const t of Array.isArray(input.done) ? input.done : []) {
    const st = typeof t === 'string' ? find(t) : undefined
    if (st?.status === 'active') lastDone = steps.indexOf(st)
    if (st) finish(st)
  }
  // finishing the step in progress moves on, as next does, unless the call names the new one itself
  if (lastDone >= 0 && typeof input.active !== 'string' && !steps.some(st => st.status === 'active')) {
    const following = steps.slice(lastDone + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
    if (following) following.status = 'active'
  }
  const active = typeof input.active === 'string' ? find(input.active) : undefined
  if (active) {
    const at = steps.indexOf(active)
    steps.forEach((st, i) => {
      if (st.status === 'active' && i !== at) {
        if (i < at) finish(st)
        else st.status = 'pending'
      }
    })
    active.status = 'active'
  }
  const failed = typeof input.failed === 'string' ? find(input.failed) : undefined
  if (failed) failed.status = 'error'

  return { stages: next, missing }
}

// the new bar, or the refusal for a call that names steps the bar does not have
function normalize(input: Raw, prev: Plan | null, now: number, id: string): Plan | string {
  const sent = list(input.stages)
    .map(s => ({
      name: str(s.name, 80) || 'Stage',
      steps: list(s.steps).map(st => ({
        title: str(st.title) || 'Step',
        status: status(st.status),
        substeps: list(st.substeps).map(sub => ({ title: str(sub.title) || '…', status: status(sub.status) })),
      })),
    }))
    .filter(s => s.steps.length > 0) as PlanStage[]
  const isPartial = sent.length === 0 && prev !== null
  // a resent plan keeps what was finished; short ops sent along with it apply on top
  const base = isPartial ? prev.stages : pointAt(prev ? carryDone(sent, prev.stages) : sent)
  const { stages, missing } = applyOps(base, input, now)
  if (missing.length > 0 && base.length > 0) {
    const titles = stages.flatMap(s => s.steps.map(st => st.title)).join(', ')
    return `plan_progress: "${id}" has no step ${missing.map(t => `"${str(t, 60)}"`).join(', ')}. Its steps: ${titles.slice(0, 400)}`
  }
  const title = str(input.title, 80) || prev?.title || 'Plan'
  const steps = stages.flatMap(s => s.steps)
  const isAllDone = steps.length > 0 && steps.every(s => isFinished(s.status))
  const asked = input.state as PlanState
  const failedNow = typeof input.failed === 'string'
  const state: PlanState = ['running', 'needs_input', 'error', 'done'].includes(asked) ? asked : isAllDone ? 'done' : failedNow ? 'error' : 'running'

  return {
    id,
    title,
    kind: input.kind === 'todo' || (isPartial && prev?.kind === 'todo') ? 'todo' : 'plan',
    stages,
    state,
    note: str(input.note, 160) || null,
    startedAt: prev ? prev.startedAt : now,
    endedAt: state === 'done' ? (prev?.endedAt ?? now) : null,
  }
}

// a resent plan keeps what is finished: a step sent as pending under a title that was done stays done
function carryDone(stages: PlanStage[], before: PlanStage[]): PlanStage[] {
  const finished = new Map(before.flatMap(s => s.steps).filter(st => isFinished(st.status)).map(st => [st.title.trim().toLowerCase(), st]))
  return stages.map(s => ({
    ...s,
    steps: s.steps.map(st => {
      const was = finished.get(st.title.trim().toLowerCase())
      return was && (st.status === 'pending' || st.status === was.status) ? { ...st, status: was.status, doneAt: was.doneAt } : st
    }),
  }))
}

// with nothing in progress, the first open step is the current one
function pointAt(stages: PlanStage[]): PlanStage[] {
  const steps = stages.flatMap(s => s.steps)
  if (steps.some(st => st.status === 'active' || st.status === 'error')) return stages
  const first = steps.find(st => st.status === 'pending')
  return stages.map(s => ({ ...s, steps: s.steps.map(st => (st === first ? { ...st, status: 'active' as const } : st)) }))
}

// the bar an approved plan-mode plan lands on; a revised plan updates it instead of opening a second one
const PLAN_ID = 'plan'

const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(\d+[.)]|[-*+]|\[[ xX]\])\s+/, '')
    .replace(/^(\d+[.)]|\[[ xX]\])\s+/, '')
    .trim()

function parsePlan(markdown: string, now: number): Plan | null {
  let title = ''
  const headed: PlanStage[] = []
  const items: { depth: number; text: string; status: StepStatus }[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const text = clean(h[2] ?? '')
      if (h[1] === '#' && !title) title = text
      else headed.push({ name: text, steps: [] })
      continue
    }
    const li = line.match(/^(\s*)(\d+[.)]|[-*+])\s+(.*)$/)
    if (!li) continue
    const depth = Math.floor((li[1] ?? '').replace(/\t/g, '  ').length / 2)
    const text = clean(li[3] ?? '').slice(0, 120)
    if (!text) continue
    // a ticked box is a step the plan already counts as done
    const status: StepStatus = /^\[[xX]\]\s/.test(li[3] ?? '') ? 'done' : 'pending'
    items.push({ depth, text, status })
    const stage = headed[headed.length - 1]
    if (!stage) continue
    const step = stage.steps[stage.steps.length - 1]
    if (depth === 0 || !step) stage.steps.push({ title: text, status, substeps: [] })
    else step.substeps.push({ title: text, status })
  }
  let stages = headed.filter(s => s.steps.length > 0)
  if (stages.length === 0) {
    if (items.some(i => i.depth > 0)) {
      for (const item of items) {
        const stage = stages[stages.length - 1]
        if (item.depth === 0 || !stage) stages.push({ name: item.text, steps: [] })
        else stage.steps.push({ title: item.text, status: item.status, substeps: [] })
      }
      stages = stages.map(s => (s.steps.length ? s : { ...s, steps: [{ title: s.name, status: 'pending', substeps: [] }] }))
    } else if (items.length > 0) {
      stages = [{ name: 'Tasks', steps: items.map(i => ({ title: i.text, status: i.status, substeps: [] })) }]
    }
  }
  if (stages.length === 0) return null

  return { id: PLAN_ID, title: title || 'Plan', kind: stages.length === 1 ? 'todo' : 'plan', stages, state: 'running', note: null, startedAt: now }
}

function st(title: string, s: StepStatus): PlanStep {
  return { title, status: s, substeps: [] }
}

const DEMO = (now: number): Plan => ({
  id: 'demo',
  title: 'Orders module',
  kind: 'plan',
  state: 'running',
  note: null,
  startedAt: now - 260_000,
  stages: [
    { name: 'Analysis', steps: [st('Read modules', 'done'), st('Find dependencies', 'done'), st('List changes', 'done')] },
    { name: 'DB migration', steps: [st('Table schema', 'done'), st('Create migration', 'done'), st('Move data', 'active'), st('Indexes', 'pending')] },
    { name: 'API', steps: [st('Endpoints', 'pending'), st('Validation', 'pending'), st('Access rules', 'pending')] },
    { name: 'Interface', steps: [st('List page', 'pending'), st('Order card', 'pending'), st('Filters', 'pending'), st('Empty states', 'pending')] },
    { name: 'Verify', steps: [st('Tests', 'pending'), st('Build', 'pending')] },
  ],
})

// ---------- drawing ----------

type Where = { pos: number; total: number; stage: number; step: number; stageSize: number }

// pos counts the finished steps wherever they are; the current step is the active one, else the first still open
function where(p: Plan): Where {
  const steps = p.stages.flatMap((s, i) => s.steps.map((step, j) => ({ i, j, step })))
  const pos = p.state === 'done' ? steps.length : steps.filter(x => isFinished(x.step.status)).length
  const cur = p.state === 'done' ? undefined : (steps.find(x => x.step.status === 'active') ?? steps.find(x => !isFinished(x.step.status)))
  const stage = (cur ?? steps[steps.length - 1])?.i ?? 0

  return { pos, total: steps.length, stage, step: cur ? cur.j + 1 : (p.stages[stage]?.steps.length ?? 0), stageSize: p.stages[stage]?.steps.length ?? 0 }
}

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (a: number[], b: number[], m: number) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m))
const rgb = (c: number[]) => `rgb(${c.join(',')})`
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const hash = (a: number, b: number, k: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const textWidth = (s: string, px = 6.7) => [...s].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 12 : /[ilI.,:;'|!]/.test(ch) ? 3.4 : /[mwMWШЩЖМ]/.test(ch) ? 9.5 : px), 0)

const ICON_PATH: Partial<Record<PlanState, string>> = {
  needs_input: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  error: 'M18 6 6 18M6 6l12 12',
  done: 'M20 6 9 17l-5-5',
}

// how long each finished step took (from the previous finish, or the plan's start) and each finished stage
function stepTimes(p: Plan): { steps: Map<PlanStep, number>; stages: (number | undefined)[] } {
  const ends = p.stages.flatMap(s => s.steps).flatMap(st => (st.doneAt === undefined ? [] : [st.doneAt])).sort((a, b) => a - b)
  const startOf = (at: number) => Math.max(p.startedAt, ...ends.filter(t => t < at))
  const steps = new Map<PlanStep, number>()
  const stages = p.stages.map(s => {
    for (const st of s.steps) if (st.doneAt !== undefined) steps.set(st, st.doneAt - startOf(st.doneAt))
    const times = s.steps.map(st => st.doneAt)
    if (times.some(t => t === undefined)) return undefined
    const done = times as number[]
    return Math.max(...done) - Math.min(...done.map(startOf))
  })
  return { steps, stages }
}

// the 2 px dots of one look go into one path: a fraction of the markup of a rect each, and one node instead of thousands
function addDot(dots: Map<string, string>, cls: string, x: number, y: number) {
  dots.set(cls, `${dots.get(cls) ?? ''}M${x} ${y}h2v2h-2z`)
}

// last drawn head position per plan, so a redraw glides from where the bar was
const lastHead = new Map<string, number>()

// the track draws in a sandboxed frame (for hover); its page must stay see-through in either theme
const SEE_THROUGH = '<style>:root,html,body{background:transparent!important;color-scheme:light dark;margin:0;overflow:hidden}svg{display:block}</style>'

// a clock that counts in the frame by itself, so the drawing never has to be redrawn each second (a redraw
// reloads the frame and everything in it blinks): each digit is a reel of its figures behind a one-line window,
// stepped by a CSS animation whose negative delay is the time already run. Plain SVG, since the host's frame
// drops foreignObject. {{T:start}} becomes those seconds only when a bar's markup really changes (liveSource)
const CLOCK_W = 48 // "59m 59s"
const LINE = 16
const CLOCK_CSS = `.ckt{font-variant-numeric:tabular-nums}
.rs1{animation:r10 10s steps(10) var(--d) infinite}.rs10{animation:r6 60s steps(6) var(--d) infinite}
.cc{animation:cc 600s linear var(--d) both}@keyframes cc{0%,9.99%{transform:translateX(-13.5px)}10%,99.99%{transform:translateX(-3.25px)}100%{transform:none}}
.rm1{animation:r10 600s steps(10) var(--d) infinite}.rm10{animation:r10 6000s steps(10) var(--d) infinite}.rmm{animation:hm 60s steps(1,end) var(--d) both}
@keyframes r10{to{transform:translateY(-${LINE * 10}px)}}@keyframes r6{to{transform:translateY(-${LINE * 6}px)}}@keyframes hm{from{opacity:0}to{opacity:1}}`

// x is the clock's left edge, top the window's top; the minutes part stays hidden for the first minute
function liveClock(x: number, top: number, start: number, cls: string, textCls: string, isCentered = false): string {
  const base = top + 12
  const reel = (cx: number, figures: string[], reelCls: string) =>
    `<g class="${reelCls}"><text class="${textCls} ckt" text-anchor="middle">${figures
      .map((f, i) => `<tspan x="${cx.toFixed(1)}" y="${base + i * LINE}">${f}</tspan>`)
      .join('')}</text></g>`
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  const id = `ck${start}x${Math.round(x)}y${Math.round(top)}`
  return (
    `<style>.${id}{--d:-{{T:${start}}}s}</style><g class="${cls} ${id}"><clipPath id="${id}"><rect x="${(x - 2).toFixed(1)}" y="${top}" width="${CLOCK_W + 4}" height="${LINE}"/></clipPath>` +
    `<g clip-path="url(#${id})"${isCentered ? ' class="cc"' : ''}><g class="rmm">${reel(x + 3.5, ['', ...digits.slice(1)], 'rm10')}${reel(x + 10.5, digits, 'rm1')}` +
    `<text x="${(x + 14).toFixed(1)}" y="${base}" class="${textCls}">m</text></g>` +
    `${reel(x + 31, digits.slice(0, 6), 'rs10')}${reel(x + 38, digits, 'rs1')}<text x="${(x + 41.5).toFixed(1)}" y="${base}" class="${textCls}">s</text></g></g>`
  )
}

// a bar's frame reloads whenever its markup changes; markup that differs only in when it was drawn keeps the
// source already shown, so its clocks run on instead of the frame blinking
const lastSource = new Map<string, { template: string; source: string }>()
function liveSource(id: string, template: string, now: number): string {
  const last = lastSource.get(id)
  if (last?.template === template) return last.source
  const source = template.replace(/\{\{T:(\d+)\}\}/g, (_, t: string) => Math.max(0, (now - Number(t)) / 1000).toFixed(1))
  lastSource.set(id, { template, source })
  return source
}

// a bar is drawn twice: the track itself as a plain picture, which the desktop keeps steady whatever else redraws,
// and a see-through layer on top for the hover parts (checkpoint times, the pill's clock). That layer needs an
// interactive frame, and the desktop rebuilds such frames on every redraw of the band; empty until hovered, the
// rebuild is invisible. A plan is immutable, so both drawings at one width are reused until the plan changes
type Track = { base: string; overlay: string }
const drawn = new WeakMap<Plan, { W: number; track: Track }>()

function trackSvg(p: Plan, W: number): Track {
  const cached = drawn.get(p)
  if (cached?.W === W) return cached.track
  const track = drawTrack(p, W)
  drawn.set(p, { W, track })
  return track
}

function drawTrack(p: Plan, W: number): Track {
  const H = TRACK_H
  const w = where(p)
  const done = p.state === 'done'
  // the fill is exactly the finished share: a fresh plan starts empty
  const frac = done ? 1 : Math.min(1, w.pos / Math.max(1, w.total))
  const fx = frac * W
  const key = p.id
  const from = lastHead.get(key) ?? fx
  lastHead.set(key, fx)

  const acc = hex(STATE_COLOR[p.state])
  const light = mix(acc, [255, 255, 255], 0.32)
  const grey = [132, 130, 138]
  const ease = 'calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"'
  const glide = Math.abs(from - fx) > 0.5

  const bounds: number[] = []
  let acc2 = 0
  p.stages.forEach((s, i) => {
    acc2 += s.steps.length
    if (i < p.stages.length - 1) bounds.push((acc2 / w.total) * W)
  })

  // pixels: 3px grid, 7 rows, denser towards the head, twinkling and warming from grey to the state colour
  const buckets = [0, 1, 2, 3, 4].map(b => {
    const m = b / 4
    const dense = 0.22 + 0.78 * Math.pow(m, 1.5)
    return { color: rgb(mix(grey, light, m)), opacity: (0.35 + 0.65 * dense).toFixed(2) }
  })
  const dots = new Map<string, string>()
  for (let col = 0; col * 3 < fx; col++) {
    const x = col * 3
    const u = Math.min(1, (x + 1.5) / fx)
    const dense = 0.22 + 0.78 * Math.pow(u, 1.5)
    const bucket = Math.min(4, Math.floor(Math.min(1, Math.pow(u, 0.9) * 1.1) * 4.99))
    for (let r = 0; r < 7; r++) {
      if (hash(col, r, 1) > dense + 0.1) continue
      addDot(dots, `b${bucket} t${Math.floor(hash(col, r, 2) * 4)}`, x, 1 + r * 3)
    }
  }
  const px = [...dots].map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join('')

  const took = stepTimes(p)
  const tipRules: string[] = []
  let marks = ''
  let hits = ''
  let tips = ''
  let k = 0
  p.stages.forEach((s, i) => {
    s.steps.forEach((_, j) => {
      if (k > 0) {
        const x = (k / w.total) * W
        const isStage = j === 0
        // a stage boundary is a short capsule, a step a dot; bright once passed
        const passed = x < fx - 1
        const fill = passed ? rgb(mix(light, [255, 255, 255], 0.45)) : '#A8A69E'
        const opacity = passed ? (isStage ? 0.95 : 0.8) : isStage ? 0.75 : 0.6
        marks += isStage
          ? `<rect x="${(x - 1.5).toFixed(1)}" y="${(H - 10) / 2}" width="3" height="10" rx="1.5" fill="${fill}" opacity="${opacity}"/>`
          : `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="1.4" fill="${fill}" opacity="${opacity}"/>`
        const before = p.stages[isStage ? i - 1 : i]
        const ended = isStage ? before?.steps[before.steps.length - 1] : s.steps[j - 1]
        const label = isStage ? (before?.name ?? '') : (ended?.title ?? '')
        const ms = isStage ? took.stages[i - 1] : took.steps.get(ended as PlanStep)
        const text = ms === undefined ? label : `${label} · ${elapsed(ms)}`
        const tw = textWidth(text, 6.2) + 16
        const tx = Math.max(0, Math.min(W - tw, x - tw / 2))
        hits += `<rect class="h${k}" x="${(x - 5).toFixed(1)}" width="10" height="${H}" fill="#000" fill-opacity="0"/>`
        tips += `<g class="tp p${k}"><rect x="${tx.toFixed(1)}" y="2" width="${tw.toFixed(1)}" height="${H - 4}" rx="${(H - 4) / 2}" fill="#1F1E1D" fill-opacity=".94"/><text x="${(tx + 8).toFixed(1)}" y="${H / 2 + 3.8}" class="tt">${esc(text)}</text></g>`
        tipRules.push(`.h${k}:hover~.p${k}`)
      }
      k++
    })
    void i
  })

  // knob: a pill with stage and count, or a round dot with the stage number when narrow
  const isNarrow = W < NARROW
  const color = STATE_COLOR[p.state]
  const icon = ICON_PATH[p.state]
  const single = p.stages.length === 1
  const number = single ? w.step : w.stage + 1
  let knob = ''
  let timePill = ''
  let kw = H
  if (isNarrow) {
    const label = done ? '' : String(number)
    knob = `<circle cx="0" cy="${H / 2}" r="${H / 2}" fill="${color}"/>${
      done ? `<path d="${ICON_PATH.done}" transform="translate(-6 5) scale(.5)" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : `<text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${label}</text>`
    }`
  } else {
    const name = done ? (p.endedAt ? elapsed(p.endedAt - p.startedAt) : 'Done') : single ? (p.stages[0]?.name ?? 'Tasks') : (p.stages[w.stage]?.name ?? '')
    // the pill carries the stage name alone; the fill and the percent already say how far along it is
    const count = ''
    const iconW = icon ? 16 : 0
    const countW = count ? textWidth(count, 6.5) : -6
    const maxW = Math.max(80, W * 0.55)
    let shown = name
    while (shown.length > 3 && 20 + iconW + textWidth(shown) + 6 + countW > maxW) shown = shown.slice(0, -1)
    if (shown !== name) shown = shown.trimEnd() + '…'
    // a running pill is wide enough for its clock too, so the hover swap does not change its size
    const textW = done ? textWidth(shown) : Math.max(textWidth(shown), CLOCK_W)
    kw = Math.round(20 + iconW + textW + 6 + countW)
    const left = -(iconW + textW) / 2
    const mid = left + iconW + textW / 2
    knob = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>`
    if (icon) knob += `<path d="${icon}" transform="translate(${left.toFixed(1)} 5) scale(.5)" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`
    knob += `<text x="${mid.toFixed(1)}" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${esc(shown)}${count ? `<tspan class="kc" dx="6">${count}</tspan>` : ''}</text>`
    // hovering the pill lays a copy of it over the stage name, carrying the time the plan has run so far
    if (!done) {
      const face = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>${
        icon ? `<path d="${icon}" transform="translate(${left.toFixed(1)} 5) scale(.5)" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''
      }`
      timePill = `<g class="kb"><rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" fill="#000" fill-opacity="0"/><g class="kv">${face}${liveClock(mid - CLOCK_W / 2, 3, p.startedAt, 'kc0', 'kt', true)}</g></g>`
    }
  }
  const clampX = (x: number) => Math.max(kw / 2, Math.min(W - kw / 2, x))
  const kx = clampX(fx)
  const kFrom = clampX(from)

  const style = `<style>
.b0{fill:${buckets[0]?.color};fill-opacity:${buckets[0]?.opacity}}.b1{fill:${buckets[1]?.color};fill-opacity:${buckets[1]?.opacity}}
.b2{fill:${buckets[2]?.color};fill-opacity:${buckets[2]?.opacity}}.b3{fill:${buckets[3]?.color};fill-opacity:${buckets[3]?.opacity}}
.b4{fill:${buckets[4]?.color};fill-opacity:${buckets[4]?.opacity}}
.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}
.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}
.kt{font:500 12px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:${INK}}
.kc{font-weight:400;fill-opacity:.75}
@media (prefers-reduced-motion:reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>`
  const hoverStyle = `<style>
.tp{opacity:0;transition:opacity .12s;pointer-events:none}${tipRules.length ? `${tipRules.join(',')}{opacity:1}` : ''}
.tt{font:400 11px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:#F0EEFC}
.kt{font:500 12px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:${INK}}
.kv{opacity:0;filter:blur(3px);transition:opacity .2s,filter .2s}.kb:hover .kv{opacity:1;filter:none}
.kb,rect[class^="h"]{cursor:pointer}
${CLOCK_CSS}
</style>`
  const glideFill = glide ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur=".45s" ${ease} fill="freeze"/>` : ''
  const glideKnob = glide ? `<animateTransform attributeName="transform" type="translate" from="${kFrom.toFixed(1)} 0" to="${kx.toFixed(1)} 0" dur=".45s" ${ease} fill="freeze"/>` : ''

  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  const base = `${open}${style}
<defs><clipPath id="pill"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill"><rect width="${fx.toFixed(1)}" height="${H}">${glideFill}</rect></clipPath>
<linearGradient id="base" x1="0" x2="${fx.toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity=".05"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity=".33"/></linearGradient></defs>
<g clip-path="url(#pill)"><rect width="${W}" height="${H}" fill="#808080" fill-opacity=".16"/>
<g clip-path="url(#fill)"><rect width="${fx.toFixed(1)}" height="${H}" fill="url(#base)"/>${px}</g>${marks}</g>
<g transform="translate(${kx.toFixed(1)} 0)">${glideKnob}${knob}</g></svg>`
  // the hover layer: checkpoint areas under the pill's copy, so the pill wins where they meet; tips on top
  const overlay = `${open}${SEE_THROUGH}${hoverStyle}${hits}<g transform="translate(${kx.toFixed(1)} 0)">${timePill}</g>${tips}</svg>`

  return { base, overlay }
}

const AGENT_COLOR: Record<AgentRun['state'], string> = {
  running: STATE_COLOR.running,
  waiting: STATE_COLOR.needs_input,
  done: STATE_COLOR.done,
  error: STATE_COLOR.error,
}

// the desktop drops an Svg whose alt is empty, so every drawing says what it shows
function stripAlt(p: Plan, key: string): string {
  const a = (p.agents ?? []).find(x => x.id === key)
  return a ? `agent ${a.title}: ${a.state}, ${a.tool}` : 'more agents'
}

const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec}s`
  return sec < 3600 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

// which strips show: all of a small batch; in a big one the unfinished first, the rest folded into one line
function visibleAgents(p: Plan, now: number, max: number): { shown: AgentRun[]; hidden: AgentRun[] } | null {
  const list = p.agents ?? []
  if (list.length === 0) return null
  const hasError = list.some(a => a.state === 'error')
  if (p.agentsDoneAt && now - p.agentsDoneAt > FOLD_MS && !hasError) return null
  if (list.length <= max) return { shown: list, hidden: [] }
  const keep = new Set(list.filter(a => a.state !== 'done').slice(0, max - 1).map(a => a.id))
  for (const a of [...list].reverse()) {
    if (keep.size >= max - 1) break
    keep.add(a.id)
  }
  return { shown: list.filter(a => keep.has(a.id)), hidden: list.filter(a => !keep.has(a.id)) }
}

// what each strip showed last time it was drawn, so a change morphs from the old status instead of jumping
const lastStrip = new Map<string, { tool: string; color: string }>()
const MORPH = '.2s'

// a strip's markup per agent object: drawn once per change, so its morph plays once and later redraws match
const drawnRows = new WeakMap<AgentRun, { key: string; html: string }>()


// one tinted strip per agent: state colour, name, what it does now and for how long; not a progress bar
// Lucide "bot", drawn at 12 px in the gutter before each strip
const BOT = '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2"/>'
const GUTTER = 36 // icon and agent number, left of the strip

// claude-haiku-4-5-20251001 -> haiku 4.5; an alias stays as given
const modelName = (m: string) => {
  const r = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(m)
  return r ? `${r[1]} ${r[2]}.${r[3]}` : m
}

// the agent's name, its model and effort in a dimmer parenthesis
const nameMarkup = (name: string) => {
  const at = name.indexOf(' (')
  return at > 0 ? `${esc(name.slice(0, at))}<tspan class="st">${esc(name.slice(at))}</tspan>` : esc(name)
}

// one tinted strip per agent behind a bot icon and its number: the colour says how it went,
// the word says what it does now (only while it runs or waits), the time how long it took
type StripRow = { key: string; html: string; height: number }

// each strip is its own drawing, so a change to one agent redraws that strip alone, never the bar or the others
function stripsSvg(v: { shown: AgentRun[]; hidden: AgentRun[] }, all: AgentRun[], W: number, calls: Map<string, string>): StripRow[] {
  const isNarrow = W < NARROW
  const SW = W - GUTTER
  const rows: StripRow[] = []
  const gutter = (y: number, label: string, color: string) =>
    `<g transform="translate(1 ${y + 2}) scale(.5)" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${BOT}</g>` +
    `<text x="16" y="${y + 11.5}" class="sn sg" style="fill:${color}">${label}</text>`
  v.shown.forEach((a, i) => {
    // the first strip keeps a little room from the track above it
    const y = i === 0 ? 5 : STRIP_GAP
    const live = a.state === 'running' || a.state === 'waiting'
    const count = live ? calls.get(a.id) : undefined
    const rowKey = `${W}|${y}|${all.indexOf(a)}|${count ?? ''}`
    const cachedRow = drawnRows.get(a)
    if (cachedRow?.key === rowKey) {
      rows.push({ key: a.id, html: cachedRow.html, height: y + STRIP_H })
      return
    }
    const c = AGENT_COLOR[a.state]
    const indent = a.depth > 0 ? 10 : 0
    const word = a.state === 'running' || a.state === 'waiting' ? a.tool : ''
    const dots = new Map<string, string>()
    if (a.state === 'running') {
      for (let col = 0; col * 3 < SW; col++) {
        for (let r = 0; r < 4; r++) {
          if (hash(col + i * 41, r, 5) > 0.2) continue
          addDot(dots, `t${Math.floor(hash(col, r, 6) * 4)}`, GUTTER + col * 3, Math.round((y + 2.5 + r * 3.2) * 10) / 10)
        }
      }
    }
    const px = [...dots].map(([cls, d]) => `<path class="${cls}" fill="${c}" fill-opacity=".32" d="${d}"/>`).join('')
    // right side, right to left: the clock, the note (sweep, calls/cap), the tool word; the name takes the rest
    //
    const pr = a.progress && live ? a.progress : null
    const note = [pr ? `${pr.label.slice(0, 24)} ${pr.done}/${pr.total}` : '', count ?? ''].filter(Boolean).join(' · ')
    const noteW = note && !isNarrow ? textWidth(note, 6.2) + 8 : 0
    const toolEnd = W - 9 - CLOCK_W - 8 - noteW
    const wordW = word && !isNarrow ? textWidth(word, 6.2) + 10 : 0
    const nameX = GUTTER + 19 + indent
    const nameRoom = isNarrow ? SW - 24 - indent : toolEnd - wordW - nameX - 4
    const effort = a.effort ? ({ medium: 'med', ultracode: 'ultra' } as Record<string, string>)[a.effort] ?? a.effort : ''
    const spec = [a.model ? modelName(a.model) : '', effort].filter(Boolean).join(' · ')
    // the title is shortened first so the model and effort stay whole
    const tail = spec ? ` (${spec})` : ''
    let title = (a.depth > 0 ? '↳ ' : '') + a.title
    const fits = (t: string) => textWidth(t + tail, 6.2) <= nameRoom
    if (!fits(title)) {
      while (title.length > 4 && !fits(title + '…')) title = title.slice(0, -1)
      title = title.trimEnd() + '…'
    }
    let name = title + tail
    while (name.length > 4 && textWidth(name, 6.2) > nameRoom) name = name.slice(0, -1)
    const time =
      a.endedAt === null
        ? liveClock(W - 9 - CLOCK_W, y, a.startedAt, 'sc', 'sn st')
        : // a finished strip's ✕ sits outside the track, in the bar's ✕ column (the bar's render)
          `<text x="${W - 9}" y="${y + 11.5}" text-anchor="end" class="sn st">${elapsed(a.endedAt - a.startedAt)}</text>`
    // a status change: the old word blurs out while the new one blurs in, and the tint flows to the new colour
    const was = lastStrip.get(a.id)
    lastStrip.set(a.id, { tool: word, color: c })
    const isWordChanged = was !== undefined && was.tool !== word
    const flow = (attr: string) => (was && was.color !== c ? `<animate attributeName="${attr}" from="${was.color}" to="${c}" dur="${MORPH}" fill="freeze"/>` : '')
    const tool = isNarrow
      ? ''
      : (isWordChanged && was.tool ? `<text x="${toolEnd}" y="${y + 11.5}" text-anchor="end" class="sn mo" style="fill:${was.color}">${esc(was.tool)}</text>` : '') +
        (word ? `<text x="${toolEnd}" y="${y + 11.5}" text-anchor="end" class="sn${isWordChanged ? ' mi' : ''}" style="fill:${c}">${esc(word)}</text>` : '') +
        time
    // fork: a sweep's progress, a thin bar along the strip's lower edge; the note sits just before the clock
    const sweep = (pr
      ? `<rect x="${GUTTER + 8 + indent}" y="${y + STRIP_H - 3}" width="${SW - 16 - indent}" height="1.5" rx=".75" fill="${c}" fill-opacity=".25"/>` +
        `<rect x="${GUTTER + 8 + indent}" y="${y + STRIP_H - 3}" width="${((SW - 16 - indent) * Math.min(1, pr.done / Math.max(1, pr.total))).toFixed(1)}" height="1.5" rx=".75" fill="${c}"/>`
      : '') +
      (note && !isNarrow ? `<text x="${W - 9 - CLOCK_W - 8}" y="${y + 11.5}" text-anchor="end" class="sn st">${esc(note)}</text>` : '')
    const html =
      gutter(y, String(a.n ?? all.indexOf(a) + 1), '#A8A69E') +
      `<rect x="${GUTTER}" y="${y}" width="${SW}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="${c}" fill-opacity=".15">${flow('fill')}</rect>${px}` +
      `<circle cx="${GUTTER + 10 + indent}" cy="${y + STRIP_H / 2}" r="3" fill="${c}"${a.state === 'running' ? ' class="sd"' : ''}>${flow('fill')}</circle>` +
      `<text x="${nameX}" y="${y + 11.5}" class="sn">${nameMarkup(name)}</text>` +
      tool +
      sweep
    drawnRows.set(a, { key: rowKey, html })
    rows.push({ key: a.id, html, height: y + STRIP_H })
  })
  if (v.hidden.length > 0) {
    const y = v.shown.length === 0 ? 5 : STRIP_GAP
    const doneCount = v.hidden.filter(a => a.state === 'done').length
    rows.push({
      key: '+',
      height: y + STRIP_H,
      html:
        gutter(y, `+${v.hidden.length}`, '#8A8984') +
        `<rect x="${GUTTER}" y="${y}" width="${SW}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="#808080" fill-opacity=".14"/>` +
        `<text x="${GUTTER + 10}" y="${y + 11.5}" class="sn st">${plural(v.hidden.length, 'more agent')} · ${doneCount} done</text>`,
    })
  }
  return rows
}

const STRIP_STYLE = `<style>.sn{font:400 11.5px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:#F0EEFC}.st{fill-opacity:.65}.sg{font-weight:500;font-variant-numeric:tabular-nums}
.sd{animation:sp 1.1s ease-in-out infinite}@keyframes sp{50%{opacity:.3}}
.mi{animation:mi ${MORPH} ease-out both}@keyframes mi{from{opacity:0;filter:blur(3px)}}
.mo{animation:mo ${MORPH} ease-in both}@keyframes mo{to{opacity:0;filter:blur(3px)}}
.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}
${CLOCK_CSS}
@media (prefers-reduced-motion:reduce){.sd,.mi,.mo,.t0,.t1,.t2,.t3{animation:none}.mo{opacity:0}}</style>`

// the strip's hover layer: an invisible hit box per item, its card faded in only after the pointer rests 0.5 s
export const TIP_DELAY = 0.5
export function stripTips(zones: Zone[], W: number, H: number): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
  const cards = zones.map(z => {
    const label = z.tip.map(t => t.text).join(' ')
    const w = Math.round(textWidth(`${label} · ${z.mod}`, 6.2)) + 14
    const x = Math.max(0, Math.min(z.x + (z.w - w) / 2, W - w))
    const spans = z.tip.map((t, i) => `<tspan fill="${t.fill}">${i ? ' ' : ''}${esc(t.text)}</tspan>`).join('')
    return (
      `<g class="z"><rect x="${z.x.toFixed(1)}" width="${z.w.toFixed(1)}" height="${H}" fill="transparent"/>` +
      `<g class="c"><rect x="${x.toFixed(1)}" width="${w}" height="${H}" rx="4" fill="#30302E"/>` +
      `<text x="${(x + w / 2).toFixed(1)}" y="${H / 2}" text-anchor="middle" dominant-baseline="central" class="sn" xml:space="preserve">${spans}<tspan fill="#7A7974"> · ${esc(z.mod)}</tspan></text></g></g>`
    )
  })
  const css = `<style>.c{opacity:0;pointer-events:none;transition:opacity .12s}.z:hover .c{opacity:1;transition-delay:${TIP_DELAY}s}</style>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${SEE_THROUGH}${STRIP_STYLE}${css}${cards.join('')}</svg>`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ---------- engine glue ----------

// the engine's player first (afplay on macOS); PowerShell where it cannot play
// set while a demo reel records: every sound with its moment, so a video can carry them
let soundLog: { at: number; name: string }[] | null = null

function play($: EngineInterface, name: 'decision' | 'error' | 'done') {
  if (soundLog) void $.clock.now().then(at => soundLog?.push({ at, name }))
  const file = `${$.plugin.root}/sounds/${name}.wav`.replace(/\//g, '\\')
  const viaPowerShell = () =>
    $.process
      .run(['powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`], { timeoutMs: 5000 })
      .catch(() => undefined)
  // on Windows the engine's player can report success and stay silent, so the system player plays it directly
  if (/^[A-Za-z]:/.test($.plugin.root)) {
    void viaPowerShell()
    return
  }
  void $.audio.play({ asset: `sounds/${name}.wav` }).catch(viaPowerShell)
}

// the agents bar is the mod's own; the model never owes it an update
const AGENTS = 'agents:auto' // slug() never yields ':', so no model id can take it
const isOpenPlan = (p: Plan) => p.id !== AGENTS && p.state === 'running' && !p.stages.flatMap(s => s.steps).every(s => isFinished(s.status))

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'plan'

// adds or replaces one bar by id; keeps at most MAX_BARS, dropping finished ones first
// computed inside update() from the latest list, so concurrent writers (parallel agents) do not drop each other
function placeBar(list: readonly Plan[], next: Plan): Plan[] {
  const prev = list.find(p => p.id === next.id)
  // an update keeps its row and, unless it brings its own, the agent strips already on it; a new bar goes to the bottom
  const kept = prev && !('agents' in next) ? { ...next, agents: prev.agents, agentsDoneAt: prev.agentsDoneAt } : next
  const rest = prev ? list.map(p => (p.id === next.id ? kept : p)) : [...list, next]
  while (rest.length > MAX_BARS) {
    const doneAt = rest.findIndex(p => p.state === 'done')
    rest.splice(doneAt >= 0 ? doneAt : 0, 1)
  }
  return rest
}

function chime($: EngineInterface, prev: PlanState | undefined, next: PlanState) {
  if (next === prev) return
  if (next === 'needs_input') play($, 'decision')
  if (next === 'error') play($, 'error')
  if (next === 'done') play($, 'done')
}

async function putPlan($: EngineInterface, next: Plan) {
  await editPlan($, next.id, () => next)
}

// builds a bar from the latest stored one inside update(), so back-to-back calls never work from a stale copy;
// make returns a string to refuse, and the list stays as it was
async function editPlan($: EngineInterface, id: string, make: (prev: Plan | null) => Plan | string): Promise<Plan | string> {
  let prev: Plan | undefined
  let made = '' as Plan | string
  await update($, plans, list => {
    prev = list.find(p => p.id === id)
    made = make(prev ?? null)
    return typeof made === 'string' ? [...list] : placeBar(list, made)
  })
  if (typeof made === 'string') return made
  chime($, prev?.state, made.state)
  if (!prev) await update($, isOpen, () => true)
  return made
}

// ---------- agents: drawn from engine events alone, no model calls ----------
// each subagent lives on a bar as one state strip: the open task bar it was started under,
// the bar of its parent agent, or the mod's own "Agents" bar when no task is open.
// Module maps: a reload forgets running agents, whose strips then stay until the bar is closed.
const agentHome = new Map<string, string>() // agentId -> bar id
const toolUses = new Map<string, string>() // tool_use_id -> agentId, to find who waits on a permission
const waiting = new Set<string>()
let lastUsed: string | undefined // dispatch-guard slots seen at the last poll
let foldUntil = 0 // keep ticking until finished strips have folded

// the mod's own bar mirrors its agents as steps, finished first, so percent and count read done/total
function syncAuto(p: Plan, now: number): Plan {
  const agents = p.agents ?? []
  const isOver = agents.length > 0 && agents.every(a => a.state === 'done' || a.state === 'error')
  const agentsDoneAt = isOver ? (p.agentsDoneAt ?? now) : null
  if (p.id !== AGENTS) return { ...p, agentsDoneAt }
  const rank = (a: AgentRun) => (a.state === 'done' ? 0 : a.state === 'error' ? 1 : 2)
  const steps: PlanStep[] = [...agents]
    .sort((a, b) => rank(a) - rank(b))
    .map(a => ({ title: a.title, status: a.state === 'done' ? 'done' : a.state === 'error' ? 'error' : 'active', substeps: [] }))
  const state: PlanState = isOver
    ? agents.some(a => a.state === 'error') ? 'error' : 'done'
    : agents.some(a => a.state === 'waiting') ? 'needs_input' : 'running'
  return { ...p, agentsDoneAt, stages: [{ name: 'Agents', steps }], state }
}

function addRun(p: Plan, run: AgentRun, parentId: string | undefined, now: number): Plan {
  // a batch that has finished makes room for the next one
  const list = p.agentsDoneAt ? [] : [...(p.agents ?? [])]
  let at = list.length
  const parentAt = parentId ? list.findIndex(a => a.id === parentId) : -1
  if (parentAt >= 0) {
    at = parentAt + 1
    while (at < list.length && (list[at]?.depth ?? 0) > 0) at++
  }
  list.splice(at, 0, { ...run, n: list.reduce((m, a, i) => Math.max(m, a.n ?? i + 1), 0) + 1 })
  return syncAuto({ ...p, agents: list, agentsDoneAt: null }, now)
}

// changes one agent's strip inside the latest list; sounds follow the bar's state
async function editAgent($: EngineInterface, agentId: string, change: (a: AgentRun) => AgentRun) {
  // after a plugin reload agentHome is empty: the stored bars say where the strip lives
  const home = agentHome.get(agentId) ?? (await read($, plans)).find(p => p.agents?.some(a => a.id === agentId))?.id
  if (!home) return
  const now = await $.clock.now()
  let before: PlanState | undefined
  let after: PlanState | undefined
  let isFolding = false
  await update($, plans, list =>
    list.map(p => {
      if (p.id !== home || !p.agents?.some(a => a.id === agentId)) return p
      before = p.state
      const next = syncAuto({ ...p, agents: p.agents.map(a => (a.id === agentId ? change(a) : a)) }, now)
      after = next.state
      isFolding = !p.agentsDoneAt && next.agentsDoneAt !== null
      return next
    }),
  )
  if (isFolding) foldUntil = now + FOLD_MS + 200
  if (before !== undefined && after !== undefined) chime($, before, after)
}

// module maps outlive the bars they describe: a bar pushed out past MAX_BARS, a cleared list, an agent
// whose finish never arrived (killed, or started before a reload); drop what no bar holds any more
function forgetGone(list: readonly Plan[]) {
  const bars = new Set(list.map(p => p.id))
  const live = new Set(list.flatMap(p => (p.agents ?? []).filter(a => a.state === 'running' || a.state === 'waiting').map(a => a.id)))
  const shown = new Set(list.flatMap(p => (p.agents ?? []).map(a => a.id)))
  for (const id of lastHead.keys()) if (!bars.has(id)) lastHead.delete(id)
  for (const id of glide.keys()) if (!bars.has(id)) glide.delete(id)
  for (const id of stillPhase.keys()) if (!bars.has(id)) stillPhase.delete(id)
  for (const id of lastSource.keys()) {
    const [bar, strip] = id.split('/')
    if (!bars.has(bar ?? '') || (strip !== undefined && strip !== '+' && !shown.has(strip))) lastSource.delete(id)
  }
  for (const id of lastStrip.keys()) if (!shown.has(id)) lastStrip.delete(id)
  for (const [id, home] of agentHome) {
    if (bars.has(home) && live.has(id)) continue
    agentHome.delete(id)
    waiting.delete(id)
  }
}

// A strip still running that the engine no longer lists (or lists as ended) lost its finish to a plugin reload or an
// app restart: close it, or it stays "running" forever. A truly running agent is always listed.
async function reapStale($: EngineInterface, list: readonly Plan[]) {
  const live = list.flatMap(p => p.agents ?? []).filter(a => a.state === 'running' || a.state === 'waiting')
  if (live.length === 0) return
  const now = await $.clock.now()
  const status = new Map((await $.agent.list()).map(a => [a.id, a.status]))
  for (const a of live) {
    const st = status.get(a.id)
    if (now - a.startedAt < 5000 || (st !== undefined && st !== 'completed' && st !== 'failed' && st !== 'killed')) continue
    const isFailed = st === 'failed' || st === 'killed'
    await editAgent($, a.id, x => ({ ...x, state: isFailed ? 'error' : 'done', tool: st === 'killed' ? 'Stopped' : isFailed ? 'Failed' : 'Done', endedAt: now, progress: undefined }))
  }
}

async function dropPlan($: EngineInterface, id: string, leftAt?: number) {
  let gone = null as Plan | null
  await update($, plans, list => {
    gone = list.find(p => p.id === id && (leftAt === undefined || hasLeft(p, leftAt))) ?? null
    return list.filter(p => p !== gone)
  })
  if (!gone) return
  lastHead.delete(id)
  glide.delete(id)
  stillPhase.delete(id)
  for (const a of (gone as Plan).agents ?? []) lastStrip.delete(a.id)
}

async function foldPlan($: EngineInterface, id: string) {
  await update($, plans, list => list.map(p => (p.id === id ? { ...p, folded: !p.folded } : p)))
}

// substeps are left out: the bar never draws them and short ops cannot reach them
const STEP_SCHEMA = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    status: { enum: STATUSES, description: 'Default pending' },
  },
}

// fork: sweep progress. A subagent's Bash commands get PLAN_PROGRESS_FILE set to <runs>/<agentId>.json; a script
// writes {label, done, total} there and the strip shows it while the file is under FRESH_MS old
const FRESH_MS = 30_000
let runsDir: string | undefined
async function getRunsDir($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return (runsDir ??= home ? `${home.replaceAll('\\', '/')}/.claude/stool/plan-progress-runs` : '')
}

async function withProgressFile<E extends { tool: string; agentId?: string }>($: EngineInterface, e: E): Promise<E> {
  const command = (e as unknown as Raw).command
  if (e.tool !== 'Bash' || typeof command !== 'string' || command.includes('PLAN_PROGRESS_FILE')) return e
  const dir = await getRunsDir($)
  // ponytail: a path with a quote is skipped rather than escaped
  if (!dir || !e.agentId || dir.includes("'")) return e
  return { ...e, command: `export PLAN_PROGRESS_FILE='${dir}/${e.agentId}.json'; ${command}` }
}

async function pollProgress($: EngineInterface) {
  const live = (await read($, plans)).flatMap(p => p.agents ?? []).filter(a => a.state === 'running' || a.state === 'waiting')
  if (live.length === 0) return
  const dir = await getRunsDir($)
  const now = await $.clock.now()
  // one listing, then a read only for a live agent's fresh file; no directory yet means no sweep has started
  const files = new Map((dir ? await $.fs.list(dir).catch(() => []) : []).map(f => [f.name, f.mtimeMs]))
  for (const a of live) {
    let next: AgentRun['progress']
    const at = files.get(`${a.id}.json`)
    if (at !== undefined && now - at < FRESH_MS) {
      try {
        const j = JSON.parse(await $.fs.read(`${dir}/${a.id}.json`)) as Record<string, unknown>
        if (typeof j.done === 'number' && typeof j.total === 'number' && j.total > 0) next = { label: String(j.label ?? ''), done: j.done, total: j.total }
      } catch {
        continue // a half-written file keeps the last good value; read again two seconds on
      }
    }
    const was = a.progress
    if (was?.label === next?.label && was?.done === next?.done && was?.total === next?.total) continue
    await editAgent($, a.id, x => ({ ...x, progress: next }))
  }
}

// edits are the work the enforcement below counts. Shell calls are never refused or counted: the host marks only
// plain reads (ls) read-only, so a compound read (cd x && git log) would look like work and be refused
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const WORK_BEFORE_PLAN = 3 // the 4th edit without a plan is refused once
const CALLS_BEFORE_NUDGE = 6 // edits without a plan update before a reminder



// ---------- demo reel: two pipelines and their agents, ~13 s, for screen recordings ----------
const run = (id: string, title: string, tool: string, at: number, isSonnet: boolean): AgentRun => ({
  id, title, state: 'running', tool, startedAt: at, endedAt: null, depth: 0,
  ...(isSonnet ? { model: 'claude-sonnet-5-5', effort: 'medium' } : { model: 'claude-haiku-4-5' }),
})

// $.state lives as long as the process, so the bars are kept per session in the plugin's store as well
const SAVED = 'plans:'
const KEEP_SESSIONS = 20
let lastSaved: Plan[] | null = null

async function savePlans($: EngineInterface, list: Plan[]) {
  lastSaved = list
  const key = SAVED + (await $.session.id())
  if (list.length === 0) {
    await $.store.delete(key)
    return
  }
  await $.store.set(key, list)
  const keys = (await $.store.keys()).filter(k => k.startsWith(SAVED))
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_SESSIONS))) await $.store.delete(old)
}

// agents do not outlive the process that ran them, so a restored bar comes back without strips
async function restorePlans($: EngineInterface) {
  const saved = await $.store.get(SAVED + (await $.session.id()))
  if (!Array.isArray(saved) || saved.length === 0) return
  const list = (saved as Plan[]).map(p => ({ ...p, agents: [], agentsDoneAt: null }))
  await update($, plans, () => list)
  lastSaved = list
}

async function runReel($: EngineInterface, logPath: string) {
  const t0 = await $.clock.now()
  soundLog = []
  foldUntil = t0 + 20_000
  await update($, plans, () => [])
  const A = 'reel-checkout'
  const B = 'reel-release'
  const steps = (names: string[], active: number) => names.map((n, i) => st(n, i < active ? 'done' : i === active ? 'active' : 'pending'))
  // mid-run the checkout plan is rewritten: a Harden stage lands between Build and Verify
  let isReplanned = false
  const planA = (k: number, state: PlanState = 'running'): Plan => {
    const all = isReplanned
      ? ['Routes', 'Cart store', 'Payment API', 'Webhooks', 'Checkout UI', 'Rate limits', 'Security review', 'Tests', 'Build']
      : ['Routes', 'Cart store', 'Payment API', 'Webhooks', 'Checkout UI', 'Tests', 'Build']
    const s2 = steps(all, k)
    const stages = isReplanned
      ? [{ name: 'Explore', steps: s2.slice(0, 2) }, { name: 'Build', steps: s2.slice(2, 5) }, { name: 'Harden', steps: s2.slice(5, 7) }, { name: 'Verify', steps: s2.slice(7) }]
      : [{ name: 'Explore', steps: s2.slice(0, 2) }, { name: 'Build', steps: s2.slice(2, 5) }, { name: 'Verify', steps: s2.slice(5) }]
    return { id: A, title: 'Checkout flow', kind: 'plan', state, note: null, startedAt: t0, stages }
  }
  const planB = (k: number, state: PlanState = 'running'): Plan =>
    ({ id: B, title: 'Release notes', kind: 'todo', state, note: null, startedAt: t0, stages: [{ name: 'Release', steps: steps(['Collect PRs', 'Group changes', 'Draft notes', 'Publish'], k) }] })
  const setAgents = async (id: string, f: (a: AgentRun[]) => AgentRun[]) => {
    const now = await $.clock.now()
    await update($, plans, list => list.map(p => (p.id === id ? syncAuto({ ...p, agents: f(p.agents ?? []) }, now) : p)))
  }
  const edit = (id: string, agentId: string, ch: Partial<AgentRun>, at: number) =>
    setAgents(id, list => list.map(a => (a.id === agentId ? { ...a, ...ch, ...(ch.state === 'done' || ch.state === 'error' ? { endedAt: at } : {}) } : a)))
  const keep = async (id: string, f: (p: Plan) => Plan) => {
    let before: PlanState | undefined
    let after: PlanState | undefined
    const now = await $.clock.now()
    await update($, plans, list =>
      list.map(p => {
        if (p.id !== id) return p
        before = p.state
        const made = f(p)
        // a finished bar shows its time in the pill, so it needs the moment it ended
        const next = { ...made, endedAt: made.state === 'done' ? now : null, agents: p.agents, agentsDoneAt: p.agentsDoneAt }
        after = next.state
        return next
      }),
    )
    if (after) chime($, before, after)
  }

  // agent events: [ms, bar, agent id, title or change]
  type Ev = [number, string, string, string | Partial<AgentRun>]
  const ev: Ev[] = [
    [0, A, 'a1', 'Map payment routes'], [0, A, 'a2', 'Read cart store'], [0, A, 'a3', 'Scan checkout tests'], [0, A, 'a4', 'Trace tax rules'],
    [0, A, 'a5', 'List webhooks'], [300, B, 'b1', 'Collect merged PRs'], [300, B, 'b2', 'Group by area'], [300, B, 'b3', 'Find breaking changes'],
    [300, B, 'b4', 'Check migrations'], [900, A, 'a1', { tool: 'Read' }], [1100, B, 'b1', { tool: 'Bash' }], [1500, A, 'a2', { state: 'done' }],
    [2000, B, 'b2', { tool: 'Grep' }], [2200, A, 'a4', { tool: 'Grep' }], [2400, B, 'b1', { state: 'done' }],
    [2800, A, 'a1', { state: 'done' }], [3200, B, 'b3', { tool: 'Read' }],
    [3500, A, 'a3', { state: 'waiting', tool: 'Needs approval' }], [4100, B, 'b2', { state: 'done' }],
    [4400, A, 'a5', { state: 'done' }], [4700, B, 'b4', { state: 'done' }], [5000, A, 'a3', { state: 'running', tool: 'Bash' }],
    [5600, B, 'b5', 'Draft release notes'], [6000, A, 'a3', { state: 'error' }], [6600, B, 'b3', { state: 'done' }], [7000, A, 'a6', 'Fix webhook retry'], [7600, A, 'a4', { state: 'done' }],
    [8000, B, 'b5', { tool: 'Write' }], [8400, A, 'a6', { tool: 'Bash' }], [9000, B, 'b5', { state: 'done' }], [10200, A, 'a6', { state: 'done' }],
  ]
  const script: [number, () => Promise<unknown>][] = [
    [0, async () => {
      await putPlan($, planA(0))
      await putPlan($, planB(0))
    }],
    ...ev.map(([at, bar, id, x]): [number, () => Promise<unknown>] => [
      at,
      () => (typeof x === 'string' ? setAgents(bar, list => [...list, run(id, x, ['Glob', 'Read', 'Grep'][list.length % 3] ?? 'Read', t0 + at, list.length % 3 === 1)]) : edit(bar, id, x, t0 + at)),
    ]),
    [1600, () => keep(A, () => planA(1))], [2500, () => keep(B, () => planB(1))], [3500, () => keep(A, p => ({ ...planA(2), state: 'needs_input', note: 'Run payment tests?' }))],
    [5000, () => keep(A, () => planA(3))], [5700, () => keep(B, () => planB(2))],
    [6000, () => keep(A, () => ({ ...planA(5), state: 'error', note: '2 tests failed' }))],
    [7000, () => keep(A, () => { isReplanned = true; return planA(5) })], [8200, () => keep(B, () => planB(3))],
    [8800, () => keep(A, () => planA(7))],
    [9100, () => keep(B, () => planB(4, 'done'))], [10400, () => keep(A, () => planA(9, 'done'))],
    [13500, async () => {
      await $.fs.write(logPath, JSON.stringify({ t0, sounds: soundLog }))
      soundLog = null
    }],
  ]
  for (const [at, step] of script) $.clock.after(at, () => void step())
}

// ---- the terminal's band: no Svg there, so the same things are drawn with Box, Text and Button ----
// (the desktop path above is untouched). One row per item, `cols` characters wide.
type TermUI = { Box: any; Text: any; Button: any; Raster: any }
type TermIn = { ui: TermUI; cols: number; list: readonly Plan[]; usage: TermCell[]; now: number; calls: Map<string, string>; requestId: string; clicks: boolean }
const TERM_MUTED = '#A8A69E'

// ---------- the terminal bar: a one-row braille Raster, ported from zycck's plan-progress 1.0.0 ----------
// Dots (U+2800 + bits, 2x4 per cell) on a track mixed from the terminal background, denser and brighter toward the head;
// stage marks; a solid pill in the state colour centred on the head reading "Stage • Step │ 3/7". A Raster cell takes one
// printable BMP character exactly one column wide, or the engine refuses the whole tree and every bar vanishes
// (ponytail: wide and astral characters become a dot instead of zycck's full width table)
let isTwinkling = true
let isTurnLive = false
let isLight = false
const DEFAULT = 0x01000000
const termBg = () => (isLight ? [255, 255, 255] : [24, 24, 27])
const pack = (c: number[]) => ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0)
const WIDE = [[0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7ff], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x2600, 0x27bf]]
const cellChar = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 63
  if (/\p{M}|\p{Cf}/u.test(ch)) return ''
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp > 0xffff || (!'✓✕'.includes(ch) && WIDE.some(([a, b]) => cp >= (a ?? 0) && cp <= (b ?? 0))) ? '·' : ch
}
const cellText = (s: string) => [...s].map(cellChar).join('')
const cellsOf = (s: string) => [...cellText(s)].length
const fitCells = (s: string, w: number) => {
  const chars = [...cellText(s)]
  if (chars.length <= w) return chars.join('')
  return w <= 1 ? '…'.slice(0, w) : chars.slice(0, w - 1).join('').trimEnd() + '…'
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// cells are [codepoint, fg, bg] words, little-endian
function encodeCells(cells: number[][]): string {
  const u: number[] = cells.flatMap(c => c.flatMap(w => [w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255]))
  let s = ''
  for (let i = 0; i < u.length; i += 3) {
    const n = ((u[i] ?? 0) << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0)
    s += (B64[n >> 18] ?? '') + (B64[(n >> 12) & 63] ?? '') + (i + 1 < u.length ? (B64[(n >> 6) & 63] ?? '') : '=') + (i + 2 < u.length ? (B64[n & 63] ?? '') : '=')
  }
  return s
}
const BRAILLE_BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
const LEVELS = 8
const q8 = (m: number) => Math.round(Math.max(0, Math.min(1, m)) * LEVELS) / LEVELS
const wave = (t: number, periodMs: number, offset = 0) => 0.5 + 0.5 * Math.sin((t / periodMs + offset) * Math.PI * 2)
const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 4)

// the head glides to a new place over GLIDE_MS, only while frames can carry the glide (the turn is live)
const glide = new Map<string, { from: number; to: number; at: number; W: number }>()
const GLIDE_MS = 450
// the twinkle moment of each bar's last moving frame, kept while it stands still
const stillPhase = new Map<string, number>()
function headAt(id: string, target: number, t: number, W: number, canGlide: boolean): number {
  const g = glide.get(id)
  if (!g || g.W !== W || (!canGlide && Math.abs(g.to - target) > 0.01)) {
    glide.set(id, { from: target, to: target, at: t, W })
    return target
  }
  const cur = g.from + (g.to - g.from) * easeOut((t - g.at) / GLIDE_MS)
  if (Math.abs(g.to - target) > 0.01) glide.set(id, { from: cur, to: target, at: t, W })
  return cur
}
const isGliding = (p: Plan, t: number) => {
  const g = glide.get(p.id)
  return g !== undefined && g.from !== g.to && t - g.at < GLIDE_MS + 100
}
// a bar twinkles only while Claude works on it; one waiting on the person or left open after the turn stands still
const isAnimated = (p: Plan, t: number) => (isTwinkling && isTurnLive && p.state === 'running') || isGliding(p, t)
const hasRunningAgents = (p: Plan) => (p.agents ?? []).some(a => a.state === 'running' || a.state === 'waiting')
const canFold = (p: Plan) => (p.agents ?? []).length > 0

// what the pill shows: the stage the head falls in (the finished share), the step counted within it
function atHead(p: Plan): Where {
  const w = where(p)
  if (p.state === 'done') return w
  let start = 0
  for (let i = 0; i < p.stages.length; i++) {
    const size = p.stages[i]?.steps.length ?? 0
    if (w.pos < start + size || i === p.stages.length - 1) return { ...w, stage: i, step: Math.max(1, Math.min(size, w.pos - start + 1)), stageSize: size }
    start += size
  }
  return w
}

function trackCells(p: Plan, W: number, t: number): string {
  const cells: number[][] = Array.from({ length: W }, () => [32, DEFAULT, DEFAULT])
  const set = (x: number, ch: string | number, fg: number, bg: number) => {
    if (x >= 0 && x < W) cells[x] = [typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 32), fg, bg]
  }
  const text = (x: number, s: string, fg: number, bg: number) => {
    let i = 0
    for (const ch of cellText(s)) set(x + i++, ch, fg, bg)
    return i
  }
  const pill = (from: number, to: number, at: (x: number) => number[]) => {
    for (let x = from; x < to; x++) set(x, ' ', DEFAULT, pack(at(x)))
  }
  const w = atHead(p)
  const done = p.state === 'done'
  const target = (done ? 1 : Math.min(1, w.pos / Math.max(1, w.total))) * W
  // after the turn a change lands at once: a glide would keep frames going through the engine's end-of-turn redraw
  const fx = headAt(p.id, target, t, W, isTurnLive)
  // only a moving bar twinkles with the clock; one that stands still keeps the twinkle of its last frame
  const phase = isAnimated(p, t) ? t : (stillPhase.get(p.id) ?? 0)
  stillPhase.set(p.id, phase)
  const acc = hex(STATE_COLOR[p.state])
  const light = mix(acc, [255, 255, 255], 0.35)
  const grey = [120, 118, 128]
  const track = mix(termBg(), [128, 128, 128], isLight ? 0.14 : 0.18)
  const fill = mix(track, acc, done ? 0.3 : 0.17)
  const under = (x: number) => (x + 0.5 < fx ? fill : track)
  pill(0, W, under)

  const TWINKLE = done ? [3200, 3800, 4400, 3500] : [2200, 2800, 1900, 3300]
  const DELAY = [0, 700, 1300, 400]
  const dim = done ? 0.2 : 0.55
  for (let col = 0; col < Math.min(W, Math.ceil(fx)); col++) {
    const u = Math.min(1, (col + 0.5) / Math.max(1, fx))
    const dense = done ? 0.8 : 0.22 + 0.78 * Math.pow(u, 1.5)
    let bits = 0
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++) {
        const sx = col * 2 + c
        if (sx / 2 >= fx || hash(sx, r, 1) > dense * 0.6) continue
        bits |= BRAILLE_BITS[r]?.[c] ?? 0
      }
    if (bits === 0) continue
    const cls = Math.floor(hash(col, 0, 2) * 4)
    const blink = 1 - dim * (isTwinkling ? wave(phase + (DELAY[cls] ?? 0), TWINKLE[cls] ?? 2200, 0.25) : 0.5)
    const tone = mix(grey, light, done ? 1 : q8(Math.min(1, Math.pow(u, 0.9) * 1.1)))
    set(col, 0x2800 + bits, pack(mix(fill, tone, q8((0.35 + 0.65 * dense) * blink))), pack(fill))
  }

  // stage boundaries: bright once passed, a dim hairline before
  let k = 0
  p.stages.forEach(s => {
    if (k > 0) {
      const x = Math.round((k / w.total) * W)
      if (x > 0 && x < W - 1) {
        const passed = x < fx - 0.5
        const mark = passed ? (isLight ? mix(acc, [0, 0, 0], 0.3) : mix(light, [255, 255, 255], 0.5)) : mix(track, isLight ? [0, 0, 0] : [255, 255, 255], 0.45)
        set(x, '│', pack(mark), pack(under(x)))
      }
    }
    k += s.steps.length
  })

  const single = p.stages.length === 1
  const number = single ? Math.min(w.total, w.pos + 1) : w.stage + 1
  const icon = done ? '✓' : p.state === 'error' ? '✕' : p.state === 'needs_input' ? '?' : ''
  let name = ''
  let count = ''
  if (W < 28) name = icon || String(number)
  else {
    name = done ? 'Done' : single ? (p.stages[0]?.name ?? 'Tasks') : (p.stages[w.stage]?.name ?? '')
    // the pill counts steps only; the agents have their own rows under the bar
    count = p.id === AGENTS ? `${w.pos}/${w.total}` : done ? `${w.total}/${w.total}` : single ? `${number}/${w.total}` : `${w.step}/${w.stageSize}`
  }
  const lead = icon && W >= 28 ? `${icon} ` : ''
  const maxName = Math.max(3, Math.floor(W * (W < 60 ? 0.75 : 0.55)) - cellsOf(lead) - cellsOf(count) - 5)
  // the step after the stage; it gives way first when the bar is short
  const stepName = W < 28 || p.id === AGENTS || done ? '' : (p.stages[w.stage]?.steps[w.step - 1]?.title ?? '')
  const stepRoom = maxName - cellsOf(name) - 3
  const step = stepName && stepRoom >= 4 ? fitCells(stepName, stepRoom) : ''
  const shown = lead + (step ? name : fitCells(name, maxName))
  const tail = step ? ` ${w.step === 1 ? '│' : '•'} ${step}` : ''
  const kw = cellsOf(shown) + cellsOf(tail) + (count ? count.length + 1 : 0) + 2
  const kx = Math.round(Math.max(0, Math.min(W - kw, fx - kw / 2)))
  const white = pack([255, 255, 255])
  const body = pack(acc)
  pill(kx, kx + kw, () => acc)
  let at = kx + 1
  at += text(at, shown, white, body)
  if (tail) at += text(at, tail, white, body)
  if (count) text(at + 1, count, white, body)
  return encodeCells(cells)
}

// the Raster is repainted by frames while a bar moves: a 30 fps clock that runs only then
type Band = { requestId: string; W: number; list: readonly Plan[] }
let band: Band | null = null
let isFrameBusy = false
let frames: { cancel: () => void } | null = null
// when the engine last refused frames of this band for good; the frames rest a second before they try again
let refusedAt: number | null = null
let refusedInRow = 0
const REFUSED_MAX = 6
// what each key was last sent: a frame sends only cells that changed; a refusal forgets it all
let sent: { band: Band; cells: Map<string, string> } | null = null

function syncFrames($: EngineInterface, now: number) {
  const isRested = refusedAt === null || now - refusedAt >= 1000
  const isWanted = band !== null && isRested && band.list.some(p => isAnimated(p, now))
  if (isWanted && !frames) frames = $.clock.every(33, () => void animate($))
  if (!isWanted && frames) {
    frames.cancel()
    frames = null
  }
}

function blitPlans($: EngineInterface, b: Band, list: readonly Plan[], now: number) {
  if (sent?.band !== b) sent = { band: b, cells: new Map() }
  const last = sent.cells
  return Promise.all(
    list.flatMap(p => {
      const key = `track-${p.id}`
      const cells = trackCells(p, b.W, now)
      if (last.get(key) === cells) return []
      last.set(key, cells)
      return [$.ui.blit({ requestId: b.requestId, key, cells, columns: b.W, rows: 1 }).catch(() => undefined)]
    }),
  )
}

async function animate($: EngineInterface) {
  const b = band
  if (!b || isFrameBusy) return
  isFrameBusy = true
  try {
    const now = await $.clock.now()
    // a redraw while the clock was read laid the band out anew: this frame belongs to the old one
    if (band !== b) return
    const live = b.list.filter(p => isAnimated(p, now))
    if (live.length === 0) return
    const answers = await blitPlans($, b, live, now)
    if (!answers.some(a => a?.deny)) {
      refusedInRow = 0
      refusedAt = null
    } else {
      sent = null
      // blits the engine keeps refusing (band hidden, redrawn at another size) stop the frames; a redraw or the 1 s timer restarts them
      if (++refusedInRow >= REFUSED_MAX) {
        refusedAt = now
        refusedInRow = 0
        frames?.cancel()
        frames = null
      }
    }
  } finally {
    isFrameBusy = false
  }
}

function termBand($: EngineInterface, a: TermIn) {
  const { Box, Text, Button, Raster } = a.ui
  const { cols, list, now, clicks } = a
  const rule = (key: string) => <Text key={key} dimColor>{'─'.repeat(cols)}</Text>
  const fit = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…`)

  // usage strip: groups spread across the width; a hover lays the labels (in the numbers' colours) and the mod over the group
  const strip = a.usage.length ? (
    <Box key="usage" flexDirection="row" justifyContent="space-between" width={cols}>
      {a.usage.map((g, i) => (
        <Box key={`tip-${g.key}`} flexShrink={0}>
          <Text>
            {`${g.glyph} `}
            {g.spans.map((s, j) => <Text key={j} color={s.fill}>{s.text}</Text>)}
          </Text>
          <Box position="absolute" top={0} {...(i === a.usage.length - 1 && i > 0 ? { right: 0 } : { left: 0 })} display="none" hover={{ display: 'flex' }} backgroundColor="#30302E" paddingX={1}>
            <Text>
              {g.spans.map((s, j) => <Text key={j} color={s.fill}>{`${j ? ' ' : ''}${s.tip}`}</Text>)}
              <Text color="#7A7974">{` · ${g.mod}`}</Text>
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  ) : null

  // glyph | title | track | [bot n/m] | percent | [fold] | [close], one space between; the pill on the track names the stage.
  // Fold and close are clicks: drawn only where the terminal takes them (fullscreen)
  const anyFolded = list.some(p => p.folded && canFold(p))
  const hasFold = clicks && list.some(canFold)
  const rest = [1, 4, ...(anyFolded ? [5] : []), ...(hasFold ? [1] : []), ...(clicks ? [1] : [])]
  const fixed = rest.reduce((s, n) => s + n, 0) + rest.length
  // in a narrow band the title gives way before the track: the track keeps 12 cells, and below 4 columns of title there is none
  const wantTitle = Math.min(Math.floor(cols * 0.3), Math.max(...list.map(p => p.title.length), 0))
  const fitTitle = Math.min(Math.max(4, wantTitle), cols - fixed - 12)
  const titleW = fitTitle >= 4 ? fitTitle : 0
  const trackW = Math.max(4, Math.min(512, cols - fixed - (titleW > 0 ? titleW + 1 : 0)))
  // the cells above start a glide where the bar moved; the frames that carry it start with them
  band = list.length > 0 ? { requestId: a.requestId, W: trackW, list } : null
  refusedAt = null
  refusedInRow = 0
  syncFrames($, now)

  // the hover card with a long title wraps inside this width, so the track keeps about 30% of the row
  const cardMax = Math.max(titleW, cols - fixed - Math.ceil(cols * 0.3) - 2)
  const bars = list.flatMap((p, i) => {
    const v = visibleAgents(p, now, stripBudget(list.length))
    const w = where(p)
    const pct = p.state === 'done' ? 100 : Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100)
    const color = STATE_COLOR[p.state]
    const all = p.agents ?? []
    const title = fit(p.title, titleW)
    const live = all.filter(x => x.state === 'running' || x.state === 'waiting').length
    return [
      ...(i > 0 ? [rule(`div-${p.id}`)] : []),
      <Box key={`bar-${p.id}`} flexDirection="row" gap={1} width={cols}>
        <Text color={color}>{STATE_GLYPH[p.state]}</Text>
        {titleW > 0 ? (
          <Box key={`title-${p.id}`} width={titleW} flexShrink={0}>
            {clicks && canFold(p) ? (
              <Button key={`fold-${p.id}-${title.length}`} plain label={title} onPress={() => foldPlan($, p.id)} />
            ) : (
              <Text wrap="truncate">{title}</Text>
            )}
            {title !== p.title ? (
              <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }} backgroundColor="#30302E" paddingRight={1} width={Math.min(p.title.length + 1, cardMax)}>
                <Text>{p.title}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}
        <Raster key={`track-${p.id}`} columns={trackW} rows={1} cells={trackCells(p, trackW, now)} />
        {anyFolded ? (
          <Box width={5} flexShrink={0}>
            {p.folded && canFold(p) ? <Text color={TERM_MUTED}>{`🤖${live}/${all.length}`}</Text> : null}
          </Box>
        ) : null}
        <Text dimColor>{`${String(pct).padStart(3)}%`}</Text>
        {hasFold ? (
          <Box width={1} flexShrink={0}>
            {canFold(p) ? <Button key={`chev-${p.id}`} plain dimColor label={p.folded ? '▸' : '▾'} onPress={() => foldPlan($, p.id)} /> : null}
          </Box>
        ) : null}
        {clicks ? <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => dropPlan($, p.id)} /> : null}
      </Box>,
      ...(v && !p.folded ? termAgents($, a, p, v, all) : []),
    ]
  })

  return (
    <Box flexDirection="column">
      {strip}
      {strip && list.length > 0 ? rule('usage-div') : null}
      {bars}
    </Box>
  )
}

// the strips under a bar as rows: number, state dot, name (model, effort), tool word, calls/cap, clock, × once finished
function termAgents($: EngineInterface, a: TermIn, p: Plan, v: { shown: AgentRun[]; hidden: AgentRun[] }, all: AgentRun[]) {
  const { Box, Text, Button } = a.ui
  const rows = v.shown.map(g => {
    const c = AGENT_COLOR[g.state]
    const isLive = g.state === 'running' || g.state === 'waiting'
    const effort = g.effort ? ({ medium: 'med', ultracode: 'ultra' } as Record<string, string>)[g.effort] ?? g.effort : ''
    const spec = [g.model ? modelName(g.model) : '', effort].filter(Boolean).join(' · ')
    const note = [g.progress && isLive ? `${g.progress.label.slice(0, 24)} ${g.progress.done}/${g.progress.total}` : '', isLive ? (a.calls.get(g.id) ?? '') : ''].filter(Boolean).join(' · ')
    const clock = elapsed((g.endedAt ?? a.now) - g.startedAt)
    return (
      <Box key={`agent-${p.id}-${g.id}`} flexDirection="row" gap={1} width={a.cols} paddingLeft={2}>
        <Text color={TERM_MUTED}>{String(g.n ?? all.indexOf(g) + 1).padStart(2)}</Text>
        <Text color={c}>{g.state === 'waiting' ? '?' : g.state === 'error' ? '!' : g.state === 'done' ? '✓' : '●'}</Text>
        <Box flexGrow={1} flexShrink={1} minWidth={4}>
          <Text wrap="truncate">
            {`${g.depth > 0 ? '↳ ' : ''}${g.title}`}
            {spec ? <Text dimColor>{` (${spec})`}</Text> : null}
          </Text>
        </Box>
        {isLive && g.tool ? <Text color={c}>{g.tool}</Text> : null}
        {note ? <Text dimColor>{note}</Text> : null}
        <Text dimColor>{clock.padStart(7)}</Text>
        {isLive || !a.clicks ? (
          <Text> </Text>
        ) : (
          <Button key={`clear-${p.id}-${g.id}`} plain dimColor label="×" onPress={() => putPlan($, { ...p, agents: all.filter(x => x.id !== g.id) })} />
        )}
      </Box>
    )
  })
  if (v.hidden.length > 0)
    rows.push(
      <Box key={`agents-more-${p.id}`} paddingLeft={2}>
        <Text dimColor>{`+${v.hidden.length}  ${plural(v.hidden.length, 'more agent')} · ${v.hidden.filter(x => x.state === 'done').length} done`}</Text>
      </Box>,
    )
  return rows
}

// ---------- footer figure: model speed (ported from zycck's plan-progress 1.0.0, simplified) ----------
type Speed = { rate: number | null; isLive: boolean }
const speed = atom({ plugin: 'stool', key: 'speed' } as const, { rate: null, isLive: false } as Speed)
const SPEED_HISTORY_MS = 60_000
// the footer is written at most once a second while a response streams
const SHOW_EVERY_MS = 1000
let history: { tokens: number; ms: number }[] = []
let historyModel = ''
const lastSpeed = { label: '', at: -Infinity }
// the average is over the latest minute of finished main-loop responses on one model (subagents are left out): all
// their output tokens over all their time. The response in progress adds its visible characters at 3.6 per token
// over the time since its first piece, so the live figure is an estimate (thinking tokens are not visible: it reads
// low until the response ends, then the exact output_tokens replace it). ponytail: no wait detection for server-side
// tools (the advisor), their wait counts as writing time
function remember(model: string, done: { tokens: number; ms: number }) {
  if (model !== historyModel) {
    history = []
    historyModel = model
  }
  history.push(done)
  let total = history.reduce((sum, h) => sum + h.ms, 0)
  while (history.length > 1 && total - (history[0]?.ms ?? 0) >= SPEED_HISTORY_MS) total -= history.shift()?.ms ?? 0
}
function average(model: string, now = { tokens: 0, ms: 0 }): number | null {
  const past = model === historyModel ? history : []
  const ms = past.reduce((sum, h) => sum + h.ms, now.ms)
  const tokens = past.reduce((sum, h) => sum + h.tokens, now.tokens)
  return ms >= 1000 ? tokens / (ms / 1000) : null
}
const speedLabel = (s: Speed) => `⚡ ${(s.rate === null ? '–' : s.rate < 10 ? s.rate.toFixed(1) : String(Math.round(s.rate))).padStart(3, FIGURE_SPACE)} tok/s`

// ---------- settings window and auto-close (ported from zycck's plan-progress 1.0.0) ----------
// Auto-close is off until turned on: a finished bar stays until closed. On, a finished bar leaves doneStaysMs after it
// finished, once none of its agents is at work; a failed bar or one waiting on the person stays. The seconds and the
// twinkle are userConfig options (/config rows stool.doneBarSeconds, stool.twinkle); auto-close and the footer figure
// are kept in the store, and in `prefs` so a reload of the mod (an option set in the window) takes them back
const AUTOCLOSE = 'autoclose'
const SPEED_SHOWN = 'speedShown'
const SETTINGS = 'settings'
const STAYS = [10, 30, 60]
let isAutoClose = false
let isSpeedShown = true
let doneStaysMs = 30_000
// the opt-in parts (userConfig booleans, default off), switched from the settings window: key, title, what it does,
// the group it sits in, and the /config fields it needs filled before it does anything (noted while they are empty)
const PARTS: [string, string, string, string, string[]][] = [
  ['dispatchGuard', 'Dispatch guard', 'Adds your standing orders to every agent prompt and holds Sonnet and Opus agents to the agent cap across all sessions.', 'Agents', []],
  ['bypassCommand', 'Permission command', 'Adds /stoolpermission <mode> [--persist]: set the permission mode (auto, acceptEdits, bypass, ...) also over Remote Control, and hold a project folder to it.', 'Agents', []],
  ['leadGuard', 'Lead guard', 'Denies the main conversation known slips: git add -A, cd out of the project, shell writes to docs.', 'Agents', []],
  ['captureGuard', 'Capture guard', 'Stops after two slow screen captures in a row and shows free RAM on the usage strip.', 'Agents', ['captureTool']],
  ['ledgerMainTurns', 'Log main turns', 'Adds the main conversation to the agent ledger so the usage_since tool can split lead from agents and calibrate weekly percent. A file write each turn.', 'Usage', []],
  ['usageLog', 'Log meter readings', 'Appends the 5-hour and weekly readings to usage-log.jsonl each time one moves, for calibration. A small write a few times an hour.', 'Usage', []],
  ['restartHandoffLint', 'Handoff lint', 'Warns when a write to the handoff file leaves two headings or a stale time.', 'Restarts', []],
  ['restartPublishCounter', 'Publish counter', 'Counts runs of a command and says when a restart is due.', 'Restarts', ['restartPublishPattern']],
]
let partsOn: Record<string, boolean> = {}
let optionSet: Record<string, boolean> = {} // option fields that hold a value, for the "needs" notes
let aboutVersion = ''
type Prefs = { autoclose: boolean; speedShown: boolean; rev: number }
const prefs = atom({ plugin: 'stool', key: 'prefs' } as const, null as Prefs | null)
// the Agents bar has no end of its own: it finished when its last agent did
const endOf = (p: Plan) => (p.id === AGENTS ? p.agentsDoneAt : p.endedAt)
const hasLeft = (p: Plan, now: number) => {
  const end = endOf(p)
  return isAutoClose && p.state === 'done' && end != null && now - end >= doneStaysMs && !hasRunningAgents(p)
}

async function holdChoices($: EngineInterface) {
  await update($, prefs, held => ({ autoclose: isAutoClose, speedShown: isSpeedShown, rev: (held?.rev ?? 0) + 1 }))
}

async function setChoice($: EngineInterface, key: typeof AUTOCLOSE | typeof SPEED_SHOWN, isOn: boolean) {
  if (key === AUTOCLOSE) isAutoClose = isOn
  else isSpeedShown = isOn
  // drawn first, kept after: the store writes a file
  await holdChoices($)
  await Promise.resolve()
    .then(() => $.store.set(key, isOn))
    .catch(() => {})
}

// written to the settings as /config writes it; the mod then reloads with the new options and the window stays open.
// A press while a set is on its way is dropped
let isSettingOption = false
async function setOption($: EngineInterface, field: string, value: boolean | number) {
  if (isSettingOption) return
  isSettingOption = true
  try {
    const once = () =>
      Promise.resolve()
        .then(() => $.config.set({ key: `stool.${field}`, value }))
        .catch((err: unknown) => ({ deny: String(err) }))
    let set = await once()
    // a plugin reload just after a session starts can leave the rows out for a moment: try again a little later
    for (let wait = 400; set.deny?.includes('no /config row') && wait <= 1600; wait *= 2) {
      await $.clock.sleep(wait)
      set = await once()
    }
    if (set.deny) $.ui.toast(`progress bars: ${set.deny}`)
  } finally {
    isSettingOption = false
  }
}

async function openSettings($: EngineInterface) {
  if (!aboutVersion)
    aboutVersion = await $.fs
      .read(`${$.plugin.root}/.claude-plugin/plugin.json`)
      .then(t => String(JSON.parse(t).version ?? ''))
      .catch(() => '')
  return $.ui.open({ id: SETTINGS, title: 'Stool settings', focus: true, closeOnEscape: true, rows: 34 })
}

export const register: Register = (on, options) => {
  stripShow = Object.fromEntries(STRIP_OPTIONS.map(([k, f]) => [k, options?.[f] !== false]))
  partsOn = Object.fromEntries(PARTS.map(([k]) => [k, flag(options, k)]))
  optionSet = Object.fromEntries(PARTS.flatMap(p => p[4]).map(f => [f, typeof options?.[f] === 'string' && options[f] !== '']))
  slotFile = typeof options?.slotFile === 'string' && options.slotFile ? options.slotFile : SLOT_DEFAULT
  const seconds = Number(options?.doneBarSeconds ?? 30)
  doneStaysMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30_000
  isTwinkling = options?.twinkle !== false
  // per-turn bookkeeping; module variables are fine here, a reload just starts a fresh count
  let workCalls = 0
  let sinceUpdate = 0
  let isPlanTouched = false
  let hasRefused = false
  let isWaitingOnBackground = false

  on('turn.start', async ($, e, next) => {
    isTurnLive = true
    workCalls = 0
    sinceUpdate = 0
    isPlanTouched = false
    hasRefused = false
    isWaitingOnBackground = false

    return next(e)
  })

  // the rule lives in the cached system prompt; a message only carries one short line when bars are open,
  // and the person answering clears any "needs input" without a model call
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    const list = await read($, plans)
    if (list.some(p => p.state === 'needs_input')) {
      await update($, plans, all => all.map(p => (p.state === 'needs_input' ? { ...p, state: 'running' as const, note: null } : p)))
    }
    const open = list.filter(p => p.state !== 'done' && p.id !== AGENTS)
    if (open.length === 0) return next(e)
    const line = `plan-progress open bars: ${open
      .map(p => {
        const w = where(p)
        return `${p.id} (${p.stages[w.stage]?.name ?? ''} ${w.step}/${w.stageSize})`
      })
      .join(', ')}`

    return next({ ...e, context: [...(e.context ?? []), line] })
  })

  // watches the main loop's changing calls: refuses once when multi-step work starts without a bar,
  // and reminds to update the bar when it goes stale mid-turn
  on('tool.call', { tool: /[^]*|a{21}/ }, async ($, e, next) => {
    // a subagent's call only names its current tool on its strip; no gate, no reminders
    if (e.agentId) {
      const agentId = e.agentId
      if (!agentHome.has(agentId)) return next(e)
      await editAgent($, agentId, a => ({ ...a, state: 'running', tool: e.tool }))
      if (e.tool_use_id) toolUses.set(e.tool_use_id, agentId)
      let ran
      try {
        ran = await next(await withProgressFile($, e))
      } finally {
        if (e.tool_use_id) toolUses.delete(e.tool_use_id)
      }
      if (waiting.delete(agentId)) await editAgent($, agentId, a => (a.state === 'waiting' ? { ...a, state: 'running' } : a))
      return ran
    }
    if (SHELL_TOOLS.has(e.tool)) {
      isWaitingOnBackground = (e as unknown as Raw).run_in_background === true
      return next(e)
    }
    if (!EDIT_TOOLS.has(e.tool)) return next(e)
    isWaitingOnBackground = false
    const open = (await read($, plans)).filter(isOpenPlan)
    const hasLivePlan = isPlanTouched || open.length > 0
    if (!hasLivePlan && !hasRefused && workCalls >= WORK_BEFORE_PLAN) {
      hasRefused = true

      return { deny: `plan-progress: several changes ahead. Create a bar with ${TOOL} first, then retry.` }
    }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    workCalls += 1
    sinceUpdate += 1
    if (hasLivePlan && sinceUpdate >= CALLS_BEFORE_NUDGE) {
      sinceUpdate = 0
      const ids = open.map(p => p.id).join(', ') || 'the bar'

      return { ...ran, context: [...(ran.context ?? []), `plan-progress: ${ids} not updated for a while; send {id, next:true} or {id, done, active}.`] }
    }

    return ran
  })

  // an open bar at the end of a turn: a question to the user marks it waiting on its own;
  // only a turn that did work and left the bar unexplained is sent back once
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.stop_hook_active || result.block || isWaitingOnBackground || (e.background_tasks?.length ?? 0) > 0) return result
    const open = (await read($, plans)).filter(isOpenPlan)
    if (open.length === 0) return result
    const asks = /\?\s*$/.test(e.last_assistant_message ?? '')
    if (asks) {
      const last = open[open.length - 1]
      if (last) await putPlan($, { ...last, state: 'needs_input' })

      return result
    }
    if (workCalls === 0 && !isPlanTouched) return result

    return {
      ...result,
      block: `plan-progress: ${open.map(p => p.id).join(', ')} still open. Update each with ${TOOL}: {id, next:true}, or state "done", "needs_input" or "error" with a note.`,
    }
  })

  on('session.start', { cwd: /[^]*|a{22}/ }, async ($, e, next) => {
    // the window's choices first: a reload starts from the defaults. The session's own (an option set in the window
    // reloads the mod), else the store's
    const held = await read($, prefs)
    isAutoClose = held ? held.autoclose : (await $.store.get(AUTOCLOSE).catch(() => undefined)) === true
    isSpeedShown = held ? held.speedShown : (await $.store.get(SPEED_SHOWN).catch(() => undefined)) !== false
    await holdChoices($)
    // the terminal track's tint follows the /config theme (dark unless it says light)
    const theme = (await Promise.resolve().then(() => $.config.list()).catch(() => [])).find(r => r.key === 'theme')
    isLight = /light/i.test(String(theme?.value ?? 'dark'))
    await $.tool.register({
      name: 'plan_progress',
      description: 'Live progress bar above the prompt, one per id. Create with title + stages; update with short ops (next, done, active, failed) or state.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Bar id; reuse it for updates' },
          title: { type: 'string' },
          kind: { enum: ['plan', 'todo'] },
          stages: {
            type: 'array',
            description: 'Full breakdown: when creating, or resent under the same id when the plan changes',
            items: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, steps: { type: 'array', items: STEP_SCHEMA } } },
          },
          next: { type: 'boolean', description: 'Active step finished, start the next one' },
          done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
          active: { type: 'string', description: 'Step title now in progress' },
          failed: { type: 'string', description: 'Step title that failed' },
          state: { enum: ['running', 'needs_input', 'error', 'done'] },
          note: { type: 'string', description: 'One line for needs_input or error' },
        },
      },
    })
    // a session reopened later (an app restart, a resume) finds its bars where it left them
    if ((await read($, plans)).length === 0) await restorePlans($)
    $.clock.every(1000, async () => {
      const list = await read($, plans)
      forgetGone(list)
      const at = await $.clock.now()
      for (const p of list) if (hasLeft(p, at)) await dropPlan($, p.id, at)
      syncFrames($, at)
      await reapStale($, list).catch(() => undefined)
      if (list !== lastSaved) await savePlans($, list)
      // another session's agent starting or ending changes the strip's used/cap, and nothing else redraws for it
      const slots = await liveSlots($, await $.clock.now())
      const used = slots ? `${slots.cheap}+${slots.used}+${slots.codex}` : undefined
      if (used !== lastUsed) {
        lastUsed = used
        await update($, tick, n => n + 1)
      }
      // clocks count inside the frame, so the only timed redraw is folding finished strips away
      if (foldUntil === 0 || (await $.clock.now()) < foldUntil) return
      foldUntil = 0
      if (await read($, isOpen)) await update($, tick, n => n + 1)
    })
    $.clock.every(2000, () => pollProgress($).catch(() => undefined))
    await $.command.register({ name: 'progress', description: 'Show or hide the progress bars' })
    await $.command.register({ name: 'progress-demo', description: 'Show a sample plan in the progress bars' })
    await $.command.register({ name: 'progress-sounds', description: 'Play the decision, error and done sounds' })
    await $.command.register({ name: 'progress-clear', description: 'Remove all progress bars' })
    await $.command.register({ name: 'progress-agents', description: 'Fold or show the agent strips under the bars' })
    await $.command.register({ name: 'plan-progress-autoclose', description: 'Turn on or off finished bars leaving on their own' })
    await $.command.register({ name: 'plan-progress-settings', description: 'Open the progress bar settings' })
    await $.command.register({ name: 'ribbon', description: 'Print what the usage strip sees (agent cap, weekly, 5hr, keep-warm, tokens)' })

    return next(e)
  })

  on('prompt.compose', { promptModel: /[^]*|a{23}/ }, async ($, e, next) => {
    const result = await next(e)

    return { sections: [...result.sections, { id: 'plan-progress:rules', text: RULES, scope: 'session' as const }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const raw = e as unknown as Raw
    const now = await $.clock.now()
    const id = slug(str(raw.id, 60) || str(raw.title, 80))
    if (id === 'reel' && typeof raw.note === 'string') {
      await runReel($, raw.note)
      return { result: 'reel started' }
    }
    const next = await editPlan($, id, prev => {
      const made = normalize(raw, prev, now, id)
      return typeof made !== 'string' && made.stages.length === 0 ? `plan_progress: no bar "${id}" yet; create it with title and stages.` : made
    })
    if (typeof next === 'string') return { deny: next }
    isPlanTouched = true
    sinceUpdate = 0
    const w = where(next)
    const active = next.state === 'done' ? undefined : next.stages.flatMap(st => st.steps).find(st => st.status === 'active')
    // the strips on the bar as stored, so the model sees which of its agents the bar tracks
    const runs = (await read($, plans)).find(p => p.id === id)?.agents ?? []
    const live = runs.filter(a => a.state === 'running' || a.state === 'waiting').length
    const agents = runs.length ? `, agents ${live} running of ${runs.length}` : ''

    return { result: `${id}: ${Math.min(w.pos, w.total)}/${w.total}, ${next.state}${active ? `, active "${active.title}"` : ''}${agents}` }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const live = (await read($, plans)).filter(p => p.state === 'running').pop()
    if (live) await update($, plans, list => list.map(p => (p.id === live.id ? { ...p, state: 'needs_input' as const } : p)))
    play($, 'decision')
    const ran = await next(e)
    if (live) await update($, plans, list => list.map(p => (p.id === live.id && p.state === 'needs_input' ? { ...p, state: 'running' as const } : p)))

    return ran
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    play($, 'decision')
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const text = (ran.result as { plan?: unknown } | undefined)?.plan
    const parsed = typeof text === 'string' ? parsePlan(text, await $.clock.now()) : null
    if (!parsed) return ran
    await editPlan($, PLAN_ID, prev =>
      prev ? { ...parsed, stages: pointAt(carryDone(parsed.stages, prev.stages)), startedAt: prev.startedAt } : { ...parsed, stages: pointAt(parsed.stages) },
    )

    // the model learns which bar holds its plan, so it moves that one rather than opening its own
    return { ...ran, context: [...(ran.context ?? []), `plan-progress: bar "${PLAN_ID}" shows this plan; move it with {id:"${PLAN_ID}", next:true} as steps finish.`] }
  })

  on('command.run', { command: 'progress' }, async $ => {
    if ((await read($, plans)).length === 0) return { text: 'No plan yet. /progress-demo shows a sample.' }
    const open = await read($, isOpen)
    await update($, isOpen, () => !open)

    return { text: open ? 'Progress bars hidden.' : 'Progress bars shown.' }
  })

  // `/ribbon`: the strip's numbers in words, answered as the command's own text. `$.ui.log` rows and an empty answer
  // showed nothing in the transcript (2026-10-15, stdout empty, also over Remote Control); a returned `text` is the
  // command's output row on every surface. It lands in the transcript, so the model reads these five short lines on the
  // next turn (about 70 tokens, once per use)
  on('command.run', { command: 'ribbon' }, async $ => {
    const [usage, warm] = [(await $.state.get(usageRef)).value, (await $.state.get(warmRef)).value]
    const at = await $.clock.now()

    return { text: ribbonLines(usage, warm, at, await stripExtra($, at)).join('\n') }
  })

  on('command.run', { command: 'progress-demo' }, async $ => {
    await putPlan($, DEMO(await $.clock.now()))
    await update($, isOpen, () => true)

    return { text: 'Sample plan shown above the prompt.' }
  })

  // folds every bar's agent strips at once, or shows them all again: the terminal outside fullscreen has no buttons
  on('command.run', { command: 'progress-agents' }, async $ => {
    const list = await read($, plans)
    if (!list.some(canFold)) return { text: 'No agent strips to fold.' }
    const isFolding = list.some(p => canFold(p) && !p.folded)
    await update($, plans, all => all.map(p => (canFold(p) ? { ...p, folded: isFolding } : p)))

    return { text: isFolding ? 'Agent strips folded; /progress-agents shows them again.' : 'Agent strips shown.' }
  })

  on('command.run', { command: 'plan-progress-autoclose' }, async $ => {
    await setChoice($, AUTOCLOSE, !isAutoClose)
    const s = Math.round(doneStaysMs / 1000)

    return {
      text: isAutoClose
        ? `Finished bars leave ${s} s after they finish; /plan-progress-autoclose keeps them.`
        : 'Finished bars stay until closed; /plan-progress-autoclose turns auto-close on.',
    }
  })

  // the footer's ⚙ opens the same window; the terminal takes clicks only in fullscreen, and VS Code has no footer
  on('command.run', { command: 'plan-progress-settings' }, async $ => {
    // another plugin's ui.open hook may refuse it
    const opened = await openSettings($).catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
    if (typeof opened === 'string') return { text: `Settings did not open: ${opened}` }

    return { text: opened.isPlaced ? 'Settings are open.' : `Settings wait for room: ${opened.reason}` }
  })

  on('command.run', { command: 'progress-clear' }, async $ => {
    glide.clear()
    await update($, plans, () => [])

    return { text: 'Progress bars removed.' }
  })

  on('command.run', { command: 'progress-sounds' }, async $ => {
    play($, 'decision')
    $.clock.after(900, () => play($, 'error'))
    $.clock.after(1800, () => play($, 'done'))

    return { text: 'Sounds: decision, error, done.' }
  })

  // always drawn, so the person sees the mod is loaded; dim while there is nothing to show. The footer also carries the
  // model speed and the settings gear (where a click reaches it: the desktop, the terminal in fullscreen)
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const count = (await read($, plans)).length
    const open = await read($, isOpen)
    const s = await read($, speed)
    await read($, prefs)
    const { Box, Button, Text } = $.ui.resolve(e)
    // other mods add their labels to modes beneath us; keep them
    const below = await next(e)
    const press = () =>
      count === 0
        ? $.ui.toast('plan-progress is on. A bar appears when Claude starts a task with several steps.')
        : update($, isOpen, () => !open)

    const button = <Button key="progress-toggle" dimColor={count === 0 || !open} label={count > 1 ? `Progress ${count}` : 'Progress'} onPress={press} />
    const hasGear = e.surface === 'desktop' || e.viewport?.isFullscreen === true
    // alone, the bare Button: wrapped in a Box the desktop dropped it to a row of its own under the footer (2026-10-14).
    // With the gear or the speed figure beside it, the row is zycck's form (a Box of Text, Buttons and what is beneath);
    // Progress stays first, next to the model selector
    if (!hasGear && !isSpeedShown && (!below || e.props.modes.length === 0)) return button
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {button}
        {hasGear ? <Button key="settings" plain dimColor label={e.surface === 'desktop' ? '⚙︎' : '⚙'} onPress={() => openSettings($)} /> : null}
        {isSpeedShown ? <Text dimColor={!s.isLive}>{speedLabel(s)}</Text> : null}
        {below}
      </Box>
    )
  })

  // the settings window: what is running now, then Progress bars, Footer, Agents, Restarts, About. Every control is a
  // Button (an open list or a half-typed field would not survive the desktop building the window anew at each redraw)
  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const s = await read($, speed)
    await read($, prefs)
    await read($, tick)
    const { Box, Button, Text } = $.ui.resolve(e)
    const secs = Math.round(doneStaysMs / 1000)
    // /config takes any seconds: one the window has no cell for gets its own
    const stays = STAYS.includes(secs) ? STAYS : [...STAYS, secs].sort((a, b) => a - b)
    // an On switch is the filled pill, an Off one sits back as plain dim text: the page reads by its pills
    const sw = (key: string, isOn: boolean, press: () => unknown) =>
      isOn ? (
        <Button key={key} variant="primary" label="● On" onPress={press} />
      ) : (
        <Button key={key} plain dimColor label="○ Off" onPress={press} />
      )
    const row = (key: string, title: string, about: string, control: unknown) => (
      <Box key={`row-${key}`} flexDirection="row" alignItems="center" gap={1} marginTop={1}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text>{title}</Text>
          <Text dimColor>{about}</Text>
        </Box>
        {control}
      </Box>
    )
    // one card a section: a bold title with what it covers beside it, the rows under it
    const card = (title: string, about: string, ...rows: unknown[]) => (
      <Box key={`card-${title}`} flexDirection="column" backgroundColor="#2A2927" paddingX={1} paddingBottom={1} marginTop={1}>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text bold>{title}</Text>
          <Text dimColor>{about}</Text>
        </Box>
        {rows}
      </Box>
    )
    // "1+2/4" is one cheap agent and two counted ones against a cap of four, as the usage strip draws it
    const slots = await liveSlots($, await $.clock.now())
    const cap = (await $.state.get(usageRef)).value?.cap
    const figure = slots ? `${slots.cheap > 0 ? `${slots.cheap}+` : ''}${slots.used}${cap === undefined ? '' : `/${cap}`}` : '–'
    const agentsNow = !slots
      ? 'none counted yet'
      : `${slots.used} counted${cap === undefined ? '' : ` of ${cap} allowed`}${slots.cheap > 0 ? `, ${slots.cheap} cheap` : ''}${slots.codex > 0 ? `, ${slots.codex} Codex` : ''}`
    const part = (g: string) =>
      PARTS.filter(p => p[3] === g).map(([k, title, about, , needs]) => {
        const missing = needs.filter(f => !optionSet[f])
        const note = partsOn[k] === true && missing.length > 0 ? `${about} Needs ${missing.join(', ')} set in /config.` : about
        return row(k, title, note, sw(k, partsOn[k] === true, () => setOption($, k, partsOn[k] !== true)))
      })
    return (
      <Box flexDirection="column">
        <Box key="card-Right now" flexDirection="column" backgroundColor="#2A2927" paddingX={1} paddingY={1}>
          <Text bold>Agents running</Text>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text bold color="#FF9FA0">{figure}</Text>
            <Text>{agentsNow}</Text>
          </Box>
          <Text dimColor>{slots ? 'Across every session on this machine. Haiku and cheap agents do not count against the cap.' : 'Switch the dispatch guard on to count agents across sessions.'}</Text>
        </Box>
        {card(
          'Progress bars',
          'above the prompt',
          row('autoclose', 'Auto-close finished bars', 'A finished bar leaves on its own; failed or waiting bars stay. Same as /plan-progress-autoclose.', sw(AUTOCLOSE, isAutoClose, () => setChoice($, AUTOCLOSE, !isAutoClose))),
          row(
            'stays',
            'Seconds a finished bar stays',
            isAutoClose ? 'How long before it closes.' : 'Used once auto-close is on.',
            <Box key="stays" flexDirection="row" flexShrink={0}>
              {stays.map(n => (
                <Button key={`stay-${n}`} dimColor={n !== secs} {...(n === secs ? { variant: 'primary' as const } : { plain: true })} label={`${n} s`} onPress={() => setOption($, 'doneBarSeconds', n)} />
              ))}
            </Box>,
          ),
          row('twinkle', 'Twinkle', 'The dots of the terminal bar twinkle while Claude works; off, they sit still.', sw('twinkle', isTwinkling, () => setOption($, 'twinkle', !isTwinkling))),
        )}
        {card(
          'Usage strip',
          'what the strip above the bars shows',
          ...STRIP_OPTIONS.map(([k, field, title, about]) => (
            <Box key={`strip-${k}`} flexDirection="row" alignItems="center" gap={1} marginTop={1}>
              <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
                <Text>{title}</Text>
                <Text dimColor>{about}</Text>
              </Box>
              {sw(`strip-${k}-sw`, stripShow[k] !== false, () => setOption($, field, stripShow[k] === false))}
            </Box>
          )),
        )}
        {card(
          'Footer',
          'next to the Progress button',
          row('speed', 'Tokens per second', `Shows the ${speedLabel(s).replaceAll(FIGURE_SPACE, '')} figure: the main conversation's average over the last minute, subagents left out.`, sw(SPEED_SHOWN, isSpeedShown, () => setChoice($, SPEED_SHOWN, !isSpeedShown))),
        )}
        {card('Agents', 'off until switched on; patterns and names are in /config', ...part('Agents'))}
        {card('Usage ledger', 'for the usage_since tool; off until switched on', ...part('Usage'))}
        {card('Restarts', 'off until switched on', ...part('Restarts'))}
        <Box key="about" flexDirection="column" marginTop={1}>
          <Text bold>About</Text>
          <Text dimColor>{`stool ${aboutVersion || '?'} · progress bars forked from zycck/plan-progress (MIT)`}</Text>
          <Text dimColor>A switch saves to your settings and the mod reloads in a moment.</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // set again by the terminal draw below; anything else (hidden, desktop, no bars) leaves no Raster to repaint
    band = null
    if (e.props.hasSurvey) return next(e)
    const all = await read($, plans)
    const list = (await read($, isOpen)) ? all : []
    const t = $.ui.resolve(e)
    const { Box, Button, Text } = t
    // the terminal's table can carry an Svg too (2.1.295) and draws it as nothing: the surface decides, not the table
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : null
    const Raster = 'Raster' in t ? t.Raster : null
    const total = Math.max(320, (e.props.bodyColumns || 100) * 8)
    // the usage strip sits on top of the bars, joined to them by a hairline; with no bars it stands alone
    const [usage, warm] = [(await $.state.get(usageRef)).value, (await $.state.get(warmRef)).value]
    const stripNow = await $.clock.now()
    // always drawn at the standalone size (see stripSvg): 24 px icons at 20 px, in an 18 px row so the band's card
    // keeps its 40 px floor; the same size with bars under it
    const usageScale = 20 / 24
    const usageH = 18
    const extra = await stripExtra($, stripNow)
    const usageSource = usageSvg(usage, warm, total, stripNow, usageScale, usageH, extra)
    const usageAlt = usageText(usage, warm, stripNow, extra)
    // one hover zone per strip item; its card (the labels in the numbers' colours, then the mod in grey) lies over the
    // row after a 0.5 s rest. A Box hover has no delay and runs no hook, so the cards live in a see-through interactive
    // frame over the strip, like the track's times, with a CSS transition-delay
    const usageTips = usageSource ? stripTips(stripZones(usage, warm, total, stripNow, usageScale, extra), total, usageH) : ''
    // each running agent's tool calls against its cap, from agent-meter (matched by agent id)
    const calls = new Map((await $.state.get(meterRef)).value?.agents.map(a => [a.id, a.cap === null ? `${a.calls}` : `${a.calls}/${a.cap}`]) ?? [])
    if (list.length === 0 && !usageSource) return next(e)
    // every bar has the same width and is pinned to the right edge (fixed-width percent, close button),
    // so rows line up whatever their titles; the slack goes into the gap after the title.
    // Desktop reports ~8 CSS px per column; glyph, gaps, percent and the close button take ~126 px.
    const titleWidth = Math.min(Math.round(total * 0.3), Math.max(...list.map(p => Math.round(textWidth(p.title, 6.4)))))
    // a folded bar's agent count (bot icon + "1/2", FOLD_W px) sits before the percent: its room comes off the track
    const FOLD_W = 34
    const anyFolded = list.some(p => p.folded && (p.agents ?? []).length > 0)
    // a chevron cell (width 3, ~24 px) before the ✕ when any bar has agent strips: up or down, every row keeps the cell
    const hasChevron = list.some(canFold)
    const trackW = Math.max(120, Math.min(1400, total - titleWidth - 140 - (anyFolded ? FOLD_W + 8 : 0) - (hasChevron ? 32 : 0)))
    // the title as a button never wraps: it is cut to its column (the row would grow tall otherwise, 2026-10-14)
    const fitTitle = (t: string) => {
      if (textWidth(t, 6.4) <= titleWidth) return t
      let s = t
      while (s.length > 2 && textWidth(s + '…', 6.4) > titleWidth) s = s.slice(0, -1)
      return s.trimEnd() + '…'
    }
    // a row item centred on the track line (Box height counts terminal rows, not px: never set it here, 2026-10-14)
    const cell = (key: string, child: unknown) => (
      <Box key={key} alignItems="center" flexShrink={0}>
        {child}
      </Box>
    )
    // the title folds the agent strips (a plain Button when the plan has agents); a title cut to its column shows in
    // full on hover through the API's documented reveal: a keyed Box holding a `display: none` absolute Box with
    // `hover: { display: 'flex' }`. No `height` on these Boxes: Box heights count terminal rows.
    const titleCell = (p: Plan) => {
      const toggle = () => foldPlan($, p.id)
      const hasAgents = (p.agents ?? []).length > 0
      const label = (t: string) =>
        hasAgents ? <Button key={`fold-${p.id}-${t.length}`} plain label={t} onPress={toggle} /> : <Text wrap="truncate">{t}</Text>
      const cut = fitTitle(p.title) !== p.title
      return (
        <Box key={`title-${p.id}`} alignItems="center" flexShrink={0}>
          {label(fitTitle(p.title))}
          {cut ? (
            <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }} backgroundColor="#30302E" paddingRight={1}>
              <Text>{p.title}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }
    const glyphCell = (p: Plan) => cell(`glyph-${p.id}`, <Text color={STATE_COLOR[p.state]}>{STATE_GLYPH[p.state]}</Text>)
    const foldCount = (p: Plan) => {
      const all = p.agents ?? []
      const live = all.filter(a => a.state === 'running' || a.state === 'waiting').length
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FOLD_W}" height="16">${STRIP_STYLE}` +
        `<g transform="translate(1 2) scale(.5)" fill="none" stroke="#A8A69E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${BOT}</g>` +
        `<text x="15" y="11.5" class="sn sg" style="fill:#A8A69E">${live}/${all.length}</text></svg>`
      )
    }
    await read($, tick)
    const now = await $.clock.now()
    // no Svg on this surface (the terminal): the same band in text
    if (!Svg) return termBand($, { ui: { Box, Text, Button, Raster }, cols: Math.max(40, (e.props.bodyColumns || 80) - 2), list, usage: stripCells(usage, warm, stripNow, extra), now, calls, requestId: e.requestId, clicks: e.viewport?.isFullscreen === true })
    // a hairline between task bars, so each bar and its agent strips read as one group
    const divider = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="1"><rect width="${total}" height="1" fill="#808080" fill-opacity=".22"/></svg>`

    return (
      <Box flexDirection="column" gap={1}>
        {/* the band's card has a floor of about 40 px and takes no negative margin (tried 2026-10-13): alone, the
            18 px strip plus the card's own padding already sits on that floor, centred */}
        {usageSource && Svg ? (
          <Box key="usage" position="relative">
            <Svg source={usageSource} alt={usageAlt} width={total} height={usageH} />
            <Box position="absolute" top={0} left={0}>
              <Svg source={usageTips} alt="usage strip: hover for labels" width={total} height={usageH} isInteractive />
            </Box>
          </Box>
        ) : null}
        {usageSource && Svg && list.length > 0 ? <Svg key="usage-div" source={divider} alt="divider" width={total} height={1} /> : null}
        {list.flatMap((p, i) => {
          const v = visibleAgents(p, now, stripBudget(list.length))
          const track = trackSvg(p, trackW)
          // the layer is rebuilt on every redraw anyway, so its clock is set from now each time
          const hover = track.overlay.replace(/\{\{T:(\d+)\}\}/g, (_, t: string) => Math.max(0, (now - Number(t)) / 1000).toFixed(1))
          const strips = v && Svg && !p.folded
            ? stripsSvg(v, p.agents ?? [], trackW, calls).map(r => {
                const svg = (
                  <Svg
                    key={`strip-${p.id}-${r.key}`}
                    source={liveSource(`${p.id}/${r.key}`, `<svg xmlns="http://www.w3.org/2000/svg" width="${trackW}" height="${r.height}">${STRIP_STYLE}${r.html}</svg>`, now)}
                    alt={stripAlt(p, r.key)}
                    width={trackW}
                    height={r.height}
                  />
                )
                const a = (p.agents ?? []).find(x => x.id === r.key)
                if (!a || (a.state !== 'done' && a.state !== 'error')) return svg
                // a finished strip: a small × right of the whole row, in the bar's ✕ column (track | gap | 4-column percent |
                // gap | ✕ = 7 columns past the track), centred on the strip's height
                const clear = () => putPlan($, { ...p, agents: (p.agents ?? []).filter(x => x.id !== a.id) })
                return (
                  <Box key={`strip-box-${p.id}-${r.key}`} position="relative">
                    {svg}
                    <Box position="absolute" top={0} bottom={0} right={-7} alignItems="center">
                      <Button key={`clear-${p.id}-${a.id}`} plain dimColor label="×" onPress={clear} />
                    </Box>
                  </Box>
                )
              })
            : []
          const agentsAlt = v ? `; agents: ${(p.agents ?? []).map(a => `${a.title} ${a.state}`).join(', ')}` : ''
          const line = i > 0 && Svg ? [<Svg key={`div-${p.id}`} source={divider} alt="divider" width={total} height={1} />] : []
          const w = where(p)
          const pct = p.state === 'done' ? 100 : Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100)
          const color = STATE_COLOR[p.state]
          const stageName = p.stages[w.stage]?.name ?? ''
          const alt =
            p.state === 'done'
              ? `${p.title}: done, ${plural(w.total, 'step')}${p.endedAt ? ` in ${elapsed(p.endedAt - p.startedAt)}` : ''}`
              : `${p.title}: ${stageName}, step ${w.step} of ${w.stageSize}, ${pct}%${p.note ? ` — ${p.note}` : ''}${agentsAlt}`
          const bar = `${'━'.repeat(Math.round(pct / 4))}${'─'.repeat(25 - Math.round(pct / 4))}`

          return [
            ...line,
            <Box key={`bar-${p.id}`} flexDirection="row" alignItems={v && !p.folded ? 'flex-start' : 'center'} gap={1}>
              {glyphCell(p)}
              {titleCell(p)}
              <Box flexGrow={1} />
              {Svg ? (
                <Box flexDirection="column" flexShrink={0}>
                  <Box key={`track-${p.id}`}>
                    <Svg source={track.base} alt={alt} width={trackW} height={TRACK_H} />
                    <Box position="absolute" top={0} left={0}>
                      <Svg source={hover} alt={`${p.title}: hover for times`} width={trackW} height={TRACK_H} isInteractive />
                    </Box>
                  </Box>
                  {strips}
                </Box>
              ) : (
                <Text>
                  <Text color={color}>{bar.replace(/─/g, '')}</Text>
                  <Text dimColor>{bar.replace(/━/g, '')}</Text>
                  <Text color={color}>{` ${stageName} ${w.step}/${w.stageSize}`}</Text>
                </Text>
              )}
              {p.folded && (p.agents ?? []).length > 0 && Svg
                ? cell(`fold-n-${p.id}`, <Svg source={foldCount(p)} alt={`${(p.agents ?? []).length} agents`} width={FOLD_W} height={16} />)
                : null}
              {cell(`pct-${p.id}`, <Text dimColor>{`${String(pct).padStart(3, FIGURE_SPACE)}%`}</Text>)}
              {hasChevron ? (
                <Box key={`chev-${p.id}`} width={3} flexShrink={0} alignItems="center">
                  {canFold(p) ? <Button key={`chev-btn-${p.id}`} plain dimColor label={p.folded ? '▸' : '▾'} onPress={() => foldPlan($, p.id)} /> : null}
                </Box>
              ) : null}
              {cell(`close-${p.id}`, <Button plain dimColor label="✕" onPress={() => dropPlan($, p.id)} />)}
            </Box>,
          ]
        })}
      </Box>
    )
  })

  on('agent.spawn', { prompt: /[^]*|a{24}/ }, async ($, e, next) => {
    const started = await next(e)
    if (!('agentId' in started) || !started.agentId) return started
    const id = started.agentId
    const now = await $.clock.now()
    const parentHome = e.parentAgentId ? agentHome.get(e.parentAgentId) : undefined
    const home = parentHome ?? [...(await read($, plans))].reverse().find(isOpenPlan)?.id ?? AGENTS
    const run: AgentRun = {
      id,
      title: (e.description || e.subagentType).slice(0, 60),
      state: 'running',
      tool: 'Starting',
      model: started.model,
      startedAt: now,
      endedAt: null,
      depth: parentHome ? 1 : 0,
    }
    let isNew = false
    await update($, plans, list => {
      if (list.some(p => p.id === home)) return list.map(p => (p.id === home ? addRun(p, run, e.parentAgentId, now) : p))
      isNew = true
      const auto: Plan = { id: AGENTS, title: 'Agents', kind: 'todo', stages: [], state: 'running', note: null, startedAt: now }
      return placeBar(list, addRun(auto, run, undefined, now))
    })
    // known only once its strip is stored, so the cleanup in the clock never sees a home without the agent
    agentHome.set(id, home)
    if (isNew) await update($, isOpen, () => true)

    return started
  })

  // an agent waiting on a permission prompt turns its strip amber until the call goes on
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const agentId = e.tool_use_id ? toolUses.get(e.tool_use_id) : undefined
    const useId = e.tool_use_id
    // the mode often settles an ask by itself in a blink; only a call still held after a moment waits on the person
    if (agentId && useId && verdict.decision === 'ask') {
      $.clock.after(600, async () => {
        if (toolUses.get(useId) !== agentId) return
        waiting.add(agentId)
        await editAgent($, agentId, a => ({ ...a, state: 'waiting', tool: 'Needs approval' }))
      })
    }

    return verdict
  })

  // the first request of an agent's loop says what it runs on: the resolved model and its effort. The main loop's
  // response is timed piece by piece for the footer's tokens per second
  on('turn.step', { model: /[^]*|a{25}/ }, async function* ($, e, next) {
    const agentId = e.agentId
    if (agentId) {
      if (agentHome.has(agentId)) {
        const effort = e.effort === undefined ? undefined : String(e.effort)
        const known = (await read($, plans)).flatMap(p => p.agents ?? []).find(a => a.id === agentId)
        if (known && (known.model !== e.model || known.effort !== effort)) await editAgent($, agentId, a => ({ ...a, model: e.model, effort }))
      }
      return yield* next(e)
    }
    const show = (value: Speed, isFinal = false) => {
      const label = `${speedLabel(value)}|${value.isLive}`
      // the figure turned off in the window: only a final figure is written, so the footer is not redrawn for nobody
      if (!isSpeedShown && !isFinal) return
      const t = performance.now()
      if (label === lastSpeed.label || (!isFinal && t - lastSpeed.at < SHOW_EVERY_MS)) return
      lastSpeed.label = label
      lastSpeed.at = t
      void update($, speed, () => value).catch(() => {})
    }
    const stream = next(e)
    let first: number | null = null
    let chars = 0
    let shownAt = 0
    let stop: { tokens: number | null; t: number } | null = null
    try {
      for await (const c of stream) {
        const t = performance.now()
        if (c.kind === 'stop') stop = { tokens: c.usage?.output_tokens ?? null, t }
        else {
          first ??= t
          chars += c.kind === 'text' ? c.text.length : c.kind === 'input' ? c.json.length : c.kind === 'tool' ? c.name.length : 0
          if (t - shownAt >= SHOW_EVERY_MS) {
            const rate = average(e.model, { tokens: chars / 3.6, ms: t - first })
            if (rate !== null) {
              shownAt = t
              show({ rate, isLive: true })
            }
          }
        }
        yield c
      }
      const result = await stream.result
      // the response is whole: its exact share (the API's output_tokens over first piece to stop); one under a second is too short to time
      if (stop && first !== null && stop.tokens !== null && stop.t - first >= 1000 && stop.tokens >= 20) remember(e.model, { tokens: stop.tokens, ms: stop.t - first })
      if (stop) show({ rate: average(e.model), isLive: false }, true)
      return result
    } finally {
      // a response cut short leaves the average of those that finished, dimmed
      if (!stop && first !== null) show({ rate: average(e.model), isLive: false }, true)
    }
  })

  on('turn.complete', { reason: /[^]*|a{26}/ }, async ($, e, next) => {
    const agentId = e.agentId
    if (!agentId) {
      isTurnLive = false
      // a glide still under way lands now: frames running on would go out with the engine's end-of-turn redraw
      for (const [id, g] of glide) glide.set(id, { ...g, from: g.to })
    }
    // agentHome lives in memory: after a plugin reload a strip is found in the stored plans instead, or it stays
    // "running" forever
    const stored = agentId && !agentHome.has(agentId) && (await read($, plans)).some(p => p.agents?.some(a => a.id === agentId))
    if (agentId && (agentHome.has(agentId) || stored)) {
      const now = await $.clock.now()
      const isFailed = e.reason !== 'answer'
      const tool = e.reason === 'aborted' ? 'Stopped' : isFailed ? 'Failed' : 'Done'
      await editAgent($, agentId, a => ({ ...a, state: isFailed ? 'error' : 'done', tool, endedAt: now, progress: undefined }))
      // the mod's own bar sounds through its state; a strip on a task bar sounds here
      if (isFailed && agentHome.get(agentId) !== AGENTS) play($, 'error')
      agentHome.delete(agentId)
      waiting.delete(agentId)
    }
    // a plan whose steps are all finished closes itself
    for (const p of await read($, plans)) {
      if (p.id === AGENTS) continue
      if (p.state === 'done') continue
      const steps = p.stages.flatMap(s => s.steps)
      if (steps.length > 0 && steps.every(s => isFinished(s.status))) await putPlan($, { ...p, state: 'done', endedAt: await $.clock.now() })
    }

    return next(e)
  })
}
