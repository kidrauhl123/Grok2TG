/**
 * Plan-mode id lookup.
 *
 * The bridge does not tell the model when to plan — the user decides that with
 * their own skills. This only recognises a plan mode among the modes the agent
 * advertises, for callers that want to switch into one.
 */
/** Optional mode ids Grok may advertise for plan mode (best-effort only). */
export const PLAN_MODE_CANDIDATES = ["plan", "planning", "architect", "design"] as const;

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
