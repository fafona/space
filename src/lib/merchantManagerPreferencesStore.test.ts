import assert from "node:assert/strict";
import test from "node:test";
import {
  updateMerchantManagerPreferencesSnapshot,
  type MerchantManagerPreferencesSnapshot,
} from "@/lib/merchantManagerPreferences";
import {
  loadStoredMerchantManagerPreferences,
  saveStoredMerchantManagerPreferences,
  type MerchantManagerPreferencesStoreClient,
} from "@/lib/merchantManagerPreferencesStore";

type MemoryRow = {
  id: string;
  merchant_id?: string | null;
  slug: string;
  blocks: unknown;
  updated_at?: string | null;
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createMemoryClient(
  initialRows: MemoryRow[] = [],
  options?: {
    readError?: string;
  },
) {
  const rows = initialRows.map(cloneValue);
  let sequence = rows.length;

  const client: MerchantManagerPreferencesStoreClient = {
    from: () => {
      let operation: "select" | "update" | "insert" = "select";
      let body: Record<string, unknown> = {};
      let returnUpdatedRows = false;
      let rowLimit = Number.POSITIVE_INFINITY;
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => {
          if (operation === "update") {
            returnUpdatedRows = true;
          } else {
            operation = "select";
          }
          return builder;
        },
        update: (value: Record<string, unknown>) => {
          operation = "update";
          body = cloneValue(value);
          return builder;
        },
        insert: (value: Record<string, unknown>) => {
          operation = "insert";
          body = cloneValue(value);
          return builder;
        },
        eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return builder;
        },
        is: (field: string, value: unknown) => {
          filters.push([field, value]);
          return builder;
        },
        limit: (value: number) => {
          rowLimit = value;
          return builder;
        },
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          const matches = (row: MemoryRow) =>
            filters.every(([field, value]) => row[field as keyof MemoryRow] === value);
          const execute = () => {
            if (operation === "select") {
              if (options?.readError) {
                return { data: null, error: { message: options.readError } };
              }
              return {
                data: rows.filter(matches).slice(0, rowLimit).map(cloneValue),
                error: null,
              };
            }
            if (operation === "update") {
              const updatedRows = rows.filter(matches);
              updatedRows.forEach((row) => Object.assign(row, cloneValue(body)));
              return {
                data: returnUpdatedRows ? updatedRows.map(cloneValue) : null,
                error: null,
              };
            }
            const duplicate = rows.some(
              (row) => row.slug === body.slug && row.merchant_id === body.merchant_id,
            );
            if (duplicate) {
              return {
                data: null,
                error: { message: "duplicate key value violates unique constraint (23505)" },
              };
            }
            sequence += 1;
            rows.push({
              id: `row-${sequence}`,
              merchant_id:
                typeof body.merchant_id === "string"
                  ? body.merchant_id
                  : body.merchant_id === null
                    ? null
                    : undefined,
              slug: String(body.slug ?? ""),
              blocks: cloneValue(body.blocks),
              updated_at: typeof body.updated_at === "string" ? body.updated_at : null,
            });
            return { data: null, error: null };
          };
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return { client, rows };
}

function createBookingSnapshot(updatedAt: string): MerchantManagerPreferencesSnapshot {
  return updateMerchantManagerPreferencesSnapshot(null, {
    siteId: "10000000",
    kind: "booking",
    preferences: {
      selectedStatuses: ["confirmed"],
      sortMode: "submitted",
      historyVisibility: "3d",
    },
    updatedAt,
  });
}

test("manager preference store saves, merges and reloads both workbenches", async () => {
  const { client } = createMemoryClient();
  const booking = createBookingSnapshot("2026-07-24T10:00:00.000Z");
  assert.deepEqual(
    await saveStoredMerchantManagerPreferences(client, {
      siteId: "10000000",
      snapshot: booking,
      expectedUpdatedAt: null,
    }),
    { error: null },
  );

  const current = await loadStoredMerchantManagerPreferences(client, "10000000");
  assert.ok(current);
  const merged = updateMerchantManagerPreferencesSnapshot(current, {
    siteId: "10000000",
    kind: "order",
    preferences: {
      selectedStatuses: ["pending"],
      sortMode: "created_asc",
      historyVisibility: "today",
    },
    updatedAt: "2026-07-24T10:01:00.000Z",
  });
  assert.deepEqual(
    await saveStoredMerchantManagerPreferences(client, {
      siteId: "10000000",
      snapshot: merged,
      expectedUpdatedAt: current?.updatedAt,
    }),
    { error: null },
  );

  const loaded = await loadStoredMerchantManagerPreferences(client, "10000000");
  assert.deepEqual(loaded?.booking?.selectedStatuses, ["confirmed"]);
  assert.equal(loaded?.order?.sortMode, "created_asc");
  assert.equal(loaded?.updatedAt, "2026-07-24T10:01:00.000Z");
});

test("manager preference store rejects stale updates", async () => {
  const { client } = createMemoryClient();
  const snapshot = createBookingSnapshot("2026-07-24T10:00:00.000Z");
  await saveStoredMerchantManagerPreferences(client, {
    siteId: "10000000",
    snapshot,
    expectedUpdatedAt: null,
  });

  assert.deepEqual(
    await saveStoredMerchantManagerPreferences(client, {
      siteId: "10000000",
      snapshot: {
        ...snapshot,
        updatedAt: "2026-07-24T10:02:00.000Z",
      },
      expectedUpdatedAt: "2026-07-24T09:59:00.000Z",
    }),
    { error: "merchant_manager_preferences_conflict" },
  );
});

test("manager preference store uses the payload version when legacy rows lack updated_at", async () => {
  const current = createBookingSnapshot("2026-07-24T10:00:00.000Z");
  const { client } = createMemoryClient([
    {
      id: "legacy-preferences",
      merchant_id: "10000000",
      slug: "__merchant_manager_preferences__:10000000",
      blocks: current,
    },
  ]);
  const next = {
    ...current,
    updatedAt: "2026-07-24T10:01:00.000Z",
  };

  assert.deepEqual(
    await saveStoredMerchantManagerPreferences(client, {
      siteId: "10000000",
      snapshot: next,
      expectedUpdatedAt: current.updatedAt,
    }),
    { error: null },
  );
});

test("manager preference store recovers a corrupt primary row from history", async () => {
  const { client, rows } = createMemoryClient();
  const first = createBookingSnapshot("2026-07-24T10:00:00.000Z");
  await saveStoredMerchantManagerPreferences(client, {
    siteId: "10000000",
    snapshot: first,
    expectedUpdatedAt: null,
  });
  const second = updateMerchantManagerPreferencesSnapshot(first, {
    siteId: "10000000",
    kind: "booking",
    preferences: {
      selectedStatuses: ["completed"],
      sortMode: "appointment",
      historyVisibility: "7d",
    },
    updatedAt: "2026-07-24T10:01:00.000Z",
  });
  await saveStoredMerchantManagerPreferences(client, {
    siteId: "10000000",
    snapshot: second,
    expectedUpdatedAt: first.updatedAt,
  });

  const primary = rows.find((row) =>
    row.slug.startsWith("__merchant_manager_preferences__:"),
  );
  assert.ok(primary);
  primary.blocks = { invalid: true };

  const recovered = await loadStoredMerchantManagerPreferences(client, "10000000");
  assert.deepEqual(recovered?.booking?.selectedStatuses, ["completed"]);
});

test("manager preference store surfaces unexpected read errors", async () => {
  const { client } = createMemoryClient([], { readError: "upstream timeout" });
  await assert.rejects(
    () => loadStoredMerchantManagerPreferences(client, "10000000"),
    /merchant_manager_preferences_read_failed:upstream timeout/,
  );
});
