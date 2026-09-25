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
  resolveToolIdentity,
} from "./tool-call-detail.js";

/** How much of a path, query, or argument stays on the line. */
export const TOOL_PREVIEW_LENGTH = 300;

export interface ToolProgressLine {
  text: string;
  /** A fenced terminal block. The next terminal call drops its header. */
  terminal: boolean;
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

function terminalBlock(command: string, dropHeader: boolean): string {
  const raw = command.replace(/\s+$/g, "").trim();
  const header = dropHeader ? "" : "💻 terminal\n";
  return `${header}\n\n\u0000CODE${raw}\u0000\n\n`;
}

/**
 * One Hermes "all" progress line for a tool that has just started.
 * `dropTerminalHeader` is true when the previous line was also a terminal block.
 */
export function formatToolProgressAll(
  update: SessionUpdate,
  opts?: { dropTerminalHeader?: boolean },
): ToolProgressLine | undefined {
  const raw = flattenRaw(update);
  const id = resolveToolIdentity(update, raw);
  const name = named(id);

  if (id.kind === "execute") {
    const command = extractCommand(raw);
    if (!command.trim()) return { text: "> 💻 terminal...", terminal: false };
    return { text: terminalBlock(command, !!opts?.dropTerminalHeader), terminal: true };
  }

  if (id.kind === "read") {
    const label = fileLabel(raw);
    return { text: label ? `> 📖 Reading ${label}` : "> 📖 Reading...", terminal: false };
  }
  if (id.kind === "search") {
    const query = clip(extractSearchQuery(raw));
    return {
      text: query ? `> 🔎 Searching files for ${query}` : "> 🔎 Searching files...",
      terminal: false,
    };
  }
  if (id.kind === "web_search") {
    const query = clip(extractSearchQuery(raw) || String(raw.query ?? ""));
    return {
      text: query ? `> 🔍 Searching the web for ${query}` : "> 🔍 Searching the web...",
      terminal: false,
    };
  }
  if (id.kind === "edit") {
    const label = fileLabel(raw);
    return { text: label ? `> 🔧 Editing ${label}` : "> 🔧 Editing...", terminal: false };
  }
  if (id.kind === "write" || id.kind === "create") {
    const label = fileLabel(raw);
    return { text: label ? `> ✍️ Writing ${label}` : "> ✍️ Writing...", terminal: false };
  }
  if (id.kind === "fetch" || id.kind === "web_fetch") {
    const url = clip(extractUrl(raw) || extractPath(raw));
    return { text: url ? `> 📄 Reading ${url}` : "> 📄 Reading...", terminal: false };
  }
  if (id.kind === "image") {
    const prompt = clip(String(raw.prompt ?? raw.query ?? ""));
    return { text: prompt ? `> 🖼️ Generating image ${prompt}` : "> 🖼️ Generating image...", terminal: false };
  }
  if (id.kind === "todo") {
    return { text: "> ✅ Updating tasks", terminal: false };
  }
  if (id.kind === "delete") {
    const label = fileLabel(raw);
    return { text: label ? plain("🗑️", "delete", label) : "🗑️ delete...", terminal: false };
  }

  const preview = clip(
    extractSearchQuery(raw) || extractPath(raw) || extractCommand(raw) || extractUrl(raw),
  );
  return { text: plain("⚙️", name, preview), terminal: false };
}
