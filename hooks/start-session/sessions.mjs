// A short-lived tool helper launches a detached supervisor; plugin reloads do not own its lifetime.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(import.meta.url)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pause = ms => new Promise(r => setTimeout(r, ms))
const read = path => JSON.parse(readFileSync(path, 'utf8'))
function write(path, data) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
}
function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
function owned(record) {
  if (!record.pid || !alive(record.pid)) return false
  const r = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(record.pid)}').CommandLine`], { encoding: 'utf8', windowsHide: true })
    : spawnSync('ps', ['-p', String(record.pid), '-o', 'args='], { encoding: 'utf8' })
  return r.status === 0 && r.stdout.includes(helper) && r.stdout.includes(record.session_id)
}

export function manager({ root = join(homedir(), '.claude', 'stool', 'started-sessions'), command = [process.platform === 'win32' ? 'claude.exe' : 'claude'] } = {}) {
  const recordPath = id => {
    if (!uuid.test(id)) throw new Error('Invalid session_id')
    return join(root, id, 'session.json')
  }
  return {
    async start(input) {
      if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('prompt is required')
      if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd) || !statSync(input.cwd).isDirectory()) throw new Error('cwd must be an existing absolute directory')
      for (const key of ['model', 'name', 'config_dir']) {
        if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim() || input[key].includes('\0'))) throw new Error(`Invalid ${key}`)
      }
      if (input.model?.startsWith('-')) throw new Error('Invalid model')
      if (input.config_dir && (!isAbsolute(input.config_dir) || !statSync(input.config_dir).isDirectory())) throw new Error('config_dir must be an existing absolute directory')
      const session_id = randomUUID()
      const file = recordPath(session_id)
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      const record = { session_id, name: input.name || null, cwd: resolve(input.cwd),
        config_dir: resolve(input.config_dir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')),
        model: input.model || null, status: 'starting', created_at: new Date().toISOString(),
        log_path: join(dirname(file), 'output.jsonl'), error_log_path: join(dirname(file), 'stderr.log') }
      write(file, record)
      write(join(dirname(file), 'input.json'), { prompt: input.prompt, command })
      const worker = spawn(process.execPath, [helper, 'run', file], { detached: true, stdio: 'ignore', windowsHide: true })
      await new Promise((yes, no) => { worker.once('spawn', yes); worker.once('error', no) })
      worker.unref()
      for (let i = 0; i < 100; i++) {
        const current = read(file)
        if (current.status !== 'starting') {
          if (current.status === 'failed') throw new Error(current.error || `Claude exited ${current.exit_code}; see ${current.error_log_path}`)
          return current
        }
        await pause(50)
      }
      throw new Error(`Supervisor startup timed out; inspect ${file}`)
    },
    list() {
      if (!existsSync(root)) return []
      return readdirSync(root).filter(id => uuid.test(id)).map(id => {
        const file = recordPath(id)
        let record = read(file)
        if (record.status === 'starting' && !record.pid && Date.now() - Date.parse(record.created_at) < 10000) return record
        if (['running', 'starting'].includes(record.status) && !owned(record)) {
          // Process inspection can overlap normal completion; never overwrite the supervisor's newer record.
          record = read(file)
          if (['running', 'starting'].includes(record.status)) record.status = 'interrupted'
        }
        return record
      })
    },
    async stop(id) {
      const file = recordPath(id)
      let record = read(file)
      // A list can expose the UUID before the supervisor has assigned its PID.
      for (let i = 0; record.status === 'starting' && !record.pid && i < 100; i++) {
        await pause(50)
        record = read(file)
      }
      if (record.status === 'starting' && !record.pid) throw new Error('Supervisor is still starting; retry stop_session')
      if (['running', 'starting'].includes(record.status) && owned(record)) {
        if (process.platform === 'win32') {
          const result = spawnSync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
          if (result.status !== 0 && alive(record.pid)) throw new Error(result.stderr || 'taskkill failed')
        } else {
          try { process.kill(-record.pid, 'SIGTERM') } catch (e) { if (e.code !== 'ESRCH') throw e }
          await pause(500)
          // The supervisor may exit first; stubborn descendants still belong to its detached process group.
          try { process.kill(-record.pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
        }
        record.status = 'stopped'
        record.ended_at = new Date().toISOString()
        write(file, record)
      } else if (['running', 'starting'].includes(record.status)) {
        const current = read(file)
        if (!['running', 'starting'].includes(current.status)) return current
        record.status = 'interrupted'
      }
      return record
    },
  }
}

async function run(file) {
  const record = read(file)
  const { prompt, command } = read(join(dirname(file), 'input.json'))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: record.config_dir }
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_PARENT_SESSION_ID']) delete env[key]
  const args = [...command.slice(1), '-p', '--verbose', '--output-format', 'stream-json', '--session-id', record.session_id]
  if (record.model) args.push('--model', record.model)
  if (record.name) args.push('--name', record.name)
  const out = openSync(record.log_path, 'a', 0o600)
  const err = openSync(record.error_log_path, 'a', 0o600)
  const child = spawn(command[0], args, { cwd: record.cwd, env, stdio: ['pipe', out, err], windowsHide: true })
  closeSync(out)
  closeSync(err)
  child.stdin.on('error', () => {}) // startup failure may close stdin before it accepts the prompt
  child.once('spawn', () => {
    Object.assign(record, { pid: process.pid, claude_pid: child.pid, status: 'running' })
    write(file, record)
    child.stdin.end(prompt)
  })
  child.once('error', error => {
    Object.assign(record, { status: 'failed', error: error.message, ended_at: new Date().toISOString() })
    write(file, record)
  })
  child.once('exit', (code, signal) => {
    // A concurrent stop owns its final status.
    if (read(file).status === 'stopped') return
    Object.assign(record, { status: code === 0 ? 'completed' : 'failed', exit_code: code, signal, ended_at: new Date().toISOString() })
    write(file, record)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === helper) {
  try {
    const [action, arg] = process.argv.slice(2)
    if (action === 'run') await run(arg)
    else {
      let data = ''
      for await (const chunk of process.stdin) data += chunk
      const input = JSON.parse(data || '{}')
      const m = manager()
      const result = action === 'start' ? await m.start(input) : action === 'list' ? m.list() : action === 'stop' ? await m.stop(input.session_id) : (() => { throw new Error('Unknown action') })()
      process.stdout.write(JSON.stringify(result) + '\n')
    }
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
