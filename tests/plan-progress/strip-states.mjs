// writes strip-states.html: the strip in its three keep-warm states, for a look in a browser
import fs from 'node:fs'
import { stripSvg } from './strip.mjs'
const [M, H, D] = [60_000, 3_600_000, 86_400_000]
const now = Date.now()
const usage = { cap: 4, weekly: { used: 95, resetAt: now + 2 * D + 3 * H, projected: 137, limitAt: now + 6 * H + 6 * M }, five: { used: 5, resetAt: now + 3 * H + 32 * M, projected: 17, limitAt: null }, tokens: 2_700_000 }
const rows = [
  { pings: 0, max: 10, lastAt: null, coldAt: now + 50 * M },
  { pings: 3, max: 10, lastAt: now - 10 * M, coldAt: now + 50 * M },
  { pings: 10, max: 10, lastAt: now - 70 * M, coldAt: now - 10 * M },
].map(w => stripSvg(usage, w, 780, now))
const img = s => `<div style="background:#1f1e1d;border-radius:12px;width:780px;padding:8px 0;margin:10px 0"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}" width="780" height="24" style="display:block"></div>`
fs.writeFileSync('strip-states.html', `<!doctype html><html style="color-scheme:dark"><body style="background:#141413;padding:20px">${rows.map(img).join('')}</body></html>`)
