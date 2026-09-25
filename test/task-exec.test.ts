import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TaskRunner } from "../src/tasks/runner.js";
import type { Task } from "../src/tasks/types.js";

function execTask(exec: string): Task {
  return {
    id: "t1",
    chatId: 1,
    name: "ping",
    prompt: "",
    exec,
    projectPath: "/tmp",
    schedule: { type: "daily", time: "08:00" },
    enabled: true,
    createdAt: 0,
  };
}

describe("TaskRunner exec", () => {
  it("runs the command and sends nothing", async () => {
    const sent: string[] = [];
    const api = { sendMessage: async (text: string) => void sent.push(text) };
    const runner = new TaskRunner(api as never, {} as never);
    const ok = await runner.run(execTask("true"));
    assert.equal(ok, true);
    assert.deepEqual(sent, []);
  });

  it("reports failure without sending", async () => {
    const sent: string[] = [];
    const api = { sendMessage: async (text: string) => void sent.push(text) };
    const runner = new TaskRunner(api as never, {} as never);
    const ok = await runner.run(execTask("false"));
    assert.equal(ok, false);
    assert.deepEqual(sent, []);
  });
});
