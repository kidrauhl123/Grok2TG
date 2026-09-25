/**
 * The live process bubble (thinking and tool lines together) as one rich
 * message. While the turn runs the <details> block is open; once the finished
 * answer is out, the same message is edited without `open`, so it collapses to
 * its summary line and shows nothing else.
 *
 * Telegram's rich Markdown has no collapsible syntax, so this is HTML, and
 * Markdown is not parsed inside <details>. Each line becomes its own paragraph
 * so the thinking reads as normal text, not a code block. The agent's own text
 * is escaped so a `<` or `&` in a thought cannot break the tag.
 */

/** Shown while the turn is still running. */
export const PROCESS_SUMMARY = "Working...";
/** Shown once the turn is done. Elapsed time is appended by the caller. */
export const PROCESS_DONE_SUMMARY = "Worked for";

/** Compact elapsed time: `12s`, `2m 13s`, `1h 4m`, `1d 2h`. Zero parts are omitted. */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSec) ? totalSec : 0));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(" ");
}

/** Collapsed title: `Worked for 1m 13s · 43,753 tokens` when this turn reported a total. */
export function workedForSummary(elapsedSec: number, tokens?: number): string {
  const n = typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0;
  const usage = n > 0 ? ` · ${n.toLocaleString("en-US")} tokens` : "";
  return `${PROCESS_DONE_SUMMARY} ${formatElapsed(elapsedSec)}${usage}`;
}

export interface ProcessBlock {
  /** Rich HTML for sendRichMessage / editMessageText. */
  html: string;
  /** Same words, no tags, for the MarkdownV2 fallback. */
  plain: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * One block for the whole process bubble.
 * `open` is true only while the turn is still running.
 * A run of lines that all start with "> " becomes one quote, so a tool line
 * reads apart from the thinking. Anything else stays one paragraph.
 */
export function renderProcessBlock(body: string, open: boolean, summary = PROCESS_SUMMARY): ProcessBlock {
  const text = body.replace(/\s+$/g, "");
  const flag = open ? " open" : "";
  const html =
    `<details${flag}><summary><i>${escapeHtml(summary)}</i></summary>` +
    `${renderBody(text)}</details>`;
  return { html, plain: `${summary}\n${text}` };
}

/** Thinking stays one paragraph. A tool arrives as \u0000TOOL{json}\u0000 and becomes
 *  its own fold: the title is the tool line, and the result sits in an
 *  expandable quote inside it. */
function renderBody(text: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let quote: string[] = [];
  const flushProse = (): void => {
    if (prose.length === 0) return;
    out.push(renderProse(prose.join("\n")));
    prose = [];
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    out.push(toolFold(quote.join("\n")));
    quote = [];
  };
  // A tool marker is one line, but the parts join with a blank line, so it can
  // arrive with whitespace on either side. Trim before matching or it falls
  // through into the prose and shows up as raw text.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("\u0000TOOL")) {
      flushProse();
      flushQuote();
      out.push(toolFold(trimmed));
    } else if (line.startsWith("> ")) {
      flushProse();
      quote.push(line.slice(2));
    } else {
      flushQuote();
      prose.push(line);
    }
  }
  flushProse();
  flushQuote();
  return out.join("");
}

const TOOL_MARK = /\u0000TOOL(\{[\s\S]*?\})\u0000/g;
const CODE_MARK = /\u0000CODE([\s\S]*?)\u0000/g;

/** One tool: a fold titled with the tool line, its result in an expandable quote. */
function toolFold(raw: string): string {
  const hit = TOOL_MARK.exec(raw);
  TOOL_MARK.lastIndex = 0;
  let title = raw.replace(/^> /, "");
  let result = "";
  let command = "";
  if (hit) {
    try {
      const parsed = JSON.parse(hit[1]!) as { title?: string; result?: string; command?: string };
      title = parsed.title || title;
      result = parsed.result || "";
      command = parsed.command || "";
    } catch {
      /* a plain "> " line has no result */
    }
  }
  const body =
    (command ? `<pre><code>${escapeHtml(command)}</code></pre>` : "") +
    (result ? `<blockquote expandable><p>${escapeHtml(result).replace(/\r?\n/g, "<br>")}</p></blockquote>` : "");
  return `<details open><summary><i>${escapeHtml(title)}</i></summary>${body}</details>`;
}

/** A code block folded one level deeper. The title is its line count. */
function codeDetails(code: string): string {
  const lines = code.length === 0 ? 0 : code.split(/\r?\n/).length;
  const title = lines === 1 ? "1 line" : `${lines} lines`;
  return `<details><summary><i>${title}</i></summary><pre><code>${escapeHtml(code)}</code></pre></details>`;
}

/** Plain sentences become a paragraph. Marked fences become code blocks. */
function renderProse(text: string): string {
  let html = "";
  let cursor = 0;
  for (const hit of text.matchAll(CODE_MARK)) {
    const before = text.slice(cursor, hit.index);
    if (before.replace(/\s/g, "")) html += `<p>${escapeHtml(before.trim()).replace(/\r?\n/g, "<br>")}</p>`;
    html += codeDetails(hit[1] ?? "");
    cursor = (hit.index ?? 0) + hit[0].length;
  }
  const rest = text.slice(cursor);
  if (rest.replace(/\s/g, "")) html += `<p>${escapeHtml(rest.trim()).replace(/\r?\n/g, "<br>")}</p>`;
  return html;
}
