import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicBlockId } from "./blockPublicId";

test("buildPublicBlockId uses page number plus block number", () => {
  assert.equal(buildPublicBlockId(0, 0), "0101");
  assert.equal(buildPublicBlockId(0, 9), "0110");
  assert.equal(buildPublicBlockId(1, 0), "0201");
  assert.equal(buildPublicBlockId(11, 34), "1235");
});

test("buildPublicBlockId clamps invalid indexes to the first slot", () => {
  assert.equal(buildPublicBlockId(-1, -1), "0101");
  assert.equal(buildPublicBlockId(Number.NaN, Number.POSITIVE_INFINITY), "0101");
});
