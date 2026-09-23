import assert from "node:assert/strict";
import test from "node:test";
import { parseTrafficRetentionArgs } from "./maintain-account-traffic";

test("retention is preview-only unless apply AND independent opt-in are present", () => {
  assert.deepEqual(parseTrafficRetentionArgs([], false), { apply: false, batch: 5000 });
  assert.deepEqual(parseTrafficRetentionArgs([], true), { apply: false, batch: 5000 });
  assert.throws(() => parseTrafficRetentionArgs(["--apply"], false), /not_enabled/);
  assert.deepEqual(parseTrafficRetentionArgs(["--apply", "--batch=100"], true), { apply: true, batch: 100 });
});
test("retention cannot accept arbitrary cutoffs, unlimited batches, or ambiguous arguments", () => {
  for (const args of [["--batch=0"], ["--batch=10001"], ["--batch=NaN"], ["--before=2030-01-01"], ["--batch=5", "--batch=10"]]) {
    assert.throws(() => parseTrafficRetentionArgs(args, true));
  }
});
