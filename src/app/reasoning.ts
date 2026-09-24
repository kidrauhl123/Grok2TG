/**
 * Reasoning effort — the effort the model itself spends thinking, set on the
 * live session through ACP `session/set_config_option` (`reasoning_effort`).
 * It is not a sentence prepended to the prompt.
 *
 * These five are the levels grok-4.7 advertises. `max` is a grok CLI tier the
 * model does not accept, so it is not offered.
 */
import type { ReasoningEffort } from "./types.js";

const LABEL: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

export function reasoningLabel(effort: ReasoningEffort): string {
  return LABEL[effort] ?? effort;
}
