import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMerchantBookingPersistenceValue,
  mergeMerchantBookingPersistenceRecords,
  saveMerchantBookingPersistenceValue,
  type MerchantBookingPersistenceStoreClient,
} from "@/lib/merchantBookingPersistenceStore";

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

  const client: MerchantBookingPersistenceStoreClient = {
    from: () => {
      let operation: "select" | "update" | "insert" = "select";
      let body: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => {
          operation = "select";
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
              return { data: rows.filter(matches).map(cloneValue), error: null };
            }
            if (operation === "update") {
              rows.forEach((row) => {
                if (matches(row)) Object.assign(row, cloneValue(body));
              });
              return { data: null, error: null };
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
              merchant_id: typeof body.merchant_id === "string" ? body.merchant_id : null,
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

type TestStore = {
  version: 1;
  items: string[];
};

function normalizeTestStore(value: unknown): TestStore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<TestStore>;
  if (!Array.isArray(record.items)) return null;
  return {
    version: 1,
    items: record.items.filter((item): item is string => typeof item === "string"),
  };
}

test("booking migration keeps local-only records and the newest copy of matching records", () => {
  const merged = mergeMerchantBookingPersistenceRecords(
    [
      {
        id: "local-only",
        updatedAt: "2026-07-23T09:00:00.000Z",
        value: "local",
      },
      {
        id: "shared",
        updatedAt: "2026-07-23T10:00:00.000Z",
        value: "stale-local",
      },
    ],
    [
      {
        id: "remote-only",
        updatedAt: "2026-07-23T11:00:00.000Z",
        value: "remote",
      },
      {
        id: "shared",
        updatedAt: "2026-07-23T12:00:00.000Z",
        value: "current-remote",
      },
    ],
  );

  assert.deepEqual(
    merged.map((record) => [record.id, record.value]),
    [
      ["shared", "current-remote"],
      ["remote-only", "remote"],
      ["local-only", "local"],
    ],
  );
});

test("booking migration preserves and deduplicates legacy records without an id", () => {
  const legacyRecord = {
    updatedAt: "2026-07-23T08:00:00.000Z",
    value: "legacy",
  };
  const merged = mergeMerchantBookingPersistenceRecords(
    [
      legacyRecord,
      {
        id: "duplicate",
        updatedAt: "2026-07-23T09:00:00.000Z",
        value: "older",
      },
      {
        id: "duplicate",
        updatedAt: "2026-07-23T10:00:00.000Z",
        value: "newer",
      },
    ],
    [{ value: "legacy", updatedAt: "2026-07-23T08:00:00.000Z" }],
  );

  assert.deepEqual(
    merged.map((record) => ["id" in record ? record.id : "", record.value]),
    [
      ["duplicate", "newer"],
      ["", "legacy"],
    ],
  );
});

test("booking persistence saves the current value and preserves the previous value as backup", async () => {
  const { client } = createMemoryClient();
  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    { version: 1, items: ["first"] },
    "2026-07-23T10:00:00.000Z",
  );
  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    { version: 1, items: ["second"] },
    "2026-07-23T11:00:00.000Z",
  );

  const loaded = await loadMerchantBookingPersistenceValue(client, "records", normalizeTestStore);
  assert.deepEqual(loaded?.value.items, ["second"]);
  assert.equal(loaded?.recoveredFromBackup, false);
});

test("booking persistence does not create a backup for key-order-only changes", async () => {
  const { client, rows } = createMemoryClient();
  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    { version: 1, nested: { first: 1, second: 2 } },
    "2026-07-23T10:00:00.000Z",
  );
  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    { nested: { second: 2, first: 1 }, version: 1 },
    "2026-07-23T11:00:00.000Z",
  );

  assert.equal(rows.filter((row) => row.slug.endsWith(":backup")).length, 0);
});

test("booking persistence recovers a corrupt primary value without overwriting the valid backup", async () => {
  const { client, rows } = createMemoryClient();
  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    { version: 1, items: ["safe"] },
    "2026-07-23T10:00:00.000Z",
  );
  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    { version: 1, items: ["new"] },
    "2026-07-23T11:00:00.000Z",
  );

  const primary = rows.find((row) => row.slug.endsWith(":v1"));
  assert.ok(primary);
  primary.blocks = { invalid: true };

  const recovered = await loadMerchantBookingPersistenceValue(client, "records", normalizeTestStore);
  assert.equal(recovered?.recoveredFromBackup, true);
  assert.deepEqual(recovered?.value.items, ["safe"]);

  await saveMerchantBookingPersistenceValue(
    client,
    "records",
    recovered?.value,
    "2026-07-23T12:00:00.000Z",
    { preserveCurrentAsBackup: false },
  );
  primary.blocks = { invalidAgain: true };

  const recoveredAgain = await loadMerchantBookingPersistenceValue(client, "records", normalizeTestStore);
  assert.equal(recoveredAgain?.recoveredFromBackup, true);
  assert.deepEqual(recoveredAgain?.value.items, ["safe"]);
});

test("booking persistence propagates unexpected database read errors", async () => {
  const { client } = createMemoryClient([], { readError: "upstream timeout" });
  await assert.rejects(
    () => loadMerchantBookingPersistenceValue(client, "records", normalizeTestStore),
    /merchant_booking_persistence_read_failed:upstream timeout/,
  );
});

test("booking persistence remains compatible with a legacy schema missing slug", async () => {
  const { client } = createMemoryClient([], { readError: "column pages.slug does not exist" });
  assert.equal(await loadMerchantBookingPersistenceValue(client, "records", normalizeTestStore), null);
});

test("booking persistence treats a throwing normalizer as corrupt data", async () => {
  const { client } = createMemoryClient([
    {
      id: "row-1",
      merchant_id: "__faolla_booking_persistence__",
      slug: "__merchant_booking_records__:v1",
      blocks: { version: 1, items: ["unsafe"] },
      updated_at: "2026-07-23T10:00:00.000Z",
    },
  ]);

  await assert.rejects(
    () =>
      loadMerchantBookingPersistenceValue(client, "records", () => {
        throw new Error("invalid payload");
      }),
    /merchant_booking_persistence_corrupt:records/,
  );
});
