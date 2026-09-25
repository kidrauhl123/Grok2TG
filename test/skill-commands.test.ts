import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillCommandFromMarkdown, loadSkillCommands } from "../src/bot/skill-commands.js";

describe("skillCommandFromMarkdown", () => {
  it("reads a declared command", () => {
    const got = skillCommandFromMarkdown("---\ncommand: review\ndescription: Review a diff\n---\n");
    assert.deepEqual(got, { command: "review", description: "Review a diff" });
  });

  it("ignores a skill that declares no command", () => {
    assert.equal(skillCommandFromMarkdown("---\nname: notes\n---\n"), undefined);
  });

  it("rejects a command Telegram cannot register", () => {
    assert.equal(skillCommandFromMarkdown("---\ncommand: Deep-Review\n---\n"), undefined);
  });
});

describe("loadSkillCommands", () => {
  it("collects declared commands and skips the rest", () => {
    const home = mkdtempSync(join(tmpdir(), "grok-skills-"));
    const write = (skill: string, body: string) => {
      const dir = join(home, "skills", skill);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), body);
    };
    write("review", "---\ncommand: review\ndescription: Review a diff\n---\n");
    write("notes", "---\nname: notes\n---\n");
    process.env.GROK_HOME = home;
    try {
      assert.deepEqual(loadSkillCommands(), [{ command: "review", description: "Review a diff" }]);
    } finally {
      delete process.env.GROK_HOME;
    }
  });
});
