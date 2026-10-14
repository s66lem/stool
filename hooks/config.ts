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
