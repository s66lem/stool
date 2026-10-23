// Each bundled mod's tests assume only that mod is loaded (the others' hooks would call nouns the test did not mock),
// so run each hooks/<mod>/register.spec.ts alone: copy that mod + types to a scratch plugin and `claude plugin test` it.
// Usage: node tests/run-specs.mjs [mod ...]
import { readFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mods = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(join(root, 'hooks')).filter(m => existsSync(join(root, 'hooks', m, 'register.spec.ts')))
let failed = 0
for (const m of mods) {
  const tmp = mkdtempSync(join(tmpdir(), `stool-${m}-`))
  mkdirSync(join(tmp, '.claude-plugin'))
  writeFileSync(join(tmp, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'stool', version: '0.0.0', description: `${m} alone`, types: './types/index.d.ts', userConfig: JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).userConfig }))
  cpSync(join(root, 'types'), join(tmp, 'types'), { recursive: true })
  for (const d of ['sounds', 'assets', 'skills']) if (existsSync(join(root, d))) cpSync(join(root, d), join(tmp, d), { recursive: true })
  cpSync(join(root, 'hooks', m), join(tmp, 'hooks', m), { recursive: true })
  cpSync(join(root, 'hooks/config.ts'), join(tmp, 'hooks/config.ts'))
  renameSync(join(tmp, 'hooks', m, 'register.spec.ts'), join(tmp, 'hooks', m, 'register.test.ts'))
  const ext = existsSync(join(tmp, 'hooks', m, 'register.tsx')) ? 'tsx' : 'ts'
  writeFileSync(join(tmp, 'hooks/hooks.json'), JSON.stringify({ modules: [`./${m}/register.${ext}`] }))
  const r = spawnSync('claude', ['plugin', 'test', tmp], { encoding: 'utf8', shell: true })
  // a failing test's error lines come with its name, so a failure reads without keeping the scratch plugin
  const all = (r.stdout + r.stderr).split('\n')
  const tail = all.filter((l, i) => /^\(fail\)|^ \d+ (pass|fail)/.test(l) || (l.startsWith('  ') && /^\(fail\)/.test(all[i - 1] ?? '')) || (l.startsWith('  ') && l.trim() && all.slice(Math.max(0, i - 3), i).some(p => /^\(fail\)/.test(p)))).join('\n')
  console.log(`== ${m}\n${tail}`)
  if (r.status) failed++
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
