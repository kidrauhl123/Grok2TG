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
/** Shown once the turn is done. The elapsed seconds are appended by the caller. */
export const PROCESS_DONE_SUMMARY = "Worked for";

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

/** Thinking stays one paragraph. A run of "> " lines becomes one quote.
 *  A fenced block arrives wrapped in \u0000 markers and becomes a code block. */
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
    out.push(`<blockquote><p>${escapeHtml(quote.join("\n")).replace(/\r?\n/g, "<br>")}</p></blockquote>`);
    quote = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("> ")) {
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

const CODE_MARK = /\u0000CODE([\s\S]*?)\u0000/g;

/** Plain sentences become a paragraph. Marked fences become code blocks. */
function renderProse(text: string): string {
  let html = "";
  let cursor = 0;
  for (const hit of text.matchAll(CODE_MARK)) {
    const before = text.slice(cursor, hit.index);
    if (before.replace(/\s/g, "")) html += `<p>${escapeHtml(before.trim()).replace(/\r?\n/g, "<br>")}</p>`;
    html += `<pre><code>${escapeHtml(hit[1] ?? "")}</code></pre>`;
    cursor = (hit.index ?? 0) + hit[0].length;
  }
  const rest = text.slice(cursor);
  if (rest.replace(/\s/g, "")) html += `<p>${escapeHtml(rest.trim()).replace(/\r?\n/g, "<br>")}</p>`;
  return html;
}
