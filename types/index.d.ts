export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus }
// doneAt: when the step was finished, so a checkpoint can tell how long it took
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[]; doneAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
// one subagent shown as a state strip under a bar; depth 1 sits under its parent agent
export type AgentRun = {
  id: string
  // the number in its gutter, kept when an earlier finished strip is cleared
  n?: number
  title: string
  state: 'running' | 'waiting' | 'done' | 'error'
  tool: string
  startedAt: number
  endedAt: number | null
  depth: number
  // the model it runs on and its effort, as the engine resolved them
  model?: string
  effort?: string
  // fork: a sweep's progress, read from PLAN_PROGRESS_FILE while the agent runs
  progress?: { label: string; done: number; total: number }
}
export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  startedAt: number
  // when the plan was finished; the pill then shows the time it took
  endedAt?: number | null
  agents?: AgentRun[]
  // when the current batch of agents all finished; their strips fold a few seconds later
  agentsDoneAt?: number | null
  // the user folded the agent strips away by clicking the title; a count stays beside the percent
  folded?: boolean
}

// what the strip above the bars draws; each is written by the mod that owns it (usage-pace, keep-warm) and only read here
export type UsageWindow = {
  used: number // percent of the window used
  resetAt: number // ms epoch
  projected: number | null // percent it is on pace for at the reset; null before there is a pace
  limitAt: number | null // ms epoch it runs out at this pace; null when it does not
}
// squeeze: 0 on pace, 1 a window would run out early, 2 well early or at its stop line; the governor tightens the restart and agent limits by it
export type UsageStrip = { cap: number; squeeze: number; weekly: UsageWindow | null; five: UsageWindow | null; tokens: number }
// restart-clock's strip: context % of the lead, red on the strip once a restart is due
export type RestartStrip = { ctx: number | null; publishes: number; due: boolean }
// agent-meter's strip: each running agent's tool calls against the cap in its prompt
export type AgentMeterStrip = { agents: { id: string; desc: string; calls: number; cap: number | null }[] }
export type KeepWarmStrip = {
  pings: number // warm pings sent in this idle stretch; 0 = the ping loop is not running
  max: number
  lastAt: number | null // the last ping
  coldAt: number | null // when the cache goes cold if nothing else is sent (an hour after the last request); null = unknown
}

// capture-guard's strip: free RAM and open windows of the watched app
export type CaptureStrip = { ramFreeGB: number; appWindows: number }

declare module 'claude-code' {
  interface PluginState {
    stool: {
      plans: Plan[]
      isOpen: boolean
      // bumped every second while agents run, so elapsed times and folding redraw
      tick: number
      // each strip value is written by the bundled mod that owns it; the bars read them
      usage: UsageStrip // usage-pace
      warm: KeepWarmStrip // keep-warm
      restart: RestartStrip // restart-clock
      meter: AgentMeterStrip // agent-meter
      capture: CaptureStrip // capture-guard
      // the footer's tokens per second (main conversation, last minute); live while a response streams
      speed: { rate: number | null; isLive: boolean }
      // the settings window's choices, rewritten at every change so a reload of the mod takes them back
      prefs: { autoclose: boolean; speedShown: boolean; rev: number } | null
    }
  }
}
