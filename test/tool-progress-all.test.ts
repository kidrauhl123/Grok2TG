import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatToolProgressAll } from "../src/render/tool-progress.js";
import type { SessionUpdate } from "../src/grok/types.js";

function call(title: string, rawInput: Record<string, unknown>, rawOutput?: unknown): SessionUpdate {
  return { sessionUpdate: "tool_call", title, toolCallId: "t", rawInput, rawOutput };
}

test("a tool fold carries its title and, once done, its result", () => {
  const started = formatToolProgressAll(call("read_file", { path: "/home/box/src/grok2tg/src/stream/streamer.ts", offset: 10, limit: 5 }));
  assert.equal(started?.title, "📖 Reading streamer.ts L10-14");
  assert.equal(started?.result, "");

  const done = formatToolProgressAll(call("read_file", { path: "/home/box/src/grok2tg/src/stream/streamer.ts" }, { output: "line one\nline two" }));
  assert.equal(done?.result, "line one\nline two");

  const search = formatToolProgressAll(call("grep", { pattern: "SHOW_THINKING|showThinking|foreground|appendThought" }));
  assert.equal(search?.title, "🔎 Searching files for SHOW_THINKING|showThinking|foreground|appendThought");
});

test("a terminal fold keeps the whole command and its output", () => {
  const long = "echo " + "x".repeat(80) + "\nsecond";
  const line = formatToolProgressAll(call("run_terminal_command", { command: long }, { output: "ok" }));
  assert.equal(line?.title, "💻 terminal");
  assert.equal(line?.command, long);
  assert.equal(line?.result, "ok");
});

test("a tool with no preview is just the name", () => {
  const line = formatToolProgressAll(call("mystery_tool", {}));
  assert.equal(line?.title, "⚙️ mystery_tool");
  assert.equal(line?.result, "");
});

test("output past 50,000 characters keeps the head and the tail", () => {
  const output = "H".repeat(30_000) + "M".repeat(40_000) + "T".repeat(30_000);
  const line = formatToolProgressAll(call("read_file", { path: "a.ts" }, { output }));
  assert.equal(line?.result.includes("OUTPUT TRUNCATED"), true);
  assert.equal(line?.result.startsWith("H".repeat(20_000)), true);
  assert.equal(line?.result.endsWith("T".repeat(30_000)), true);
});
