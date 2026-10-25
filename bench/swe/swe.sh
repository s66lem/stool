#!/bin/bash
# SWE-bench Pro helper, run inside the bench WSL distro as root (Docker lives there).
#   swe.sh prepare <instance> <image> <base_commit> <workdir>   start the run's container, export the repo to <workdir>
#   swe.sh envrun  <runid> <workdir> <command...>               apply <workdir>'s changes to the container's /app, run the command there
#   swe.sh grade   <instance> <image> <workdir>                 fresh container + the task's hidden tests; prints REWARD=0|1
#   swe.sh cleanup <runid>                                      remove the run's container
#   swe.sh rmi     <image>                                      remove an instance image
# <workdir> is a Linux path (/mnt/g/...). Task files come from the harness clone in $TASKS.
set -uo pipefail
TASKS=${TASKS:-/root/SWE-bench_Pro-os/v2/tasks}
cmd=$1; shift
g() { git -c safe.directory='*' -c core.autocrlf=false "$@"; }

# the work dir's changes against its first commit, untracked files included, as one patch on stdout
diffof() {
  g -C "$1" add -A >/dev/null 2>&1
  g -C "$1" diff --cached --binary "$(g -C "$1" rev-list --max-parents=0 HEAD)"
}

case "$cmd" in
  prepare)
    inst=$1 image=$2 base=$3 work=$4
    docker pull -q "$image" >/dev/null || exit 1
    docker rm -f "c-${work##*/}" >/dev/null 2>&1
    docker run -d --name "c-${work##*/}" --network none --entrypoint sleep "$image" infinity >/dev/null || exit 1
    mkdir -p "$work"
    docker exec "c-${work##*/}" git -c safe.directory='*' -C /app archive "$base" | tar -x -C "$work"
    ;;
  envrun)
    run=$1 work=$2; shift 2
    c="c-$run"
    # back to the base state (tracked files only: installed dependencies, which git ignores, stay), then the patch
    docker exec "$c" bash -c "cd /app && git -c safe.directory='*' checkout -q . && git -c safe.directory='*' clean -fdq" >/dev/null 2>&1
    diffof "$work" | docker exec -i "$c" bash -c "cd /app && git -c safe.directory='*' apply --whitespace=nowarn - 2>&1" || true
    # long outputs are cut to their tail, the same for both setups
    docker exec "$c" bash -lc "cd /app && $*" 2>&1 | tail -n 300
    ;;
  grade)
    inst=$1 image=$2 work=$3
    c="g-${work##*/}"
    docker rm -f "$c" >/dev/null 2>&1
    docker run -d --name "$c" --entrypoint sleep "$image" infinity >/dev/null || { echo "REWARD=0"; exit 0; }
    docker cp "$TASKS/$inst/tests" "$c:/tests" >/dev/null
    diffof "$work" > "/tmp/$c.patch"
    docker cp "/tmp/$c.patch" "$c:/tmp/agent.patch" >/dev/null
    docker exec "$c" bash -c "cd /app && git -c safe.directory='*' apply --whitespace=nowarn /tmp/agent.patch" >/dev/null 2>&1 || echo "patch did not apply" >&2
    timeout 3000 docker exec "$c" bash /tests/test.sh >"/tmp/$c.log" 2>&1
    r=$(docker exec "$c" cat /logs/verifier/reward.txt 2>/dev/null || echo 0)
    docker rm -f "$c" >/dev/null 2>&1
    echo "REWARD=${r//[^01]/}"
    ;;
  cleanup) docker rm -f "c-$1" >/dev/null 2>&1; true ;;
  rmi) docker rmi -f "$1" >/dev/null 2>&1; true ;;
  *) echo "unknown: $cmd" >&2; exit 2 ;;
esac
