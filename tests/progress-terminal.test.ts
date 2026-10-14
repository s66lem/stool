// the engine's own tree check on the terminal progress bar: a Raster (braille track) the engine accepts, in fullscreen and inline
import { expect, mock, test, tier } from 'claude-code/testing'

tier('user')

test('terminal band: the braille Raster track is accepted and the clicks show only in fullscreen', async ($, on) => {
  mock.clock(on, { now: 10 * 3600_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000 }, rateLimits: [] } }))
  for (const n of ['get', 'set', 'delete']) on(('store.' + n) as never, () => ({ value: undefined }) as never)
  on('store.keys', () => ({ value: [] }))
  on('ui.render', ($$, e) => (h as any)($$.ui.resolve(e).Text, {}, 'base'))
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  await $.tool.call({ tool: 'mcp__stool__plan_progress', id: 'a', title: 'API review', stages: [{ name: 'Scan', steps: [{ title: 'Routes' }, { title: 'Services' }] }] })
  // wide, astral and combining characters in the pill's words must not get the Raster refused
  await $.tool.call({ tool: 'mcp__stool__plan_progress', id: 'b', title: '日本語 🙂', stages: [{ name: '日本語 🙂 é ✓', steps: [{ title: 'ステップ 🙂 ⚡' }, { title: 'x' }] }] })
  const props = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100 } as never
  for (const isFullscreen of [true, false]) {
    const ui = await $.ui.mount({ plugin: 'stool', surface: 'terminal', component: 'AbovePrompt', props, viewport: { columns: 100, rows: 30, isFullscreen } })
    expect(await ui.find({ key: 'track-a' })).toBeDefined()
    expect(await ui.find({ key: 'track-b' })).toBeDefined()
    expect((await ui.find({ key: 'close-a' })) !== undefined).toBe(isFullscreen)
    await ui.unmount()
  }
  // the settings window and the footer, on the surfaces that take clicks: the engine validates each tree
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'stool', surface, component: 'Pane', requestId: 'settings', props: { bodyColumns: 80 } as never, viewport: { columns: 80, rows: 30, isFullscreen: true } })
    for (const key of ['autoclose', 'stay-30', 'twinkle', 'speedShown']) expect(await pane.find({ key })).toBeDefined()
    await pane.unmount()
    const footer = await $.ui.mount({ plugin: 'stool', surface, component: 'SessionMode', props: { modes: [] } as never, viewport: { columns: 80, rows: 30, isFullscreen: true } })
    expect(await footer.find({ key: 'settings' })).toBeDefined()
    expect(await footer.find({ key: 'progress-toggle' })).toBeDefined()
    await footer.unmount()
  }
})
