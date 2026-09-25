import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chunkMarkdown } from "../src/render/chunk.js";
import { toTelegramMarkdown } from "../src/render/markdown.js";

test("a command quote shows a short first line and folds the rest", () => {
  const src = "> \u{1F4BB} command: first line that runs well past twenty characters\n> second line\n> third";
  const md = toTelegramMarkdown(src);
  const lines = md.split("\n");
  assert.ok(lines[0]!.startsWith(">\u{1F4BB} command:"));
  assert.ok(lines[0]!.length < 40, lines[0]);
  assert.ok(md.includes("**>"), "the rest stays folded");
  assert.ok(md.trimEnd().endsWith("||"));
  assert.ok(md.includes("second line"));
});

test("thinking stays open instead of folding to a stub", () => {
  const src = "> \u{1F4AD} thinking: first line that runs well past twenty characters\n> second line of the thought";
  const md = toTelegramMarkdown(src);
  assert.ok(md.includes("first line that runs well past twenty characters"));
  assert.ok(md.includes("second line of the thought"));
  assert.ok(!md.includes("**>"));
});

test("a long single tool line is cut and not folded", () => {
  const src = "> \u{1F4BB} command: " + "x".repeat(100);
  const md = toTelegramMarkdown(src);
  assert.equal(md.split("\n").length, 1);
  assert.ok(!md.includes("**>"));
  assert.ok(md.length < 40);
});

test("only the final answer quotes the user; thoughts and tool cards do not", async () => {
  const { groupForReply } = await import("../src/stream/streamer.js");
  const seg = (kind: "out" | "think" | "tool", text: string) => ({ kind, text });

  const turn = groupForReply([
    seg("think", "let me look this up"),
    seg("tool", "grep reminders.json"),
    seg("out", "Here is what I found."),
  ]);
  assert.equal(turn.length, 2);
  assert.equal(turn[0]!.reply, false);
  assert.ok(turn[0]!.text.startsWith("\u{1F9E0} let me look this up"));
  assert.ok(!turn[0]!.text.includes(">"));
  const long = "word ".repeat(800);
  const full = groupForReply([seg("think", long)]);
  assert.ok(full[0]!.text.includes(long.trim()));
  assert.ok(!full[0]!.text.includes("\u2026"));
  assert.equal(turn[1]!.reply, true);
  assert.ok(turn[1]!.text.includes("Here is what I found."));

  // An answer followed by a later thought: only the last group, the thought, and
  // it is not the answer, so nothing quotes the user.
  const trailing = groupForReply([
    seg("out", "Done."),
    seg("think", "one more check"),
  ]);
  assert.equal(trailing.length, 2);
  assert.equal(trailing[0]!.reply, false);
  assert.equal(trailing[1]!.reply, false);

  // A reply that is only the answer quotes the user.
  const answer = groupForReply([seg("out", "Just the answer.")]);
  assert.equal(answer.length, 1);
  assert.equal(answer[0]!.reply, true);
});
