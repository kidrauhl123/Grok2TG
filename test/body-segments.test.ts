import { strict as assert } from "node:assert";
import { test } from "node:test";
import { splitBodySegments } from "../src/render/body-segments.js";

// A body segment that is followed by a tool call is process narration: it goes
// out as its own message. Only the segment after the last tool call — or the
// whole reply when the turn used no tools — is the final answer.

test("a body segment followed by a tool call is process, the last is the answer", () => {
  const split = splitBodySegments([
    { kind: "body", text: "我先对一下源码。" },
    { kind: "tool" },
    { kind: "body", text: "改完了，284 个测试都过了。" },
  ]);
  assert.deepEqual(split.process, ["我先对一下源码。"]);
  assert.equal(split.answer, "改完了，284 个测试都过了。");
});

test("several narration segments each stay their own process message", () => {
  const split = splitBodySegments([
    { kind: "body", text: "第一段，我先看。" },
    { kind: "tool" },
    { kind: "body", text: "第二段，我再改。" },
    { kind: "tool" },
    { kind: "body", text: "第三段，改好了。" },
  ]);
  assert.deepEqual(split.process, ["第一段，我先看。", "第二段，我再改。"]);
  assert.equal(split.answer, "第三段，改好了。");
});

test("a turn with no tool call is entirely the final answer", () => {
  const split = splitBodySegments([
    { kind: "body", text: "主人，现在是 17:44。" },
  ]);
  assert.deepEqual(split.process, []);
  assert.equal(split.answer, "主人，现在是 17:44。");
});

test("a turn that ends on a tool call has narration but no answer", () => {
  const split = splitBodySegments([
    { kind: "body", text: "我去查一下。" },
    { kind: "tool" },
  ]);
  assert.deepEqual(split.process, ["我去查一下。"]);
  assert.equal(split.answer, "");
});

test("adjacent body chunks before a tool join into one process message", () => {
  const split = splitBodySegments([
    { kind: "body", text: "我先看" },
    { kind: "body", text: "一下源码。" },
    { kind: "tool" },
    { kind: "body", text: "看完了。" },
  ]);
  assert.deepEqual(split.process, ["我先看一下源码。"]);
  assert.equal(split.answer, "看完了。");
});

test("blank body segments are dropped", () => {
  const split = splitBodySegments([
    { kind: "body", text: "   " },
    { kind: "tool" },
    { kind: "body", text: "答案。" },
  ]);
  assert.deepEqual(split.process, []);
  assert.equal(split.answer, "答案。");
});
