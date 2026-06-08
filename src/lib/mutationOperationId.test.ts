import test from "node:test";
import assert from "node:assert/strict";
import {
  appendMutationOperationMarker,
  buildMutationOperationMarker,
  hasMutationOperationMarker,
  normalizeMutationOperationId,
} from "./mutationOperationId";

test("mutation operation ids are normalized for note markers", () => {
  assert.equal(normalizeMutationOperationId(" op 123/中文 "), "op_123___");
  assert.equal(buildMutationOperationMarker("member checkout", "op/123"), "[op:member_checkout:op_123]");
});

test("mutation operation markers are appended within note limits", () => {
  const marker = buildMutationOperationMarker("coupon-redeem", "abc");
  const note = appendMutationOperationMarker("manual redeem", marker);
  assert.equal(note, "manual redeem [op:coupon-redeem:abc]");
  assert.equal(appendMutationOperationMarker(note, marker), note);
  assert.equal(hasMutationOperationMarker("manual redeem [op:coupon-redeem:abc]", marker), true);
});
