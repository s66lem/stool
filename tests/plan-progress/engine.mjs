// a stand-in engine around the real, compiled register.tsx: hooks run as written, only $ is faked
globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })

export const TOOL = 'mcp__stool__plan_progress'

export async function boot(file, kept = new Map(), state = new Map()) {
  // a fresh module instance per scenario, so its module-level maps start empty
  const mod = await import(new URL(file, import.meta.url).href + '?n=' + Math.random())
  const hooks = []
  mod.register((event, a, b) => hooks.push(b ? { event, matcher: a, fn: b } : { event, matcher: null, fn: a }), {})

  const listed = new Map() // $.agent.list(): id -> status, filled by spawn() and emptied by turnComplete()
  const others = new Map()
  let now = 1_000_000
  const files = new Map()
  const timers = []
  const every = []
  const sounds = []
  const blits = []
  const opened = []
  const configSet = []
  let toolSpec = null
  const $ = {
    __get(a) {
      return state.has(a.ref.key) ? state.get(a.ref.key) : a.initial
    },
    __update(a, fn) {
      const v = fn(this.__get(a))
      state.set(a.ref.key, v)
      return v
    },
    // other mods' state the bars read (the usage strip): empty unless a test sets it with api.strip()
    state: { get: async ref => ({ value: others.get(`${ref.plugin}.${ref.key}`) }) },
    clock: { now: async () => now, after: (ms, cb) => void timers.push({ at: now + ms, cb }), every: (ms, cb) => (every.push(cb), { cancel: () => every.splice(every.indexOf(cb), 1) }), sleep: async () => {} },
    // the plugin's store outlives a boot when the caller passes the same map, as it outlives a restart
    store: {
      get: async k => (kept.has(k) ? JSON.parse(kept.get(k)) : undefined),
      set: async (k, v) => void kept.set(k, JSON.stringify(v)),
      delete: async k => void kept.delete(k),
      keys: async () => [...kept.keys()],
    },
    env: { get: async n => (n === 'USERPROFILE' ? String.raw`C:\Users\t` : undefined) },
    // an in-memory disk: path -> { text, mtimeMs }; list answers one directory's files
    fs: {
      list: async dir => {
        const out = [...files].filter(([p]) => p.startsWith(dir + '/')).map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false }))
        if (!out.length) throw new Error('ENOENT')
        return out
      },
      read: async p => files.get(p).text,
    },
    agent: { list: async () => [...listed].map(([id, status]) => ({ id, status })) },
    session: { id: async () => 'session-1' },
    env: { get: async k => (k === 'USERPROFILE' || k === 'HOME' ? 'C:/Users/t' : undefined) },
    audio: { play: async ({ asset }) => void sounds.push(asset) },
    process: { run: async () => ({}) },
    plugin: { root: '/plugin' },
    tool: { register: async spec => void (toolSpec = spec) },
    command: { register: async () => {} },
    config: { list: async () => [], set: async ({ key, value }) => (configSet.push({ key, value }), { value }) },
    ui: {
      resolve: e => (e?.surface === 'terminal' ? { Box: 'Box', Button: 'Button', Text: 'Text', Raster: 'Raster' } : { Box: 'Box', Button: 'Button', Text: 'Text', Svg: 'Svg' }),
      toast: () => {},
      blit: async args => (blits.push(args), {}),
      open: async args => (opened.push(args), { isPlaced: true }),
    },
  }
  // ponytail: a regex matcher (the always-true ones that keep each hook distinct in the bundle) also passes an event without that key
  const matches = (m, e) => !m || Object.entries(m).every(([k, v]) => (v instanceof RegExp ? e[k] === undefined || v.test(e[k]) : e[k] === v))
  const dispatch = (event, e, core) => {
    const chain = hooks.filter(h => h.event === event && matches(h.matcher, e))
    const run = (i, ev) => (i < chain.length ? chain[i].fn($, ev, ev2 => run(i + 1, ev2)) : Promise.resolve(core(ev)))
    return run(0, e)
  }

  let use = 0
  const uid = () => 'u' + ++use
  const coreRuns = []
  const api = {
    $,
    state,
    listed,
    sounds,
    hooks,
    blits,
    opened,
    configSet,
    coreRuns,
    get toolSpec() {
      return toolSpec
    },
    tick: ms => (now += ms),
    everyTick: async () => {
      for (const cb of every) await cb()
    },
    fireTimers: async () => {
      for (const t of timers.splice(0)) await t.cb()
    },
    call: input => dispatch('tool.call', { tool: TOOL, tool_use_id: uid(), ...input }, () => ({ result: 'core reached' })),
    work: (tool = 'Edit', isReadOnly = false) =>
      dispatch('tool.call', { tool, command: 'x', tool_use_id: uid() }, () => {
        coreRuns.push(tool)
        return isReadOnly ? { result: {}, text: '', isReadOnly: true } : { result: {}, text: '' }
      }),
    exitPlan: result => dispatch('tool.call', { tool: 'ExitPlanMode', tool_use_id: uid() }, () => result),
    spawn: (agentId, description, parentAgentId) => dispatch('agent.spawn', { description, subagentType: 'general-purpose', parentAgentId }, () => (listed.set(agentId, 'running'), { agentId, model: 'claude-haiku-4-5-20251001' })),
    step: (agentId, effort) => (async () => { const g = hooks.find(h => h.event === 'turn.step').fn($, { agentId, model: 'claude-haiku-4-5-20251001', effort, turnId: 't', index: 0, messageCount: 1 }, async function* () {}); for await (const _ of g); })(),
    files,
    writeProgress: (agentId, text) => files.set('C:/Users/t/.claude/stool/plan-progress-runs/' + agentId + '.json', { text, mtimeMs: now }),
    // the event the engine would run: a subagent's Bash call after the chain
    bash: async (agentId, command, tool = 'Bash') => { let seen; await dispatch('tool.call', { tool, agentId, command, tool_use_id: uid() }, ev => ((seen = ev), { result: {} })); return seen },
    agentTool: (agentId, tool) => dispatch('tool.call', { tool, agentId, tool_use_id: uid() }, () => ({ result: {} })),
    turnComplete: (agentId, reason = 'answer') => dispatch('turn.complete', { agentId, reason }, () => (listed.delete(agentId), {})),
    turnStart: () => dispatch('turn.start', {}, () => ({})),
    sessionStart: () => dispatch('session.start', {}, () => ({})),
    stop: (msg = 'Done.') => dispatch('classic.Stop', { stop_hook_active: false, last_assistant_message: msg, background_tasks: [] }, () => ({})),
    plans: () => $.__get({ ref: { key: 'plans' }, initial: [] }),
    tickCount: () => $.__get({ ref: { key: 'tick' }, initial: 0 }),
    bar: id => api.plans().find(p => p.id === id),
    steps: id => (api.bar(id)?.stages ?? []).flatMap(s => s.steps.map(st => `${st.title}:${st.status}`)).join(' '),
    // what the person sees, read from the real AbovePrompt render: the Svg alt text and source of one bar
    strip: (mod, value) => void others.set(`stool.${{ 'usage-pace': 'usage', 'keep-warm': 'warm', 'restart-clock': 'restart', 'agent-meter': 'meter' }[mod]}`, value),
    now: () => now,
    // the AbovePrompt tree for a surface (the terminal has no Svg)
    // the terminal takes clicks only in fullscreen: tree('terminal', cols, false) is the inline band
    tree: (surface, bodyColumns = 100, isFullscreen = true) => dispatch('ui.render', { component: 'AbovePrompt', surface, requestId: 'r1', viewport: { isFullscreen }, props: { bodyColumns, hasSurvey: false } }, () => null),
    // other hooks, as the engine would run them
    render: (component, extra = {}) => dispatch('ui.render', { component, surface: 'desktop', props: { modes: [] }, ...extra }, () => null),
    command: command => dispatch('command.run', { command }, () => ({})),
    complete: () => dispatch('turn.complete', { reason: 'answer' }, () => ({})),
    svgs: async () => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: globalThis.COLS ?? 120, hasSurvey: false } }, () => null)
      const found = []
      const walk = n => {
        if (Array.isArray(n)) return n.forEach(walk)
        if (!n || typeof n !== 'object') return
        if (n.type === 'Svg') found.push(n.props)
        ;(n.children ?? []).forEach(walk)
      }
      walk(tree)
      return found
    },
    view: async id => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 140, hasSurvey: false } }, () => null)
      const found = []
      // a strip's drawing sits in a keyed row with its open button; it takes the row's key
      const walk = (n, key) => {
        if (Array.isArray(n)) return n.forEach(c => walk(c, key))
        if (!n || typeof n !== 'object') return
        if (n.type === 'Svg') found.push({ ...n.props, key: n.props.key ?? key })
        ;(n.children ?? []).forEach(c => walk(c, n.props?.key ?? key))
      }
      walk(tree)
      const title = api.bar(id)?.title
      const svg = found.find(p => p.alt.startsWith(title + ':'))
      // the bar's agent strips are separate drawings keyed after it
      const strips = found.filter(p => String(p.key ?? '').startsWith(`strip-${id}-`))
      // the see-through hover layer drawn over the track
      const overlay = found.slice(found.indexOf(svg) + 1).find(p => p.isInteractive)
      return svg ? { alt: svg.alt, source: svg.source + strips.map(p => p.source).join('') + (overlay?.source ?? ''), track: svg.source, overlay: overlay?.source ?? '', strips: strips.map(p => p.source), height: svg.height } : null
    },
  }
  await api.sessionStart()
  return api
}

export const S = (name, ...steps) => ({ name, steps: steps.map(s => (typeof s === 'string' ? { title: s, status: 'pending' } : s)) })
export const st = (title, status) => ({ title, status })
