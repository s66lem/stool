// shared by the parts: reading the plugin's userConfig options and the one folder scope (`projectRoots`)
import type { Register } from 'claude-code'

export type Opts = Parameters<Register>[1]

export const flag = (o: Opts, k: string) => o?.[k] === true
export const text = (o: Opts, k: string, d = '') => (typeof o?.[k] === 'string' ? (o[k] as string) : d)
export const num = (o: Opts, k: string, d: number) => (typeof o?.[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d)
export const roots = (o: Opts): string[] => (Array.isArray(o?.projectRoots) ? (o.projectRoots as string[]).filter(r => typeof r === 'string' && r.trim()) : [])
// a user-written pattern: an invalid one matches nothing instead of breaking the part
export const pattern = (src: string, flags = ''): RegExp => {
  try {
    return new RegExp(src, flags)
  } catch {
    return /(?!)/
  }
}

// the in-the-wild trial: with `trial` on, a session lands in the "off" arm (cost levers disabled) when its id hashes
// under `trialOffShare` percent; the same id always lands in the same arm. pure: no $ across imports
export const trialOff = (o: Opts, sessionId: string) => {
  if (!flag(o, 'trial')) return false
  let h = 2166136261
  for (const ch of sessionId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h % 100 < num(o, 'trialOffShare', 20)
}

// lower case, forward slashes, no trailing slash, git-bash `/c/x` as `c:/x`
export const norm = (p: string) =>
  p.split(String.fromCharCode(92)).join('/').replace(/^\/([a-z])\//i, (_m, d: string) => d + ':/').replace(/\/+$/, '').toLowerCase()

// no roots set = every folder; else the session's folder is one of them or below one
export const inScope = (cwd: string, rs: readonly string[]) => rs.length === 0 || rs.some(r => (norm(cwd) + '/').startsWith(norm(r) + '/'))

// `~/x` -> the user's home folder (USERPROFILE, else HOME) with forward slashes; other paths as given
// pure: the 2.1.295 module compiler refuses $ passed into an imported function
export const expand = (home: string | undefined, p: string): string =>
  p.startsWith("~") ? (home ?? "").split(String.fromCharCode(92)).join("/") + p.slice(1) : p
export const SLOT_DEFAULT = '~/.claude/stool/agent-slots.json'
