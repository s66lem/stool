// Layout preview: runs the real register.tsx through a few scenarios and draws the returned AbovePrompt element
// tree as HTML (preview.html). It APPROXIMATES the desktop band (1 unit = 8 px, flex boxes, hover cards) and is for
// layout checks only: alignment, wrapping, overlay positions, hover reveals. Fonts, exact metrics, the real
// card chrome and anything the desktop's own renderer does differently are not reproduced.
// Regenerate: node preview.mjs   (compiles first; TYPESCRIPT env var overrides the global typescript path)
import fs from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'

process.env.TYPESCRIPT ??= `${execSync('npm root -g').toString().trim()}/typescript/lib/typescript.js`
for (const [s, o] of [['register.tsx', 'register.mjs'], ['strip.ts', 'strip.mjs'], ['strip-icons.ts', 'strip-icons.mjs']])
  execFileSync('node', ['compile.cjs', `../../hooks/plan-progress/${s}`, o], { stdio: 'ignore' })

const { boot, S, st } = await import('./engine.mjs')
globalThis.COLS = 95 // total = columns * 8 = 760 px
const mk = globalThis.h
let last = null
globalThis.h = (...a) => (last = mk(...a)) // the root is the last element built

const px = v => `${v * 8}px`
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const seen = new Set()
let FORCE = [] // keys of Boxes whose hover card a scenario holds open
const kids = c => (c ?? []).flat(Infinity).filter(x => x != null && x !== false && x !== true)

function css(p) {
  const s = []
  for (const [prop, css] of [['flexDirection', 'flex-direction'], ['alignItems', 'align-items'], ['justifyContent', 'justify-content'], ['flexGrow', 'flex-grow'], ['flexShrink', 'flex-shrink'], ['position', 'position'], ['display', 'display']])
    if (p[prop] != null) s.push(`${css}:${p[prop]}`)
  if (p.backgroundColor) s.push(`background:${p.backgroundColor}`)
  for (const [prop, css] of [['gap', 'gap'], ['width', 'width'], ['top', 'top'], ['left', 'left'], ['right', 'right'], ['bottom', 'bottom'], ['padding', 'padding'], ['margin', 'margin']])
    if (p[prop] != null) s.push(`${css}:${px(p[prop])}`)
  for (const [kind, X, Y] of [['padding', 'paddingX', 'paddingY'], ['margin', 'marginX', 'marginY']])
    for (const [side, ax] of [['Left', X], ['Right', X], ['Top', Y], ['Bottom', Y]]) {
      const v = p[kind + side] ?? p[ax]
      if (v != null) s.push(`${kind}-${side.toLowerCase()}:${px(v)}`)
    }
  return s.join(';')
}
const handled = new Set('key flexDirection alignItems justifyContent gap flexGrow flexShrink position top left right bottom display hover backgroundColor padding paddingLeft paddingRight paddingX paddingTop paddingBottom paddingY margin marginLeft marginRight marginX marginTop marginBottom marginY color dimColor bold wrap plain label onPress source alt width height isInteractive'.split(' '))

function draw(n) {
  if (n == null || n === false || n === true) return ''
  if (Array.isArray(n)) return n.map(draw).join('')
  if (typeof n !== 'object') return esc(n)
  const { type, props: p } = n
  for (const k of Object.keys(p)) handled.has(k) || seen.add(`${type}.${k}`)
  const kid = kids(n.children)
  const text = `${p.color ? `color:${p.color};` : ''}${p.dimColor ? 'opacity:.6;' : ''}${p.bold ? 'font-weight:600;' : ''}`
  if (type === 'Svg') {
    const sz = `width:${p.width}px;height:${p.height}px;display:block;flex:none`
    // like look.mjs: the see-through hover layer is a sandboxed frame so its own :hover works
    return p.isInteractive
      ? `<iframe sandbox="" srcdoc="${esc(p.source)}" style="${sz};border:0" title="${esc(p.alt)}"></iframe>`
      : `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.source)}" alt="${esc(p.alt)}" style="${sz}">`
  }
  if (type === 'Text') {
    const t = p.wrap === 'truncate' ? 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;' : ''
    return `<span style="${text}${t}">${kid.map(draw).join('')}</span>`
  }
  if (type === 'Button') return `<button style="${text}">${esc(p.label)}</button>`
  // Box: a child with `hover` is revealed by :hover on its parent (the .hp rule in the page CSS)
  const cls = [kid.some(c => c.props?.hover) ? 'hp' : '', p.hover ? 'hc' : '', FORCE.includes(p.key) ? 'force' : ''].join(' ')
  const hv = p.hover?.display ? `--hd:${p.hover.display};` : ''
  // an absolute child is placed against its parent, as the desktop does
  const rel = kid.some(c => c.props?.position === 'absolute') && !p.position ? 'position:relative;' : ''
  return `<div class="box ${cls}" style="${rel}${css(p)};${hv}">${kid.map(draw).join('')}</div>`
}

const D = 86_400_000, H = 3_600_000, M = 60_000
const usage = E => {
  const now = E.now()
  // dispatch-guard's slot file: one live agent, so the agent cap reads 1/4
  E.files.set('C:/Users/t/.claude/stool/agent-slots.json', { text: JSON.stringify([{ id: 'a', at: now }]), mtimeMs: now })
  E.strip('usage-pace', { cap: 4, tokens: 13_300_000_000, weekly: { used: 93, resetAt: now + 2 * D + 3 * H, projected: 147, limitAt: now + 8 * H }, five: { used: 83, resetAt: now + 49 * M, projected: 123, limitAt: now + 46 * M } })
  E.strip('keep-warm', { pings: 9, max: 10, lastAt: now - 5 * M, coldAt: now + 50 * M })
}
const plan = (E, title) => E.call({ id: 'a', title, stages: [S('Scan', st('Routes', 'active'), 'Services'), S('Report', 'Summary')] })
const names = ['Count route files', 'List service modules', 'Check package scripts']
const agents = async (E, n, done) => {
  for (let i = 1; i <= n; i++) await E.spawn(`g${i}`, names[i - 1])
  E.tick(56_000)
  for (let i = 1; i <= n; i++) await E.agentTool(`g${i}`, 'Grep')
  for (let i = 1; i <= done; i++) await E.turnComplete(`g${i}`)
}
const scenarios = {
  'One bar, 3 agents (2 running, 1 done)': async E => { await plan(E, 'API review'); await agents(E, 3, 1) },
  'Folded bar': async E => {
    await plan(E, 'API review'); await agents(E, 3, 3)
    E.$.__update({ ref: { key: 'plans' }, initial: [] }, l => l.map(p => ({ ...p, folded: true })))
  },
  'Long title': async E => { await plan(E, 'Audit every route handler, service module and package script for dead code and unsafe input'); await agents(E, 2, 0) },
  'Usage strip alone': async E => usage(E),
  'Usage strip: weekly hover open': async E => { usage(E); await plan(E, 'API review'); await agents(E, 3, 1); return ['tip-weekly'] },
  'Usage strip: agent-cap hover open': async E => { usage(E); await E.spawn('g1', 'Count route files'); return ['tip-agent'] },
  'Usage strip: keep-warm hover open (left of it: no plain warm)': async E => { usage(E); return ['tip-warm'] },
  'Title hover card open (plain Text)': async E => { await plan(E, 'Audit every route handler, service module and package script for dead code and unsafe input'); await agents(E, 2, 1); return ['title-a'] },
  'Finished agent rows: x in the bar x column': async E => { await plan(E, 'API review'); await agents(E, 3, 3) },
  'Usage strip with a bar': async E => { usage(E); await plan(E, 'API review'); await agents(E, 3, 1) },
}

let body = ''
for (const [name, run] of Object.entries(scenarios)) {
  const E = await boot('./register.mjs')
  FORCE = (await run(E)) ?? []
  last = null
  await E.svgs()
  body += `<h2>${esc(name)}</h2><div class="band">${draw(last) || '<i>nothing drawn</i>'}</div>`
}
fs.writeFileSync('preview.html', `<!doctype html><meta charset="utf-8"><title>plan-progress layout preview</title>
<style>
:root{color-scheme:dark}
body{background:#1f1e1d;color:#ddd;font:14px 'Anthropic Sans',ui-sans-serif,system-ui,'Segoe UI',sans-serif;padding:12px}
h2{font-size:12px;font-weight:400;opacity:.5;margin:20px 0 6px}
.band{width:760px;box-sizing:border-box;outline:1px dashed #444}
.box{display:flex;flex-direction:row;box-sizing:border-box;min-width:0}
button{all:unset;font:inherit;color:inherit;cursor:pointer;white-space:nowrap}
.hc{display:none;z-index:5}
.hp:hover>.hc,body.all .hc,.force>.hc{display:var(--hd,flex)!important}
</style>
<label><input type="checkbox" onchange="document.body.classList.toggle('all',this.checked)"> show every hover card</label>
${body}${seen.size ? `<p style="opacity:.5">props not mapped: ${[...seen].join(', ')}</p>` : ''}`)
console.log('wrote preview.html', seen.size ? `(unmapped: ${[...seen]})` : '')
