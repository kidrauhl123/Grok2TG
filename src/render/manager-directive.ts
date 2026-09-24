/**
 * Manager (OpenClaw-style) directive for the Telegram General topic.
 *
 * General is a chat-like orchestrator: it routes work to project topics,
 * never implements project code itself, and reports statuses back to the user.
 * Keep tidy-idempotent (no digit `{progress:…}` markers) so history cleaners
 * can strip by exact match.
 */
import type { PromptInput } from "../app/types.js";

export const MANAGER_DIRECTIVE_MARKER = "MANAGER MODE (General topic — OpenClaw-style orchestrator):";

/** Marker for child-session completion wakes injected into General. */
export const MANAGER_WORK_REPORT_MARKER =
  "MANAGER WORK REPORT (system — analyze and report to the user; do not invent facts):";

/**
 * First-prompt / steering block for General. Free of real progress digit tokens.
 */
export const MANAGER_DIRECTIVE = [
  MANAGER_DIRECTIVE_MARKER,
  "You manage this Telegram forum group. General is a control room, not a workspace: never edit files, run builds, or write code here — delegate it.",
  "",
  "Talking to the user: free-form prose is NOT shown in General, only a telegram notify is. Quiet by default — search and dispatch with no notify. Notify only to answer what was asked, report an important failure, give a final outcome, or ask a clarifying question. One short line. Never spam job tables, \"Dispatching…\", or \"Sending to…\".",
  "",
  "Before any git, shell, or file tool: read the auto-injected MANAGER CONTEXT, then search_memory (list_topics if you need names). Trust, in order: General chat and memory hits stamped [Xm/h/d ago], the project's newest session, then older sessions, and git only when the user asked for it or memory found nothing. Judge \"what changed\" by the latest prompt and its Done note, not by how often a keyword appears in an old session.",
  "",
  "To dispatch: pick the topic, write the child a prompt that carries what was done, what remains, and the acceptance criteria, then one telegram block — create_topic or set_path if needed, then send_prompt, plus one notify only if the user should hear about it. On a MANAGER WORK REPORT wake, notify only for an outcome the user needs; otherwise stay silent.",
  "",
  "RESUME a related session: when memory shows a session id and the user wants to continue there, send_prompt MUST carry that session_id — without it the bridge uses the topic's currently open session, often the wrong one. The topic must be its exact title or #threadId, never \"…\". If you only have the session id, omit topic. Drop session_id only for new work on the foreground session, or set new_session for a fresh one. On \"Topic not found\", list_topics and retry.",
  "",
  "New project: create_topic with a name and absolute path (the folder is created if missing), then send_prompt the kickoff into it.",
  "",
  "User message:",
].join("\n");

/** True when text is a system work-report wake (meta; skip recheck / manager re-wrap noise). */
export function isManagerWorkReportPrompt(text: string): boolean {
  return text.trimStart().startsWith(MANAGER_WORK_REPORT_MARKER);
}

/** Prepend manager directive (idempotent). */
export function wrapManagerDirective(input: PromptInput): PromptInput {
  const body = input.text.trim() || "(see attached media / files)";
  if (body.startsWith(MANAGER_DIRECTIVE_MARKER) || body.includes(MANAGER_DIRECTIVE_MARKER)) {
    return input;
  }
  return {
    ...input,
    text: `${MANAGER_DIRECTIVE}\n${body}`,
  };
}

/** Build the meta prompt that wakes General after a child topic finishes. */
export function buildManagerWorkReportPrompt(payload: {
  jobId: string;
  targetName: string;
  targetThreadId: number;
  targetPath: string;
  userAskPreview: string;
  dispatchPromptPreview: string;
  status: "done" | "failed" | "cancelled";
  stopReason?: string;
  error?: string;
  assistantSummary: string;
  filesSummary?: string;
  childSessionId?: string;
}): string {
  const lines = [
    MANAGER_WORK_REPORT_MARKER,
    "```json",
    JSON.stringify(
      {
        jobId: payload.jobId,
        status: payload.status,
        target: {
          name: payload.targetName,
          threadId: payload.targetThreadId,
          path: payload.targetPath,
        },
        userAskPreview: payload.userAskPreview.slice(0, 500),
        dispatchPromptPreview: payload.dispatchPromptPreview.slice(0, 800),
        stopReason: payload.stopReason,
        error: payload.error,
        childSessionId: payload.childSessionId,
        filesSummary: payload.filesSummary,
        assistantSummary: payload.assistantSummary.slice(0, 3500),
      },
      null,
      2,
    ),
    "```",
    "Quiet by default: if this is routine and the user did not ask for a status, process silently (no notify).",
    "If the user needs to know (success, failure, blocked, needs a decision), emit ONE short notify.",
    "Do not re-emit the same send_prompt unless a retry is clearly useful.",
    "No progress markers. No job tables or multi-message status spam.",
  ];
  return lines.join("\n");
}
