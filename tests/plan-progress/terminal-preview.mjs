// Terminal preview + check: runs the real register.tsx with surface 'terminal' (no Svg) through a few scenarios, lays the
// returned Box/Text/Button tree out in character cells (a small flexbox: row/column, width, flexGrow, space-between,
// truncate, absolute hover cards for the keys a scenario holds open) and writes terminal-preview.txt (ANSI colours) and
// terminal-preview.html (coloured, for a screenshot). It APPROXIMATES Ink; for layout and colour checks only.
// Run: node terminal-preview.mjs   (compiles first; TYPESCRIPT env var overrides the global typescript path)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'

process.env.TYPESCRIPT ??= `${execSync('npm root -g').toString().trim()}/typescript/lib/typescript.js`
for (const [s, o] of [['register.tsx', 'register.mjs'], ['strip.ts', 'strip.mjs'], ['strip-icons.ts', 'strip-icons.mjs'], ['../config.ts', 'config.mjs']])
  execFileSync('node', ['compile.cjs', `../../hooks/plan-progress/${s}`, o], { stdio: 'ignore' })
const { boot, S, st } = await import('./engine.mjs')

const COLS = 100
const kids = c => (c ?? []).flat(Infinity).filter(x => x != null && x !== false && x !== true)
const wide = ch => /\p{Extended_Pictographic}|[\u23F3]/u.test(ch) && ch.codePointAt(0) > 0x2000 && !/[✓✕×●·━─╍┃↳…]/.test(ch)
const cw = ch => (wide(ch) ? 2 : 1)

// styled text of a Text/Button subtree: [{ch, color, dim}]
function chars(n, st0 = {}) {
  if (typeof n === 'string' || typeof n === 'number') return [...String(n)].map(ch => ({ ch, ...st0 }))
  if (!n || typeof n !== 'object') return []
  const p = n.props ?? {}
  const s = { color: p.color ?? st0.color, dim: p.dimColor ?? st0.dim }
  if (n.type === 'Button') return chars(p.label, s)
  return kids(n.children).flatMap(c => chars(c, s))
}
const tw = cs => cs.reduce((w, c) => w + cw(c.ch), 0)
const hidden = n => n.props?.display === 'none'
let rasterSeen = 0
const abs = n => n.props?.position === 'absolute'

function nat(n) {
  if (n.type === 'Raster') return n.props.columns
  if (n.type !== 'Box') return tw(chars(n))
  const p = n.props
  if (typeof p.width === 'number') return p.width
  const k = kids(n.children).filter(c => !abs(c) && !hidden(c))
  const pad = (p.paddingLeft ?? p.paddingX ?? p.padding ?? 0) + (p.paddingRight ?? p.paddingX ?? p.padding ?? 0)
  const sizes = k.map(nat)
  return pad + (p.flexDirection === 'column' ? Math.max(0, ...sizes) : sizes.reduce((a, b) => a + b, 0) + Math.max(0, k.length - 1) * (p.gap ?? 0))
}

const blank = w => Array.from({ length: w }, () => ({ ch: ' ' }))
// draws n into a block `W` wide; returns rows (arrays of cells, wide chars followed by a {skip} cell)
// a Raster's cells: base64 of little-endian words [codepoint, fg, bg] per cell; 0x01000000 is the terminal's default colour
const cellHex = w => (w >= 0x01000000 ? undefined : '#' + (w & 0xffffff).toString(16).padStart(6, '0'))
function raster(n) {
  const b = Buffer.from(n.props.cells, 'base64')
  assert.equal(b.length, n.props.columns * n.props.rows * 12, 'raster cells length')
  return Array.from({ length: n.props.rows }, (_, y) =>
    Array.from({ length: n.props.columns }, (_, x) => {
      const o = (y * n.props.columns + x) * 12
      return { ch: String.fromCodePoint(b.readUInt32LE(o)), color: cellHex(b.readUInt32LE(o + 4)), bg: cellHex(b.readUInt32LE(o + 8)) }
    }),
  )
}
function draw(n, W, ox, oy, ctx) {
  if (n.type === 'Raster') return (rasterSeen++, raster(n))
  if (n.type !== 'Box') {
    let cs = chars(n)
    if (n.props?.wrap === 'truncate' && tw(cs) > W) {
      while (cs.length && tw(cs) > W - 1) cs = cs.slice(0, -1)
      cs.push({ ch: '…', ...(cs.at(-1) ?? {}) })
    }
    const row = cs.flatMap(c => (cw(c.ch) === 2 ? [c, { skip: true }] : [c]))
    return [[...row.slice(0, W), ...blank(Math.max(0, W - row.length))]]
  }
  const p = n.props
  const pl = p.paddingLeft ?? p.paddingX ?? p.padding ?? 0
  const pr = p.paddingRight ?? p.paddingX ?? p.padding ?? 0
  const inner = W - pl - pr
  const all = kids(n.children)
  const flow = all.filter(c => !abs(c) && !hidden(c))
  let rows
  if (p.flexDirection === 'column') {
    let y = 0
    rows = flow.flatMap(c => {
      const r = draw(c, inner, ox + pl, oy + y, ctx)
      y += r.length
      return r
    })
  } else {
    const gap = p.gap ?? 0
    const size = flow.map(nat)
    let free = inner - size.reduce((a, b) => a + b, 0) - Math.max(0, flow.length - 1) * gap
    if (free < 0) {
      // shrink the shrinkable ones (not flexShrink 0), widest first
      const sh = flow.map((c, i) => (c.props?.flexShrink === 0 || typeof c.props?.width === 'number' ? -1 : i)).filter(i => i >= 0)
      while (free < 0 && sh.length) {
        const i = sh.sort((a, b) => size[b] - size[a])[0]
        if (size[i] <= 4) break
        size[i]--
        free++
      }
    }
    if (free > 0) {
      const grow = flow.map((c, i) => [c.props?.flexGrow ?? 0, i]).filter(([g]) => g > 0)
      if (grow.length) grow.forEach(([, i]) => (size[i] += Math.floor(free / grow.length)))
    }
    free = inner - size.reduce((a, b) => a + b, 0) - Math.max(0, flow.length - 1) * gap
    const between = p.justifyContent === 'space-between' && flow.length > 1 ? Math.floor(free / (flow.length - 1)) : 0
    let x = 0
    const cols = flow.map((c, i) => {
      const r = draw(c, size[i], ox + pl + x, oy, ctx)
      x += size[i] + gap + between
      return r
    })
    const h = Math.max(1, ...cols.map(r => r.length))
    rows = Array.from({ length: h }, (_, y) => {
      const out = []
      cols.forEach((r, i) => {
        if (i) out.push(...blank(gap + between))
        out.push(...(r[y] ?? blank(size[i])))
      })
      return out
    })
    rows = rows.map(r => [...r, ...blank(Math.max(0, inner - r.length))].slice(0, Math.max(inner, 0)))
  }
  rows = rows.map(r => [...blank(pl), ...r, ...blank(pr)])
  if (p.width != null || p.flexGrow) rows = rows.map(r => [...r, ...blank(Math.max(0, W - r.length))].slice(0, W))
  // hover cards of a Box the scenario holds open
  if (ctx.force.includes(p.key))
    for (const c of all.filter(x => abs(x) && hidden(x))) {
      const w = nat(c)
      const x = c.props.right != null ? ox + W - w - c.props.right : ox + (c.props.left ?? 0)
      ctx.over.push({ x, y: oy + (c.props.top ?? 0), rows: draw(c, w, x, oy, ctx), bg: c.props.backgroundColor })
    }
  return rows
}

function render(tree, force) {
  const ctx = { force, over: [] }
  const rows = draw(tree, COLS, 0, 0, ctx)
  for (const o of ctx.over)
    o.rows.forEach((r, j) => {
      rows[o.y + j] ??= blank(COLS)
      r.forEach((c, i) => (rows[o.y + j][o.x + i] = { ...c, bg: o.bg }))
    })
  return rows
}

const rgbOf = c => {
  if (!c) return null
  const m = /^#(..)(..)(..)$/.exec(c)
  if (m) return m.slice(1).map(h => parseInt(h, 16))
  const r = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c)
  return r ? r.slice(1).map(Number) : null
}
const ansi = rows =>
  rows
    .map(r => {
      let s = ''
      for (const c of r) {
        if (c.skip) continue
        const f = rgbOf(c.color)
        const b = rgbOf(c.bg)
        s += `\x1b[0m${c.dim ? '\x1b[2m' : ''}${f ? `\x1b[38;2;${f}m`.replace(/,/g, ';') : ''}${b ? `\x1b[48;2;${b}m`.replace(/,/g, ';') : ''}${c.ch}`
      }
      return s.replace(/(\x1b\[0m ?)+$/, '') + '\x1b[0m'
    })
    .join('\n')
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = rows =>
  rows
    .map(r =>
      r
        .filter(c => !c.skip)
        .map(c => `<span style="${c.color ? `color:${c.color};` : ''}${c.dim ? 'opacity:.55;' : ''}${c.bg ? `background:${c.bg};` : ''}">${esc(c.ch)}</span>`)
        .join(''),
    )
    .join('\n')

const D = 86_400_000, H = 3_600_000, M = 60_000
const usage = E => {
  const now = E.now()
  E.files.set('C:/Users/t/.claude/stool/agent-slots.json', { text: JSON.stringify([{ id: 'a', at: now }]), mtimeMs: now })
  E.strip('usage-pace', { cap: 4, tokens: 13_300_000_000, weekly: { used: 93, resetAt: now + 2 * D + 3 * H, projected: 147, limitAt: now + 8 * H }, five: { used: 83, resetAt: now + 49 * M, projected: 123, limitAt: now + 46 * M } })
  E.strip('keep-warm', { pings: 9, max: 10, lastAt: now - 5 * M, coldAt: now + 50 * M })
  E.strip('restart-clock', { ctx: 41, publishes: 1, due: false })
}
const plan = (E, id, title) => E.call({ id, title, stages: [S('Scan', st('Routes', 'active'), 'Services'), S('Report', 'Summary')] })
const names = ['Count route files', 'List service modules', 'Check package scripts']
const agents = async (E, n, done) => {
  for (let i = 1; i <= n; i++) await E.spawn(`g${i}`, names[i - 1])
  E.tick(56_000)
  for (let i = 1; i <= n; i++) await E.agentTool(`g${i}`, 'Grep')
  for (let i = 1; i <= done; i++) await E.turnComplete(`g${i}`)
}
const fold = (E, id) => E.$.__update({ ref: { key: 'plans' }, initial: [] }, l => l.map(p => (p.id === id ? { ...p, folded: true } : p)))
const long = 'Audit every route handler, service module and package script for dead code and unsafe input'
const scenarios = {
  'Strip + one bar, 3 agents (2 running, 1 done)': async E => {
    usage(E)
    await plan(E, 'a', 'API review')
    await agents(E, 3, 1)
  },
  'Strip + two bars, the second folded with its agents': async E => {
    usage(E)
    await plan(E, 'a', 'API review')
    await E.call({ id: 'b', title: 'UI audit', stages: [S('Collect', st('Components', 'active'), 'Styles'), S('Check', 'Icons')] })
    await agents(E, 3, 3)
    fold(E, 'b')
    await E.call({ id: 'a', done: ['Routes'] })
  },
  'Long title + hover cards open (title, weekly)': async E => {
    usage(E)
    await plan(E, 'a', long)
    await agents(E, 2, 0)
    return ['title-a', 'tip-weekly']
  },
  'No usage numbers, bar only': async E => {
    await plan(E, 'a', 'API review')
  },
}

let txt = ''
let body = ''
for (const [name, run] of Object.entries(scenarios)) {
  const E = await boot('./register.mjs')
  const force = (await run(E)) ?? []
  const tree = await E.tree('terminal', COLS)
  assert.ok(tree, `${name}: nothing drawn`)
  // the terminal tree has no Svg anywhere
  const types = new Set()
  ;(function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') (types.add(n.type), kids(n.children).forEach(walk))
  })(tree)
  assert.ok(!types.has('Svg'), `${name}: an Svg on the terminal`)
  const rows = render(tree, force)
  const text = rows.map(r => r.filter(c => !c.skip).map(c => c.ch).join('')).join('\n')
  if (process.env.DUMP) console.log(`${name}\n${text}`)
  // the band reads right: every row fits the width and the pieces the task asks for are there
  rows.forEach(r => assert.ok(r.length <= COLS + 12, `${name}: row too wide (${r.length})`))
  if (name.startsWith('Strip + one')) {
    for (const s of ['1/4', '93%', '83%', '9/10', '41%', 'API review', 'Scan │ Routes 1/2', ' 0%', '✕', 'haiku 4.5', 'Grep', '×', '─']) assert.ok(text.includes(s), `${name}: missing ${s}`)
    assert.equal((text.match(/Grep/g) ?? []).length, 2) // only the two running agents show a tool word
  }
  if (name.includes('two bars')) {
    assert.ok(/[⠁-⣿]/.test(text), `${name}: braille dots on the track`)
    assert.ok(/🤖3\/3|🤖0\/3/.test(text) && text.includes('UI audit') && text.includes('API review') && !text.includes('Grep'), `${name}: folded count`)
    assert.ok((text.match(/─{20,}/g) ?? []).length >= 2, `${name}: dividers`)
  }
  if (name.startsWith('Long')) {
    assert.ok(text.includes(long.slice(0, 40)) && text.includes('% Used') && text.includes('usage-pace'), `${name}: hover cards`)
    const bar = text.split(String.fromCharCode(10)).find(l => l.startsWith('●')) ?? ''
    assert.ok(/^[\s│⠀-⣿]+$/.test(bar.slice(60, 88)), `${name}: the track keeps about 30% of the row: ${bar}`)
  }
  txt += `${name}\n${ansi(rows)}\n\n`
  body += `<h2>${esc(name)}</h2><pre>${html(rows)}</pre>`
}
// the Raster: a bar moving in a live turn repaints by blit, one standing still does not; the frames stop with the turn
{
  const E = await boot('./register.mjs')
  await plan(E, 'a', 'API review')
  await E.turnStart()
  await E.tree('terminal', COLS)
  assert.equal(E.blits.length, 0, 'no blit before a frame')
  E.tick(100)
  await E.everyTick()
  assert.ok(E.blits.length > 0 && E.blits[0].key === 'track-a' && E.blits[0].rows === 1, 'a live running bar repaints its track')
  const n = E.blits.length
  await E.complete()
  E.tick(1500)
  await E.everyTick()
  assert.equal(E.blits.length, n, 'no frames after the turn')
  // inline (not fullscreen): no click controls drawn
  const inline = await E.tree('terminal', COLS, false)
  const t = []
  ;(function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk)
    if (x && typeof x === 'object') (x.type === 'Button' && t.push(x.props.label), kids(x.children).forEach(walk))
  })(inline)
  assert.ok(!t.includes('✕'), 'inline band has no close button')
  const full = await E.tree('terminal', COLS, true)
  const t2 = []
  ;(function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk)
    if (x && typeof x === 'object') (x.type === 'Button' && t2.push(x.props.label), kids(x.children).forEach(walk))
  })(full)
  assert.ok(t2.includes('✕'), 'fullscreen band has the close button')
}
assert.ok(rasterSeen > 0, 'preview drew Rasters')
fs.writeFileSync('terminal-preview.txt', txt)
fs.writeFileSync(
  'terminal-preview.html',
  `<!doctype html><meta charset="utf-8"><title>plan-progress terminal preview</title>
<style>body{background:#1f1e1d;color:#e8e6df;padding:12px}h2{font:12px sans-serif;opacity:.5;margin:18px 0 4px;font-weight:400}
pre{margin:0;font:14px/1.25 'Cascadia Mono',Consolas,'DejaVu Sans Mono',monospace;width:${COLS}ch;outline:1px dashed #444}</style>${body}`,
)
console.log('terminal preview ok:', Object.keys(scenarios).length, 'scenarios -> terminal-preview.txt, terminal-preview.html')
