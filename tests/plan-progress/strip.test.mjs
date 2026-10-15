// the usage strip: formats as specified, and where it is drawn
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { boot, S, st } from './engine.mjs'
import { fmtClock, fmtCount, fmtSpan, ribbonLines, stripSvg, stripText, stripZones } from './strip.mjs'

const [M, H, D] = [60_000, 3_600_000, 86_400_000]
assert.equal(fmtSpan(2 * D + 3 * H + 40 * M), '2d3h') // no minutes once it is a day or more
assert.equal(fmtSpan(2 * D + 10 * M), '2d') // a zero part is left out
assert.equal(fmtSpan(3 * H + 20 * M), '3h20m')
assert.equal(fmtSpan(8 * H), '8hr')
assert.equal(fmtSpan(49 * M), '49min')
assert.equal(fmtClock(Date.UTC(2026, 9, 13, 0, 40), 'UTC'), '12:40a')
assert.equal(fmtClock(Date.UTC(2026, 9, 13, 17, 0), 'UTC'), '5p')
assert.deepEqual([950, 13_300, 2_000_000, 13_300_000_000, 1_200_000_000_000, 250_400].map(fmtCount), ['950', '13.3k', '2m', '13.3b', '1.2t', '250k'])

const now = 1_000_000
const usage = {
  cap: 4,
  weekly: { used: 93, resetAt: now + 2 * D + 3 * H, projected: 147, limitAt: now + 8 * H },
  five: { used: 83, resetAt: now + 49 * M, projected: 123, limitAt: now + 46 * M },
  tokens: 13_300_000_000,
}
const warm = { pings: 9, max: 10, lastAt: Date.UTC(2026, 9, 13, 5, 40), coldAt: now + 50 * M }
const rs = { ctx: 41, publishes: 1, due: false }
const ex = { used: 1, restart: rs }
const text = stripText(usage, warm, now, ex)
assert.ok(text.startsWith('agents 1/4  ·  week 93% | 2d3h - 147% | 8hr  ·  5h 83% | 49min - 123% | 46min  ·  cache 9/10 | '), text)
assert.ok(text.endsWith('·  context 41%'), text)
// a window that lasts to its reset shows its pace without a run-out time; keep-warm off drops its group
assert.equal(stripText({ ...usage, five: { ...usage.five, projected: 60, limitAt: null } }, { ...warm, coldAt: null }, now, ex).includes('5h 83% | 49min - 60%  ·  context'), true)
// no pings running: no keep-warm group at all (the plain `warm` state is gone); an hour after the last request: cold
assert.ok(!stripText(usage, { ...warm, pings: 0 }, now, ex).includes('cache'))
assert.ok(stripText(usage, warm, now + 51 * M, ex).includes('·  cache cold  ·'))
assert.ok(stripSvg(usage, warm, 1037, now + 51 * M).includes('cold-ice-gradient'))
assert.equal(stripSvg(undefined, undefined, 1037, now), null)

assert.deepEqual(ribbonLines(usage, { ...warm, pings: 0 }, now, ex), ['🔴 1/4', '🟠 93% | 2d3h - 147% | 8hr', '🟢 83% | 49min - 123% | 46min', '🔵 —', '🟣 41%'])
// no slot file: the cap alone; no restart reading: no context group; due: red
assert.ok(stripText(usage, warm, now).startsWith('agents 4  ·') && !stripText(usage, warm, now).includes('context'))
assert.ok(stripSvg(usage, warm, 1037, now, 1, 24, { restart: { ctx: 70, publishes: 0, due: true } }).includes('#FF3B3B'))
assert.ok(!stripSvg(usage, warm, 1037, now, 1, 24, { restart: rs }).includes('#FF3B3B'))
assert.equal(ribbonLines(usage, warm, now + 51 * M, ex)[3], '🔵 cold')
// agent cap colours: used, slash, cap; and the hover cards' labels follow the numbers' spans
const svg = stripSvg(usage, warm, 1037, now, 1, 24, { used: 1 })
assert.ok(svg.includes('fill="#FF9FA0"') && svg.includes('fill="#FE5D60"') && svg.includes('fill="#E42626"'))
const zones = stripZones(usage, warm, 1037, now, 20 / 24, ex)
const tips = zones.map(z => `${z.mod}: ${z.tip.map(t => t.text).join(' ')}`)
assert.deepEqual(tips, [
  'agent-cap: Agents Running / Agent Cap',
  'usage-pace: % Used | Reset Date - % Projected | Proj. Limit Hit',
  'usage-pace: % Used | Reset Date - % Projected | Proj. Limit Hit',
  'keep-warm: Cache Pings | Last Ping',
  'restart-clock: Context Used',
])
assert.deepEqual(zones[1].tip.map(t => t.fill), ['#FA6A34', '#982C19', '#FA6A34', '#505050', '#FEA75E', '#9D5E2A', '#FEA75E'])
assert.ok(zones.every((z, i) => z.w > 0 && (i === 0 || z.x > zones[i - 1].x + zones[i - 1].w)), 'zones are in order, apart')
assert.deepEqual(ribbonLines(undefined, undefined, now), ['🔴 —', '🟠 —', '🟢 —', '🔵 —', '🟣 —'])

// drawn alone with no bars, and on top of the bars with a hairline between
const E = await boot('./register.mjs')
assert.equal((await E.svgs()).length, 0)
E.strip('usage-pace', { ...usage, weekly: { ...usage.weekly, resetAt: E.now() + 2 * D + 3 * H, limitAt: E.now() + 8 * H }, five: { ...usage.five, resetAt: E.now() + 49 * M, limitAt: E.now() + 46 * M } })
E.strip('keep-warm', { ...warm, coldAt: E.now() + 50 * M })
globalThis.COLS = 130 // 1040 px, the frame's width
const alone = await E.svgs()
assert.equal(alone.length, 2) // the strip and its hover layer
assert.equal(alone[0].height, 18) // alone: three quarters of the 24 px row
// hover cards wait 0.5 s: CSS in an interactive frame (a Box hover can't delay), one card per item
assert.ok(alone[1].isInteractive && alone[1].source.includes('transition-delay:0.5s'))
assert.equal(alone[1].source.split('class="c"').length - 1, 4) // no restart-clock here
await E.call({ id: 'a', title: 'Mountain shot + look panel', stages: [S('Scan', st('Routes', 'active'), 'Services')] })
const withBar = await E.svgs()
assert.equal(withBar[0].alt, alone[0].alt)
assert.equal(withBar[0].height, 18) // the same size with bars under it
assert.equal(withBar[2].alt, 'divider')
assert.ok(withBar.length >= 3)

// another session's agent starts: dispatch-guard's slot file changes and the 1 s poll redraws the strip
const slotsText = async E2 => (await E2.svgs())[0].alt
const E3 = await boot('./register.mjs')
E3.strip('usage-pace', usage)
assert.ok(!(await slotsText(E3)).includes('0/4'), 'no slot file: the cap alone')
E3.files.set('C:/Users/t/.claude/stool/agent-slots.json', { text: JSON.stringify([{ id: 'a', at: E3.now() }, { id: 'old', at: E3.now() - 4 * 3600_000 }]), mtimeMs: E3.now() })
const before = E3.tickCount()
await E3.everyTick()
assert.ok(E3.tickCount() > before, 'a slot change bumps the redraw tick')
assert.ok((await slotsText(E3)).includes('1/4'), 'used/cap reads the file, the stale entry not counted')
const t1 = E3.tickCount()
await E3.everyTick()
assert.equal(E3.tickCount(), t1, 'no change, no redraw')
// cheap (Haiku) agents are listed in front: one cheap and two counted against the cap reads "1+2/4"
E3.files.set('C:/Users/t/.claude/stool/agent-slots.json', { text: JSON.stringify([{ id: 'h', at: E3.now(), cheap: true }, { id: 'a', at: E3.now() }, { id: 'b', at: E3.now() }]), mtimeMs: E3.now() })
await E3.everyTick()
assert.ok((await slotsText(E3)).includes('1+2/4'), 'cheap+counted/cap')

const img = s => `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.source)}" width="${s.width}" height="${s.height}" style="display:block">`
fs.writeFileSync('strip-look.html', `<!doctype html><html style="color-scheme:dark"><head><meta charset="utf-8"></head><body style="background:#141413;padding:40px"><div style="background:#1f1e1d;border-radius:12px;width:${withBar[0].width}px;overflow:hidden">${withBar.filter(s => !s.isInteractive).map(img).join('')}</div></body></html>`)
console.log('strip: all passed')
