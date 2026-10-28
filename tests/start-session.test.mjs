import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { manager } from '../hooks/start-session/sessions.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(50) }
  assert.fail('timed out')
}

test('detached session survives its launcher, forwards exact prompt/cwd/config/model/name, stops its tree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stool sessions '))
  const m = manager({ root })
  try {
    const input = { prompt: 'exact "quotes"\n$HOME & `no shell`' + 'x'.repeat(40000), cwd: root, config_dir: root, model: 'sonnet', name: 'school seat' }
    const result = spawnSync(process.execPath, [join(here, 'fixtures/start-session-launch.mjs'), root], {
      encoding: 'utf8', timeout: 15000, input: JSON.stringify(input),
      env: { ...process.env, CLAUDECODE: '1', CLAUDE_SESSION_ID: 'parent', CLAUDE_CODE_SESSION_ID: 'parent' },
    })
    assert.equal(result.status, 0, result.stderr)
    const record = JSON.parse(result.stdout)
    assert.equal(record.status, 'running')
    assert.ok(record.pid && record.claude_pid)
    assert.equal(m.list()[0].status, 'running')
    await until(() => readFileSync(record.log_path, 'utf8').trim())
    const seen = JSON.parse(readFileSync(record.log_path, 'utf8'))
    assert.equal(seen.prompt, input.prompt)
    assert.equal(seen.cwd.toLowerCase(), root.toLowerCase())
    assert.equal(seen.config, root)
    assert.equal(seen.parent, undefined)
    assert.equal(seen.sessionParent, undefined)
    const args = seen.args
    assert.equal(args[args.indexOf('--session-id') + 1], record.session_id)
    assert.equal(args[args.indexOf('--model') + 1], input.model)
    assert.equal(args[args.indexOf('--name') + 1], input.name)
    assert.ok(args.includes('stream-json') && args.includes('--verbose'))
    assert.ok(!args.includes('--no-session-persistence'))
    assert.equal((await m.stop(record.session_id)).status, 'stopped')
    await until(() => { try { process.kill(record.claude_pid, 0); return false } catch { return true } })
    assert.equal(m.list()[0].status, 'stopped')
    assert.equal((await m.stop(record.session_id)).status, 'stopped')
    assert.ok(readFileSync(record.log_path, 'utf8').includes('quotes'))
  } finally {
    for (const record of m.list()) await m.stop(record.session_id)
    rmSync(root, { recursive: true, force: true })
  }
})

test('completion, startup error, validation and unrelated PID safety', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stool-sessions-'))
  const command = [process.execPath, join(here, 'fixtures/start-session-cli.mjs')]
  const m = manager({ root, command })
  try {
    await assert.rejects(m.start({ cwd: root, prompt: '' }), /prompt/)
    await assert.rejects(m.start({ cwd: 'relative', prompt: 'go' }), /cwd/)
    await assert.rejects(m.start({ cwd: root, prompt: 'go', model: '--bad' }), /model/)
    await assert.rejects(m.start({ cwd: root, prompt: 'go', config_dir: 'relative' }), /config_dir/)
    await assert.rejects(m.stop('../escape'), /session_id/)
    const done = await m.start({ cwd: root, prompt: 'complete' })
    try {
      await until(() => m.list().find(r => r.session_id === done.session_id).status === 'completed')
    } catch (e) {
      assert.fail(JSON.stringify(m.list()) + '\n' + readFileSync(done.error_log_path, 'utf8'))
    }
    assert.equal(m.list()[0].exit_code, 0)
    const file = join(root, done.session_id, 'session.json')
    writeFileSync(file, JSON.stringify({ ...done, status: 'running', pid: process.pid }))
    assert.equal((await m.stop(done.session_id)).status, 'interrupted') // never kill a reused/unrelated pid
    assert.equal(process.pid > 0, true)
    await assert.rejects(manager({ root, command: [join(root, 'missing-claude')] }).start({ cwd: root, prompt: 'go' }), /ENOENT/)
  } finally {
    for (const record of m.list()) await m.stop(record.session_id)
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop during startup waits for the supervisor and leaves no session running', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stool-startup-'))
  const m = manager({ root, command: [process.execPath, join(here, 'fixtures/start-session-cli.mjs')] })
  try {
    const starting = m.start({ cwd: root, prompt: 'keep running' })
    const id = readdirSync(root)[0]
    const initial = JSON.parse(readFileSync(join(root, id, 'session.json'), 'utf8'))
    assert.equal(initial.status, 'starting')
    assert.equal(initial.pid, undefined)
    assert.equal(m.list()[0].status, 'starting')
    const [stopped] = await Promise.all([m.stop(id), starting])
    assert.equal(stopped.status, 'stopped')
    await until(() => { try { process.kill(stopped.claude_pid, 0); return false } catch { return true } })
  } finally {
    for (const record of m.list()) await m.stop(record.session_id)
    rmSync(root, { recursive: true, force: true })
  }
})
