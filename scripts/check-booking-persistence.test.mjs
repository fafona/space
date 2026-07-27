import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeBookingPersistenceRows,
  waitForBookingPersistence,
} from "./check-booking-persistence.mjs";

const VALID_ROWS = [
  {
    slug: "__merchant_booking_records__:v1",
    blocks: { version: 1, records: [{ id: "booking-1" }] },
    updated_at: "2026-07-23T10:00:00.000Z",
  },
  {
    slug: "__merchant_booking_workbench__:v1",
    blocks: { version: 1, settingsBySiteId: { "10000000": {} } },
    updated_at: "2026-07-23T10:00:00.000Z",
  },
  {
    slug: "__merchant_booking_rules__:v1",
    blocks: { version: 1, snapshots: {} },
    updated_at: "2026-07-23T10:00:00.000Z",
  },
];

test("booking persistence summary requires every valid internal store", () => {
  const summary = summarizeBookingPersistenceRows(VALID_ROWS);
  assert.equal(summary.complete, true);
  assert.deepEqual(
    summary.stores.map((store) => [store.slug, store.entryCount]),
    [
      ["__merchant_booking_records__:v1", 1],
      ["__merchant_booking_workbench__:v1", 1],
      ["__merchant_booking_rules__:v1", 0],
    ],
  );
});

test("booking persistence summary rejects missing or malformed rows", () => {
  const summary = summarizeBookingPersistenceRows([
    VALID_ROWS[0],
    {
      ...VALID_ROWS[1],
      blocks: { version: 1, settingsBySiteId: [] },
    },
  ]);
  assert.equal(summary.complete, false);
  assert.equal(
    summary.stores.find((store) => store.slug === "__merchant_booking_workbench__:v1")?.valid,
    false,
  );
  assert.equal(
    summary.stores.find((store) => store.slug === "__merchant_booking_rules__:v1")?.valid,
    false,
  );
});

test("booking persistence check retries until all stores are available", async () => {
  let requestCount = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => {
          requestCount += 1;
          return {
            data: requestCount === 1 ? VALID_ROWS.slice(0, 2) : VALID_ROWS,
            error: null,
          };
        },
      }),
    }),
  };

  const result = await waitForBookingPersistence(client, {
    attempts: 2,
    delayMs: 1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.attemptsUsed, 2);
});

test("booking persistence check surfaces database errors", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: null,
          error: { message: "upstream timeout" },
        }),
      }),
    }),
  };

  await assert.rejects(
    () => waitForBookingPersistence(client, { attempts: 1 }),
    /booking_persistence_query_failed:upstream timeout/,
  );
});

test("booking persistence check retries transient database errors", async () => {
  let requestCount = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => {
          requestCount += 1;
          if (requestCount === 1) {
            return {
              data: null,
              error: { message: "temporary upstream failure" },
            };
          }
          return { data: VALID_ROWS, error: null };
        },
      }),
    }),
  };

  const result = await waitForBookingPersistence(client, {
    attempts: 2,
    delayMs: 1,
    queryTimeoutMs: 100,
  });
  assert.equal(result.complete, true);
  assert.equal(result.attemptsUsed, 2);
});

test("booking persistence check bounds a stalled query", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => new Promise(() => {}),
      }),
    }),
  };

  await assert.rejects(
    () =>
      waitForBookingPersistence(client, {
        attempts: 1,
        queryTimeoutMs: 10,
      }),
    /booking_persistence_query_failed:query_timeout_10ms/,
  );
});
