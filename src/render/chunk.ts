/**
 * Split a MarkdownV2 string into Telegram-sized chunks (<= 4096 chars) without
 * breaking code fences or expandable quotes. A split inside either construct
 * closes it before the boundary and reopens it in the next chunk.
 *
 * Expandable quotes are MarkdownV2 `**>` … `||`. A cut that leaves `**>`
 * without its closing `||` makes Telegram drop the whole entity, so the
 * thinking quote renders fully open.
 */
const LIMIT = 4000; // headroom under Telegram's 4096 hard limit

/** A line that opens an expandable quote, and is not itself the close. */
function opensExpandable(line: string): boolean {
  return line.startsWith("**>") && !line.endsWith("||");
}

export function chunkMarkdown(text: string, limit = LIMIT): string[] {
  if (text.length <= limit) return text.length ? [text] : [];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  /** Open fence: tick count + optional lang; null when outside a fence. */
  let openFence: { ticks: number; lang: string } | null = null;
  /** True after a `**>` line until the line that ends with `||`. */
  let openExpandable = false;

  const flush = (): void => {
    if (current.length === 0) return;
    let body = current.join("\n");
    if (openExpandable && !body.endsWith("||")) body += "||";
    if (openFence) body += "\n" + "`".repeat(openFence.ticks); // close dangling fence
    chunks.push(body);
    current = [];
    size = 0;
    if (openFence) {
      // Reopen the fence at the top of the next chunk (preserve tick length).
      const reopen = "`".repeat(openFence.ticks) + openFence.lang;
      current.push(reopen);
      size = reopen.length + 1;
    }
    if (openExpandable) {
      // Continue the collapsed quote. `**>` reopens it; the later `||` closes it.
      const reopen = "**>";
      current.push(reopen);
      size += reopen.length + 1;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const fenceMatch = /^(```+)(.*)$/.exec(line);

    // Hard-split a single oversized line (never mid-fence marker line).
    if (line.length + 1 > limit && fenceMatch === null) {
      flush();
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }

    if (size + line.length + 1 > limit) flush();

    current.push(line);
    size += line.length + 1;

    if (fenceMatch) {
      const ticks = fenceMatch[1]!.length;
      const lang = (fenceMatch[2] ?? "").trim();
      if (!openFence) {
        openFence = { ticks, lang };
      } else if (ticks >= openFence.ticks) {
        openFence = null;
      }
    }

    if (opensExpandable(line)) openExpandable = true;
    else if (openExpandable && line.endsWith("||")) openExpandable = false;
  }

  flush();
  return chunks.filter((c) => c.trim().length > 0);
}
