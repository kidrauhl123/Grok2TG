/**
 * One line appended to the first prompt of a session, telling the agent how to
 * hand a file to Telegram. The bridge delivers `MEDIA:/absolute/path` and a
 * bare absolute path that exists; it does not scan directories.
 *
 * Keep tidy-idempotent (no trailing spaces / 3+ blank lines) so
 * `cleanStoredText` can strip it by exact match.
 */
export const IMAGE_OUTPUT_DIRECTIVE =
  "You can send files natively: write MEDIA:/absolute/path/to/file in your response. Images (.png, .jpg, .webp) are delivered as files.";
