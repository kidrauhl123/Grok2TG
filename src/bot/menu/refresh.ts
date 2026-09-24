/**
 * Sends a short status line and refreshes the pinned status panel.
 * The persistent reply keyboard stays off: this sends remove_keyboard so a
 * stale bar is cleared, and never re-attaches compactKeyboard().
 */
import type { Context } from "grammy";
import type { BotDeps } from "../deps.js";
import { resolveScope } from "../scope.js";

export async function refreshMenu(ctx: Context, deps: BotDeps, text: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const scope = resolveScope(ctx, deps);
  await ctx.reply(text, { reply_markup: { remove_keyboard: true }, ...scope.threadExtra });
  await deps.statusPanel.refresh(chatId);
}
