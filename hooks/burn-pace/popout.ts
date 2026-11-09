// the Weekly burn pop-out: /burn (and the settings window's Pop out button) writes a self-contained page,
// ~/.claude/stool/burn.html, and opens it as a small app-style window (Edge --app on Windows, else the default
// browser). The data is computed here with burn.tsx's math (currentWeek, project, hourly, readouts) and embedded as
// JSON; the page draws the chart from it as inline SVG, with a mouse-following crosshair and tooltip. The file is
// rewritten each minute (and after each meter reading) while popped out; the page reloads itself each minute.
import type { EngineInterface, Timer } from 'claude-code'

import { expand } from '../config'
import { USAGE_LOG } from '../usage-pace/register'
import { currentWeek, downsample, hourly, project, readouts, WINDOWS } from './burn'
import type { Projection, Week } from './burn'

export const PAGE = '~/.claude/stool/burn.html'
export const WINDOW_SIZE = [520, 380] as const
const MAX_PAGE_POINTS = 2000

/** What the page draws: the week, its readings, the hourly bars, and one projection + readout pair per pace window. */
export type PageData = {
  generated: number // epoch ms the file was written
  start: number
  reset: number
  points: [number, number][] // [t, percent], oldest first
  hours: [number, number, number][] // [hour start, percent at its end, points gained]
  proj: Record<string, Projection> // by pace window in hours ('1' | '6' | '24')
  lines: Record<string, [string, string]>
}

export function pageData(w: Week, nowMs: number, timeZone?: string): PageData {
  const proj: Record<string, Projection> = {}
  const lines: Record<string, [string, string]> = {}
  for (const n of WINDOWS) {
    proj[n] = project(w, nowMs, n)
    lines[n] = readouts(proj[n]!, timeZone)
  }
  return {
    generated: nowMs,
    start: w.start,
    reset: w.reset,
    points: downsample(w.points, MAX_PAGE_POINTS).map(p => [p.t, p.week]),
    hours: hourly(w, nowMs).map(h => [h.t, h.pct, Math.round(h.gain * 1000) / 1000]),
    proj,
    lines,
  }
}

// the page's own script: draws the chart sized to the window, redraws on resize, keeps the range / pace choice in
// the URL hash and localStorage, reloads each minute to pick up the rewritten file. No network, no libraries.
const SCRIPT = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('burn-data').textContent || 'null');
  var H = 3600000, ACC = '#d97757', GREY = '#8a8a8a';
  var root = document.getElementById('chart'), plot = document.getElementById('plot'), tip = document.getElementById('tip');
  var st = { range: 'week', window: '24' };
  try { var s = JSON.parse(localStorage.getItem('stool-burn') || '{}'); if (s.range) st.range = s.range; if (s.window) st.window = s.window; } catch (e) {}
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0] === 'r' && p[1]) st.range = p[1]; if (p[0] === 'w' && p[1]) st.window = p[1]; });
  if (st.range !== 'week' && st.range !== '48h') st.range = 'week';
  if (!D || !D.proj[st.window]) st.window = '24';
  function save() {
    try { localStorage.setItem('stool-burn', JSON.stringify(st)); } catch (e) {}
    history.replaceState(null, '', '#r=' + st.range + '&w=' + st.window);
  }
  function at(ms) {
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + (h < 12 ? 'am' : 'pm');
  }
  function f1(x) { return x.toFixed(1); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function valueAt(t) { var v; for (var i = 0; i < D.points.length; i++) { if (D.points[i][0] > t) break; v = D.points[i][1]; } return v; }
  var geo;
  function draw() {
    if (!D) { plot.innerHTML = '<p class="dim">No weekly readings logged yet.</p>'; return; }
    var p = D.proj[st.window], now = Math.min(Math.max(D.generated, D.start), D.reset);
    document.getElementById('l1').textContent = D.lines[st.window][0];
    document.getElementById('l2').textContent = D.lines[st.window][1];
    document.querySelectorAll('button[data-k]').forEach(function (b) { b.className = st[b.dataset.k] === b.dataset.v ? 'on' : ''; });
    var W = Math.max(280, root.clientWidth), Ht = Math.max(200, root.clientHeight);
    var L = 38, R = 10, T = 26, bB = Ht - 22, bT = bB - Math.max(36, Math.round((Ht - 48) * 0.24)), cB = bT - 14;
    var x0 = D.start, x1 = D.reset;
    if (st.range === '48h') { x0 = Math.min(Math.max(D.generated - 36 * H, D.start), D.reset - 48 * H); x1 = x0 + 48 * H; }
    var yMax = Math.max(100, Math.max.apply(null, D.points.map(function (q) { return q[1]; }))) * 1.08;
    function x(t) { return L + (t - x0) / (x1 - x0) * (W - L - R); }
    function y(v) { return T + (1 - v / yMax) * (cB - T); }
    var bMax = Math.max(0.5, p.canSpend * 1.5, Math.max.apply(null, D.hours.map(function (q) { return q[2]; }).concat([0])));
    function by(v) { return bB - v / bMax * (bB - bT); }
    var g = [], c = [];
    [0, 50, 100].forEach(function (v) {
      g.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + (v === 100 ? ACC : GREY) + '" stroke-opacity="' + (v === 100 ? 0.55 : 0.25) + '"/>');
      g.push('<text x="' + (L - 5) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '%</text>');
    });
    if (st.range === 'week') for (var d = 0; d < 7; d++) g.push('<text x="' + x(D.start + (d + 0.5) * 24 * H) + '" y="' + (Ht - 6) + '" text-anchor="middle">' + at(D.start + d * 24 * H).split(' ')[0] + '</text>');
    else for (var t = Math.ceil(x0 / (12 * H)) * 12 * H; t <= x1; t += 12 * H) if (x(t) > L + 24 && x(t) < W - R - 24) g.push('<text x="' + x(t) + '" y="' + (Ht - 6) + '" text-anchor="middle">' + at(t) + '</text>');
    c.push('<line x1="' + x(D.start) + '" y1="' + y(0) + '" x2="' + x(D.reset) + '" y2="' + y(100) + '" stroke="' + GREY + '" stroke-opacity="0.5" stroke-dasharray="1 3"/>');
    var pts = D.points.filter(function (q, i, a) { return q[0] >= x0 || (a[i + 1] ? a[i + 1][0] : Infinity) >= x0; });
    if (pts.length) c.push('<polyline fill="none" stroke="' + ACC + '" stroke-width="2" stroke-linejoin="round" points="' + pts.map(function (q) { return x(q[0]).toFixed(1) + ',' + y(q[1]).toFixed(1); }).join(' ') + '"/>');
    c.push('<line x1="' + x(now) + '" x2="' + x(now) + '" y1="' + T + '" y2="' + bB + '" stroke="' + GREY + '" stroke-opacity="0.3"/>');
    function end(r) { return r.outAt !== null ? [r.outAt, 100] : [D.reset, r.atReset]; }
    var a = end(p.avg), e = end(p.pace);
    c.push('<line x1="' + x(now) + '" y1="' + y(p.now) + '" x2="' + x(a[0]) + '" y2="' + y(a[1]) + '" stroke="' + GREY + '" stroke-width="1.5" stroke-dasharray="5 4"/>');
    c.push('<line x1="' + x(now) + '" y1="' + y(p.now) + '" x2="' + x(e[0]) + '" y2="' + y(e[1]) + '" stroke="' + ACC + '" stroke-width="1.5" stroke-dasharray="5 4"/>');
    if (e[0] <= x1) {
      var lab = p.pace.outAt !== null ? 'out ' + at(p.pace.outAt) : 'ends ~' + Math.round(p.pace.atReset) + '%', right = x(e[0]) > W - 100;
      c.push('<circle cx="' + x(e[0]) + '" cy="' + y(e[1]) + '" r="3.5" fill="' + ACC + '"/><text x="' + (x(e[0]) + (right ? -6 : 6)) + '" y="' + (y(e[1]) - 7) + '" text-anchor="' + (right ? 'end' : 'start') + '" fill="' + ACC + '">' + lab + '</text>');
    }
    var bw = Math.max(1, (W - L - R) / ((x1 - x0) / H) - 0.6);
    D.hours.forEach(function (q) { if (q[2] > 0 && q[0] + H > x0 && q[0] < x1) c.push('<rect x="' + x(q[0]) + '" y="' + by(q[2]) + '" width="' + bw + '" height="' + (by(0) - by(q[2])) + '" fill="' + ACC + '" fill-opacity="0.75"/>'); });
    c.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + bB + '" y2="' + bB + '" stroke="' + GREY + '" stroke-opacity="0.35"/>');
    c.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + by(p.canSpend) + '" y2="' + by(p.canSpend) + '" stroke="' + GREY + '" stroke-opacity="0.6" stroke-dasharray="2 3"/>');
    g.push('<g clip-path="url(#pa)">' + c.join('') + '</g>');
    g.push('<text x="' + (L - 5) + '" y="' + (bT + 4) + '" text-anchor="end">/hr</text><text x="' + (W - R) + '" y="' + (by(p.canSpend) - 4) + '" text-anchor="end">can spend ' + f1(p.canSpend) + '/h</text>');
    function lg(dx, col, dash, text) { return '<line x1="' + (L + dx) + '" x2="' + (L + dx + 16) + '" y1="10" y2="10" stroke="' + col + '" stroke-width="2"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/><text x="' + (L + dx + 20) + '" y="14">' + text + '</text>'; }
    g.push(lg(0, ACC, '', 'actual'), lg(68, GREY, '4 3', 'week avg'), lg(152, ACC, '4 3', 'last ' + st.window + ' h pace'));
    g.push('<line id="xh" y1="' + T + '" y2="' + bB + '" stroke="#e8e6e3" stroke-opacity="0.5" visibility="hidden"/><circle id="xd" r="4" fill="' + ACC + '" stroke="#e8e6e3" stroke-width="1.5" visibility="hidden"/>');
    plot.innerHTML = '<svg width="' + W + '" height="' + Ht + '" viewBox="0 0 ' + W + ' ' + Ht + '"><defs><clipPath id="pa"><rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + Ht + '"/></clipPath></defs>' + g.join('') + '</svg>';
    geo = { W: W, L: L, R: R, T: T, bB: bB, x0: x0, x1: x1, x: x, y: y, p: p };
  }
  // hover: the hour under the mouse; a crosshair at its middle, a dot on the line, a tooltip box by the mouse
  function hover(ev) {
    if (!geo) return;
    var r = root.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    var xh = document.getElementById('xh'), xd = document.getElementById('xd');
    if (mx < geo.L || mx > geo.W - geo.R || my < geo.T || my > geo.bB) { leave(); return; }
    var t = geo.x0 + (mx - geo.L) / (geo.W - geo.L - geo.R) * (geo.x1 - geo.x0);
    var h0 = D.start + Math.floor((t - D.start) / H) * H, gx = geo.x(h0 + H / 2), q = null, p = geo.p;
    for (var i = 0; i < D.hours.length; i++) if (D.hours[i][0] === h0) { q = D.hours[i]; break; }
    var v, html;
    if (q) { v = q[1]; html = '<b>' + at(h0) + '</b><br>' + Math.round(q[1]) + '% used<br>+' + f1(q[2]) + ' pts/hr'; }
    else if (h0 + H > D.generated) {
      v = Math.min(p.now + p.pace.rate * ((h0 + H - D.generated) / H), p.pace.outAt !== null ? 100 : Infinity);
      html = '<b>' + at(h0) + '</b><br>~' + Math.round(Math.min(v, 999)) + '% at pace<br>+' + f1(p.pace.rate) + ' pts/hr';
    } else { v = valueAt(h0 + H); html = '<b>' + at(h0) + '</b><br>no reading'; }
    xh.setAttribute('x1', gx); xh.setAttribute('x2', gx); xh.setAttribute('visibility', 'visible');
    if (v !== undefined && geo.y(v) >= geo.T) { xd.setAttribute('cx', gx); xd.setAttribute('cy', geo.y(v)); xd.setAttribute('visibility', 'visible'); } else xd.setAttribute('visibility', 'hidden');
    tip.innerHTML = html; tip.style.display = 'block';
    var tw = tip.offsetWidth, th = tip.offsetHeight, tx = mx + 14, ty = my + 14;
    if (tx + tw > r.width - 4) tx = mx - 14 - tw;
    if (ty + th > r.height - 4) ty = my - 14 - th;
    tip.style.left = Math.max(2, tx) + 'px'; tip.style.top = Math.max(2, ty) + 'px';
  }
  function leave() {
    tip.style.display = 'none';
    ['xh', 'xd'].forEach(function (id) { var n = document.getElementById(id); if (n) n.setAttribute('visibility', 'hidden'); });
  }
  root.addEventListener('mousemove', hover);
  root.addEventListener('mouseleave', leave);
  document.querySelectorAll('button[data-k]').forEach(function (b) { b.addEventListener('click', function () { st[b.dataset.k] = b.dataset.v; save(); leave(); draw(); }); });
  window.addEventListener('resize', function () { leave(); draw(); });
  var age = D ? Date.now() - D.generated : 0;
  document.getElementById('upd').textContent = D ? (age > 3 * 60000 ? 'not updated since ' + at(D.generated) + ' (session closed?)' : 'updated ' + at(D.generated)) : '';
  if (age > 3 * 60000) document.getElementById('upd').className = 'stale';
  save(); draw();
  setTimeout(function () { location.reload(); }, 60000);
})();
`

const STYLE = `
:root{color-scheme:dark;--bg:#1f1e1d;--fg:#e8e6e3;--dim:#9a9893;--acc:#d97757;--line:#3a3836}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:flex;flex-direction:column;padding:10px 12px 8px;gap:6px;overflow:hidden}
.ro{display:flex;flex-direction:column;gap:1px}
.ro div:first-child{font-weight:600}
#chart{position:relative;flex:1;min-height:200px}
#plot{position:absolute;inset:0}
#chart svg{display:block;font-size:11px;fill:var(--dim)}
#tip{position:absolute;display:none;pointer-events:none;background:#2b2a28;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:12px;line-height:1.4;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.45)}
#tip b{color:var(--acc);font-weight:600}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:12px;color:var(--dim)}
.grp{display:flex;align-items:center;gap:4px}
button{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font:inherit;cursor:pointer}
button:hover{border-color:var(--dim)}
button.on{background:var(--acc);border-color:var(--acc);color:#1f1e1d;font-weight:600}
#upd{margin-left:auto}
.stale{color:var(--acc)}
.dim{color:var(--dim)}
`

/** The whole page: readouts, chart, controls, the data as embedded JSON. No external URL of any kind. */
export function pageHtml(data: PageData | undefined): string {
  const json = JSON.stringify(data ?? null).replace(/</g, '\\u003c')
  const btn = (k: string, v: string, label: string) => `<button data-k="${k}" data-v="${v}">${label}</button>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Weekly burn</title><style>${STYLE}</style></head>
<body>
<div class="ro"><div id="l1">${data ? '' : 'No weekly readings logged yet.'}</div><div id="l2" class="dim"></div></div>
<div id="chart"><div id="plot"></div><div id="tip"></div></div>
<div class="bar"><span class="grp">range ${btn('range', 'week', 'Week')}${btn('range', '48h', '48 h')}</span><span class="grp">pace ${WINDOWS.map(n => btn('window', String(n), `${n} h`)).join('')}</span><span id="upd"></span></div>
<script id="burn-data" type="application/json">${json}</script>
<script>${SCRIPT}</script>
</body></html>
`
}

export type Platform = 'win32' | 'darwin' | 'linux'

/** file:/// URL for an absolute path (forward or back slashes, a drive letter or a leading slash). */
export const fileUrl = (path: string) => 'file:///' + encodeURI(path.split(String.fromCharCode(92)).join('/').replace(/^\/+/, ''))

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`
/** The command line that opens the page: an Edge app window on Windows (the default browser if Edge will not start);
 * `open` on macOS, `xdg-open` elsewhere. */
export function openArgv(platform: Platform, url: string): string[] {
  if (platform === 'win32') {
    const [w, h] = WINDOW_SIZE
    const edge = `Start-Process msedge -ArgumentList ${psq(`--app=${url}`)},${psq(`--window-size=${w},${h}`)} -ErrorAction Stop`
    return ['powershell', '-NoProfile', '-NonInteractive', '-Command', `try { ${edge} } catch { Start-Process ${psq(url)} }`]
  }
  return [platform === 'darwin' ? 'open' : 'xdg-open', url]
}

async function home($: EngineInterface) {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
}

async function platformOf($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
  const r = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => undefined)
  return r?.stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
}

/** Writes the page from the log as it is now; resolves its path. */
export async function writePage($: EngineInterface): Promise<string> {
  const h = await home($)
  const [w, nowMs] = [currentWeek(await $.fs.read(expand(h, USAGE_LOG)).catch(() => '')), await $.clock.now()]
  const file = expand(h, PAGE)
  await $.fs.write(file, pageHtml(w ? pageData(w, nowMs) : undefined))
  return file
}

let isPopped = false
let timer: Timer | undefined
export const isPoppedOut = () => isPopped

/** After a meter reading is logged: rewrite the page if it is popped out. */
export async function refreshPage($: EngineInterface) {
  if (isPopped) await writePage($).catch(() => undefined)
}

/** /burn and the Pop out button: write the page and open its window, or (already open and not `isForced`) only
 * rewrite it; rewritten each minute from then on in this session. Resolves the line to show. */
export async function popOut($: EngineInterface, isForced = false): Promise<string> {
  const file = await writePage($)
  if (!timer) timer = $.clock.every(60_000, () => void writePage($).catch(() => undefined))
  if (isPopped && !isForced)
    return "Weekly burn is already open in its own window (refreshed now). Stool can't close that window; close it there. /burn new opens another."
  const argv = openArgv(await platformOf($), fileUrl(file))
  const r = await $.process.run(argv, { timeoutMs: 20_000 }).catch((err: unknown) => ({ exitCode: -1, stderr: String(err), stdout: '' }))
  if (r.exitCode !== 0) return `Wrote ${file} but could not open a window (${r.stderr.trim().slice(0, 160) || `exit ${r.exitCode}`}); open it in a browser.`
  isPopped = true
  return `Weekly burn opened in its own window (${file}, refreshed each minute).`
}
