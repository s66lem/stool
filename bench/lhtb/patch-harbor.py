# Lets Harbor's Claude Code agent load a plugin for the bench's "on" runs: when STOOL_PLUGIN_DIR is set (a folder on
# the machine running Harbor), it is uploaded to /opt/stool in the task container and passed as --plugin-dir.
# Idempotent. Usage: python patch-harbor.py <path to harbor/src/harbor/agents/installed/claude_code.py>
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
MARK = "# bench: STOOL_PLUGIN_DIR"
if MARK in src:
    print("already patched")
    sys.exit(0)

old = '''        cli_flags = self.build_cli_flags()
        extra_flags = (cli_flags + " ") if cli_flags else ""
'''
new = '''        cli_flags = self.build_cli_flags()
        extra_flags = (cli_flags + " ") if cli_flags else ""
        ''' + MARK + '''
        if os.environ.get("STOOL_PLUGIN_DIR"):
            await environment.upload_dir(os.environ["STOOL_PLUGIN_DIR"], "/opt/stool")
            extra_flags += "--plugin-dir /opt/stool --debug-file /logs/agent/claude-debug.txt "
'''
if old not in src:
    sys.exit("anchor not found: the adapter changed, patch by hand")
open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
print("patched")
