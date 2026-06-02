#!/usr/bin/env bash
# scripts/e2e-publish.sh
#
# End-to-end test of the *published* npm artifact:
#   1. build → stage → npm pack    (mirrors what changeset publish does)
#   2. npm install -g into an isolated prefix
#   3. drive every Claude Code hook event with realistic payloads
#   4. verify install/uninstall, search (FTS / better-sqlite3), MCP launch
#
# This catches the things `pnpm test` cannot:
# - bin shim symlink resolution (the entrypoint guard must compare realpaths)
# - chunk shebangs (one shebang per ESM file, never two)
# - prepublishOnly staging (README, LICENSE, hooks-scripts in the tarball)
# - better-sqlite3 native module resolution from a global install
# - dynamic import of bundled @cavemem/* sub-modules
#
# Run from repo root:  bash scripts/e2e-publish.sh
# Requires: node >= 20, npm, pnpm
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$REPO/.e2e"
PACK="$WORK/pack"
PREFIX="$WORK/prefix"
HOME_DIR="$WORK/home"

node_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

REPO_NODE="$(node_path "$REPO")"

cleanup() {
  rm -rf "$PREFIX" "$HOME_DIR" "$PACK"
}
cleanup
mkdir -p "$PACK" "$PREFIX" "$HOME_DIR"

cd "$REPO"

# Embedding backfill needs the worker daemon to run. We disable autoSpawn
# during hook runs so the e2e stays deterministic — the test drives the
# worker explicitly in the checks below.
export CAVEMEM_NO_AUTOSTART=1

echo "==> 1. build everything"
pnpm build >/dev/null

echo "==> 2. stage publish files (README, LICENSE, hooks-scripts)"
pnpm --filter cavemem stage-publish

echo "==> 3. npm pack from apps/cli"
VERSION=$(REPO_NODE="$REPO_NODE" node -e "const path = require('node:path'); console.log(require(path.join(process.env.REPO_NODE, 'apps/cli/package.json')).version)")
( cd "$REPO/apps/cli" && npm pack --pack-destination "$PACK" >/dev/null )
TGZ="$PACK/cavemem-$VERSION.tgz"
test -f "$TGZ" || { echo "tarball missing at $TGZ"; ls "$PACK"; exit 1; }

echo "==> 4. inspect tarball contents"
tar -tzf "$TGZ" | sort

echo "==> 5. install -g into isolated prefix"
npm install --prefix "$PREFIX" --global "$TGZ" >/dev/null
if [ -x "$PREFIX/bin/cavemem" ]; then
  BIN="$PREFIX/bin/cavemem"
elif [ -x "$PREFIX/cavemem" ]; then
  BIN="$PREFIX/cavemem"
elif [ -f "$PREFIX/cavemem.cmd" ]; then
  BIN="$PREFIX/cavemem.cmd"
else
  echo "bin shim missing"
  exit 1
fi

# All subsequent commands run in an isolated $HOME so we never touch the real ~/.cavemem
export HOME="$HOME_DIR"
export USERPROFILE="$(node_path "$HOME_DIR")"
export COPILOT_HOME="$(node_path "$HOME_DIR/.copilot")"

echo "==> 6. version (must match apps/cli/package.json#version)"
EXPECTED_VERSION=$(REPO_NODE="$REPO_NODE" node -e "const path = require('node:path'); console.log(require(path.join(process.env.REPO_NODE, 'apps/cli/package.json')).version)")
ACTUAL_VERSION=$("$BIN" --version)
test "$ACTUAL_VERSION" = "$EXPECTED_VERSION" || {
  echo "version mismatch: bin reports '$ACTUAL_VERSION', package.json says '$EXPECTED_VERSION'"
  exit 1
}
echo "$ACTUAL_VERSION"

echo "==> 7. install --ide claude-code"
"$BIN" install --ide claude-code

echo "==> 8. claude settings written"
test -f "$HOME/.claude/settings.json"
grep -q "hook run session-start --ide claude-code" "$HOME/.claude/settings.json"

echo "==> 8b. install --ide copilot-cli"
"$BIN" install --ide copilot-cli

echo "==> 8c. copilot cli config written"
test -f "$HOME/.copilot/hooks/cavemem.json"
test -f "$HOME/.copilot/mcp-config.json"
grep -q "hook run session-start --ide copilot-cli" "$HOME/.copilot/hooks/cavemem.json"
grep -q '"cavemem"' "$HOME/.copilot/mcp-config.json"

echo "==> 9. drive full hook lifecycle"
echo '{"session_id":"e2e","hook_event_name":"SessionStart","source":"startup","cwd":"/tmp"}' | "$BIN" hook run session-start --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"UserPromptSubmit","prompt":"Edit the broken /etc/hosts file"}' | "$BIN" hook run user-prompt-submit --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.ts"},"tool_response":{"success":true}}' | "$BIN" hook run post-tool-use --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"Stop","last_assistant_message":"shipped the migration"}' | "$BIN" hook run stop --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"SessionEnd","reason":"logout"}' | "$BIN" hook run session-end --ide claude-code

echo "==> 10. resume idempotency (same session_id, source=resume)"
echo '{"session_id":"e2e","hook_event_name":"SessionStart","source":"resume"}' | "$BIN" hook run session-start --ide claude-code

echo "==> 11. new session emits hookSpecificOutput JSON to stdout"
out=$(echo '{"session_id":"e2e-2","hook_event_name":"SessionStart","source":"startup"}' | "$BIN" hook run session-start --ide claude-code 2>/dev/null)
echo "$out" | grep -q '"hookSpecificOutput"' || { echo "missing hookSpecificOutput"; exit 1; }
echo "$out" | grep -q '"additionalContext"' || { echo "missing additionalContext"; exit 1; }

echo "==> 11b. copilot cli emits direct additionalContext JSON"
out=$(echo '{"session_id":"e2e-copilot","hook_event_name":"SessionStart","source":"startup"}' | "$BIN" hook run session-start --ide copilot-cli 2>/dev/null)
echo "$out" | grep -q '"additionalContext"' || { echo "missing copilot additionalContext"; exit 1; }
! echo "$out" | grep -q '"hookSpecificOutput"' || { echo "copilot output used Claude envelope"; exit 1; }

echo "==> 11c. copilot cli PostToolUse payload maps tool_result text"
echo '{"session_id":"e2e-copilot","hook_event_name":"PostToolUse","tool_name":"bash","tool_input":{"command":"printf copilot-output-marker"},"tool_result":{"result_type":"success","text_result_for_llm":"copilot-output-marker"}}' | "$BIN" hook run post-tool-use --ide copilot-cli

echo "==> 12. search via FTS (better-sqlite3 native)"
"$BIN" search "hosts" | grep -q "hosts" || { echo "FTS search returned no hits"; exit 1; }
"$BIN" search "copilot-output-marker" | grep -q "copilot-output-marker" || { echo "copilot PostToolUse was not indexed"; exit 1; }

echo "==> 13. doctor reports healthy"
"$BIN" doctor

echo "==> 13b. status command runs and reports observation count"
"$BIN" status

echo "==> 13c. config show works and includes descriptions"
"$BIN" config show | grep -q "embedding.provider" || { echo "config show missing embedding.provider"; exit 1; }
"$BIN" config path | grep -q "settings.json" || { echo "config path broken"; exit 1; }

echo "==> 14. MCP server launches without crashing on init"
HOME="$HOME_DIR" "$BIN" mcp </dev/null >/dev/null 2>&1 &
mcp_pid=$!
sleep 0.4
if ! kill -0 $mcp_pid 2>/dev/null; then
  wait $mcp_pid || true
  # If mcp errored on a closed stdin that's actually fine — but fail loudly
  # if it crashed with the chunk-shebang syntax error we used to ship.
  out=$("$BIN" mcp </dev/null 2>&1 || true)
  if echo "$out" | grep -q "Invalid or unexpected token"; then
    echo "FAIL: mcp crashed with shebang syntax error: $out"
    exit 1
  fi
fi
kill $mcp_pid 2>/dev/null || true
wait $mcp_pid 2>/dev/null || true

echo "==> 15. uninstall cleans up settings"
"$BIN" uninstall --ide claude-code
grep -q "cavemem" "$HOME/.claude/settings.json" && { echo "uninstall left cavemem entry"; exit 1; }
"$BIN" uninstall --ide copilot-cli
grep -q "cavemem" "$HOME/.copilot/hooks/cavemem.json" && { echo "copilot uninstall left hook entry"; exit 1; }
grep -q '"cavemem"' "$HOME/.copilot/mcp-config.json" && { echo "copilot uninstall left mcp entry"; exit 1; }

echo
echo "ALL CHECKS PASSED"
cleanup
