/**
 * Work-report wakes for the Telegram General topic.
 *
 * A child topic reports back here when work dispatched from General finishes.
 * General gets the same bridge directive as every other topic — there is no
 * separate manager prompt telling it how to behave.
 */

/** Marker for child-session completion wakes injected into General. */
export const MANAGER_WORK_REPORT_MARKER =
  "MANAGER WORK REPORT (system — analyze and report to the user; do not invent facts):";

/** Kept so history written before the manager prompt was removed still strips. */
export const MANAGER_DIRECTIVE_MARKER = "MANAGER MODE (General topic — OpenClaw-style orchestrator):";
export function isManagerWorkReportPrompt(text: string): boolean {
  return text.trimStart().startsWith(MANAGER_WORK_REPORT_MARKER);
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
    "Quiet by default: if this is routine and the user did not ask for a status, process silently.",
    "If the user needs to know (success, failure, blocked, needs a decision), say it once in your reply.",
    "Do not re-emit the same send_prompt unless a retry is clearly useful.",
    "No progress markers. No job tables or multi-message status spam.",
  ];
  return lines.join("\n");
}
