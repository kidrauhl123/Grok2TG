/**
 * How the finished answer is allowed to look.
 *
 * Rich off (default): every reply is MarkdownV2. The model is told not to use
 * the four constructs MarkdownV2 cannot render; pipe tables are rewritten into
 * bullets before send.
 *
 * Rich on: ordinary replies still go MarkdownV2. Only a finished message that
 * actually contains one of those four — a pipe table, a task list, a
 * collapsible <details> block, or $$ block math — is sent with
 * sendRichMessage. A rejection, an oversized body, or math nested inside
 * <details> (Telegram Desktop crash) falls back to MarkdownV2.
 */

export const BODY_FORMAT_MARKER = "TELEGRAM BODY:";

/** GFM separator: at least three dashes. Used when rewriting a table. */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/**
 * Hermes detection (`TABLE_SEPARATOR_RE`): one or more dashes per cell, at
 * least two columns. A hit means MarkdownV2 would flatten the table.
 */
const RICH_TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;
const TASK_LIST = /^\s*[-*]\s+\[[ xX]\]\s+/m;
const DETAILS_LINE = /^<details\b|^<\/details>|^<summary\b|^<\/summary>/m;
const DETAILS_BLOCK = /<details\b[^>]*>[\s\S]*?<\/details>/gi;
const MATH_IN_DETAILS =
  /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\(?:sum|frac|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|int|prod|sqrt|lim|infty|begin\{(?:equation|align|matrix|cases)\})/i;

export function bodyFormatDirective(rich: boolean): string {
  if (rich) {
    return (
      `${BODY_FORMAT_MARKER} Ordinary replies stay MarkdownV2 ` +
      "(**bold**, *italic*, `code`, fences, links, ## headers, bullets). " +
      "Only a finished message that actually contains one of the four constructs MarkdownV2 cannot render " +
      "is sent as native rich text: a pipe table, a task list (`- [ ]` / `- [x]`), " +
      "a collapsible <details> block, or block math (`$$...$$`). " +
      "Use one of those when it makes the answer easier to scan. Do not force them onto ordinary prose."
    );
  }
  return (
    `${BODY_FORMAT_MARKER} Telegram rich Markdown is off. The final answer is MarkdownV2: ` +
    "**bold**, *italic*, `code`, fences, links, ## headers. " +
    'Structured data is bullets or "Label: value". No pipe tables, task lists, <details>, or $$ block math.'
  );
}

/**
 * True when the finished text contains a construct MarkdownV2 degrades:
 * a pipe table, a GFM task list, a collapsible details block, or block math.
 * Ordinary prose, bold, lists, and headings stay false.
 */
export function needsRichRendering(content: string): boolean {
  if (!content) return false;
  if (content.split("\n").some((line) => RICH_TABLE_SEPARATOR.test(line))) return true;
  if (TASK_LIST.test(content)) return true;
  if (DETAILS_LINE.test(content)) return true;
  return content.includes("$$");
}

/**
 * Math inside <details> crashes Telegram Desktop 6.9.1. The Bot API still
 * accepts the payload, so rich delivery has to be skipped up front.
 */
export function richDetailsContainMath(content: string): boolean {
  if (!content || !content.toLowerCase().includes("<details")) return false;
  const blocks = content.match(DETAILS_BLOCK);
  if (!blocks) return false;
  return blocks.some((block) => MATH_IN_DETAILS.test(block));
}

/** Drop the one-line body hint so history and cards keep the user's words. */
export function stripBodyFormatDirective(text: string): string {
  if (!text || !text.includes(BODY_FORMAT_MARKER)) return text;
  return text.replace(/TELEGRAM BODY:[^\n]*(?:\n+|$)/g, "").trim();
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

function renderTable(block: string[]): string {
  const headers = splitRow(block[0] ?? "");
  if (headers.length < 2) return block.join("\n");
  const groups: string[] = [];
  let index = 1;
  for (const row of block.slice(2)) {
    const cells = splitRow(row);
    const heading = cells[0] || `Row ${index}`;
    const bullets = headers.slice(1).map((header, i) => {
      const value = cells[i + 1] ?? "";
      return value ? `• ${header}: ${value}` : "";
    }).filter((line) => line.length > 0);
    groups.push([`**${heading}**`, ...bullets].join("\n"));
    index++;
  }
  return groups.join("\n\n");
}

/**
 * Rewrite GFM pipe tables into a bold heading plus bullets.
 * Fenced code is left alone.
 */
export function convertTablesToBullets(text: string): string {
  if (!text.includes("|") || !text.includes("-")) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) fence = !fence;
    const next = lines[i + 1];
    if (!fence && line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next)) {
      let j = i + 2;
      while (j < lines.length && lines[j]!.includes("|") && !lines[j]!.trimStart().startsWith("```")) j++;
      out.push(renderTable(lines.slice(i, j)));
      i = j;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}
