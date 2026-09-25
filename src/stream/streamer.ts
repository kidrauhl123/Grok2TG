/**
 * ResponseStreamer — renders a whole agent turn into as FEW Telegram messages as
 * possible, edited at most once per throttle window (anti-spam, avoids 429s).
 *
 * The turn is modelled as ordered segments so the transcript reads clearly:
 *   • plain prose      = the agent talking to you
 *   • 🧠 body text      = the agent's thinking, in full, not a quote
 *   • one Hermes "all" line per tool start, stacked in one bubble
 *
 * A single "live" message is edited as content grows; only when it would exceed
 * Telegram's size limit is it sealed and a new live message started.
 */
import type { Api } from "grammy";
import { chunkMarkdown } from "../render/chunk.js";
import { toTelegramMarkdown } from "../render/markdown.js";
import { stripProgressMarkers } from "../render/progress.js";
import { stripTelegramActionFences } from "../render/telegram-bridge.js";
import { safeEdit, safeSend } from "../bot/telegram-io.js";
import { outboundThreadExtra } from "../forum/thread.js";

const SOFT_LIMIT = 3500;
/** Do not refresh the activity line until the live bubble has been silent this long. */
export const LIVENESS_MIN_SILENCE_MS = 12_000;

type SegKind = "out" | "think" | "tool";
interface Seg {
  kind: SegKind;
  text: string;
  /** When set, later tool updates replace this segment instead of appending. */
  toolId?: string;
}

/**
 * Activity footer while ACP is quiet. Empty when there is no known step —
 * never show a bare "Still working · Xm" timer (useless noise).
 */
export function formatLivenessHint(elapsedLabel: string, step?: string): string {
  const s = (step || "").trim();
  if (!s) return "";
  const e = elapsedLabel.trim();
  const short = s.length > 120 ? `${s.slice(0, 119)}\u2026` : s;
  return e ? `${short} \u00B7 ${e}` : short;
}

/** Whether a liveness pulse should edit the bubble (pure helper for tests). */
export function shouldPulseLiveness(opts: {
  closed: boolean;
  lastContentAt: number;
  now: number;
  nextHint: string;
  currentHint?: string;
  minSilenceMs?: number;
  /** Need an existing bubble or real content before pulsing. */
  hasLiveSurface: boolean;
}): boolean {
  if (opts.closed || !opts.hasLiveSurface) return false;
  if (!opts.nextHint.trim()) return false;
  const silence = opts.now - opts.lastContentAt;
  if (silence < (opts.minSilenceMs ?? LIVENESS_MIN_SILENCE_MS)) return false;
  if (opts.currentHint === opts.nextHint) return false;
  return true;
}

export interface StreamerOptions {
  /** Chat-like mode: drop thoughts/tools/plan; only stream agent prose. */
  proseOnly?: boolean;
  /**
   * Pre-posted message id to edit in place (e.g. General "Thinking…" placeholder).
   * Avoids a separate bubble when the first real tokens arrive.
   */
  seedMessageId?: number;
}

export class ResponseStreamer {
  private readonly segs: Seg[] = [];
  private sealedIdx = 0;
  private liveId: number | undefined;
  private timer: NodeJS.Timeout | undefined;
  private dirty = false;
  private flushing = false;
  private closed = false;
  /**
   * Active plan board (ACP sessionUpdate "plan"), rendered above the liveness
   * line when set — done / in-progress / pending steps.
   */
  private planMarkdown: string | undefined;
  private readonly proseOnly: boolean;
  /** Wall clock of last real agent content (not liveness pulses). */
  private lastContentAt = Date.now();
  /** Sticky "still working" line while long tools emit no ACP updates. */
  private livenessLine: string | undefined;
  /** Single-flight lock so concurrent ensureLiveSurface calls cannot double-post. */
  private ensureSurfaceInflight: Promise<void> | undefined;
  /**
   * Answer text held until the turn finishes. It is not edited into Telegram
   * while the model is still writing — that seals a half message.
   * Presence counts as output so a dropped stream is not re-run from scratch.
   */
  private answerBuf = "";
  /** True once a thought or tool card was written into the live bubble. */
  private processPainted = false;
  /** In-flight flush, so a final flush can wait instead of dropping the tail. */
  private flushDone: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: Api,
    private readonly chatId: number,
    private readonly throttleMs: number,
    private replyTo?: number,
    private footer?: string,
    /** Forum topic thread — required so stream edits land in the right topic. */
    private readonly messageThreadId?: number,
    opts?: StreamerOptions,
  ) {
    this.proseOnly = !!opts?.proseOnly;
    if (opts?.seedMessageId !== undefined) this.liveId = opts.seedMessageId;
  }

  /** Replace the hashtag footer (used after a logical fork swaps the session id
   *  mid-turn, so the streamed response carries the NEW session's tags). */
  setFooter(footer: string): void {
    this.footer = footer;
  }

  /** Seed/replace the live bubble id (General Thinking… placeholder). */
  seedLiveMessage(messageId: number): void {
    this.liveId = messageId;
  }

  /**
   * Post a placeholder live message so a real step (a tool, a subagent) has a
   * surface before the first chunk. A bare "Working…" is not a step: that used
   * to be its own bubble, and it is replaced by a reaction on the user's
   * message, so it must not be posted here.
   * Concurrent callers share one in-flight send.
   */
  async ensureLiveSurface(placeholder?: string): Promise<void> {
    if (this.closed || this.liveId !== undefined) return;
    const src = (placeholder ?? "").trim();
    if (!src || src === "\u23F3 Working\u2026") return;
    if (this.ensureSurfaceInflight) return this.ensureSurfaceInflight;
    this.ensureSurfaceInflight = (async () => {
      try {
        if (this.closed || this.liveId !== undefined) return;
        const rendered = toTelegramMarkdown(src);
        this.liveId = await safeSend(this.api, this.chatId, rendered, src, this.replyExtra(true));
      } finally {
        this.ensureSurfaceInflight = undefined;
      }
    })();
    return this.ensureSurfaceInflight;
  }

  /** Current live Telegram message id (for attaching suggestions after finalize). */
  get liveMessageId(): number | undefined {
    return this.liveId;
  }

  /** "\n\n<footer>" appended to every finished message bubble (e.g. hashtags). */
  private footerSuffix(): string {
    return this.footer ? `\n\n${this.footer}` : "";
  }

  /** Footer for a rich message. A leading # is a Markdown heading there, so
   *  escape it and the line stays small instead of rendering as a title. */
  private richFooter(): string {
    if (!this.footer) return "";
    return `\n\n${this.footer.replace(/(^|\s)#/g, "$1\\#")}`;
  }

  /** Strip telegram action JSON fences and any leftover progress marker. */
  private captureProgress(text: string): string {
    return stripProgressMarkers(stripTelegramActionFences(text));
  }

  private threadExtra(): Record<string, unknown> {
    // Never send message_thread_id=1 (General) — Telegram rejects it.
    return outboundThreadExtra(this.messageThreadId);
  }

  /** reply_parameters threading a message to the user's prompt, plus the forum
   *  topic id. The process bubble (thinking, tools) and the finished answer
   *  both quote the prompt, so the work stays on the question. */
  private replyExtra(reply: boolean): Record<string, unknown> {
    const extra: Record<string, unknown> = { ...this.threadExtra() };
    if (reply && this.replyTo !== undefined) {
      extra.reply_parameters = { message_id: this.replyTo, allow_sending_without_reply: true };
    }
    return extra;
  }

  appendOutput(text: string): void {
    if (!text) return;
    // Record only. The finished answer is sent by the runtime after the turn,
    // from the full transcript, so a mid-turn edit cannot close a half reply.
    this.answerBuf += text;
    this.noteRealContent();
  }

  appendThought(text: string): void {
    if (!text || this.proseOnly) return;
    this.merge("think", text);
    this.noteRealContent();
    this.schedule(true);
  }

  /**
   * Hermes `all` + `accumulate`: append one tool-start line. The same line
   * twice in a row becomes `line (×N)`. Lines stack with a single newline.
   */
  appendProgressLine(rawMarkdown: string): void {
    const line = rawMarkdown.replace(/\s+$/g, "");
    if (!line.trim() || this.proseOnly) return;
    const last = this.segs.at(-1);
    if (last?.kind === "tool" && last.toolId === "progress") {
      const base = last.text.replace(/ \(×\d+\)$/, "");
      if (base === line) {
        const times = / \(×(\d+)\)$/.exec(last.text);
        const n = times ? Number(times[1]) + 1 : 2;
        last.text = `${line} (×${n})`;
      } else {
        this.segs.push({ kind: "tool", text: line, toolId: "progress" });
      }
    } else {
      this.segs.push({ kind: "tool", text: line, toolId: "progress" });
    }
    this.noteRealContent();
    this.schedule(true);
  }

  /**
   * Append a one-shot tool card (no live updates). Prefer {@link upsertTool}
   * for ACP tool calls that stream progress/output under a stable toolCallId.
   */
  addTool(rawMarkdown: string): void {
    if (!rawMarkdown || this.proseOnly) return;
    this.segs.push({ kind: "tool", text: rawMarkdown });
    this.noteRealContent();
    this.schedule(true);
  }

  /**
   * Insert or replace a tool card keyed by toolCallId so one command/edit stays
   * a single Telegram block that auto-updates (no spam of new code sections).
   * Full tool results remain in the agent session; this is display-only.
   */
  /** Replace the live plan board (or clear with empty/undefined). */
  setPlan(markdown: string | undefined): void {
    if (this.proseOnly) return;
    const next = markdown?.trim() ? markdown.trim() : undefined;
    if (next === this.planMarkdown) return;
    this.planMarkdown = next;
    this.noteRealContent();
    this.schedule();
  }

  upsertTool(toolId: string | undefined, rawMarkdown: string): void {
    if (!rawMarkdown || this.proseOnly) return;
    const id = (toolId || "").trim();
    if (id) {
      // Replace any existing segment with this id (newest first; includes rare
      // sealed-region matches so we don't keep stale text in the segs model).
      for (let i = this.segs.length - 1; i >= 0; i--) {
        const s = this.segs[i]!;
        if (s.kind === "tool" && s.toolId === id) {
          if (s.text === rawMarkdown) return;
          s.text = rawMarkdown;
          // If the card lives only in a sealed bubble, also ensure a live copy
          // so the user sees the latest output on the current message.
          if (i < this.sealedIdx) {
            this.segs.push({ kind: "tool", text: rawMarkdown, toolId: id });
          }
          this.noteRealContent();
          this.schedule(true);
          return;
        }
      }
    }
    this.segs.push({ kind: "tool", text: rawMarkdown, toolId: id || undefined });
    this.noteRealContent();
    this.schedule(true);
  }

  /**
   * Refresh the activity footer with a known live step (+ elapsed) when ACP is
   * quiet. No-op without a step (never a bare timer) or when unchanged/recent.
   */
  pulseLiveness(elapsedLabel: string, step?: string): void {
    const next = formatLivenessHint(elapsedLabel, step);
    if (
      !shouldPulseLiveness({
        closed: this.closed,
        lastContentAt: this.lastContentAt,
        now: Date.now(),
        nextHint: next,
        currentHint: this.livenessLine,
        hasLiveSurface: this.liveId !== undefined || this.hasOutput,
      })
    ) {
      return;
    }
    this.livenessLine = next;
    this.schedule(true);
  }

  /** True when agent prose/tools/thoughts were appended (not just a seed bubble). */
  get hasOutput(): boolean {
    return this.answerBuf.trim().length > 0 || this.segs.some((s) => s.text.trim().length > 0);
  }

  async finalize(): Promise<void> {
    this.closed = true;
    this.livenessLine = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.flushing) await this.flushDone;
    await this.flush(true);
    if (this.liveId !== undefined && !this.processPainted) {
      const id = this.liveId;
      this.liveId = undefined;
      await this.api.deleteMessage(this.chatId, id).catch(() => {});
    }
    // Seeded Thinking… with zero agent text: clear the placeholder.
    // Manager quiet mode also deletes/replaces this bubble explicitly.
    if (
      this.proseOnly &&
      this.liveId !== undefined &&
      !this.segs.some((s) => s.text.trim().length > 0)
    ) {
      try {
        await this.api.editMessageText(this.chatId, this.liveId, "\u2026");
      } catch {
        /* non-fatal */
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private merge(kind: SegKind, text: string): void {
    const last = this.segs.at(-1);
    if (last && last.kind === kind) last.text += text;
    else this.segs.push({ kind, text });
  }

  /** Real agent/tool content — clear any stale "still working" hint. */
  private noteRealContent(): void {
    this.lastContentAt = Date.now();
    this.livenessLine = undefined;
  }

  /**
   * @param urgent tool updates — flush sooner (~200ms) so heavy /goal turns
   * feel live instead of waiting a full throttle window.
   */
  private schedule(urgent = false): void {
    if (this.closed) return;
    this.dirty = true;
    const delay = urgent ? Math.min(200, this.throttleMs) : this.throttleMs;
    if (this.timer) {
      if (!urgent) return;
      // Reschedule sooner for tool cards.
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush(false);
    }, delay);
  }

  private async flush(final: boolean): Promise<void> {
    if (this.flushing) {
      if (!final) {
        this.schedule();
        return;
      }
      await this.flushDone;
    }
    if (!this.dirty && !final) return;
    let release: () => void = () => {};
    this.flushDone = new Promise((resolve) => {
      release = resolve;
    });
    this.flushing = true;
    this.dirty = false;
    try {
      await this.sealOverflow(final);
      // The answer is not in these segments. It is sent once, after the turn.
      const liveSegs = this.segs.slice(this.sealedIdx).filter((s) => s.kind !== "out");
      const base = this.captureProgress(renderSegs(liveSegs));
      // Hang the process bubble on the user's message. The finished answer is a
      // second reply, sent only after the text is complete.
      const liveReply = this.replyTo !== undefined;
      // Never send an empty / progress-only bubble. Plan alone is allowed so the
      // board is visible as soon as the agent publishes steps.
      if (!base.trim() && !this.planMarkdown && !this.livenessLine) return;
      if (base.trim() || this.planMarkdown) this.processPainted = true;
      // Live bubble: thoughts / tools → plan → liveness → footer.
      const parts: string[] = [];
      if (base.trim()) parts.push(base);
      if (!this.proseOnly && this.planMarkdown) parts.push(this.planMarkdown);
      if (this.livenessLine) parts.push(this.livenessLine);
      if (parts.length === 0) return;
      const src = `${parts.join("\n\n")}${this.footerSuffix()}`;
      const rendered = toTelegramMarkdown(src);
      const chunks = chunkMarkdown(rendered);
      const plain = chunkMarkdown(src);
      if (chunks.length <= 1) {
        const mdv2 = chunks[0] ?? rendered;
        if (this.liveId === undefined) this.liveId = await safeSend(this.api, this.chatId, mdv2, src, this.replyExtra(liveReply));
        else await safeEdit(this.api, this.chatId, this.liveId, mdv2, src);
      } else {
        // Remainder no longer fits one message: flush all, last stays live.
        for (let i = 0; i < chunks.length; i++) {
          const mdv2 = chunks[i]!;
          const p = plain[i] ?? mdv2;
          if (i === 0 && this.liveId !== undefined) await safeEdit(this.api, this.chatId, this.liveId, mdv2, p);
          else if (i < chunks.length - 1) await safeSend(this.api, this.chatId, mdv2, p, this.replyExtra(liveReply));
          else this.liveId = await safeSend(this.api, this.chatId, mdv2, p, this.replyExtra(liveReply));
        }
        this.sealedIdx = this.segs.length; // everything before the live tail is sealed
      }
    } finally {
      this.flushing = false;
      release();
    }
  }

  /** Seal leading segments into finalized messages while the live view is too big,
   *  and always seal at a thought/tool → answer boundary so the answer can quote
   *  the user on its own message. */
  private async sealOverflow(final = false): Promise<void> {
    let live = this.segs.slice(this.sealedIdx);
    while (live.length > 1 && this.shouldSealHead(live, final)) {
      const headCount = this.sealHeadCount(live);
      await this.seal(this.sealedIdx, this.sealedIdx + headCount);
      this.sealedIdx += headCount;
      this.liveId = undefined;
      live = this.segs.slice(this.sealedIdx);
    }
  }

  /** True when the live view must shed its leading segments. */
  private shouldSealHead(live: Seg[], final = false): boolean {
    if (live.length <= 1) return false;
    if (toTelegramMarkdown(renderSegs(live)).length > SOFT_LIMIT) return true;
    // A thought or tool card followed by the answer: seal the thought so the
    // answer starts a fresh message that quotes the user. At the end of the turn
    // the answer is sealed on its own too, so it is sent once instead of edited
    // onto the thought's bubble.
    if (groupForReply(live).length > 1 && live[0]!.kind !== "out") return true;
    // The answer is its own message. Once it is the head, anything after it
    // (a later command or thought) must be sealed off too, or it is edited into
    // the answer and the answer's tail never goes out on its own.
    if (live[0]!.kind === "out" && live.some((s) => s.kind !== "out")) return true;
    return final && live.some((s) => s.kind === "out") && live[0]!.kind !== "out";
  }

  /** How many leading segments to seal: up to the first kind change, else all but one. */
  private sealHeadCount(live: Seg[]): number {
    const firstOut = live[0]!.kind === "out";
    for (let i = 1; i < live.length; i++) {
      if ((live[i]!.kind === "out") !== firstOut) return i;
    }
    return live.length - 1;
  }

  private async seal(from: number, to: number): Promise<void> {
    const slice = this.segs.slice(from, to);
    const base = this.captureProgress(renderSegs(slice.filter((s) => s.kind !== "out")));
    if (!base.trim()) return;
    this.processPainted = true;
    // A sealed process bubble stays, and it quotes the user so the thinking
    // and tool cards sit on the same message as the question.
    const reply = this.replyTo !== undefined && slice.some((s) => s.kind !== "out");
    const src = `${base}${this.footerSuffix()}`;
    const chunks = chunkMarkdown(toTelegramMarkdown(src));
    const plain = chunkMarkdown(src);
    for (let i = 0; i < chunks.length; i++) {
      const mdv2 = chunks[i]!;
      const p = plain[i] ?? mdv2;
      if (i === 0 && this.liveId !== undefined) await safeEdit(this.api, this.chatId, this.liveId, mdv2, p);
      else await safeSend(this.api, this.chatId, mdv2, p, this.replyExtra(reply));
    }
  }
}

/** A run of segments that should travel as one bubble, and whether it replies. */
export interface RenderGroup {
  text: string;
  /** Only the final answer quotes the user's message. Thoughts and tool cards do not. */
  reply: boolean;
}

/**
 * Group segments into bubbles so a thought or a tool card never shares a message
 * with the answer. The answer is the only part that quotes the user's message, so
 * it must be its own bubble; everything before it is sent without a reply.
 * `reply` is true only for the last group, and only when that group is the answer.
 */
export function groupForReply(segs: Seg[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let buf: Seg[] = [];
  let bufReply = false;
  const flush = (): void => {
    if (buf.length === 0) return;
    const text = renderSegs(buf);
    if (text.trim()) groups.push({ text, reply: bufReply });
    buf = [];
  };
  for (const s of segs) {
    const reply = s.kind === "out";
    if (buf.length > 0 && reply !== bufReply) flush();
    buf.push(s);
    bufReply = reply;
  }
  flush();
  if (groups.length > 1) {
    for (let i = 0; i < groups.length - 1; i++) groups[i]!.reply = false;
  }
  return groups;
}

function renderSegs(segs: Seg[]): string {
  const parts: { text: string; progress: boolean }[] = [];
  for (const s of segs) {
    const text = s.kind === "out"
      ? s.text.trim()
      : s.kind === "think"
        ? formatThought(s.text)
        : s.text.trim();
    if (!text) continue;
    parts.push({ text, progress: s.kind === "tool" && s.toolId === "progress" });
  }
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out += parts[i - 1]!.progress && parts[i]!.progress ? "\n" : "\n\n";
    out += parts[i]!.text;
  }
  return out;
}

function formatThought(text: string): string {
  const t = text.trim();
  if (!t) return "";
  // Fence markers and half-open emphasis break MarkdownV2 of the live bubble.
  // The words themselves are kept in full.
  const safe = t
    .replace(/```+/g, "'''")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/~~/g, "");
  return `\u{1F9E0} ${safe}`;
}
