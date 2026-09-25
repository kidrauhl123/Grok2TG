/**
 * Forum groups this bot has adopted, so a group works without TOPIC_GROUP_ID.
 *
 * The configured group is handled by ForumManager. Any other supergroup that
 * arrives with a topic id is remembered here and treated as a forum from then
 * on: each topic gets its own session, no setup command and no restart.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class ForumGroups {
  private readonly file: string;
  private ids = new Set<number>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "forum-groups.json");
    this.load();
  }

  has(chatId: number): boolean {
    return this.ids.has(chatId);
  }

  /** Remember a group the first time a topic message arrives from it. */
  add(chatId: number): boolean {
    if (this.ids.has(chatId)) return false;
    this.ids.add(chatId);
    this.save();
    return true;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { groups?: unknown };
      if (Array.isArray(raw.groups)) {
        for (const id of raw.groups) if (typeof id === "number") this.ids.add(id);
      }
    } catch {
      /* a corrupt file just means no groups remembered yet */
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify({ groups: [...this.ids] }, null, 2));
  }
}
