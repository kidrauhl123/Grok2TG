/**
 * Per-chat persistent settings (JSON file under the data dir).
 */
import { join } from "node:path";
import type { ChatSettings } from "./types.js";
import { defaultSettings } from "./types.js";
import { JsonStore } from "./json-store.js";

export class SettingsStore {
  private readonly store: JsonStore<Record<string, ChatSettings>>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "settings.json"), {});
  }

  /** Settings key for a chat, optionally scoped to a forum topic thread. */
  private key(chatId: number, threadId?: number): string {
    return threadId ? `${chatId}:t${threadId}` : String(chatId);
  }

  get(chatId: number, threadId?: number): ChatSettings {
    return this.getKey(this.key(chatId, threadId));
  }

  getKey(key: string): ChatSettings {
    return this.store.get()[key] ?? defaultSettings();
  }

  update(chatId: number, patch: Partial<ChatSettings>, threadId?: number): ChatSettings {
    return this.updateKey(this.key(chatId, threadId), patch);
  }

  updateKey(key: string, patch: Partial<ChatSettings>): ChatSettings {
    const next = { ...this.getKey(key), ...patch };
    const all = this.store.get();
    all[key] = next;
    this.store.set(all);
    return next;
  }

  /** Drop settings for a topic (e.g. when its forum topic is deleted). */
  deleteKey(key: string): void {
    const all = this.store.get();
    if (!(key in all)) return;
    delete all[key];
    this.store.set(all);
  }

  /**
   * Every settings entry bound to a project path — chat-level project or a
   * manager-controlled session. Used to find the topics that should hear about
   * a change (a commit, a PR) that happened in that project.
   */
  entriesForProject(projectPath: string): Array<{ key: string; settings: ChatSettings }> {
    const want = normPath(projectPath);
    const out: Array<{ key: string; settings: ChatSettings }> = [];
    for (const [key, s] of Object.entries(this.store.get())) {
      if (s.projectPath && normPath(s.projectPath) === want) {
        out.push({ key, settings: s });
      }
      for (const cs of s.controlledSessions ?? []) {
        if (cs.projectPath && normPath(cs.projectPath) === want) {
          out.push({ key, settings: s });
          break;
        }
      }
    }
    return out;
  }

  /**
   * The chat and topic that currently have `sessionId` in the foreground, so a
   * turn cut off by a restart can be resumed in the same place. Undefined when
   * the session is not anyone's foreground.
   */
  locationOfSession(sessionId: string): { chatId: number; threadId?: number } | undefined {
    for (const [key, s] of Object.entries(this.store.get())) {
      if (s.foregroundSessionId !== sessionId && s.sessionId !== sessionId) continue;
      const [chatPart, threadPart] = key.split(":");
      const chatId = Number(chatPart);
      if (!Number.isFinite(chatId)) continue;
      const threadId = threadPart?.startsWith("t") ? Number(threadPart.slice(1)) : undefined;
      return { chatId, threadId: Number.isFinite(threadId) ? threadId : undefined };
    }
    return undefined;
  }

  /** All chat ids that have interacted (for broadcast announcements). */
  chatIds(): number[] {
    const ids = new Set<number>();
    for (const key of Object.keys(this.store.get())) {
      const n = Number(key.split(":")[0]);
      if (Number.isFinite(n)) ids.add(n);
    }
    return [...ids];
  }
}

function normPath(p: string): string {
  return p.replace(/\/+$/, "");
}
