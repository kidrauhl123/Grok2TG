/**
 * Menu surfaces:
 *  - No buttons for Menu, New, Running or Stop. Those are slash commands:
 *    /menu /new /running /stop /cancel.
 *  - INLINE menu message (opened via /menu) — settings & navigation only.
 * Live state lives in the pinned status panel.
 */
import { InlineKeyboard } from "grammy";

/** The full, grouped inline menu (opened via /menu). */
export function mainMenuInline(state: {
  model: string;
  reasoning: string;
  /** Forum topic scope — hide project switch; label topic sessions. */
  forumTopic?: { name: string; account?: string };
}): InlineKeyboard {
  const t = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);
  const kb = new InlineKeyboard();

  if (state.forumTopic) {
    kb.text("\u{1F5C2} Sessions", "m:sessions")
      .row()
      .text(`\u{1F4C1} ${t(state.forumTopic.name, 28)}`, "m:topicinfo")
      .row()
      .text("\u{1F4E5} Import session", "m:import")
      .row()
      .text(`\u{1F9E9} Model \u00B7 ${t(state.model, 24)}`, "m:model")
      .row()
      .text(`\u{1F9E0} Reasoning \u00B7 ${t(state.reasoning, 24)}`, "m:reasoning")
      .row();
    if (state.forumTopic.account) {
      kb.text(`\u{1F465} Account \u00B7 ${t(state.forumTopic.account, 20)}`, "m:accounts").row();
    }
    kb.text("\u{1F4CA} Status", "m:status").text("\u2716 Close", "m:close");
    return kb;
  }

  // Private chat.
  kb.text("\u{1F4C1} Project", "m:project")
    .text("\u{1F5C2} Sessions", "m:sessions")
    .row()
    .text("\u{1F4E5} Import session", "m:import")
    .row()
    .text(`\u{1F9E9} Model \u00B7 ${t(state.model, 24)}`, "m:model")
    .row()
    .text(`\u{1F9E0} Reasoning \u00B7 ${t(state.reasoning, 24)}`, "m:reasoning")
    .row()
    .text("\u2705 Tasks", "m:tasks")
    .text("\u{1F4CA} Status", "m:status")
    .text("\u{1F4B3} Usage", "m:usage")
    .row()
    .text("\u{1F465} Accounts", "m:accounts")
    .row()
    .text("\u{1F9E9} MCP", "m:mcp")
    .text("\u{1F6D1} Kill all", "m:killall")
    .row()
    .text("\u2716 Close", "m:close");
  return kb;
}
