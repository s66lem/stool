# SWE-bench Pro part of the bench

`--mode full` and `--mode swe-smoke` run instances from the public [SWE-bench Pro](https://github.com/scaleapi/SWE-bench_Pro-os) set (v2), graded by the benchmark's own hidden tests, so the result is a known score as well as a cost.

## How a run works
1. `swe.sh prepare` pulls the instance's image (`ghcr.io/scaleapi/swe-bench_pro-v2:<id>`), starts a container with no network, and exports the repository at its base commit into the run folder.
2. Claude Code works in that folder on the host. The prompt is the task's own `instruction.md` with one change (the repository is in the current folder, not `/app`) plus one note: a command that runs anything in the instance's environment (`swe.sh envrun`), which applies the current changes to the container's `/app` and runs the command there.
3. `swe.sh grade` starts a fresh container, applies the folder's diff, copies in the task's `tests/`, and runs its `test.sh`; reward 1 is a pass.
4. The container is removed after each run, and the image after the instance's last run.

Both setups get the same prompt, the same environment command and the same grading; only stool differs.

## One-time setup (Windows, no admin)
WSL2 must be enabled. Then:
```bash
wsl --install Ubuntu-24.04 --name bench --location <a drive with room>\wsl\bench --no-launch
wsl -d bench -u root -- bash -c "apt-get update && apt-get install -y docker.io git python3-venv"
wsl -d bench -u root -- bash -c "cd /root && git clone --depth 1 https://github.com/scaleapi/SWE-bench_Pro-os && python3 -m venv venv && venv/bin/pip install datasets"
```
Images go inside the distro's disk, so put the distro on a drive with tens of GB free; run folders go to `--work`.

## Choosing instances
`select.py` (run in the distro with `/root/venv/bin/python`) writes `instances.json`: one non-hard instance from each of 8 repositories (Go, Python, JavaScript), fixed seed, flipt first because `swe-smoke` runs it.

## Checking the harness for free
For any instance: grade the untouched export (expect 0), then apply the task's `solution/gold_patch.diff` and grade again (expect 1). No model calls.
