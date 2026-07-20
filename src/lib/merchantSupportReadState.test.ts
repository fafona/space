import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantSupportReadStateBlocks,
  getLatestSupportReadTimestamp,
  getLatestSupportReadTimestampAtOrBefore,
  getMerchantSupportReadState,
  isSupportTimestampUnread,
  mergeMerchantSupportReadState,
  mergeMerchantSupportReadStatePayloads,
  readMerchantSupportReadStateFromBlocks,
} from "@/lib/merchantSupportReadState";

test("merchant support read state keeps latest official and peer timestamps per account", () => {
  const first = mergeMerchantSupportReadState({ accounts: [] }, "10000000", {
    officialLastReadAt: "2026-05-05T10:00:00.000Z",
    peerLastRead: {
      "50010105": "2026-05-05T09:00:00.000Z",
    },
  });
  const second = mergeMerchantSupportReadState(first, "10000000", {
    officialLastReadAt: "2026-05-05T09:30:00.000Z",
    peerLastRead: {
      "50010105": "2026-05-05T11:00:00.000Z",
      "10000003": "2026-05-05T08:00:00.000Z",
    },
  });

  assert.deepEqual(getMerchantSupportReadState(second, "10000000"), {
    officialLastReadAt: "2026-05-05T10:00:00.000Z",
    peerLastRead: {
      "50010105": "2026-05-05T11:00:00.000Z",
      "10000003": "2026-05-05T08:00:00.000Z",
    },
  });
});

test("merchant support read state round trips through blocks", () => {
  const payload = mergeMerchantSupportReadState({ accounts: [] }, "50010105", {
    officialLastReadAt: "2026-05-05T12:00:00.000Z",
  });
  const restored = readMerchantSupportReadStateFromBlocks(buildMerchantSupportReadStateBlocks(payload));

  assert.deepEqual(getMerchantSupportReadState(restored, "50010105"), {
    officialLastReadAt: "2026-05-05T12:00:00.000Z",
    peerLastRead: {},
  });
});

test("getLatestSupportReadTimestamp ignores invalid values", () => {
  assert.equal(getLatestSupportReadTimestamp("bad", "2026-05-05T12:00:00Z"), "2026-05-05T12:00:00.000Z");
  assert.equal(getLatestSupportReadTimestamp("2026-05-05T13:00:00Z", "2026-05-05T12:00:00Z"), "2026-05-05T13:00:00.000Z");
});

test("concurrent read-state snapshots keep independent accounts and latest timestamps", () => {
  const first = mergeMerchantSupportReadState({ accounts: [] }, "10000000", {
    officialLastReadAt: "2026-05-05T12:00:00.000Z",
  });
  const second = mergeMerchantSupportReadState({ accounts: [] }, "10000001", {
    peerLastRead: { "10000002": "2026-05-05T13:00:00.000Z" },
  });
  const staleFirst = mergeMerchantSupportReadState({ accounts: [] }, "10000000", {
    officialLastReadAt: "2026-05-05T11:00:00.000Z",
  });

  const merged = mergeMerchantSupportReadStatePayloads(
    mergeMerchantSupportReadStatePayloads(first, second),
    staleFirst,
  );
  assert.equal(getMerchantSupportReadState(merged, "10000000").officialLastReadAt, "2026-05-05T12:00:00.000Z");
  assert.equal(getMerchantSupportReadState(merged, "10000001").peerLastRead["10000002"], "2026-05-05T13:00:00.000Z");
});

test("unread comparison handles missing, older, and current read timestamps", () => {
  assert.equal(isSupportTimestampUnread("2026-05-05T12:00:00Z", ""), true);
  assert.equal(isSupportTimestampUnread("2026-05-05T12:00:00Z", "2026-05-05T11:59:59Z"), true);
  assert.equal(isSupportTimestampUnread("2026-05-05T12:00:00Z", "2026-05-05T12:00:00Z"), false);
  assert.equal(isSupportTimestampUnread("bad", "2026-05-05T12:00:00Z"), false);
});

test("read timestamps are clamped to an existing message at or before the request", () => {
  const timestamps = [
    "2026-05-05T10:00:00Z",
    "2026-05-05T11:00:00Z",
    "2026-05-05T12:00:00Z",
  ];
  assert.equal(
    getLatestSupportReadTimestampAtOrBefore(timestamps, "2099-01-01T00:00:00Z"),
    "2026-05-05T12:00:00.000Z",
  );
  assert.equal(
    getLatestSupportReadTimestampAtOrBefore(timestamps, "2026-05-05T11:30:00Z"),
    "2026-05-05T11:00:00.000Z",
  );
  assert.equal(getLatestSupportReadTimestampAtOrBefore(timestamps, "2026-05-05T09:00:00Z"), "");
});
