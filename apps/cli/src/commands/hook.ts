import { type HookName, type HookResult, runHook } from '@cavemem/hooks';
import type { Command } from 'commander';
import { adaptHookInputForIde, formatIdeOutput } from './hook-protocol.js';

const VALID: HookName[] = [
  'session-start',
  'user-prompt-submit',
  'post-tool-use',
  'stop',
  'session-end',
];

export function registerHookCommand(program: Command): void {
  const hook = program.command('hook').description('Internal: hook handler entrypoints');
  hook
    .command('run <name>')
    .description('Run a hook by name (reads JSON from stdin)')
    .option('--ide <name>', 'IDE that invoked the hook (Claude Code does not send this)')
    .action(async (name: string, opts: { ide?: string }) => {
      if (!VALID.includes(name as HookName)) {
        // Stay non-blocking: the IDE's hook config could be stale.
        process.stderr.write(`${JSON.stringify({ ok: false, error: `unknown hook ${name}` })}\n`);
        process.exitCode = 1;
        return;
      }
      const hookName = name as HookName;
      const raw = await readStdin();
      const parsed = raw.trim() ? safeJson(raw) : {};
      const adapted = adaptHookInputForIde(parsed, opts.ide);
      const input = {
        session_id: typeof adapted.session_id === 'string' ? adapted.session_id : 'unknown',
        ...adapted,
        ...(opts.ide ? { ide: opts.ide } : {}),
      } as Parameters<typeof runHook>[1];

      const result = await runHook(hookName, input);

      // Telemetry always goes to stderr — stdout is reserved for the IDE's
      // hook protocol and any text we put there is interpreted (e.g. injected
      // as additionalContext).
      process.stderr.write(`${JSON.stringify({ hook: hookName, ...result })}\n`);

      if (!result.ok) {
        // Non-blocking error: stderr already carries the structured payload;
        // exit 1 surfaces it in the IDE's hook log without blocking the turn.
        process.exitCode = 1;
        return;
      }

      writeIdeOutput(hookName, result, opts.ide);
    });
}

function writeIdeOutput(hook: HookName, result: HookResult, ide?: string): void {
  const payload = formatIdeOutput(hook, result, ide);
  if (payload) process.stdout.write(`${payload}\n`);
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}
