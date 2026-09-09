import assert from "node:assert/strict";
import test from "node:test";

import { isServerPublishConfirmed, readServerPublishCompletionError } from "./serverPublishConfirmation";

const expected = {
  requestId: "publish-synthetic-1",
  updatedAt: "2026-09-09T10:00:00.000Z",
  mode: "merchant" as const,
};
const ack = {
  ok: true,
  requestId: expected.requestId,
  updatedAt: expected.updatedAt,
  merchantCount: 1,
  mode: "merchant",
};

test("actual merchant and platform success acknowledgements confirm only the captured request", () => {
  assert.equal(isServerPublishConfirmed({ ok: true }, ack, expected), true);
  assert.equal(isServerPublishConfirmed({ ok: true }, {
    ...ack, permissionSnapshotSkipped: true, postPublishSyncScheduled: true,
  }, expected), true);
  assert.equal(isServerPublishConfirmed({ ok: true }, {
    ...ack, mode: "platform", merchantCount: 0,
  }, { ...expected, mode: "platform" }), true);
  assert.equal(isServerPublishConfirmed({ ok: true }, {
    ...ack, updatedAt: "2026-09-09T12:00:00+02:00",
  }, expected), true, "server-normalized timestamp equality is semantic");
});

test("HTTP success without a complete matching success acknowledgement is unconfirmed", () => {
  for (const value of [null, undefined, [], "<html>unavailable</html>", {}, { ok: true }, { ...ack, ok: false }]) {
    assert.equal(isServerPublishConfirmed({ ok: true }, value, expected), false);
  }
  assert.equal(isServerPublishConfirmed({ ok: false }, ack, expected), false);
  for (const patch of [
    { requestId: "other-request" }, { requestId: undefined }, { mode: "platform" },
    { updatedAt: undefined }, { updatedAt: "invalid" }, { updatedAt: "2026-09-09T10:00:00.001Z" },
  ]) assert.equal(isServerPublishConfirmed({ ok: true }, { ...ack, ...patch }, expected), false);
  assert.equal(isServerPublishConfirmed({ ok: true }, ack, { ...expected, updatedAt: "invalid" }), false);
  assert.equal(isServerPublishConfirmed({ ok: true }, ack, { ...expected, requestId: "" }), false);
});

test("success count must conform to the real server mode and be a safe integer", () => {
  for (const merchantCount of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(isServerPublishConfirmed({ ok: true }, { ...ack, merchantCount }, expected), false);
  }
  assert.equal(isServerPublishConfirmed({ ok: true }, { ...ack, merchantCount: 2 }, expected), true);
  assert.equal(isServerPublishConfirmed({ ok: true }, {
    ...ack, mode: "platform", merchantCount: 1,
  }, { ...expected, mode: "platform" }), false);
});

test("unhandled results remain errors and cannot fall through to local published success", () => {
  assert.equal(readServerPublishCompletionError({ handled: true, error: null }), null);
  const failure = { code: "publish_failed", message: "synthetic rejection" };
  assert.equal(readServerPublishCompletionError({ handled: true, error: failure }), failure);
  assert.equal(readServerPublishCompletionError({ handled: false, error: failure }), failure);
  const unknown = readServerPublishCompletionError({ handled: false, error: null });
  assert.equal(unknown?.code, "publish_result_unconfirmed");
  assert.match(unknown?.message ?? "", /结果未确认/);
  assert.match(unknown?.message ?? "", /先核对线上内容/);
});
