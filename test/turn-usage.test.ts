import assert from "node:assert/strict";
import { test } from "node:test";
import { turnTokensFromPromptResult, turnTokensFromUpdate } from "../src/grok/turn-usage.js";

test("turn_completed usage is this turn's own total", () => {
  assert.equal(
    turnTokensFromUpdate({
      sessionUpdate: "turn_completed",
      usage: { totalTokens: 43753 },
    }),
    43753,
  );
});

test("context occupancy on other updates is not spend", () => {
  assert.equal(turnTokensFromUpdate({ sessionUpdate: "agent_message_chunk", usage: { totalTokens: 21790 } }), undefined);
  assert.equal(turnTokensFromUpdate({ sessionUpdate: "turn_completed", usage: { totalTokens: 0 } }), undefined);
});

test("a prompt result can carry the same total", () => {
  assert.equal(turnTokensFromPromptResult({ stopReason: "end_turn", _meta: { usage: { totalTokens: 223541 } } }), 223541);
  assert.equal(turnTokensFromPromptResult({ usage: { totalTokens: 201784 } }), 201784);
  assert.equal(turnTokensFromPromptResult({ stopReason: "end_turn" }), undefined);
});
