# GitHub Copilot CLI

cavemem can wire into the standalone GitHub Copilot CLI through hooks and MCP:

```sh
cavemem install --ide copilot-cli
```

This targets the current `copilot` CLI, not the retired `gh copilot` GitHub CLI extension.

## What gets written

By default, install writes:

```text
~/.copilot/hooks/cavemem.json
~/.copilot/mcp-config.json
```

If `COPILOT_HOME` is set, cavemem writes under that directory instead:

```text
$COPILOT_HOME/hooks/cavemem.json
$COPILOT_HOME/mcp-config.json
```

The hook file registers `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, and `SessionEnd` events. The MCP file registers the existing cavemem stdio server:

```json
{
  "mcpServers": {
    "cavemem": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cavemem/dist/index.js", "mcp"],
      "tools": ["*"]
    }
  }
}
```

## How memory flows

Hooks capture session events and write observations locally through `MemoryStore`.

Copilot reads memory by calling cavemem's MCP tools:

| Tool | Purpose |
|---|---|
| `search` | Find compact memory hits for a query |
| `timeline` | List nearby observation IDs for a session |
| `get_observations` | Fetch full expanded observation bodies |
| `list_sessions` | List recent sessions |

## Limitations

- `Stop` does not currently parse Copilot transcript files. Turn summaries depend on payloads that include a summary or last assistant message.
- VS Code Copilot is separate from Copilot CLI and is not installed by `--ide copilot-cli`.
- GitHub Copilot cloud agent cannot read a local cavemem SQLite store unless you expose cavemem through a remote MCP server.

## Uninstall

```sh
cavemem uninstall --ide copilot-cli
```

Uninstall removes only cavemem entries and preserves unrelated Copilot hooks and MCP servers.
