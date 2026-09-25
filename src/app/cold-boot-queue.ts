/** Name of the flag a stalled process sets before it exits, so the next one keeps the queue. */
export const KEEP_QUEUE_FLAG = "GROK_TG_KEEP_QUEUE";

/**
 * What to do with updates Telegram queued while nobody was polling.
 *
 * A process start is a cold boot: the queue was built while the bot was down,
 * and those messages are discarded, matching Hermes. A later start inside the
 * same process is a reconnect (the polling loop died and came back), and that
 * queue holds messages sent while the bot was up, so it is kept. A restart
 * that exists only because the poller stalled is the same case: the flag says
 * the queue holds messages the dead process never pulled.
 */
export function dropPendingOnStart(startsSoFar: number): boolean {
  if (process.env[KEEP_QUEUE_FLAG] === "1") return false;
  return startsSoFar === 0;
}

/** One line for the log, so a discarded queue is visible instead of silent. */
export function coldBootQueueLog(drop: boolean): string {
  return drop
    ? "Cold boot: dropping Telegram updates queued while offline"
    : "Reconnect: keeping Telegram updates queued during the outage";
}
