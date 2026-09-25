/**
 * What to do with updates Telegram queued while nobody was polling.
 *
 * A process start is a cold boot: the queue was built while the bot was down,
 * and those messages are discarded, matching Hermes. A later start inside the
 * same process is a reconnect (the polling loop died and came back), and that
 * queue holds messages sent while the bot was up, so it is kept.
 */
export function dropPendingOnStart(startsSoFar: number): boolean {
  return startsSoFar === 0;
}

/** One line for the log, so a discarded queue is visible instead of silent. */
export function coldBootQueueLog(drop: boolean): string {
  return drop
    ? "Cold boot: dropping Telegram updates queued while offline"
    : "Reconnect: keeping Telegram updates queued during the outage";
}
