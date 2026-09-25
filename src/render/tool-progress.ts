/**
 * Hermes `tool_progress: all` for one tool start.
 *
 * Every call is one line. The preview is capped, but wide enough to read the
 * command or the path; it used to be 40, which cut everything to a stub.
 * A terminal call keeps its whole command, wrapped in a fence. Completion
 * output is not part of this line; the caller paints a call once and leaves it.
 */
import { basename } from "node:path";
import type { SessionUpdate } from "../grok/types.js";
import {
  extractCommand,
  extractPath,
  extractSearchQuery,
  extractUrl,
  extractToolOutput,
  resolveToolIdentity,
} from "./tool-call-detail.js";

/** How much of a path, query, or argument stays on the line. */
export const TOOL_PREVIEW_LENGTH = 300;

export interface ToolProgressLine {
  /** The one line that titles the fold, such as `📖 Reading config.json`. */
  title: string;
  /** The tool's result, shown inside the fold. Empty until it arrives. */
  result: string;
  /** A terminal call's command, shown as its own code block. */
  command?: string;
}

function flattenRaw(u: SessionUpdate): Record<string, unknown> {
  const raw = { ...((u.rawInput || {}) as Record<string, unknown>) };
  for (const key of ["arguments", "input", "args", "parameters"]) {
    const nested = raw[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
        if (raw[k] === undefined) raw[k] = v;
      }
    }
  }
  if (u.locations?.[0]?.path && raw.path === undefined) raw.path = u.locations[0].path;
  return raw;
}

function oneline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, limit = TOOL_PREVIEW_LENGTH): string {
  const one = oneline(text);
  if (one.length <= limit) return one;
  return limit <= 3 ? ".".repeat(limit) : one.slice(0, limit - 3) + "...";
}

function fileLabel(raw: Record<string, unknown>): string {
  const path = extractPath(raw);
  const name = path ? basename(path.replace(/\\/g, "/")) || path : "";
  const offset = raw.offset ?? raw.start_line;
  const limit = raw.limit;
  let range = "";
  if (typeof offset === "number" && offset > 0) {
    range = typeof limit === "number" && limit > 1 ? ` L${offset}-${offset + limit - 1}` : ` L${offset}`;
  }
  return clip(`${name}${range}`.trim());
}

function named(id: { toolName: string; mcpMethod?: string }): string {
  const name = (id.mcpMethod || id.toolName || "tool").trim();
  return name || "tool";
}

function plain(emoji: string, name: string, preview: string): string {
  const line = !preview ? `${emoji} ${name}...` : `${emoji} ${name}: "${preview}"`;
  return `> ${line}`;
}

/** A command's output, cut the way Hermes cuts it: head 40%, tail 60%, and only
 *  once it passes 50,000 characters. Shorter output is kept whole. */
const OUTPUT_CAP = 50_000;

function cutOutput(text: string): string {
  const clean = text.replace(/\s+$/g, "").trim();
  if (clean.length <= OUTPUT_CAP) return clean;
  const head = Math.floor(OUTPUT_CAP * 0.4);
  const tail = OUTPUT_CAP - head;
  const omitted = clean.length - head - tail;
  const notice = `\n\n... [OUTPUT TRUNCATED - ${omitted.toLocaleString("en-US")} chars omitted out of ${clean.length.toLocaleString("en-US")} total] ...\n\n`;
  return clean.slice(0, head) + notice + clean.slice(-tail);
}

/**
 * One fold per tool. `title` is the summary line; `result` is what the tool
 * returned, filled in once the call completes.
 */
export function formatToolProgressAll(update: SessionUpdate): ToolProgressLine | undefined {
  const raw = flattenRaw(update);
  const id = resolveToolIdentity(update, raw);
  const name = named(id);

  if (id.kind === "execute") {
    const command = extractCommand(raw).replace(/\s+$/g, "").trim();
    const first = command.split(/\r?\n/)[0] ?? "";
    return { title: "💻 terminal", command, result: cutOutput(extractToolOutput(update)) };
  }

  const result = cutOutput(extractToolOutput(update));
  if (id.kind === "read") {
    const label = fileLabel(raw);
    return { title: label ? `📖 Reading ${label}` : "📖 Reading", result };
  }
  if (id.kind === "search") {
    const query = clip(extractSearchQuery(raw));
    return { title: query ? `🔎 Searching files for ${query}` : "🔎 Searching files", result };
  }
  if (id.kind === "web_search") {
    const query = clip(extractSearchQuery(raw) || String(raw.query ?? ""));
    return { title: query ? `🔍 Searching the web for ${query}` : "🔍 Searching the web", result };
  }
  if (id.kind === "edit") {
    const label = fileLabel(raw);
    return { title: label ? `🔧 Editing ${label}` : "🔧 Editing", result };
  }
  if (id.kind === "write" || id.kind === "create") {
    const label = fileLabel(raw);
    return { title: label ? `✍️ Writing ${label}` : "✍️ Writing", result };
  }
  if (id.kind === "fetch" || id.kind === "web_fetch") {
    const url = clip(extractUrl(raw) || extractPath(raw));
    return { title: url ? `📄 Reading ${url}` : "📄 Reading", result };
  }
  if (id.kind === "image") {
    const prompt = clip(String(raw.prompt ?? raw.query ?? ""));
    return { title: prompt ? `🖼️ Generating image ${prompt}` : "🖼️ Generating image", result };
  }
  if (id.kind === "todo") {
    return { title: "✅ Updating tasks", result };
  }
  if (id.kind === "delete") {
    const label = fileLabel(raw);
    return { title: label ? `🗑️ delete ${label}` : "🗑️ delete", result };
  }

  const preview = clip(extractSearchQuery(raw) || extractPath(raw) || extractCommand(raw) || extractUrl(raw));
  return { title: preview ? `⚙️ ${name}: "${preview}"` : `⚙️ ${name}`, result };
}
