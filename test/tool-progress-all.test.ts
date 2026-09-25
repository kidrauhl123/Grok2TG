import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatToolProgressAll } from "../src/render/tool-progress.js";
import type { SessionUpdate } from "../src/grok/types.js";

function call(title: string, rawInput: Record<string, unknown>): SessionUpdate {
  return { sessionUpdate: "tool_call", title, toolCallId: "t", rawInput };
}

test("read and search are one Hermes all line", () => {
  const read = formatToolProgressAll(call("read_file", { path: "/home/box/src/grok2tg/src/stream/streamer.ts", offset: 10, limit: 5 }));
  assert.equal(read?.text, "> 📖 Reading streamer.ts L10-14");
  assert.equal(read?.terminal, false);

  const search = formatToolProgressAll(call("grep", { pattern: "SHOW_THINKING|showThinking|foreground|appendThought" }));
  assert.equal(search?.text, "> 🔎 Searching files for SHOW_THINKING|showThinking|foreground|appendThought");
});

test("a terminal call keeps the whole command, and the next one drops the header", () => {
  const long = "echo " + "x".repeat(80) + "\nsecond";
  const first = formatToolProgressAll(call("run_terminal_command", { command: long }));
  assert.equal(first?.terminal, true);
  assert.equal(first?.text, "💻 terminal\n\n\n\u0000CODE" + long + "\u0000\n\n");

  const next = formatToolProgressAll(call("run_terminal_command", { command: "pwd" }), { dropTerminalHeader: true });
  assert.equal(next?.text, "\n\n\u0000CODEpwd\u0000\n\n");
});

test("a tool with no preview is just the name", () => {
  const line = formatToolProgressAll(call("mystery_tool", {}));
  assert.equal(line?.text, "> ⚙️ mystery_tool...");
});
