import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manager } from '../../hooks/start-session/sessions.mjs'
const m = manager({ root: process.argv[2], command: [process.execPath, join(dirname(fileURLToPath(import.meta.url)), 'start-session-cli.mjs')] })
let data = ''
for await (const chunk of process.stdin) data += chunk
console.log(JSON.stringify(await m.start(JSON.parse(data))))
