import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantOperationLogsCsv,
  filterMerchantOperationLogs,
  normalizeMerchantOperationLogEntry,
  shouldKeepMerchantOperationLog,
  type MerchantOperationLogEntry,
} from "@/lib/merchantOperationLogs";

function createLog(overrides: Partial<MerchantOperationLogEntry> = {}): MerchantOperationLogEntry {
  return {
    id: "log-1",
    siteId: "10000000",
    at: "2026-07-21T10:00:00.000Z",
    module: "优惠券",
    action: "更新",
    summary: "更新优惠券",
    status: "success",
    method: "PATCH",
    endpoint: "/api/coupons",
    ...overrides,
  };
}

test("operation log normalization rejects invalid timestamps and gives legacy rows a stable id", () => {
  assert.equal(normalizeMerchantOperationLogEntry(createLog({ at: "not-a-date" })), null);
  const legacy = { ...createLog(), id: "" };
  const first = normalizeMerchantOperationLogEntry(legacy);
  const second = normalizeMerchantOperationLogEntry(legacy);
  assert.ok(first?.id.startsWith("op-legacy-"));
  assert.equal(first?.id, second?.id);
  assert.equal(first?.method, "PATCH");
});

test("operation log filtering deduplicates, sorts and applies all filters", () => {
  const logs = [
    createLog({ id: "older", at: "2026-07-20T10:00:00.000Z", status: "failed" }),
    createLog({ id: "newer", at: "2026-07-21T12:00:00.000Z" }),
    createLog({ id: "newer", at: "2026-07-21T11:00:00.000Z", summary: "stale duplicate" }),
    createLog({ id: "member", at: "2026-07-21T13:00:00.000Z", module: "会员管理" }),
  ];
  const filtered = filterMerchantOperationLogs(logs, {
    module: "优惠券",
    status: "success",
    startAt: Date.parse("2026-07-21T00:00:00.000Z"),
    endAt: Date.parse("2026-07-21T23:59:59.999Z"),
  });
  assert.deepEqual(filtered.map((item) => item.id), ["newer"]);
  assert.equal(filtered[0]?.summary, "更新优惠券");
});

test("conversation and operation-log transport requests are excluded", () => {
  assert.equal(shouldKeepMerchantOperationLog(createLog({ module: "会话" })), false);
  assert.equal(shouldKeepMerchantOperationLog(createLog({ endpoint: "/api/merchant-operation-logs" })), false);
  assert.equal(shouldKeepMerchantOperationLog(createLog()), true);
});

test("CSV export prevents spreadsheet formulas while retaining UTF-8 headings", () => {
  const csv = buildMerchantOperationLogsCsv([
    createLog({ summary: "=HYPERLINK(\"https://example.com\")", detail: "+cmd" }),
  ]);
  assert.ok(csv.startsWith("\uFEFF\"时间\",\"状态\""));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /"'\+cmd"/);
});
