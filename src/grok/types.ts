/**
 * Agent Client Protocol (ACP) type definitions for the Grok Build CLI agent
 * (`grok agent stdio`). Wire format: newline-delimited JSON-RPC 2.0 over stdio.
 * @see https://agentclientprotocol.com  @see https://docs.x.ai/build/cli/headless-scripting
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcResponse & JsonRpcNotification & { method?: string };

/** A content block in a prompt or message (ACP ContentBlock subset). */
export interface ContentBlock {
  type: "text" | "image" | "audio" | "resource" | "resource_link";
  text?: string;
  data?: string;
  mimeType?: string;
  /** resource_link */
  uri?: string;
  name?: string;
  size?: number;
  /** embedded resource */
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
  [k: string]: unknown;
}

/** One authentication method advertised by the agent in `initialize`. */
export interface AuthMethod {
  id: string; // e.g. "cached_token" | "xai.api_key"
  name?: string;
  description?: string;
}

export interface InitializeResult {
  protocolVersion: number;
  authMethods?: AuthMethod[];
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
  };
  agentInfo?: { name?: string; version?: string };
}

export interface NewSessionResult {
  sessionId: string;
}

export interface PromptResult {
  stopReason?: string; // e.g. "end_turn", "cancelled", "max_tokens"
}

/** session/update notification payload. */
export interface SessionUpdate {
  sessionUpdate:
    | "agent_message_chunk"
    | "agent_thought_chunk"
    | "tool_call"
    | "tool_call_update"
    | "plan"
    | "user_message_chunk"
    | string;
  /**
   * Message chunk body (ContentBlock) OR tool-call content array (ACP standard).
   * Callers must narrow based on sessionUpdate — use {@link contentText} helper.
   */
  content?: ContentBlock | ToolCallContent[] | (ContentBlock & Record<string, unknown>) | unknown;
  toolCallId?: string;
  /** Human title (sometimes generic "Tool call" from Grok). */
  title?: string;
  /** Stable tool identity when the agent sends it (ACP RFD / Grok extensions). */
  name?: string;
  toolName?: string;
  kind?: string; // "read" | "edit" | "execute" | "search" | ...
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  /** Some agents use content_blocks instead of content. */
  content_blocks?: ToolCallContent[];
  locations?: Array<{ path?: string; line?: number }>;
  [k: string]: unknown;
}

/** Render a Grok /memory panel into text. The panel returns no prose, only a
 *  memory_files update, so without this the turn looks empty and gets retried. */
export function renderMemoryFiles(update: SessionUpdate): string {
  const files = Array.isArray(update.files) ? (update.files as Array<Record<string, unknown>>) : [];
  const lines = files.map((f) => {
    const path = String(f.path ?? "");
    const name = path.split("/").slice(-2).join("/");
    const kb = Math.round(Number(f.size_bytes ?? 0) / 102.4) / 10;
    return `• ${name} (${f.source ?? "?"}, ${kb} KB)`;
  });
  const flags = [
    update.enabled === false ? "memory off" : "memory on",
    update.capture_enabled === false ? "capture off" : "capture on",
    update.dream_enabled ? "dream on" : "dream off",
  ];
  const body = lines.length ? lines.join("\n") : "No memory files.";
  return `Memory\n${body}\n${flags.join(" · ")}`;
}
export interface ToolCallContent {
  type: "content" | "diff" | "terminal" | string;
  path?: string;
  oldText?: string | null;
  newText?: string;
  content?: ContentBlock;
  terminalId?: string;
  [k: string]: unknown;
}

export interface SessionNotificationParams {
  sessionId: string;
  update: SessionUpdate;
}

/** Safe text extraction when content is a ContentBlock (not a tool content array). */
export function contentText(content: SessionUpdate["content"]): string | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  const t = (content as ContentBlock).text;
  return typeof t === "string" ? t : undefined;
}

/** Permission request from the agent (server -> client) — ACP "ask" mode. */
export interface RequestPermissionParams {
  sessionId: string;
  toolCall?: { toolCallId?: string; title?: string; kind?: string; rawInput?: Record<string, unknown> };
  options: Array<{ optionId: string; name: string; kind?: string }>;
}

export type PermissionOutcome =
  | { outcome: { outcome: "selected"; optionId: string } }
  | { outcome: { outcome: "cancelled" } };

/** One subagent ("crew" member) as reported by the agent, if it emits them. */
export interface SubagentInfo {
  sessionId: string;
  sessionName?: string;
  agentName?: string;
  role?: string;
  initialQuery?: string;
  status?: { type?: string; message?: string };
  group?: string;
  dependsOn?: string[];
  hasLoop?: boolean;
  loopIteration?: number;
  loopMaxIterations?: number;
  createdAtMs?: number;
}

export interface PendingStage {
  name?: string;
  role?: string;
  agentName?: string;
  dependsOn?: string[];
  [k: string]: unknown;
}

export interface SubagentListUpdate {
  subagents?: SubagentInfo[];
  pendingStages?: PendingStage[];
}
