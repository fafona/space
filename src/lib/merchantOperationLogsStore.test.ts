import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantOperationLogEntry } from "@/lib/merchantOperationLogs";
import {
  appendStoredMerchantOperationLog,
  loadStoredMerchantOperationLogs,
  mergeStoredMerchantOperationLogRows,
  parseMerchantOperationLogBoundary,
  queryMerchantOperationLogs,
  type MerchantOperationLogsStoreClient,
} from "@/lib/merchantOperationLogsStore";

function createLog(id: string, at: string, status: "success" | "failed" = "success"): MerchantOperationLogEntry {
  return {
    id,
    siteId: "10000000",
    at,
    module: "优惠券",
    action: "保存",
    summary: `保存 ${id}`,
    status,
  };
}

function createReadClient(result: { data: unknown; error: unknown }): MerchantOperationLogsStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

function createMemoryClient() {
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const client: MerchantOperationLogsStoreClient = {
    from: () => {
      let operation: "select" | "update" | "insert" = "select";
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const execute = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const matches = (row: Record<string, unknown>) => filters.every(([key, value]) => row[key] === value);
        if (operation === "select") return { data: rows.filter(matches).map((row) => ({ ...row })), error: null };
        if (operation === "update") {
          rows.forEach((row, index) => {
            if (matches(row)) rows[index] = { ...row, ...payload };
          });
          return { data: null, error: null };
        }
        rows.push({ id: nextId++, ...payload });
        return { data: null, error: null };
      };
      const query = {
        select: () => {
          operation = "select";
          return query;
        },
        update: (body: Record<string, unknown>) => {
          operation = "update";
          payload = body;
          return query;
        },
        insert: (body: Record<string, unknown>) => {
          operation = "insert";
          payload = body;
          return query;
        },
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        then: (resolve: (value: { data: unknown; error: null }) => unknown, reject: (reason: unknown) => unknown) =>
          execute().then(resolve, reject),
      };
      return query;
    },
  };
  return { client, rows };
}

test("operation log store propagates unexpected reads instead of reporting empty data", async () => {
  const client = createReadClient({ data: null, error: { message: "upstream timeout" } });
  await assert.rejects(
    () => loadStoredMerchantOperationLogs(client, "10000000"),
    /merchant_operation_logs_read_failed:upstream timeout/,
  );
});

test("operation log store retains compatibility with a schema missing slug", async () => {
  const client = createReadClient({ data: null, error: { message: "column pages.slug does not exist" } });
  assert.deepEqual(await loadStoredMerchantOperationLogs(client, "10000000"), []);
});

test("duplicate storage rows are merged without losing unique logs", () => {
  const merged = mergeStoredMerchantOperationLogRows("10000000", [
    {
      id: 1,
      slug: "__merchant_operation_logs__:10000000",
      blocks: { logs: [createLog("a", "2026-07-20T10:00:00.000Z")] },
    },
    {
      id: 2,
      slug: "__merchant_operation_logs__:10000000",
      blocks: { logs: [createLog("b", "2026-07-21T10:00:00.000Z")] },
    },
  ]);
  assert.deepEqual(merged.logs.map((item) => item.id), ["b", "a"]);
  assert.equal(merged.existingRowId, 1);
});

test("concurrent appends are serialized and retrying the same id is idempotent", async () => {
  const memory = createMemoryClient();
  const logs = Array.from({ length: 12 }, (_, index) =>
    createLog(`log-${index}`, `2026-07-21T10:${String(index).padStart(2, "0")}:00.000Z`),
  );
  await Promise.all(logs.map((entry) => appendStoredMerchantOperationLog(memory.client, entry)));
  await appendStoredMerchantOperationLog(memory.client, logs[0]!);
  const stored = await loadStoredMerchantOperationLogs(memory.client, "10000000");
  assert.equal(stored.length, 12);
  assert.equal(new Set(stored.map((item) => item.id)).size, 12);
  assert.equal(memory.rows.length, 1);
});

test("date boundaries reject impossible dates and support local ISO ranges", () => {
  assert.equal(parseMerchantOperationLogBoundary("2026-02-31", "start"), null);
  assert.equal(
    parseMerchantOperationLogBoundary("2026-07-20T22:00:00.000Z", "start"),
    Date.parse("2026-07-20T22:00:00.000Z"),
  );
  const result = queryMerchantOperationLogs(
    [
      createLog("before", "2026-07-20T21:59:59.999Z"),
      createLog("inside", "2026-07-20T22:00:00.000Z", "failed"),
      createLog("after", "2026-07-21T22:00:00.000Z"),
    ],
    {
      startAt: "2026-07-20T22:00:00.000Z",
      endAt: "2026-07-21T21:59:59.999Z",
      limit: 20,
    },
  );
  assert.deepEqual(result.logs.map((item) => item.id), ["inside"]);
  assert.equal(result.failedCount, 1);
  assert.equal(result.hasMore, false);
});
