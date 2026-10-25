# Picks the SWE-bench Pro (v2, public) instances the bench runs: one non-hard instance from each of 8 repos, fixed seed.
# Run inside the bench WSL distro: /root/venv/bin/python select.py > instances.json
import json
import random

from datasets import load_dataset

REPOS = ["NodeBB/NodeBB", "internetarchive/openlibrary", "qutebrowser/qutebrowser", "flipt-io/flipt",
         "navidrome/navidrome", "future-architect/vuls", "ansible/ansible", "element-hq/element-web"]

d = load_dataset("ScaleAI/SWE-bench_Pro", split="test")
rng = random.Random(2026)
out = []
for repo in REPOS:
    rows = [r for r in d if r["repo"] == repo and str(r["hard"]) != "True"]
    r = rng.choice(sorted(rows, key=lambda x: x["instance_id"]))
    out.append({"id": r["instance_id"], "repo": repo, "language": r["repo_language"], "base_commit": r["base_commit"], "image": r["docker_image"]})
# flipt first: its image is small (0.7 GB) and it is the one `--mode swe-smoke` runs
out.sort(key=lambda x: x["repo"] != "flipt-io/flipt")
print(json.dumps(out, indent=2))
