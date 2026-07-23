import assert from "node:assert/strict";
import test from "node:test";
import {
  getMerchantManagerPreferencesStoredState,
  normalizeMerchantManagerPreferencesSnapshot,
  parseStoredMerchantManagerPreferencesSnapshot,
  updateMerchantManagerPreferencesSnapshot,
} from "@/lib/merchantManagerPreferences";

test("manager preferences preserve whether booking and order settings were actually stored", () => {
  const snapshot = normalizeMerchantManagerPreferencesSnapshot("10000000", {
    siteId: "10000000",
    booking: {
      selectedStatuses: ["pending", "confirmed"],
      sortMode: "submitted",
      historyVisibility: "3d",
    },
  });

  assert.deepEqual(getMerchantManagerPreferencesStoredState(snapshot), {
    booking: true,
    order: false,
  });
  assert.equal(snapshot.booking?.sortMode, "submitted");
  assert.equal(snapshot.order, null);
});

test("manager preference updates merge one workbench without overwriting the other", () => {
  const booking = updateMerchantManagerPreferencesSnapshot(null, {
    siteId: "10000000",
    kind: "booking",
    preferences: {
      selectedStatuses: ["confirmed"],
      sortMode: "appointment",
      historyVisibility: "today",
    },
    updatedAt: "2026-07-24T10:00:00.000Z",
  });
  const merged = updateMerchantManagerPreferencesSnapshot(booking, {
    siteId: "10000000",
    kind: "order",
    preferences: {
      selectedStatuses: ["pending", "completed"],
      sortMode: "created_asc",
      historyVisibility: "7d",
    },
    updatedAt: "2026-07-24T10:01:00.000Z",
  });

  assert.deepEqual(merged.booking?.selectedStatuses, ["confirmed"]);
  assert.equal(merged.booking?.historyVisibility, "today");
  assert.deepEqual(merged.order?.selectedStatuses, ["pending", "completed"]);
  assert.equal(merged.order?.sortMode, "created_asc");
});

test("stored manager preferences reject wrong-site and empty payloads", () => {
  assert.equal(
    parseStoredMerchantManagerPreferencesSnapshot("10000000", {
      siteId: "10909091",
      booking: {},
    }),
    null,
  );
  assert.equal(
    parseStoredMerchantManagerPreferencesSnapshot("10000000", {
      siteId: "10000000",
      updatedAt: "2026-07-24T10:00:00.000Z",
    }),
    null,
  );
});
