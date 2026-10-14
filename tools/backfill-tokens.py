# Backfill this week's token count for the strip from Claude Code's own session transcripts.
# Sums every assistant response's usage (input + output + cache read + cache write) since the weekly window opened,
# main sessions and subagents alike, one count per response (a response is written once per content block, and again
# when a session is resumed, so it is counted by its message id). Prints the total; --write puts it in the mod's store.
# Run: python tools/backfill-tokens.py 2026-10-15T10:00:00.000Z [--write]
import glob
import json
import os
import sys
from datetime import datetime, timedelta, timezone

reset = sys.argv[1]
end = datetime.fromisoformat(reset.replace("Z", "+00:00"))
start = end - timedelta(days=7)
home = os.path.expanduser("~/.claude")
seen = {}
files = 0
for path in glob.glob(os.path.join(home, "projects", "**", "*.jsonl"), recursive=True):
    if datetime.fromtimestamp(os.path.getmtime(path), timezone.utc) < start:
        continue
    files += 1
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            if '"usage"' not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            msg = row.get("message") or {}
            usage = msg.get("usage")
            stamp = row.get("timestamp")
            if not usage or not stamp or not msg.get("id"):
                continue
            at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if not (start <= at < end):
                continue
            total = sum(
                usage.get(k) or 0
                for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
            )
            # the last line of a response carries its final counts
            seen[msg["id"]] = max(seen.get(msg["id"], 0), total)

total = sum(seen.values())
print(f"{files} transcripts, {len(seen)} responses, {total} tokens since {start.isoformat()}")
if "--write" in sys.argv:
    stores = glob.glob(os.path.join(home, "plugins", "store", "usage-pace_*.json"))
    for store in stores:
        data = json.load(open(store, encoding="utf8"))
        key = f"tokens:{reset}"
        print(f"{os.path.basename(store)}: {data.get(key)} -> {total}")
        data[key] = total
        json.dump(data, open(store, "w", encoding="utf8", newline="\n"), indent=2)
