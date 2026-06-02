import { describe, expect, it } from 'vitest';
import { adaptHookInputForIde, formatIdeOutput } from '../src/commands/hook-protocol.js';

describe('hook command helpers', () => {
  it('keeps Claude Code additionalContext envelope', () => {
    expect(
      formatIdeOutput(
        'session-start',
        { ok: true, ms: 1, context: 'remember this' },
        'claude-code',
      ),
    ).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'remember this',
        },
      }),
    );
  });

  it('emits direct additionalContext for Copilot CLI', () => {
    expect(
      formatIdeOutput(
        'session-start',
        { ok: true, ms: 1, context: 'remember this' },
        'copilot-cli',
      ),
    ).toBe(JSON.stringify({ additionalContext: 'remember this' }));
  });

  it('does not emit output when context is empty or hook cannot inject context', () => {
    expect(formatIdeOutput('session-start', { ok: true, ms: 1 }, 'copilot-cli')).toBeUndefined();
    expect(
      formatIdeOutput('post-tool-use', { ok: true, ms: 1, context: 'ignore me' }, 'copilot-cli'),
    ).toBeUndefined();
  });

  it('maps Copilot tool result text onto cavemem tool_response', () => {
    expect(
      adaptHookInputForIde(
        {
          session_id: 's1',
          tool_result: {
            result_type: 'success',
            text_result_for_llm: 'tool output',
          },
        },
        'copilot-cli',
      ),
    ).toMatchObject({
      session_id: 's1',
      tool_response: 'tool output',
    });
  });

  it('leaves non-Copilot input untouched', () => {
    const input = {
      session_id: 's1',
      tool_result: {
        text_result_for_llm: 'tool output',
      },
    };
    expect(adaptHookInputForIde(input, 'claude-code')).toBe(input);
  });
});
