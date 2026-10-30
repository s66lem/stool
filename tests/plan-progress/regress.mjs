// the audit's cases after the fixes: each check states the behaviour the mod should have now
import { boot, S, st } from './engine.mjs'

const file = process.argv[2] ?? './register.mjs'
const three = () => [S('One', st('A', 'active'), 'B'), S('Two', 'C')]
const create = (E, id = 't', stages = three(), title = 'Task') => E.call({ id, title, stages })
const res = r => r.deny ?? r.result
const pct = async (E, id) => (await E.view(id)).alt.match(/\d+%/)?.[0]

const C = {
  async T01_next(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    return [E.steps('t'), E.steps('t') === 'A:done B:done C:active']
  },
  async T02_T04_snapshot(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('New', st('C', 'active'), st('A', 'done'), st('B2', 'pending'))] })
    return [`${E.plans().length} bar; ${E.steps('t')}`, E.plans().length === 1 && E.steps('t') === 'C:active A:done B2:pending']
  },
  async T03_percent_after_append(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    const a = await pct(E, 't')
    await E.call({ id: 't', stages: [S('One', st('A', 'done'), st('B', 'done')), S('Two', st('C', 'active'), 'D')] })
    return [`${a} → ${await pct(E, 't')}`, a === '67%' && (await pct(E, 't')) === '50%']
  },
  async T05_resend_keeps_done(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('One', 'A', 'B'), S('Two', 'C', 'D')] })
    return [E.steps('t'), E.steps('t') === 'A:done B:done C:active D:pending']
  },
  async T05b_active_redoes(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('One', st('A', 'active'), 'B'), S('Two', 'C')] })
    return [E.steps('t'), E.steps('t') === 'A:active B:pending C:pending']
  },
  async T06_T07_create_without_status(E) {
    const r = await E.call({ id: 't', title: 'Task', stages: [{ name: 'One', steps: [{ title: 'A' }, { title: 'B' }] }] })
    const req = E.toolSpec.inputSchema.properties.stages.items.properties.steps.items.required
    return [`${E.steps('t')}; ${res(r)}; required ${req}`, E.steps('t') === 'A:active B:pending' && req.join() === 'title']
  },
  async T08_reimport_keeps_done(E) {
    const plan = '# Fix login\n\n## Analyse\n- Read code\n- Find bug\n## Fix\n- Patch\n- Test'
    await E.exitPlan({ result: { plan } })
    await E.call({ id: 'plan', next: true })
    await E.call({ id: 'plan', next: true })
    await E.exitPlan({ result: { plan: plan + '\n- Deploy' } })
    return [E.steps('plan'), E.steps('plan') === 'Read code:done Find bug:done Patch:active Test:pending Deploy:pending']
  },
  async T09_new_title_same_bar(E) {
    await E.exitPlan({ result: { plan: '# Fix login\n## A\n- One\n- Two\n## B\n- Three' } })
    await E.exitPlan({ result: { plan: '# Fix login flow\n## A\n- One\n- Two\n## B\n- Three' } })
    return [`${E.plans().map(p => `${p.id}:${p.title}`)}`, E.plans().length === 1 && E.bar('plan').title === 'Fix login flow']
  },
  async T10_ticked_boxes(E) {
    await E.exitPlan({ result: { plan: '# Ship\n- [x] Read code\n- [x] Find bug\n- [ ] Patch' } })
    return [E.steps('plan'), E.steps('plan') === 'Read code:done Find bug:done Patch:active']
  },
  async T11_active_forward_unchanged(E) {
    await create(E)
    await E.call({ id: 't', active: 'C' })
    return [E.steps('t'), E.steps('t') === 'A:done B:pending C:active']
  },
  async T12_out_of_order(E) {
    const r = await E.call({ id: 't', title: 'Task', stages: [S('First', st('A', 'pending')), S('Second', st('B', 'active'), st('C', 'done'))] })
    const v = await E.view('t')
    return [`"${res(r)}"; "${v.alt}"`, res(r).includes('1/3') && v.alt.includes('Second') && v.alt.includes('33%')]
  },
  async T13_duplicate_titles(E) {
    await E.call({ id: 't', title: 'Task', stages: [S('Backend', st('API', 'active'), 'Tests'), S('Frontend', 'UI', 'Tests')] })
    await E.call({ id: 't', done: ['Tests'] })
    await E.call({ id: 't', done: ['Tests'] })
    return [E.steps('t'), E.steps('t') === 'API:active Tests:done UI:pending Tests:done']
  },
  async T14_unknown_refused(E) {
    await create(E)
    const r = await E.call({ id: 't', done: ['Nonexistent'] })
    return [`${r.deny}`, !!r.deny && r.deny.includes('A, B, C') && E.steps('t') === 'A:active B:pending C:pending']
  },
  async T15_ops_with_stages(E) {
    await create(E)
    await E.call({ id: 't', stages: [S('One', st('A', 'active'), 'B'), S('Two', 'C')], next: true })
    return [E.steps('t'), E.steps('t') === 'A:done B:active C:pending']
  },
  async T16_T17_strips_survive(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('One', 'A', 'B', 'X'), S('Two', 'C')] })
    await E.agentTool('ag1', 'Grep')
    const src = (await E.view('t')).source
    return [`strip ${src.includes('Scan tests')}, tool ${src.includes('Grep')}`, src.includes('Scan tests') && src.includes('Grep')]
  },
  async T16b_strips_survive_import(E) {
    await E.exitPlan({ result: { plan: '# P\n## A\n- One\n## B\n- Two' } })
    await E.spawn('ag1', 'Scan tests')
    await E.exitPlan({ result: { plan: '# P\n## A\n- One\n## B\n- Two\n- Three' } })
    return [`${E.bar('plan').agents?.map(a => a.title)}`, E.bar('plan').agents?.length === 1]
  },
  async T19_parallel_next(E) {
    await create(E)
    await Promise.all([E.call({ id: 't', next: true }), E.call({ id: 't', next: true })])
    return [E.steps('t'), E.steps('t') === 'A:done B:done C:active']
  },
  async T20_parallel_bars(E) {
    await Promise.all([create(E, 'x'), create(E, 'y')])
    return [E.plans().map(p => p.id).join(), E.plans().length === 2]
  },
  async T21_unknown_failed_refused(E) {
    await create(E)
    const r = await E.call({ id: 't', failed: 'Nope' })
    return [`${E.bar('t').state}; deny ${!!r.deny}`, !!r.deny && E.bar('t').state === 'running']
  },
  async T22_done_result_has_no_active(E) {
    await create(E)
    const r = await E.call({ id: 't', state: 'done' })
    return [res(r), res(r) === 't: 3/3, done']
  },
  async T23_reminder_names_bar(E) {
    await E.turnStart()
    await create(E)
    const out = []
    for (let i = 0; i < 6; i++) out.push(await E.work('Edit'))
    const hit = out.findIndex(r => (r.context ?? []).some(c => c.includes('not updated')))
    return [`#${hit + 1}: ${out[hit]?.context}`, hit === 5 && out[hit].context.some(c => c.includes('t '))]
  },
  async T24_refusal_keeps_count(E) {
    await E.turnStart()
    await create(E)
    let hit = -1
    for (let i = 0; i < 6; i++) {
      if (i === 3) await E.call({ id: 't', done: ['Nonexistent'] })
      const r = await E.work('Edit')
      if (hit < 0 && (r.context ?? []).some(c => c.includes('not updated'))) hit = i
    }
    return [`reminder on edit #${hit + 1}`, hit === 5]
  },
  async T25_shell_never_refused(E) {
    await E.turnStart()
    for (let i = 0; i < 3; i++) await E.work('Edit')
    const bash = await E.work('Bash', false)
    const edit = await E.work('Edit')
    return [`bash ${bash.deny ? 'denied' : 'ran'}, 4th edit ${edit.deny ? 'denied' : 'ran'}`, !bash.deny && !!edit.deny]
  },
  async T25b_shell_not_counted(E) {
    await E.turnStart()
    await create(E)
    let reminded = false
    for (let i = 0; i < 12; i++) if (((await E.work('Bash', false)).context ?? []).length) reminded = true
    return [`12 shell calls, reminder ${reminded}`, !reminded]
  },
  async T27_no_substeps_in_schema(E) {
    const step = E.toolSpec.inputSchema.properties.stages.items.properties.steps.items.properties
    return [Object.keys(step).join(), !('substeps' in step)]
  },
  async T30_T31_no_import(E) {
    await E.exitPlan({ deny: 'no' })
    await E.exitPlan({ isError: true, result: { plan: '# X\n- a\n- b' } })
    await E.exitPlan({ result: { plan: null } })
    return [`${E.plans().length} bars`, E.plans().length === 0]
  },
  async T32_next_wraps_back(E) {
    await E.call({ id: 't', title: 'Task', stages: [S('One', 'A', st('B', 'active'), 'C')] })
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    const a = E.steps('t')
    await E.call({ id: 't', next: true })
    return [`${a} → ${E.steps('t')} ${E.bar('t').state}`, a === 'A:active B:done C:done' && E.bar('t').state === 'done']
  },
  async N1_model_told_bar_id(E) {
    const r = await E.exitPlan({ result: { plan: '# Fix login\n## A\n- One\n## B\n- Two' } })
    return [`${r.context}`, (r.context ?? []).some(c => c.includes('"plan"'))]
  },
  async N2_one_bar_one_block(E) {
    await E.turnStart()
    await E.exitPlan({ result: { plan: '# Fix login\n## A\n- One\n## B\n- Two' } })
    await E.work('Edit')
    await E.call({ id: 'plan', next: true })
    await E.call({ id: 'plan', next: true })
    const r = await E.stop('All set.')
    return [`${E.plans().length} bar, ${E.bar('plan').state}, stop ${r.block ? 'blocked' : 'passes'}`, E.plans().length === 1 && !r.block]
  },
  async done_on_active_moves_on(E) {
    await create(E)
    const r = await E.call({ id: 't', done: ['A'] })
    return [res(r), E.steps('t') === 'A:done B:active C:pending']
  },
  async same_bar_same_source_while_time_passes(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    // the still parts: the track picture and the strips (the hover layer is rebuilt every redraw by design)
    const still = v => v.track + v.strips.join('')
    const a = still(await E.view('t'))
    E.tick(7000)
    const b = still(await E.view('t'))
    await E.agentTool('ag1', 'Grep')
    const c = still(await E.view('t'))
    return [`idle redraw same ${a === b}, change redraws ${a !== c}`, a === b && a !== c]
  },
  async running_pill_has_live_clock(E) {
    await create(E)
    E.tick(83_000)
    await E.call({ id: 't', next: true })
    const src = (await E.view('t')).overlay
    const delay = src.match(/--d:-([\d.]+)s/)?.[1]
    return [`clock ${src.includes('class="kc0 ')}, delay ${delay}s`, src.includes('class="kc0 ') && delay === '83.0' && !src.includes('{{T:')]
  },
  async done_pill_static_time(E) {
    await create(E)
    E.tick(125_000)
    await E.call({ id: 't', state: 'done' })
    const src = (await E.view('t')).source
    return [`2m 5s ${src.includes('2m 5s')}, no clock ${!src.includes('class="kc0 ')}`, src.includes('2m 5s') && !src.includes('class="kc0 ')]
  },
  async strips_clock_live_then_static(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    E.tick(12_000)
    const live = (await E.view('t')).source.includes('class="sc ')
    await E.turnComplete('ag1')
    const src = (await E.view('t')).source
    return [`live ${live}, finished shows 12s ${src.includes('>12s<')}`, live && src.includes('>12s<') && !src.includes('class="sc ')]
  },
  async agent_change_redraws_only_its_strip(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.spawn('ag2', 'Read docs')
    const a = await E.view('t')
    await E.agentTool('ag1', 'Grep')
    const b = await E.view('t')
    const same = a.track === b.track && a.strips[1] === b.strips[1]
    return [`track and other strip kept ${same}, own strip redrawn ${a.strips[0] !== b.strips[0]}`, same && a.strips[0] !== b.strips[0]]
  },
  async strip_names_model_and_effort(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    const before = (await E.view('t')).strips[0]
    await E.step('ag1', 'low')
    const after = (await E.view('t')).strips[0]
    return [`model ${before.includes('(haiku 4.5)')}, effort ${after.includes('(haiku 4.5 · low)')}`, before.includes('(haiku 4.5)') && after.includes('(haiku 4.5 · low)')]
  },
  async bars_survive_a_restart(E) {
    const kept = new Map()
    const first = await boot('./register.mjs', kept)
    await create(first)
    await first.spawn('ag1', 'Scan tests')
    await first.call({ id: 't', next: true })
    await first.everyTick()
    const second = await boot('./register.mjs', kept)
    const bar = second.bar('t')
    const ok = !!bar && second.steps('t') === first.steps('t') && (bar.agents ?? []).length === 0
    return [`restored ${!!bar}, same steps ${bar ? second.steps('t') === first.steps('t') : false}, strips dropped ${bar ? (bar.agents ?? []).length === 0 : false}`, ok]
  },
  async done_bar_twinkles_like_running(E) {
    await create(E)
    await E.call({ id: 't', state: 'done' })
    const src = (await E.view('t')).track
    return [`twinkle ${/class="b\d t\d"/.test(src)}`, /class="b\d t\d"/.test(src)]
  },
  async pill_covers_checkpoints(E) {
    await create(E)
    const src = (await E.view('t')).overlay
    const hit = src.indexOf('class="h'), pill = src.indexOf('<g transform="translate('), tip = src.indexOf('class="tp')
    return [`hit ${hit} < pill ${pill} < tip ${tip}`, hit > 0 && hit < pill && pill < tip]
  },
  async sweep_bash_gets_progress_file(E) {
    await create(E)
    await E.spawn('ag1', 'Sweep')
    const ev = await E.bash('ag1', 'node tools/balance-par.mjs 50')
    const want = "export PLAN_PROGRESS_FILE='C:/Users/t/.claude/stool/plan-progress-runs/ag1.json'; node tools/balance-par.mjs 50"
    const again = await E.bash('ag1', ev.command)
    const other = await E.bash('ag1', 'ls', 'Read')
    const main = await E.bash(undefined, 'ls')
    const ok = ev.command === want && again.command === want && other.command === 'ls' && main.command === 'ls'
    return [`${ev.command}; kept on repeat ${again.command === want}`, ok]
  },
  async sweep_unknown_agent_untouched(E) {
    const ev = await E.bash('ghost', 'ls')
    return [ev.command, ev.command === 'ls']
  },
  async sweep_strip_shows_progress(E) {
    await create(E)
    await E.spawn('ag1', 'Sweep')
    await E.spawn('ag2', 'Other')
    const a = await E.view('t')
    await E.writeProgress('ag1', '{"label":"balance 50 seeds","done":6,"total":24}')
    await E.everyTick()
    const b = await E.view('t')
    const quarter = b.strips[0].includes('balance 50 seeds 6/24') && b.strips[0].includes('height="1.5"')
    const quiet = a.strips[1] === b.strips[1] && !a.strips[0].includes('6/24')
    // stale files and half-written ones are ignored; a finished agent drops its bar
    E.tick(31_000)
    await E.everyTick()
    const stale = !(await E.view('t')).strips[0].includes('6/24')
    E.writeProgress('ag1', '{"label":"x","done":2,"total":4}')
    await E.everyTick()
    const back = (await E.view('t')).strips[0].includes('x 2/4')
    E.writeProgress('ag1', '{"label":"x","do')
    await E.everyTick()
    const torn = (await E.view('t')).strips[0].includes('x 2/4') // keeps the last good value
    E.writeProgress('ag1', '{"label":"x","done":2,"total":4}')
    await E.turnComplete('ag1')
    await E.everyTick()
    const gone = !(await E.view('t')).strips[0].includes('2/4')
    return [`bar ${quarter}, other strip kept ${quiet}, stale dropped ${stale}, back ${back}, torn kept ${torn}, finished ${gone}`, quarter && quiet && stale && back && torn && gone]
  },
  // a plugin reload empties the module's maps but not the stored strips: the late finish, and one that never comes
  async reload_closes_finished_agents(E) {
    await E.spawn('ag1', 'Scan tests')
    await E.spawn('ag2', 'Read docs')
    await E.spawn('ag3', 'Still going')
    const R = await boot(file, new Map(), E.state) // same host state, fresh module
    R.listed.set('ag3', 'running')
    R.tick(10_000)
    await R.turnComplete('ag1')
    await R.everyTick() // ag2 is no longer listed: its finish was lost in the reload
    const s = Object.fromEntries(R.plans().flatMap(p => p.agents ?? []).map(a => [a.id, a.state]))
    return [JSON.stringify(s), s.ag1 === 'done' && s.ag2 === 'done' && s.ag3 === 'running']
  },
  async autoclose_drops_finished_bar(E) {
    await create(E, 't', [S('One', st('A', 'active'))])
    await E.call({ id: 't', next: true })
    E.tick(40_000)
    await E.everyTick()
    const stays = E.plans().length === 1 // auto-close is off until turned on
    const said = (await E.command('plan-progress-autoclose')).text
    E.tick(2_000)
    await E.everyTick()
    return [`${stays} ${E.plans().length} ${said}`, stays && E.plans().length === 0 && /leave 30 s/.test(said)]
  },
  async progress_agents_folds_and_shows(E) {
    await create(E)
    const none = (await E.command('progress-agents')).text
    await E.spawn('ag1', 'Count files')
    const folded = (await E.command('progress-agents')).text
    const f1 = E.bar('t').folded
    await E.command('progress-agents')
    return [`${none} | ${f1} ${E.bar('t').folded}`, /No agent/.test(none) && f1 === true && !E.bar('t').folded && /folded/.test(folded)]
  },
  async settings_window_and_footer(E) {
    const texts = n => (Array.isArray(n) ? n.flatMap(texts) : typeof n === 'string' ? [n] : n && typeof n === 'object' ? [n.props?.label, ...(n.children ?? []).flatMap(texts)].filter(Boolean) : [])
    const find = (n, key) => (Array.isArray(n) ? n.map(c => find(c, key)).find(Boolean) : n && typeof n === 'object' ? (n.props?.key === key ? n : (n.children ?? []).map(c => find(c, key)).find(Boolean)) : undefined)
    await E.command('plan-progress-settings')
    const pane = texts(await E.render('Pane', { requestId: 'settings' })).join('|')
    const footer = texts(await E.render('SessionMode')).join('|')
    // the footer figure turned off in the window: Progress alone on a surface without the gear is the bare Button
    await find(await E.render('Pane', { requestId: 'settings' }), 'speedShown').props.onPress()
    const bare = await E.render('SessionMode', { surface: 'terminal', viewport: { isFullscreen: false } })
    const ok = E.opened[0]?.id === 'settings' && ['Agents running', 'Progress bars', 'Usage strip', 'Footer', 'Agents', 'Usage ledger', 'Restarts', 'About'].every(h => pane.includes(h)) && !/Appearance|Language/.test(pane) && footer.includes('Progress') && footer.includes('⚙') && footer.includes('⚡') && bare.type === 'Button'
    return [`${E.opened[0]?.id} ${footer} bare=${bare?.type}`, ok]
  },
  async twinkle_and_seconds_set_through_config(E) {
    const find = (n, key) => (Array.isArray(n) ? n.map(c => find(c, key)).find(Boolean) : n && typeof n === 'object' ? (n.props?.key === key ? n : (n.children ?? []).map(c => find(c, key)).find(Boolean)) : undefined)
    const tree = await E.render('Pane', { requestId: 'settings' })
    await find(tree, 'twinkle').props.onPress()
    await find(tree, 'stay-60').props.onPress()
    return [JSON.stringify(E.configSet), JSON.stringify(E.configSet) === '[{"key":"stool.twinkle","value":false},{"key":"stool.doneBarSeconds","value":60}]']
  },
  async footer_speed_is_main_loop_average(E) {
    let t = 0
    const real = performance.now
    performance.now = () => t
    try {
      const run = async (agentId, chunks) => {
        const hook = E.hooks.find(h => h.event === 'turn.step').fn
        const next = () => Object.assign((async function* () { for (const [at, c] of chunks) { t = at; yield c } })(), { result: Promise.resolve({}) })
        const g = hook(E.$, { agentId, model: 'm', turnId: 't', index: 0, messageCount: 1 }, next)
        for await (const _ of g);
      }
      await run('sub', [[0, { kind: 'text', text: 'x' }], [1000, { kind: 'stop', usage: { output_tokens: 9000 } }]])
      const none = E.$.__get({ ref: { key: 'speed' }, initial: null })
      await run(undefined, [[10, { kind: 'text', text: 'abc' }], [5010, { kind: 'stop', usage: { output_tokens: 300 } }]])
      const s = E.$.__get({ ref: { key: 'speed' }, initial: null })
      return [JSON.stringify([none, s]), none === null && Math.abs(s.rate - 60) < 0.01 && s.isLive === false]
    } finally {
      performance.now = real
    }
  },
  async plan_progress_off(E) {
    const F = await boot(file, new Map(), new Map(), { planProgress: false })
    const comp = F.hooks.find(h => h.event === 'prompt.compose')
    const { sections } = await comp.fn(F.$, {}, async () => ({ sections: [] }))
    await F.turnStart()
    const edits = []
    for (let i = 0; i < 6; i++) edits.push(await F.work('Edit'))
    const stop = await F.stop('All set.')
    const denied = edits.filter(r => r.deny).length
    return [`tool ${F.toolSpec ? 'on' : 'off'}, rules ${sections.length}, denied ${denied}, stop ${stop.block ? 'blocked' : 'passes'}; on: tool ${E.toolSpec ? 'on' : 'off'}`, !F.toolSpec && sections.length === 0 && denied === 0 && !stop.block && !!E.toolSpec]
  },
  async stop_still_blocks_open_bar(E) {
    await E.turnStart()
    await create(E)
    await E.work('Edit')
    const r = await E.stop('All set.')
    return [`${r.block ? 'blocked' : 'passes'}`, !!r.block]
  },
}

let failed = 0
for (const [id, fn] of Object.entries(C)) {
  const E = await boot(file)
  let observed, ok
  try {
    ;[observed, ok] = await fn(E)
  } catch (err) {
    ;[observed, ok] = ['THREW ' + (err?.stack ?? err), false]
  }
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(32)} ${observed}`)
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exitCode = failed ? 1 : 0
