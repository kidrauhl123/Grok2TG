/**
 * Searchable Telegram hashtags for a session's messages. Tapping a tag in
 * Telegram pulls up every message that carries it, so the SAME footer is
 * appended to every AI-output surface: live streams, Done/error summaries, the
 * history/unread you see when switching back to a session, and live watch.
 */

export interface TagInput {
  projectName?: string;
  cwd?: string;
  sessionId?: string;
  /** Short id for a single user turn; becomes `#prompt_<id>`. */
  promptId?: string;
}

/** Sanitise a value into a Telegram-safe hashtag body (letters/digits/_ only). */
export function tagSafe(v: string): string {
  const s = v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || "none";
}

/**
 * Build the hashtag footer. `#proj_` is added only when a project was actually
 * bound — a topic that just sits on the shared workspace has no project, and
 * falling back to the directory name would print a tag for a project that does
 * not exist. `#sess_` is added when the session id is known, `#prompt_` when a
 * turn-level id is known. Order: project · session · prompt.
 */
export function sessionHashtags(input: TagInput): string {
  const tags: string[] = [];
  if (input.projectName?.trim()) tags.push(`#proj_${tagSafe(input.projectName)}`);
  if (input.sessionId) tags.push(`#sess_${tagSafe(input.sessionId.slice(0, 8))}`);
  if (input.promptId) tags.push(`#prompt_${tagSafe(input.promptId)}`);
  return tags.join(" ");
}
