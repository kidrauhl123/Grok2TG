import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chunkMarkdown } from "../src/render/chunk.js";
import { toTelegramMarkdown } from "../src/render/markdown.js";

test("a short expandable quote is one chunk and stays closed", () => {
  const src = "> \u{1F4AD} thinking: first\n> second line\n> third";
  const md = toTelegramMarkdown(src);
  const chunks = chunkMarkdown(md, 4000);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.includes("**>"));
  assert.ok(chunks[0]!.trimEnd().endsWith("||"));
});

test("splitting an expandable quote closes it and reopens the next chunk", () => {
  const bodies = Array.from({ length: 8 }, (_, i) => `> line ${i} ${"x".repeat(20)}`);
  const src = [`> \u{1F4AD} thinking: head`, ...bodies].join("\n");
  const md = toTelegramMarkdown(src);
  const chunks = chunkMarkdown(md, 120);
  assert.ok(chunks.length > 1, chunks.join("\n---\n"));
  for (const chunk of chunks) {
    const opens = (chunk.match(/\*\*>/g) ?? []).length;
    const closes = (chunk.match(/\|\|/g) ?? []).length;
    assert.equal(opens, closes, chunk);
    assert.ok(!chunk.includes("**>\n||") && !chunk.endsWith("**>||"), chunk);
  }
  assert.ok(chunks[0]!.startsWith(">\u{1F4AD} thinking:"));
  assert.ok(chunks[1]!.split("\n")[0] === "**>" || chunks[1]!.startsWith("**>"));
});
