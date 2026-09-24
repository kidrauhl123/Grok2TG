/**
 * Telegram bridge protocol: first-prompt directive + parse/strip of agent
 * JSON action blocks (`{"telegram":[...]}`) from assistant responses.
 *
 * Keep TELEGRAM_BRIDGE_DIRECTIVE tidy-idempotent (no trailing spaces / 3+ blank
 * lines, no digit `{progress:…}` tokens) so history cleaners can strip by
 * exact match after extractProgress/tidy.
 */
import type { PromptInput } from "../app/types.js";

/** Marker prefix for first-prompt teaching block (used by strip / history). */
export const TELEGRAM_BRIDGE_MARKER = "TELEGRAM BRIDGE (how to work in this chat):";

/** Marker for results injected back into the agent after actions run. */
export const TELEGRAM_BRIDGE_RESULTS_MARKER =
  "TELEGRAM BRIDGE RESULTS (system — use these facts; do not re-emit the same request unless needed):";

/** Max actions accepted from one agent turn (create + path + several prompts). */
export const TELEGRAM_ACTION_MAX = 9;
/** Max bot_command actions per turn. */
export const TELEGRAM_BOT_COMMAND_MAX = 2;
/** Max send_prompt actions per turn (cross-topic work). */
export const TELEGRAM_SEND_PROMPT_MAX = 5;

export type TelegramAction =
  | { action: "create_topic"; name: string; path?: string }
  | { action: "set_path"; topic: string; path: string }
  | {
      action: "send_prompt";
      topic: string;
      prompt: string;
      newSession?: boolean;
      /** Resume this exact Grok session in the topic (full id or short prefix). */
      sessionId?: string;
    }
  /** User-facing message in the current chat (General: only way to talk to the user). */
  | { action: "notify"; text: string; important?: boolean }
  | { action: "search_memory"; query: string; limit?: number }
  | { action: "list_topics" }
  | { action: "list_jobs" }
  | { action: "list_bots" }
  | { action: "bot_command"; bot: string; command: string; args?: string };

/** Max user-facing notify messages per turn (anti-spam). */
export const TELEGRAM_NOTIFY_MAX = 3;

export interface TelegramActionExtract {
  actions: TelegramAction[];
  /** Text with telegram action fences removed. */
  cleaned: string;
}

/**
 * Static teaching block. Dynamic capability lines are appended by
 * {@link buildTelegramBridgeDirective}.
 */
export const TELEGRAM_BRIDGE_DIRECTIVE_BASE = [
  TELEGRAM_BRIDGE_MARKER,
  "This chat is driven over ACP by a Telegram bridge. To act on Telegram, put ONE fenced json block in your reply (it is stripped before the user sees it; results come back as TELEGRAM BRIDGE RESULTS):",
  "```json",
  '{ "telegram": [ { "action": "..." } ] }',
  "```",
  "Up to 9 actions, run in order. Actions:",
  '- create_topic — new forum topic. Optional "path" binds it (absolute path or exact catalog name); a missing absolute path is created on disk.',
  '- set_path — rebind an existing topic. "topic" is its exact title or #threadId; "path" as above.',
  '- send_prompt — queue work in another topic (returns immediately, does not wait). "topic" = exact title, #threadId, "general", or "ai chat" — never placeholders like "…", "...", "topic", or "there"; call list_topics if unsure. Optional "new_session": true starts fresh. Optional "session_id" (full UUID or short prefix) RESUMES that exact session and wins over new_session; with it, "topic" may be omitted and is inferred from the session path. session_id is required when memory found the session the user wants continued — without it the topic\'s current foreground session is used, which is often wrong. From General you MUST dispatch here and never code in General. The child auto-reports back with a MANAGER WORK REPORT.',
  "- notify — the only way to speak to the user in General. Quiet by default: search, dispatch, and process with no notify. Notify only to answer what was asked, report an important failure, or give an outcome the user needs. Max 3 per turn, prefer one short line. Never notify dispatch chatter, job tables, or \"sending to…\".",
  '- search_memory — "query", optional "limit" (default 8). Searches topics, session titles, comments, and history. Do this before any git or shell.',
  "- list_topics — every mapped topic: name, #id, path, kind.",
  "- list_jobs — recent dispatches from General and their status.",
  "- list_bots — allowlisted sibling bots and their commands.",
  '- bot_command — run "/command" on a sibling bot and wait for it to settle. "bot" without @, "command", optional "args". A timeout returns ok=false and is not a Done.',
  "One block per turn. Use the bridge results; do not invent them or re-emit an action that already succeeded.",
].join("\n");

export interface TelegramBridgeCaps {
  forumReady: boolean;
  topicGroupId?: number;
  allowedBots: string[];
  /** username → command list for first-prompt teaching */
  botCommands?: Record<string, Array<{ command: string; description?: string }>>;
  /** When true, General manager wording is appended. */
  managerMode?: boolean;
}

/** Full first-prompt directive including live capabilities. */
export function buildTelegramBridgeDirective(caps: TelegramBridgeCaps): string {
  const lines = [TELEGRAM_BRIDGE_DIRECTIVE_BASE, "", "Capabilities right now:"];
  if (caps.forumReady && caps.topicGroupId !== undefined) {
    lines.push(
      `- Forum topics: READY (group ${caps.topicGroupId}). You may create_topic, set_path, and send_prompt.`,
      `- General is the manager topic (orchestrates only). AI Chat uses GROK_WORKSPACE for coding there; project topics use their bound path.`,
    );
  } else if (caps.topicGroupId !== undefined) {
    lines.push(
      `- Forum topics: NOT READY (group ${caps.topicGroupId} configured but setup failed or bot is not admin). Do not rely on create_topic / set_path / send_prompt.`,
    );
  } else {
    lines.push("- Forum topics: OFF (TOPIC_GROUP_ID unset). create_topic / set_path / send_prompt will fail.");
  }
  if (caps.allowedBots.length > 0) {
    lines.push(
      `- Sibling bots (allowlist): ${caps.allowedBots.map((b) => "@" + b).join(", ")}. Use list_bots / bot_command like MCP.`,
    );
    for (const u of caps.allowedBots) {
      const cmds = caps.botCommands?.[u];
      if (cmds && cmds.length > 0) {
        lines.push(
          `  - @${u}: ${cmds
            .map((c) => (c.description ? `/${c.command} (${c.description})` : `/${c.command}`))
            .join(", ")}`,
        );
      }
    }
  } else {
    lines.push(
      "- Sibling bots: none configured (ALLOWED_TELEGRAM_BOTS empty). list_bots returns empty; bot_command disabled.",
    );
  }
  lines.push("- search_memory / list_topics / list_jobs: available against bot-owned indexes.");
  if (caps.managerMode) {
    lines.push(
      "- You are in General manager mode: chat-like replies only; memory-first; dispatch via send_prompt; child work auto-reports back.",
    );
  }
  return lines.join("\n");
}

/**
 * Prepend the telegram bridge teaching block (idempotent if already present).
 * Call after complexity wrapping so it sits between complexity and user task body.
 */
export function wrapTelegramBridgePrompt(input: PromptInput, directive: string): PromptInput {
  const body = input.text.trim() || "(see attached media / files)";
  if (body.includes(TELEGRAM_BRIDGE_MARKER)) return input;
  // Prefer inserting after "User task:\n" when complexity wrapper is present.
  const marker = "User task:";
  const idx = body.indexOf(marker);
  if (idx !== -1) {
    const before = body.slice(0, idx + marker.length);
    const after = body.slice(idx + marker.length);
    return {
      ...input,
      text: `${before}\n\n${directive}\n\nUser task (continued):\n${after.trimStart()}`,
    };
  }
  return {
    ...input,
    text: `${directive}\n\n${body}`,
  };
}

/** True when text is the bridge results follow-up (meta; skip recheck). */
export function isTelegramBridgeResultsPrompt(text: string): boolean {
  return text.trimStart().startsWith(TELEGRAM_BRIDGE_RESULTS_MARKER);
}

/** Build the meta prompt that feeds action results back to the agent. */
export function buildTelegramBridgeResultsPrompt(results: unknown[]): string {
  const payload = JSON.stringify({ results }, null, 2);
  return [
    TELEGRAM_BRIDGE_RESULTS_MARKER,
    "```json",
    payload,
    "```",
    "Continue the user's task with this information. Do not ask the user to paste results. Do not re-emit the same telegram actions unless something failed and a retry is useful.",
    "Quiet: if actions succeeded, prefer silent continue or one short notify — never dump job tables or dispatch narration.",
  ].join("\n");
}

/**
 * Extract telegram actions from fenced JSON blocks and strip those fences from
 * the visible text. Non-telegram fences are left intact.
 */
export function extractTelegramActions(text: string): TelegramActionExtract {
  if (!text) return { actions: [], cleaned: text };
  const actions: TelegramAction[] = [];
  // Match complete fenced blocks (``` or ```json etc.).
  const fenceRe = /```(?:json|JSON)?\s*\r?\n([\s\S]*?)```/g;
  let cleaned = text.replace(fenceRe, (full, body: string) => {
    const parsed = tryParseTelegramFence(body);
    if (!parsed) return full;
    for (const a of parsed) {
      if (actions.length >= TELEGRAM_ACTION_MAX) break;
      actions.push(a);
    }
    return "";
  });
  // Hide a trailing incomplete ```json … telegram block mid-stream.
  cleaned = cleaned.replace(/```(?:json|JSON)?\s*\r?\n[\s\S]*$/i, (tail) => {
    if (
      /"telegram"\s*:/i.test(tail) ||
      /"action"\s*:\s*"(?:create_topic|set_path|send_prompt|notify|search_memory|list_topics|list_jobs|list_bots|bot_command)"/i.test(
        tail,
      )
    ) {
      return "";
    }
    return tail;
  });
  cleaned = tidy(cleaned);
  return { actions: capBotCommands(actions), cleaned };
}

/** Strip only (no need for actions) — streamer path. */
export function stripTelegramActionFences(text: string): string {
  return extractTelegramActions(text).cleaned;
}

function tryParseTelegramFence(body: string): TelegramAction[] | undefined {
  const raw = body.trim();
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const list = coerceActionList(parsed);
  if (!list) return undefined;
  const out: TelegramAction[] = [];
  for (const item of list) {
    const a = normalizeAction(item);
    if (a) out.push(a);
  }
  return out.length > 0 ? out : undefined;
}

function coerceActionList(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return undefined;
    // Bare array only if every element looks like an action.
    if (parsed.every((x) => x && typeof x === "object" && "action" in (x as object))) {
      return parsed;
    }
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const rec = parsed as Record<string, unknown>;
  if ("telegram" in rec) {
    const t = rec.telegram;
    if (Array.isArray(t)) return t;
    if (t && typeof t === "object") return [t];
    return undefined;
  }
  // Single action object at top level.
  if (typeof rec.action === "string") return [rec];
  return undefined;
}

function normalizeAction(item: unknown): TelegramAction | undefined {
  if (!item || typeof item !== "object") return undefined;
  const rec = item as Record<string, unknown>;
  const action = String(rec.action ?? rec.type ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");

  switch (action) {
    case "create_topic": {
      const name = String(rec.name ?? rec.title ?? "").trim();
      if (!name) return undefined;
      const path = String(rec.path ?? rec.project_path ?? rec.projectPath ?? "").trim();
      return path
        ? { action: "create_topic", name: name.slice(0, 128), path: path.slice(0, 500) }
        : { action: "create_topic", name: name.slice(0, 128) };
    }
    case "set_path":
    case "bind_path":
    case "bind_topic": {
      const topic = String(rec.topic ?? rec.name ?? rec.thread ?? rec.thread_id ?? rec.threadId ?? "").trim();
      const path = String(rec.path ?? rec.project_path ?? rec.projectPath ?? "").trim();
      if (!topic || !path) return undefined;
      return {
        action: "set_path",
        topic: topic.slice(0, 128),
        path: path.slice(0, 500),
      };
    }
    case "send_prompt":
    case "topic_prompt":
    case "prompt_topic": {
      let topic = String(rec.topic ?? rec.name ?? rec.thread ?? rec.thread_id ?? rec.threadId ?? "").trim();
      const prompt = String(rec.prompt ?? rec.text ?? rec.message ?? "").trim();
      const newSessionRaw = rec.new_session ?? rec.newSession ?? rec.fresh;
      const newSession =
        newSessionRaw === true ||
        newSessionRaw === 1 ||
        /^(1|true|yes|y)$/i.test(String(newSessionRaw ?? "").trim());
      const sessionIdRaw = String(
        rec.session_id ?? rec.sessionId ?? rec.sess ?? rec.session ?? "",
      ).trim();
      const sessionId = sessionIdRaw
        ? sessionIdRaw.replace(/^#?sess[_-]?/i, "").slice(0, 64)
        : undefined;
      // Drop placeholder topics ("…") so resolve can use session_id / memory inference.
      if (
        !topic ||
        /^[\s.…·•⋯︙\-–—_*~`'"“”‘’\u2026\u22ef\u3002]+$/u.test(topic) ||
        /^(topic|there|here|same|related|todo|tbd|none|null|target)$/i.test(topic)
      ) {
        topic = "";
      }
      // topic optional when session_id is present OR prompt alone (memory may infer topic).
      if (!prompt) return undefined;
      // Allow prompt-only send_prompt: bridge may infer topic from memory + user ask.
      // Still require at least something actionable (prompt is enough).
      // Full prompt for the target agent — do NOT hard-crop to Telegram size.
      // Long prompts are split only in the human-visible announce message.
      const PROMPT_MAX = 100_000;
      return {
        action: "send_prompt",
        topic: topic.slice(0, 128),
        prompt: prompt.length > PROMPT_MAX ? prompt.slice(0, PROMPT_MAX) : prompt,
        newSession: newSession || undefined,
        // session_id wins over new_session when both are set (resume is explicit).
        sessionId: sessionId || undefined,
      };
    }
    case "notify":
    case "message_user":
    case "say":
    case "tell_user": {
      const text = String(rec.text ?? rec.message ?? rec.body ?? rec.prompt ?? "").trim();
      if (!text) return undefined;
      const impRaw = rec.important ?? rec.priority ?? rec.loud;
      const important =
        impRaw === true ||
        impRaw === 1 ||
        /^(1|true|yes|y|high|urgent|important)$/i.test(String(impRaw ?? "").trim());
      return {
        action: "notify",
        text: text.slice(0, 3500),
        important: important || undefined,
      };
    }
    case "search_memory":
    case "search":
    case "memory_search": {
      const query = String(rec.query ?? rec.q ?? rec.text ?? "").trim();
      if (!query) return undefined;
      let limit = Number(rec.limit ?? rec.max ?? 8);
      if (!Number.isFinite(limit)) limit = 8;
      limit = Math.max(1, Math.min(20, Math.round(limit)));
      return { action: "search_memory", query: query.slice(0, 300), limit };
    }
    case "list_topics":
    case "topics":
      return { action: "list_topics" };
    case "list_jobs":
    case "jobs":
    case "manager_jobs":
      return { action: "list_jobs" };
    case "list_bots":
    case "bots":
      return { action: "list_bots" };
    case "bot_command":
    case "call_bot":
    case "invoke_bot": {
      const bot = normalizeUsername(String(rec.bot ?? rec.username ?? ""));
      const command = String(rec.command ?? rec.cmd ?? "")
        .trim()
        .replace(/^\//, "");
      if (!bot || !command) return undefined;
      const args = String(rec.args ?? rec.arguments ?? rec.text ?? "").trim();
      return {
        action: "bot_command",
        bot,
        command: command.slice(0, 64),
        args: args ? args.slice(0, 500) : undefined,
      };
    }
    default:
      return undefined;
  }
}

function capBotCommands(actions: TelegramAction[]): TelegramAction[] {
  let botCmds = 0;
  let sendPrompts = 0;
  let notifies = 0;
  const out: TelegramAction[] = [];
  for (const a of actions) {
    if (a.action === "bot_command") {
      if (botCmds >= TELEGRAM_BOT_COMMAND_MAX) continue;
      botCmds++;
    }
    if (a.action === "send_prompt") {
      if (sendPrompts >= TELEGRAM_SEND_PROMPT_MAX) continue;
      sendPrompts++;
    }
    if (a.action === "notify") {
      if (notifies >= TELEGRAM_NOTIFY_MAX) continue;
      notifies++;
    }
    out.push(a);
    if (out.length >= TELEGRAM_ACTION_MAX) break;
  }
  return out;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "");
}
