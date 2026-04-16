import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultPwaNotificationSettings,
  normalizePwaNotificationHistory,
  normalizePwaNotificationSettings,
} from "@/lib/pwaNotificationCenter";

test("normalizePwaNotificationSettings falls back to defaults", () => {
  const defaults = createDefaultPwaNotificationSettings();
  assert.deepEqual(normalizePwaNotificationSettings(null), defaults);
  assert.deepEqual(
    normalizePwaNotificationSettings({
      categories: {
        booking: false,
      },
      routingMode: "recent-workspace",
    }),
    {
      version: 1,
      categories: {
        booking: false,
        message: true,
        system: true,
      },
      routingMode: "recent-workspace",
    },
  );
});

test("normalizePwaNotificationHistory sorts and deduplicates entries", () => {
  const history = normalizePwaNotificationHistory([
    {
      id: "old",
      title: "Old",
      category: "booking",
      createdAt: "2026-04-15T10:00:00.000Z",
    },
    {
      id: "new",
      title: "New",
      category: "message",
      createdAt: "2026-04-16T10:00:00.000Z",
      shown: false,
      source: "test",
    },
    {
      id: "new",
      title: "Duplicate new",
      category: "system",
      createdAt: "2026-04-16T09:00:00.000Z",
    },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0]?.id, "new");
  assert.equal(history[0]?.shown, false);
  assert.equal(history[0]?.source, "test");
  assert.equal(history[1]?.id, "old");
});
