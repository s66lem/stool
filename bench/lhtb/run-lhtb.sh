#!/bin/bash
# LHTB part of the bench, run inside the "bench" WSL distro as root.
#   run-lhtb.sh <task-path> <off|on> <model> <timeout-multiplier> <jobs-dir> [stool-dir]
# Claude Code runs inside the task's container via Harbor; "on" mounts <stool-dir> (patch-harbor.py applied) and
# loads it with --plugin-dir. The sign-in token comes from /mnt/g/wsl/secrets/oauth and is never printed.
set -uo pipefail
task=$1 setup=$2 model=$3 mult=$4 jobs=$5 stool=${6:-}
export CLAUDE_CODE_OAUTH_TOKEN="$(cat /mnt/g/wsl/secrets/oauth)"
unset ANTHROPIC_API_KEY
if [ "$setup" = on ]; then export STOOL_PLUGIN_DIR="$stool"; else unset STOOL_PLUGIN_DIR; fi
cd /root/LHTB
# continue_until_timeout is the harness's keep-going-until-time-runs-out behavior; off in a private copy of the task
# so the cost is the task's own work, the same for both setups
copy=/root/lhtb-tasks/$(basename "$task")-$setup
rm -rf "$copy"; mkdir -p /root/lhtb-tasks; cp -r "$task" "$copy"
sed -i -e 's/^continue_until_timeout *= *true/continue_until_timeout = false/' -e 's/^allow_internet *= *false/allow_internet = true/' "$copy/task.toml"  # Claude Code in the container needs the network (install + API); the same for both setups
timeout 14400 /root/hvenv/bin/harbor run -p "$copy" -e docker -a claude-code -m "$model" -n 1 \
  --timeout-multiplier "$mult" --jobs-dir "$jobs" --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" 2>&1 | sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-***/g' | tail -n 40
