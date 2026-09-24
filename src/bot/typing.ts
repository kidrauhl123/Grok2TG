/**
 * Keeps the Telegram "typing…" chat action alive while the agent works.
 *
 * Same timing as Hermes Agent (`gateway/platforms/base.py::_keep_typing`):
 * Telegram drops the action after about 5s, so it is re-sent every 2s, and
 * one slow round-trip is abandoned before the next tick instead of letting
 * the bubble lapse. Sending starts the moment the message is received, not
 * when generation begins.
 */
import type { Api } from "grammy";
import { outboundMessageThreadId } from "../forum/thread.js";

/** Hermes re-sends well inside Telegram's ~5s expiry. */
const INTERVAL_MS = 2_000;
/** One send that overruns this is dropped so the next tick stays on time. */
const SEND_TIMEOUT_MS = 1_500;

export class TypingIndicator {
  private timer: NodeJS.Timeout | undefined;
  /** Drop a late reply from a send we already gave up on. */
  private generation = 0;

  constructor(
    private readonly api: Api,
    private readonly chatId: number,
    private readonly messageThreadId?: number,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.ping();
    this.timer = setInterval(() => void this.ping(), INTERVAL_MS);
  }

  stop(): void {
    this.generation += 1;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async ping(): Promise<void> {
    const generation = this.generation;
    const threadId = outboundMessageThreadId(this.messageThreadId);
    try {
      await withTimeout(
        this.api.sendChatAction(
          this.chatId,
          "typing",
          threadId !== undefined ? { message_thread_id: threadId } : {},
        ),
        SEND_TIMEOUT_MS,
      );
    } catch {
      /* non-fatal: a slow or rejected action must not stop the next tick */
    }
    if (generation !== this.generation) return;
  }
}

/** Reject if `work` has not settled within `ms`. The underlying call keeps running. */
function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("typing send timed out")), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
