/**
 * The emoji a turn shows on the user's message while it runs, instead of a
 * "Working…" bubble. Telegram bots may react with only the fixed set below;
 * the negative ones are left out. A custom (premium) emoji needs the chat's
 * administrators to allow it, so this stays on the default set.
 *
 * One reaction per message. An empty reaction list clears it.
 */
import type { ReactionTypeEmoji } from "grammy/types";

export const WORKING_REACTIONS = [
  "👍", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "🎉", "🤩", "🙏", "👌", "🕊",
  "🥴", "😍", "🐳", "❤‍🔥", "🌚", "🌭", "💯", "⚡", "🍌", "🏆", "🍾", "💋", "😈",
  "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "🤝", "✍", "🤗", "🫡", "🎅", "🎄",
  "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾",
] as const;

export type WorkingReaction = (typeof WORKING_REACTIONS)[number];

/** A reaction from the set, chosen by `pick` so tests can pin the result. */
export function pickWorkingReaction(
  pick: () => number = Math.random,
): WorkingReaction {
  const n = WORKING_REACTIONS.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(pick() * n)));
  return WORKING_REACTIONS[i]!;
}

/** The `reaction` field for setMessageReaction. `null` clears it. */
export function reactionPayload(
  emoji: WorkingReaction | null,
): ReactionTypeEmoji[] {
  return emoji ? [{ type: "emoji", emoji }] : [];
}
