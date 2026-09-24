/**
 * The progress bar is gone: the bot no longer asks the model for a
 * `{progress: N%}` marker and no longer renders one.
 *
 * This only strips a marker a model still emits out of habit, so old replies
 * and leftover markers never show up raw in the chat, history, or cards.
 */

/** A complete marker (`{progress: 65%}`) or a half-streamed tail (`…{progress: 6`). */
const PROGRESS_RE = /\{\s*progress\s*:\s*\d{1,3}\s*%?\s*\}/gi;
const PARTIAL_TAIL_RE = /\{\s*progress\b[^}]*$/i;

/** Kept so old call sites import. Empty: the bot no longer asks for a marker. */
export const PROGRESS_DIRECTIVE = "";

/** Strip markers. The numeric bar is gone, so nothing else is returned. */
export function extractProgress(text: string): { cleaned: string } {
  return { cleaned: stripProgressMarkers(text) };
}

/** Remove every progress marker from `text`. */
export function stripProgressMarkers(text: string): string {
  return tidy(text.replace(PROGRESS_RE, "").replace(PARTIAL_TAIL_RE, ""));
}

function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "");
}
