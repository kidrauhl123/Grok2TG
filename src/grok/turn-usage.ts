/**
 * Per-turn token totals reported by Grok's ACP agent.
 *
 * `turn_completed.usage.totalTokens` is this turn's own input + output, not a
 * running session counter and not the context window occupancy on `_meta`.
 */

export function turnTokensFromUpdate(update: {
  sessionUpdate?: string;
  usage?: { totalTokens?: number };
}): number | undefined {
  if (update.sessionUpdate !== "turn_completed") return undefined;
  return positiveTokens(update.usage?.totalTokens);
}

/** Prompt RPC result, when the agent puts the same total on the response. */
export function turnTokensFromPromptResult(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as {
    usage?: { totalTokens?: number };
    _meta?: { usage?: { totalTokens?: number } };
  };
  return positiveTokens(r.usage?.totalTokens) ?? positiveTokens(r._meta?.usage?.totalTokens);
}

function positiveTokens(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}
