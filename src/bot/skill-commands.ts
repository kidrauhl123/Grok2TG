/**
 * Skill slash commands for the Telegram menu.
 *
 * The built-in Grok commands stay a fixed list. A skill adds its own by
 * declaring `command` in its SKILL.md frontmatter, and the menu picks it up
 * on the next start. The command is forwarded either way; this only decides
 * whether it shows in the menu.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SkillCommand {
  command: string;
  description: string;
}

/** Telegram command names: lowercase letters, digits, underscore, 1–32 chars. */
const NAME = /^[a-z0-9_]{1,32}$/;

/** Read `command` and `description` from a SKILL.md frontmatter block. */
export function skillCommandFromMarkdown(text: string): SkillCommand | undefined {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const body = fm[1]!;
  const command = body.match(/^command:\s*"?([a-z0-9_]{1,32})"?\s*$/m)?.[1];
  if (!command || !NAME.test(command)) return undefined;
  const raw = body.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1]?.trim();
  const description = (raw || command).slice(0, 256);
  return { command, description };
}

/** Skill directories to scan: the instance's own Grok home, else ~/.grok. */
function skillRoots(): string[] {
  const home = process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
  return [join(home, "skills"), join(home, "bundled", "skills")];
}

/** Commands declared by installed skills. Undeclared skills are skipped. */
export function loadSkillCommands(): SkillCommand[] {
  const found = new Map<string, SkillCommand>();
  for (const root of skillRoots()) {
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(root, name, "SKILL.md");
      try {
        if (!statSync(file).isFile()) continue;
        const cmd = skillCommandFromMarkdown(readFileSync(file, "utf8"));
        if (cmd && !found.has(cmd.command)) found.set(cmd.command, cmd);
      } catch {
        /* a skill without a readable SKILL.md simply adds nothing */
      }
    }
  }
  return [...found.values()];
}
