import assert from "node:assert/strict";
import test from "node:test";
import {
  saveMerchantSnapshotHistory,
  type MerchantSnapshotHistoryStoreClient,
} from "./merchantSnapshotHistoryStore";

type SnapshotRow = {
  id: string;
  merchant_id: string;
  slug: string;
  blocks: unknown;
  updated_at: string;
};

function createSnapshotHistoryClient(initialRows: SnapshotRow[]) {
  const rows = initialRows.map((row) => ({ ...row }));
  let selectCount = 0;
  let updateCount = 0;

  const executeQuery = (
    mode: "select" | "update",
    filters: Map<string, unknown>,
    body?: Record<string, unknown>,
  ) => {
    const matches = rows.filter((row) =>
      Array.from(filters.entries()).every(([field, value]) => row[field as keyof SnapshotRow] === value),
    );
    if (mode === "select") {
      selectCount += 1;
      return Promise.resolve({ data: matches, error: null });
    }
    updateCount += 1;
    matches.forEach((row) => Object.assign(row, body));
    return Promise.resolve({ data: null, error: null });
  };

  const createQuery = (mode: "select" | "update", body?: Record<string, unknown>) => {
    const filters = new Map<string, unknown>();
    const query = {
      eq(field: string, value: unknown) {
        filters.set(field, value);
        return query;
      },
      is(field: string, value: unknown) {
        filters.set(field, value);
        return query;
      },
      limit() {
        return executeQuery(mode, filters, body);
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return executeQuery(mode, filters, body).then(onfulfilled, onrejected);
      },
    };
    return query;
  };

  const client: MerchantSnapshotHistoryStoreClient = {
    from: () => ({
      select: () => createQuery("select"),
      update: (body: Record<string, unknown>) => createQuery("update", body),
      insert: (body: Record<string, unknown>) => {
        rows.push(body as SnapshotRow);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };

  return {
    client,
    rows,
    getSelectCount: () => selectCount,
    getUpdateCount: () => updateCount,
  };
}

test("snapshot history reuses primary and backup lookups during persistence", async () => {
  const siteId = "10000000";
  const primarySlug = "__history__:10000000";
  const backupSlug = "__history_backup__:10000000";
  const initialPayload = {
    siteId,
    updatedAt: "2026-07-15T10:00:00.000Z",
    entries: [],
  };
  const store = createSnapshotHistoryClient([
    {
      id: "primary",
      merchant_id: siteId,
      slug: primarySlug,
      blocks: initialPayload,
      updated_at: initialPayload.updatedAt,
    },
    {
      id: "backup",
      merchant_id: siteId,
      slug: backupSlug,
      blocks: initialPayload,
      updated_at: initialPayload.updatedAt,
    },
  ]);

  const result = await saveMerchantSnapshotHistory(store.client, {
    siteId,
    slug: primarySlug,
    backupSlug,
    source: "test",
    before: [{ value: 1 }],
    after: [{ value: 2 }],
    at: "2026-07-16T10:00:00.000Z",
  });

  assert.equal(result.error, null);
  assert.equal(store.getSelectCount(), 2);
  assert.equal(store.getUpdateCount(), 2);
  store.rows.forEach((row) => {
    const payload = row.blocks as { entries?: Array<{ after?: unknown }> };
    assert.equal(payload.entries?.length, 1);
    assert.deepEqual(payload.entries?.[0]?.after, [{ value: 2 }]);
  });
});
