import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from './fs-utils.js';
import type { InstallContext, Installer } from './types.js';

interface CopilotHookEntry {
  type?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  timeoutSec?: number;
  [key: string]: unknown;
}

interface CopilotHooksFile {
  version?: number;
  disableAllHooks?: boolean;
  hooks?: Record<string, CopilotHookEntry[]>;
  [key: string]: unknown;
}

interface CopilotMcpConfig {
  mcpServers?: Record<
    string,
    {
      type?: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      tools?: string[];
    }
  >;
  [key: string]: unknown;
}

const HOOK_NAMES: Array<[string, string, number]> = [
  ['SessionStart', 'session-start', 10],
  ['UserPromptSubmit', 'user-prompt-submit', 5],
  ['PostToolUse', 'post-tool-use', 5],
  ['Stop', 'stop', 5],
  ['SessionEnd', 'session-end', 10],
];

function copilotHome(): string {
  return process.env.COPILOT_HOME || join(homedir(), '.copilot');
}

function hooksFile(): string {
  return join(copilotHome(), 'hooks', 'cavemem.json');
}

function mcpFile(): string {
  return join(copilotHome(), 'mcp-config.json');
}

function isCavememHookEntry(entry: CopilotHookEntry, hookId: string): boolean {
  if (entry.type !== 'command') return false;
  return [entry.command, entry.bash, entry.powershell].some(
    (command) => typeof command === 'string' && command.includes(`hook run ${hookId}`),
  );
}

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function hookCommands(
  ctx: InstallContext,
  hookId: string,
): Pick<CopilotHookEntry, 'bash' | 'powershell'> {
  const args = `hook run ${hookId} --ide copilot-cli`;
  return {
    bash: `${bashQuote(ctx.nodeBin)} ${bashQuote(ctx.cliPath)} ${args}`,
    powershell: `& ${powershellQuote(ctx.nodeBin)} ${powershellQuote(ctx.cliPath)} ${args}`,
  };
}

export const copilotCli: Installer = {
  id: 'copilot-cli',
  label: 'GitHub Copilot CLI',
  async detect(_ctx): Promise<boolean> {
    return existsSync(copilotHome());
  },
  async install(ctx: InstallContext): Promise<string[]> {
    const messages: string[] = [];
    const hookPath = hooksFile();
    const mcpPath = mcpFile();

    const hooks = readJson<CopilotHooksFile>(hookPath, {});
    const hookMap: Record<string, CopilotHookEntry[]> = { ...(hooks.hooks ?? {}) };

    for (const [eventName, hookId, timeoutSec] of HOOK_NAMES) {
      const existing = hookMap[eventName] ?? [];
      const others = existing.filter((entry) => !isCavememHookEntry(entry, hookId));
      others.push({
        type: 'command',
        ...hookCommands(ctx, hookId),
        timeoutSec,
      });
      hookMap[eventName] = others;
    }

    writeJson(hookPath, { ...hooks, version: 1, hooks: hookMap });
    messages.push(`wrote ${hookPath}`);

    const mcp = readJson<CopilotMcpConfig>(mcpPath, {});
    const mcpNext: CopilotMcpConfig = {
      ...mcp,
      mcpServers: {
        ...(mcp.mcpServers ?? {}),
        cavemem: {
          type: 'stdio',
          command: ctx.nodeBin,
          args: [ctx.cliPath, 'mcp'],
          tools: ['*'],
        },
      },
    };
    writeJson(mcpPath, mcpNext);
    messages.push(`wrote ${mcpPath}`);

    return messages;
  },
  async uninstall(_ctx): Promise<string[]> {
    const messages: string[] = [];
    const hookPath = hooksFile();
    const mcpPath = mcpFile();

    if (existsSync(hookPath)) {
      const hooks = readJson<CopilotHooksFile>(hookPath, {});
      if (hooks.hooks) {
        for (const [eventName, hookId] of HOOK_NAMES) {
          const entries = hooks.hooks[eventName];
          if (!entries) continue;
          const remaining = entries.filter((entry) => !isCavememHookEntry(entry, hookId));
          if (remaining.length === 0) delete hooks.hooks[eventName];
          else hooks.hooks[eventName] = remaining;
        }
        if (Object.keys(hooks.hooks).length === 0) delete hooks.hooks;
      }
      writeJson(hookPath, hooks);
      messages.push(`updated ${hookPath}`);
    }

    if (existsSync(mcpPath)) {
      const mcp = readJson<CopilotMcpConfig>(mcpPath, {});
      if (mcp.mcpServers?.cavemem) {
        delete mcp.mcpServers.cavemem;
        if (Object.keys(mcp.mcpServers).length === 0) delete mcp.mcpServers;
      }
      writeJson(mcpPath, mcp);
      messages.push(`updated ${mcpPath}`);
    }

    return messages;
  },
};
