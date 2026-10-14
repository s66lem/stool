import { expect, test, tier } from 'claude-code/testing'

import { inScope } from '../config'
import { check } from './register'

tier('user')

const OPT = { options: { projectRoots: ['C:/Users/dev/work'], leadGuard: true, leadGuardImageNudge: true } }

const ROOT = 'C:/Users/dev/work/app'
const bad = [
  'git add -A',
  'git add .',
  'git -C x add --all && git commit -m a',
  "sed -i 's/a/b/' docs/HANDOFF.md",
  `node -e "require('fs').writeFileSync('docs/HANDOFF.md','x')"`,
  "cat > docs/TODO.md <<'EOF'\nx\nEOF",
  "python -c \"open('CLAUDE.md','w').write('x')\"",
  "Set-Content docs/TODO.md 'x'",
  'node tools/check.mjs | tail -5',
  'cd C:/Users/dev && ls',
  'cd /c/Users/dev/elsewhere; git status',
  'ls && cd ..',
  'cd ~',
  '(ls) && cd ..',
]
const good = [
  'git add src/a.luau docs/TODO.md',
  'git add .gitignore',
  'sed -n 1,5p docs/HANDOFF.md',
  "node -e \"console.log(require('fs').readFileSync('docs/x.md','utf8'))\"",
  'node tools/splice-lines.mjs docs/HANDOFF.md 3 9 f.txt',
  'set -o pipefail; node tools/check.mjs | tail -5',
  'node tools/check.mjs',
  'cd "C:/Users/dev/work/app/tools" && ls',
  'cd src && ls',
  '(cd C:/Users/dev/plugins/x && git status)',
  'echo $(cd /tmp && pwd)',
  'git commit -m "docs: writeFile notes" ',
]

test('check denies the slips and passes the sanctioned forms', () => {
  for (const c of bad) expect(check(c, ROOT), c).toBeDefined()
  for (const c of good) expect(check(c, ROOT), c).toBeUndefined()
})

test('scope is the configured project folder', () => {
  expect(inScope(ROOT, ['C:/Users/dev/work'])).toBe(true)
  expect(inScope('C:\\Users\\dev\\work\\other', ['C:/Users/dev/work'])).toBe(true)
  expect(inScope('C:/Users/dev/elsewhere', ['C:/Users/dev/work'])).toBe(false)
})

const session = { surface: null, isInteractive: false, cwd: ROOT }

test('the lead is denied, a subagent is not; the 3rd still read is nudged', OPT, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(session)
  const lead = await $.tool.call({ tool: 'Bash', command: 'git add -A' })
  expect(lead.deny).toContain('lead-guard')
  const sub = await $.tool.call({ tool: 'Bash', command: 'git add -A', agentId: 'a1' } as never)
  expect(sub.deny).toBeUndefined()
  const ctx: unknown[] = []
  for (let i = 0; i < 3; i++) ctx.push((await $.tool.call({ tool: 'Read', file_path: `x${i}.png` })).context)
  expect(ctx[1]).toBeUndefined()
  expect(String(ctx[2])).toContain('read #3')
})
