import assert from "node:assert/strict";
import test from "node:test";
import { pickWorkingReaction, reactionPayload, WORKING_REACTIONS } from "../src/render/working-reaction.ts";

test("the pool stays inside the allowed set and drops the negative ones", () => {
  for (const emoji of ["👎", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🖕", "😭", "😡", "🥴", "🌚", "👻", "🎃", "🗿", "🤪", "🙈", "💊"]) {
    assert.equal((WORKING_REACTIONS as readonly string[]).includes(emoji), false, emoji);
  }
  assert.ok(WORKING_REACTIONS.includes("👍"));
});

test("a pick is always one of the pool", () => {
  for (let i = 0; i < 40; i++) assert.ok(WORKING_REACTIONS.includes(pickWorkingReaction()));
});

test("an empty reaction list clears the reaction", () => {
  assert.deepEqual(reactionPayload(null), []);
});

test("a set reaction names the emoji", () => {
  assert.deepEqual(reactionPayload("🔥"), [{ type: "emoji", emoji: "🔥" }]);
});
