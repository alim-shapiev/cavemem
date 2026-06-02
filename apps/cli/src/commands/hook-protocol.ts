type ContextHookName =
  | 'session-start'
  | 'user-prompt-submit'
  | 'post-tool-use'
  | 'stop'
  | 'session-end';

interface HookResultLike {
  ok?: boolean;
  ms?: number;
  context?: string;
}

const CLAUDE_EVENT_NAME: Record<ContextHookName, string> = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
  'session-end': 'SessionEnd',
};

export function adaptHookInputForIde(
  parsed: Record<string, unknown>,
  ide?: string,
): Record<string, unknown> {
  if (ide !== 'copilot-cli') return parsed;

  const adapted: Record<string, unknown> = { ...parsed };
  if (typeof parsed.sessionId === 'string' && typeof adapted.session_id !== 'string') {
    adapted.session_id = parsed.sessionId;
  }

  const toolResult = parsed.tool_result;
  if (
    toolResult &&
    typeof toolResult === 'object' &&
    'text_result_for_llm' in toolResult &&
    adapted.tool_response === undefined
  ) {
    adapted.tool_response = (toolResult as { text_result_for_llm?: unknown }).text_result_for_llm;
  }

  return adapted;
}

export function formatIdeOutput(
  hook: ContextHookName,
  result: HookResultLike,
  ide?: string,
): string | undefined {
  if (hook !== 'session-start' && hook !== 'user-prompt-submit') return undefined;
  const ctx = result.context?.trim();
  if (!ctx) return undefined;
  if (ide === 'copilot-cli') {
    return JSON.stringify({ additionalContext: ctx });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: CLAUDE_EVENT_NAME[hook],
      additionalContext: ctx,
    },
  });
}
