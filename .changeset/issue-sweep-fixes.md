---
'@cavemem/config': patch
'@cavemem/installers': minor
'@cavemem/embedding': patch
'cavemem': minor
---

Issue sweep: fix six bugs across config, installers, and embedding.

- **config (#25):** Correct the inverted description for `search.alpha`. The
  ranker computes `alpha * bm25 + (1 - alpha) * cosine`, so `1 = pure BM25`
  and `0 = pure cosine`. Doc-only — no behavior change.
- **installers/claude-code (#19):** Write the cavemem MCP server entry to
  `~/.claude.json` instead of `~/.claude/settings.json`. Newer Claude Code
  reads MCP config from `~/.claude.json`; the previous location was silently
  ignored. Hooks continue to live in `~/.claude/settings.json`. Legacy
  `mcpServers.cavemem` entries in `settings.json` are migrated out on
  install.
- **installers/claude-code (#12):** Stop overwriting pre-existing entries in
  `hooks.SessionStart` / `PostToolUse` / etc. The installer now appends
  cavemem's hook to whatever is already there and writes a one-shot
  `settings.json.pre-cavemem-<unix-ts>` backup before mutating a file with
  prior hooks. Re-running install no longer duplicates cavemem entries.
- **installers/codex (#17):** Switch from `~/.codex/config.json` (which
  Codex never read) to `~/.codex/config.toml` with the `[features]
  codex_hooks = true` flag and an `[mcp_servers.cavemem]` table. Also write
  `~/.codex/hooks.json` with `SessionStart` / `UserPromptSubmit` /
  `PostToolUse` / `Stop` entries so observations are actually captured.
  Adds `smol-toml` as a dependency (bundled into the CLI dist).
- **installers/opencode (#14):** Drop a generated plugin at
  `~/.config/opencode/plugins/cavemem.js` that hooks into
  `session.created` / `session.idle` / `tool.execute.before` /
  `tool.execute.after` and forwards to `cavemem hook run …`. Previously the
  installer only registered an MCP server and no hooks fired at all, so
  observations were empty. Plugin is registered in `opencode.json` and
  uses detached `child_process.spawn` so the IDE never blocks on a hook.
  Path migrated to OpenCode's documented global config location
  (`~/.config/opencode/`, honoring `XDG_CONFIG_HOME`).
- **embedding (#20):** Detect musl libc (Alpine, musl-built Node) before
  importing `@xenova/transformers`. The bundled `onnxruntime-node` prebuilts
  target glibc and have segfaulted on Alpine in the wild; we now throw a
  clean error pointing at `embedding.provider: 'none' | 'ollama'`.
