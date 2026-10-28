let prompt = ''
for await (const chunk of process.stdin) prompt += chunk
console.log(JSON.stringify({ prompt, cwd: process.cwd(), args: process.argv.slice(2),
  config: process.env.CLAUDE_CONFIG_DIR, parent: process.env.CLAUDECODE, sessionParent: process.env.CLAUDE_SESSION_ID }))
if (prompt !== 'complete') setInterval(() => {}, 1000)
