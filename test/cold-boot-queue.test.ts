import { strict as assert } from "node:assert";
import { test } from "node:test";
import { coldBootQueueLog, dropPendingOnStart } from "../src/app/cold-boot-queue.js";

test("the first poll of a process drops the queue, a later one keeps it", () => {
  assert.equal(dropPendingOnStart(0), true);
  assert.equal(dropPendingOnStart(1), false);
  assert.equal(dropPendingOnStart(4), false);
});

test("the log line says which way the queue went", () => {
  assert.match(coldBootQueueLog(true), /dropping/);
  assert.match(coldBootQueueLog(false), /keeping/);
});
