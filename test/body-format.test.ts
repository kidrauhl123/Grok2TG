import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  bodyFormatDirective,
  convertTablesToBullets,
  needsRichRendering,
  richDetailsContainMath,
  stripBodyFormatDirective,
} from "../src/render/body-format.js";

test("rich off tells the model not to use tables", () => {
  const hint = bodyFormatDirective(false);
  assert.match(hint, /No pipe tables/);
  assert.equal(stripBodyFormatDirective(`${hint}\n\nhello`), "hello");
});

test("rich on keeps ordinary replies on MarkdownV2", () => {
  const hint = bodyFormatDirective(true);
  assert.match(hint, /Ordinary replies stay MarkdownV2/);
  assert.match(hint, /pipe table/);
  assert.match(hint, /task list/);
  assert.match(hint, /<details>/);
  assert.match(hint, /\$\$/);
  assert.doesNotMatch(hint, /rich Markdown is on for the final answer/);
});

test("only the four MarkdownV2 gaps ask for rich text", () => {
  assert.equal(needsRichRendering("Hello **there**\n\nA normal reply."), false);
  assert.equal(needsRichRendering("## Heading\n\n- one\n- two"), false);
  assert.equal(needsRichRendering("| Name | Qty |\n| --- | --- |\n| Apple | 2 |"), true);
  assert.equal(needsRichRendering("- [ ] buy milk\n- [x] done"), true);
  assert.equal(needsRichRendering("<details>\n<summary>Notes</summary>\nHi\n</details>"), true);
  assert.equal(needsRichRendering("Block:\n\n$$x^2$$\n"), true);
  assert.equal(needsRichRendering(""), false);
});

test("math inside details skips rich to avoid the desktop crash", () => {
  const crash = "<details><summary>Proof</summary>\n\n$$x^2$$\n</details>";
  assert.equal(needsRichRendering(crash), true);
  assert.equal(richDetailsContainMath(crash), true);
  assert.equal(richDetailsContainMath("<details><summary>Notes</summary>\nNo equations.\n</details>"), false);
  assert.equal(richDetailsContainMath("$$x^2$$"), false);
});

test("a pipe table becomes bullets and a fenced table stays", () => {
  const src = [
    "before",
    "| Name | Qty |",
    "| --- | --- |",
    "| Apple | 2 |",
    "",
    "```",
    "| keep | me |",
    "```",
  ].join("\n");
  const out = convertTablesToBullets(src);
  assert.match(out, /\*\*Apple\*\*/);
  assert.match(out, /Qty: 2/);
  assert.ok(!out.includes("| Apple |"));
  assert.match(out, /\| keep \| me \|/);
});
