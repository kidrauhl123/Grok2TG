import assert from "node:assert/strict";
import { test } from "node:test";
import { renderProcessBlock, workedForSummary } from "../src/render/process-block.js";

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

test("a finished title keeps the token total beside the elapsed time", () => {
  assert.equal(workedForSummary(12, 43753), "Worked for 12s · 43,753 tokens");
  assert.equal(workedForSummary(3), "Worked for 3s");
  assert.equal(workedForSummary(73), "Worked for 1m 13s");
  assert.equal(workedForSummary(3661), "Worked for 1h 1m 1s");
  assert.equal(workedForSummary(90_061), "Worked for 1d 1h 1m 1s");
  assert.equal(workedForSummary(7_200), "Worked for 2h");
});

test("a tool becomes its own open fold, and the result sits in a collapsed quote", () => {
  const tool = "\u0000TOOL" + JSON.stringify({ title: "📖 Reading a.ts", result: "line 1\nline 2" }) + "\u0000";
  const block = renderProcessBlock(`the user wants X\n${tool}`, true);
  assert.match(block.html, /<p>the user wants X<\/p><details open><summary><i>📖 Reading a\.ts<\/i><\/summary><blockquote expandable><p>line 1<br>line 2<\/p><\/blockquote><\/details>/);
});

test("a command renders as a code block, with its output in a collapsed quote", () => {
  const tool = "\u0000TOOL" + JSON.stringify({ title: "💻 terminal", command: "echo hi", result: "hi" }) + "\u0000";
  const block = renderProcessBlock(`thinking\n\n${tool}\n\nmore`, true);
  assert.match(block.html, /<details open><summary><i>💻 terminal<\/i><\/summary><pre><code>echo hi<\/code><\/pre><blockquote expandable><p>hi<\/p><\/blockquote><\/details>/);
});

test("a code block folds one level deeper and its title is the line count", () => {
  const block = renderProcessBlock("see\n\u0000CODEa < b\nb\nc\u0000\nthen", true);
  assert.match(block.html, /<details><summary><i>3 lines<\/i><\/summary><pre><code>a &lt; b\nb\nc<\/code><\/pre><\/details>/);
  assert.match(block.html, /<p>see<\/p>/);
});

test("a fenced block becomes a code block and its content is escaped", () => {
  const block = renderProcessBlock("see\n\u0000CODEa < b\u0000\nthen", true);
  assert.match(block.html, /<details><summary><i>1 line<\/i><\/summary><pre><code>a &lt; b<\/code><\/pre><\/details>/);
  assert.match(block.html, /<p>see<\/p>/);
});

test("the agent's own text cannot break the tag, and line breaks survive", () => {
  const block = renderProcessBlock("a < b && c > d\nnext", true);
  assert.equal(block.html.includes("a < b"), false);
  assert.match(block.html, /a &lt; b &amp;&amp; c &gt; d<br>next/);
  assert.equal(block.plain.includes("a < b && c > d"), true);
});
