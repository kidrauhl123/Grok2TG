import assert from "node:assert/strict";
import { test } from "node:test";
import { renderProcessBlock } from "../src/render/process-block.js";

test("a running turn is open and the finished turn is collapsed", () => {
  const open = renderProcessBlock("🧠 thinking\n💻 terminal", true);
  assert.match(open.html, /^<details open><summary><i>/);
  const done = renderProcessBlock("🧠 thinking\n💻 terminal", false);
  assert.match(done.html, /^<details><summary><i>/);
  assert.equal(done.html.includes(" open"), false);
});

test("a collapsed block can carry its own summary", () => {
  const block = renderProcessBlock("the command", false, "Worked for 12s");
  assert.match(block.html, /<summary><i>Worked for 12s<\/i><\/summary>/);
  assert.match(block.plain, /^Worked for 12s\n/);
});

test("a tool line becomes its own quote, the thinking stays a paragraph", () => {
  const block = renderProcessBlock("the user wants X\n> 📖 Reading a.ts\n> 🔎 Searching files for y", true);
  assert.match(block.html, /<p>the user wants X<\/p><blockquote><p>📖 Reading a\.ts<br>🔎 Searching files for y<\/p><\/blockquote>/);
});

test("a fenced block becomes a code block and its content is escaped", () => {
  const block = renderProcessBlock("see\n\u0000CODEa < b\u0000\nthen", true);
  assert.match(block.html, /<pre><code>a &lt; b<\/code><\/pre>/);
  assert.match(block.html, /<p>see<\/p>/);
});

test("the agent's own text cannot break the tag, and line breaks survive", () => {
  const block = renderProcessBlock("a < b && c > d\nnext", true);
  assert.equal(block.html.includes("a < b"), false);
  assert.match(block.html, /a &lt; b &amp;&amp; c &gt; d<br>next/);
  assert.equal(block.plain.includes("a < b && c > d"), true);
});
