Fork of plan-progress 0.5.0 by Kirill Serditov (zycck, MIT, https://github.com/zycck), adding per-agent
progress bars for long sweeps: a subagent's Bash commands get `PLAN_PROGRESS_FILE` set to
`~/.claude/stool/plan-progress-runs/<agentId>.json`; a script writes `{"label","done","total"}` there and the agent's
strip shows a thin bar plus "label done/total" while the file is under 30 s old.

1.1.0 (stool): ported from zycck's plan-progress 1.0.0, adapted: the terminal bar as a braille Raster (trackCells, head glide, 30 fps frames only while a bar moves), settings window (Behavior, Effects, Speed, About), auto-close (`doneBarSeconds`), twinkle, the footer's tokens per second, per-bar fold chevron and `/progress-agents`, click controls (fold, close) in the fullscreen terminal. Left out: localisation, Omarchy/macOS/GNOME tint, his update check, his SVG switch pictures, his stage-step strip Raster (our agent rows stay text).
