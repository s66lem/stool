export const flag = (o, k) => o?.[k] === true;
export const text = (o, k, d = '') => (typeof o?.[k] === 'string' ? o[k] : d);
export const num = (o, k, d) => (typeof o?.[k] === 'number' && Number.isFinite(o[k]) ? o[k] : d);
export const roots = (o) => (Array.isArray(o?.projectRoots) ? o.projectRoots.filter(r => typeof r === 'string' && r.trim()) : []);
// a user-written pattern: an invalid one matches nothing instead of breaking the part
export const pattern = (src, flags = '') => {
    try {
        return new RegExp(src, flags);
    }
    catch {
        return /(?!)/;
    }
};
// lower case, forward slashes, no trailing slash, git-bash `/c/x` as `c:/x`
export const norm = (p) => p.split(String.fromCharCode(92)).join('/').replace(/^\/([a-z])\//i, (_m, d) => d + ':/').replace(/\/+$/, '').toLowerCase();
// no roots set = every folder; else the session's folder is one of them or below one
export const inScope = (cwd, rs) => rs.length === 0 || rs.some(r => (norm(cwd) + '/').startsWith(norm(r) + '/'));
// `~/x` -> the user's home folder (USERPROFILE, else HOME) with forward slashes; other paths as given
// pure: the 2.1.295 module compiler refuses $ passed into an imported function
export const expand = (home, p) => p.startsWith("~") ? (home ?? "").split(String.fromCharCode(92)).join("/") + p.slice(1) : p;
export const SLOT_DEFAULT = '~/.claude/stool/agent-slots.json';
