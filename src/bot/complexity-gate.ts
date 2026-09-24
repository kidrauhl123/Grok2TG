/**
 * First-prompt complexity steering (fully automatic — never asks the user).
 *
 * On the first user message of a fresh session the bot prepends a directive so
 * Grok itself decides Simple vs Complex:
 *   • Simple  — implement directly.
 *   • Complex — enter plan mode, investigate carefully, write a plan,
 *               exit_plan_mode (auto-approved by this bridge), implement,
 *               then re-review the result.
 *
 * No Telegram buttons, no user choice, no waiting.
 */
import type { PromptInput } from "../app/types.js";

/**
 * Agent-only directive. Must stay free of real `{progress: N%}` digit markers
 * (history cleaner strips those). Uses the letter N only if mentioning format.
 */
export const AUTO_COMPLEXITY_DIRECTIVE = [
  "COMPLEXITY (decide yourself — never ask the user):",
  "Silently decide Simple or Complex. Never ask, and never offer a choice.",
  "Simple (clear path, small change, obvious fix, short answer): just do it.",
  "Complex (ambiguous, multi-file, high rework risk, unclear approach): call enter_plan_mode, investigate the codebase before writing anything, write the plan, then call exit_plan_mode. This bridge auto-approves it — there is no popup to wait for — so implement as soon as it succeeds, then re-check the result against the plan before finishing.",
  "",
  "User task:",
].join("\n");

/** Optional mode ids Grok may advertise for plan mode (best-effort only). */
export const PLAN_MODE_CANDIDATES = ["plan", "planning", "architect", "design"] as const;

/**
 * Prepend the auto-complexity directive so the agent decides Simple vs Complex
 * without any user interaction.
 */
export function wrapAutoComplexityPrompt(input: PromptInput): PromptInput {
  const body = input.text.trim() || "(see attached media / files)";
  // Avoid double-wrapping if a retry/queue path already applied it.
  if (body.startsWith("COMPLEXITY (decide yourself")) return input;
  return {
    ...input,
    text: `${AUTO_COMPLEXITY_DIRECTIVE}\n${body}`,
  };
}

/** Pick a plan-mode id from the agent's advertised modes, if any. */
export function pickPlanModeId(
  modes: Array<{ id: string; name: string }>,
  hasMode: (id: string) => boolean,
): string | undefined {
  for (const id of PLAN_MODE_CANDIDATES) {
    if (hasMode(id)) return id;
  }
  for (const m of modes) {
    if (/plan|architect|design/i.test(m.id) || /plan|architect|design/i.test(m.name)) {
      return m.id;
    }
  }
  return undefined;
}
