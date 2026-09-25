/**
 * One `grok agent stdio` process per ACP session.
 *
 * A single shared process means one stuck session/prompt freezes every topic,
 * because JSON-RPC for all sessions shares one stdio pipe and one Node event
 * loop. Terminal users already get isolation by opening another window (another
 * process); this pool does the same for forum topics.
 *
 * The pool owns the processes. Callers still talk to a GrokClient — forClient()
 * returns the process that owns that session (or the warm spare, which is
 * claimed by the next session/new or session/load). Process-wide actions
 * (account rotation, /restart, sandbox) are fanned out to every live process.
 *
 * Idle processes are stopped after `idleMs` of no prompt activity so a forum
 * with many topics does not keep a grok agent resident for each of them.
 */
import { EventEmitter } from "node:events";
import { createLogger } from "../logger.js";
import { GrokClient, type GrokClientOptions } from "./client.js";
import type { PendingStage, SubagentInfo } from "./types.js";

const log = createLogger("grok:pool");

const DEFAULT_IDLE_MS = 30 * 60_000;
const REAP_INTERVAL_MS = 60_000;

export class GrokPool extends EventEmitter {
  private readonly bySession = new Map<string, GrokClient>();
  /** Connected process with no session bound yet. At most one. */
  private spare: GrokClient | undefined;
  private spareStarting: Promise<GrokClient> | undefined;
  private readonly lastUsed = new Map<GrokClient, number>();
  private handlers: {
    permissionHandler?: GrokClient["permissionHandler"];
    planExitHandler?: GrokClient["planExitHandler"];
    askUserHandler?: GrokClient["askUserHandler"];
    onSessionCancel?: GrokClient["onSessionCancel"];
  } = {};
  private readonly reapTimer: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly opts: GrokClientOptions,
    private readonly idleMs = DEFAULT_IDLE_MS,
  ) {
    super();
    this.setMaxListeners(0);
    this.reapTimer = setInterval(() => this.reap(), REAP_INTERVAL_MS);
  }

  /** Client that owns `sessionId`, or the shared spare when none does. */
  clientFor(sessionId: string | undefined): GrokClient {
    if (sessionId) {
      const owned = this.bySession.get(sessionId);
      if (owned) return owned;
    }
    return this.ensureSpare();
  }

  /**
   * A connected client ready for session/new or session/load.
   * Concurrent callers share one in-flight start.
   */
  async acquire(): Promise<GrokClient> {
    if (this.spare) return this.spare;
    if (this.spareStarting) return this.spareStarting;
    const client = this.make();
    this.spareStarting = client
      .start()
      .then(() => {
        this.spare = client;
        this.touch(client);
        return client;
      })
      .finally(() => {
        this.spareStarting = undefined;
      });
    return this.spareStarting;
  }

  /**
   * Bind a session id to the process that created or loaded it, so later calls
   * for that id hit the same process. The warm spare is consumed; the next
   * acquire() starts a fresh one.
   */
  bind(sessionId: string, client: GrokClient): void {
    const prev = this.bySession.get(sessionId);
    if (prev && prev !== client) {
      // Session moved (fork / re-bind onto a fresh process). Drop the old one
      // once nothing else references it.
      this.bySession.set(sessionId, client);
      this.releaseIfOrphan(prev);
    } else {
      this.bySession.set(sessionId, client);
    }
    if (this.spare === client) this.spare = undefined;
    this.touch(client);
  }

  /** Drop the binding when a session is closed. Stops the process if it is now idle. */
  unbind(sessionId: string): void {
    const client = this.bySession.get(sessionId);
    if (!client) return;
    this.bySession.delete(sessionId);
    this.releaseIfOrphan(client);
  }

  touch(sessionIdOrClient: string | GrokClient | undefined): void {
    const client =
      typeof sessionIdOrClient === "string"
        ? this.bySession.get(sessionIdOrClient)
        : sessionIdOrClient;
    if (client) this.lastUsed.set(client, Date.now());
  }

  /** Every process that currently owns a session, plus the spare. */
  liveClients(): GrokClient[] {
    const all = new Set<GrokClient>(this.bySession.values());
    if (this.spare) all.add(this.spare);
    return [...all];
  }

  has(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  get size(): number {
    return this.liveClients().length;
  }

  /** PIDs of every agent process this pool spawned (bot-owned, never /kill targets). */
  pids(): number[] {
    const ids: number[] = [];
    for (const c of this.liveClients()) if (c.pid) ids.push(c.pid);
    return ids;
  }

  metadataFor(sessionId: string | undefined): ReturnType<GrokClient["metadataFor"]> {
    if (!sessionId) return undefined;
    return this.bySession.get(sessionId)?.metadataFor(sessionId);
  }

  currentSubagents(): SubagentInfo[] {
    const out: SubagentInfo[] = [];
    for (const c of this.liveClients()) out.push(...c.currentSubagents());
    return out;
  }

  currentPendingStages(): PendingStage[] {
    const out: PendingStage[] = [];
    for (const c of this.liveClients()) out.push(...c.currentPendingStages());
    return out;
  }

  subagentById(sessionId: string): SubagentInfo | undefined {
    for (const c of this.liveClients()) {
      const info = c.subagentById(sessionId);
      if (info) return info;
    }
    return undefined;
  }

  /** Handlers shared by every agent process (permissions, plan exit, ask-user). */
  setHandlers(h: {
    permissionHandler?: GrokClient["permissionHandler"];
    planExitHandler?: GrokClient["planExitHandler"];
    askUserHandler?: GrokClient["askUserHandler"];
    onSessionCancel?: GrokClient["onSessionCancel"];
  }): void {
    this.handlers = h;
    for (const c of this.liveClients()) this.applyHandlers(c);
  }
  setAgentOptions(opts: { sandboxProfile?: string; grokMemory?: string }): void {
    if (opts.sandboxProfile !== undefined) this.opts.sandboxProfile = opts.sandboxProfile;
    if (opts.grokMemory !== undefined) this.opts.grokMemory = opts.grokMemory;
    for (const c of this.liveClients()) c.setAgentOptions(opts);
  }

  /** Restart every live agent. Each emits its own "restarted"; sessions re-bind lazily. */
  async restartAll(): Promise<void> {
    const clients = this.liveClients();
    await Promise.all(clients.map((c) => c.restart()));
  }

  /**
   * Account rotation: every agent must be down before auth.json is swapped,
   * then each one re-authenticates against the new token.
   */
  async stopAllAndWait(): Promise<void> {
    const clients = this.liveClients();
    this.spare = undefined;
    await Promise.all(clients.map((c) => c.stopAndWait()));
  }

  /** Alias kept for callers and tests written against the single-client API. */
  stopAndWait(): Promise<void> {
    return this.stopAllAndWait();
  }

  /** Alias for restartAll(); account rotation and /restart both restart every agent. */
  restart(): Promise<void> {
    return this.restartAll();
  }

  /** Bring the warm spare back after stopAllAndWait() (e.g. a failed rotation). */
  async start(notifyRestarted = false): Promise<void> {
    const client = await this.acquire();
    if (notifyRestarted) client.emit("restarted");
  }

  /** Bot shutdown: stop every agent and the reaper.
   *  A real shutdown leaves in-flight turns unsettled, so their lock files stay
   *  and the next process resumes them. A grok restart still settles them. */
  stop(keepLocks = false): void {
    this.stopped = true;
    clearInterval(this.reapTimer);
    for (const c of this.liveClients()) c.stop(keepLocks);
    this.bySession.clear();
    this.spare = undefined;
  }

  private ensureSpare(): GrokClient {
    if (this.spare) return this.spare;
    // Synchronous callers (touchActivity, setModel before a session exists)
    // need a client now; connect it in the background.
    const client = this.make();
    this.spare = client;
    void client.start().catch((e) => {
      log.error("spare agent failed to start:", (e as Error).message);
      if (this.spare === client) this.spare = undefined;
    });
    return client;
  }

  private make(): GrokClient {
    const client = new GrokClient(this.opts);
    this.applyHandlers(client);
    this.wire(client);
    this.touch(client);
    return client;
  }

  private applyHandlers(client: GrokClient): void {
    if (this.handlers.permissionHandler) client.permissionHandler = this.handlers.permissionHandler;
    if (this.handlers.planExitHandler) client.planExitHandler = this.handlers.planExitHandler;
    if (this.handlers.askUserHandler) client.askUserHandler = this.handlers.askUserHandler;
    if (this.handlers.onSessionCancel) client.onSessionCancel = this.handlers.onSessionCancel;
  }

  /** Re-emit per-process events so existing listeners keep working unchanged. */
  private wire(client: GrokClient): void {
    client.on("session-update", (sid: string, update: unknown) => {
      this.touch(sid);
      this.emit("session-update", sid, update);
    });
    client.on("plan-exit", (sid: string | undefined, result: unknown) => {
      if (sid) this.touch(sid);
      this.emit("plan-exit", sid, result);
    });
    client.on("restarted", () => this.emit("restarted"));
    client.on("subagents", (subagents: unknown, pending: unknown) =>
      this.emit("subagents", subagents, pending),
    );
    client.on("notification", (method: unknown, params: unknown) =>
      this.emit("notification", method, params),
    );
    client.on("exit", (code: unknown) => this.emit("exit", code));
  }

  private releaseIfOrphan(client: GrokClient): void {
    if (this.owns(client) || this.spare === client) return;
    log.info(`stopping agent with no remaining sessions (pid ${client.pid ?? "?"})`);
    this.lastUsed.delete(client);
    client.stop();
  }

  private owns(client: GrokClient): boolean {
    for (const c of this.bySession.values()) if (c === client) return true;
    return false;
  }

  private reap(): void {
    if (this.stopped) return;
    const cutoff = Date.now() - this.idleMs;
    for (const client of this.liveClients()) {
      if (client.hasInflightPrompt()) continue;
      const seen = this.lastUsed.get(client) ?? 0;
      if (seen > cutoff) continue;
      log.info(`reaping idle agent (pid ${client.pid ?? "?"})`);
      for (const [sid, c] of this.bySession) if (c === client) this.bySession.delete(sid);
      if (this.spare === client) this.spare = undefined;
      this.lastUsed.delete(client);
      client.stop();
    }
  }
}
