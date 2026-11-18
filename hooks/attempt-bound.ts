// $.tool.register and $.command.register throw until the session is bound ("no session is bound
// ... catch it and carry on"). A hook that throws before next() is skipped and nothing is said, so
// a session resumed after a reboot loses every tool whose session.start handler registers it as its
// first act. plan_progress keeps its tool because that handler awaits the store and config first,
// and the bind lands during the wait. The same wait, here, before the register: the engine awaits
// session.start before the first prompt, so a tool that lands here is listed from the first turn.
const UNBOUND = 'no session is bound'
// a few turns of the event loop, then a short backoff. The bind is the REPL mounting, not a long job.
const GAP_MS = [0, 0, 0, 0, 20, 50, 100, 200, 400, 800, 1600]

export async function attemptBound(run: () => Promise<unknown>, sleep: (ms: number) => Promise<unknown>) {
  for (let i = 0; ; i++) {
    try {
      return await run()
    } catch (err) {
      const gap = GAP_MS[i]
      if (gap === undefined || !String(err).includes(UNBOUND)) throw err
      await sleep(gap)
    }
  }
}
