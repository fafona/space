import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantOrderManagerPreferences } from "@/lib/merchantOrderManagerPreferences";

test("normalizes invalid order manager preferences", () => {
  assert.deepEqual(normalizeMerchantOrderManagerPreferences({}), {
    selectedStatuses: ["pending", "confirmed", "completed", "cancelled"],
    sortMode: "created_desc",
    historyVisibility: "none",
  });

  assert.deepEqual(
    normalizeMerchantOrderManagerPreferences({
      selectedStatuses: ["confirmed", "completed", "invalid"],
      sortMode: "created_asc",
      historyVisibility: "7d",
    }),
    {
      selectedStatuses: ["confirmed", "completed"],
      sortMode: "created_asc",
      historyVisibility: "7d",
    },
  );

  assert.deepEqual(
    normalizeMerchantOrderManagerPreferences({
      selectedStatuses: [],
      sortMode: "invalid",
      historyVisibility: "invalid",
    }),
    {
      selectedStatuses: [],
      sortMode: "created_desc",
      historyVisibility: "none",
    },
  );
});
