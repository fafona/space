import assert from "node:assert/strict";
import test from "node:test";
import { unifiedExportCommand as cmd, unifiedExportWire as wire } from "../../scripts/fixtures/attendance-unified-export-model";
import { timesheetId as id, sheetEvent } from "../../scripts/fixtures/attendance-timesheet-model";
import { parseUnifiedExportCommand, parseUnifiedExportReceipt, parseUnifiedExportSource as parse, buildUnifiedExportCsv as csv, unifiedExportFilename, unifiedExportSelection } from "./merchantAttendanceUnifiedExport";
import { executeUnifiedExport } from "./merchantAttendanceUnifiedExport.server";
import { UnifiedExportClient } from "./merchantAttendanceUnifiedExportClient";
const response = async (c = cmd()) => ({ ok: true, moduleEnabled: true, ...await executeUnifiedExport({ command: c, authUserId: id(1) }, { rpc: async () => ({ data: wire(c), error: null }) }) });
const rows = (text: string) => text.slice(1).trimEnd().split("\r\n").map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""', '"')));
test("unified export command reuses bounded principal-free filters and explicitly binds saved scope and time zone", () => {
  for (const access of ["owner", "self", "manager"] as const) {
    const c = cmd(access); assert.deepEqual(parseUnifiedExportCommand(c), c);
    assert.deepEqual(unifiedExportSelection(parse(wire(c), c).report!), { siteId: c.siteId, query: c.query });
    for (const changed of [{ authUserId: id(9) }, { reportVersion: "legacy" }, { operationId: "wrong" }]) assert.throws(() => parseUnifiedExportCommand({ ...c, ...changed }));
  }
});
test("unified receipts require their own version, both source counts, correct identity and no misleading replay contents", () => {
  const c = cmd(), w = wire(c); assert.equal(parse(w, c).report!.totals.selected.workedUs, 15 * 3600000000 + 1);
  for (const patch of [{ reportVersion: "raw-and-approved-v2" }, { missingCount: 0 }, { sourceCount: 101 }, { workerId: id(9) }, { operationId: id(9) }, { downloadConfirmed: true }, { extra: true }]) assert.throws(() => parse({ ...w, receipt: { ...w.receipt, ...patch } }, c));
  assert.throws(() => parseUnifiedExportReceipt({ ...w.receipt, missingCount: -1 }, c));
  assert.equal(parse({ ...w, replayed: true, report: null }, c).report, null); assert.throws(() => parse({ ...w, replayed: true }, c));
});
test("CSV has exact source/day totals and microseconds, protected formulas and no fabricated punches or account IDs", () => {
  const c = cmd("manager"), w = wire(c); w.report.base.workerName = '=HYPERLINK("https://invalid.local")'; w.report.missing[0].workerName = "@SUM(1)";
  const r = parse(w, c), text = csv(r.report!, r.receipt), data = rows(text); assert(data.every(row => row.length === 16));
  assert.equal(data.find(row => row[0] === "汇总" && row[1] === "selected")![13], String(15 * 3600000000 + 1));
  assert.equal(data.find(row => row[0] === "汇总" && row[1] === "missingSelected")![12], "3600000000");
  assert.equal(data.filter(row => row[0] === "日明细" && row[1] === "missingSelected").reduce((n, row) => n + Number(row[13]), 0), 7 * 3600000000 + 1);
  assert(data.some(row => row[0] === "整段申报完整" && row[4] === id(500) && row[13] === "25200000001"));
  assert(!data.some(row => row[0] === "原始动作" && row[4] === id(500)));
  for (const token of ["'=HYPERLINK", "'@SUM", "不可混合累加", "不是完整个人月报", "不是 CSV 校验值", "attendance-unified-v1"]) assert(text.includes(token), token);
  for (const token of ["employeeId", "viewerEmployeeId", "actor_auth_user_id", id(90)]) assert(!text.includes(token), token);
  assert.match(unifiedExportFilename(c), /^attendance-unified-99990009-2026-09-01-2026-09-30-[a-f0-9-]+\.csv$/);
});
test("empty and open-shift CSV preserve metadata and blank unfinished durations instead of inventing zeros", () => {
  const c = cmd(); for (const empty of [true, false]) {
    const w = wire(); w.report.missing = []; w.report.base.items = empty ? [] : [{ startEventId: id(101), events: [sheetEvent(1, "clock_in", "2026-09-05T08:00:00.000000Z")], effect: null }];
    w.receipt.missingCount = 0; w.receipt.sessionCount = w.receipt.sourceCount = w.report.base.items.length;
    const r = parse(w, c), data = rows(csv(r.report!, r.receipt)); assert(data.some(row => row[5] === "来源版本"));
    if (!empty) assert(data.filter(row => row[0].startsWith("打卡班次")).every(row => row.slice(10, 14).every(s => s === "")));
  }
});
test("source conflicts or changed scope do not create a CSV, executor only calls new RPC and never falls back", async () => {
  const c = cmd(), w = wire(); w.report.missing[0].proposal.startAt = "2026-09-05T09:00:00.000000Z"; w.report.missing[0].proposal.endAt = "2026-09-05T10:00:00.000000Z"; w.report.missing[0].proposal.breaks = [];
  const run = (data: unknown) => executeUnifiedExport({ command: c, authUserId: id(1) }, { rpc: async (name, args) => { assert.equal(name, "faolla_attendance_unified_export_v1"); assert.equal(args.p_auth_user_id, id(1)); return { data, error: null }; } });
  await assert.rejects(run(w), /attendance_report_reconciliation_required/);
  const fresh = await run(wire()); assert(fresh.csv); assert.equal(Object.hasOwn(fresh, "report"), false);
  const replay = await run({ ...wire(), replayed: true, report: null }); assert.equal(replay.csv, null); assert.equal(replay.filename, null);
  await assert.rejects(run({ ...wire(), receipt: { ...wire().receipt, sourceCount: 99 } }), /attendance_unavailable/);
});
test("client requires acknowledgement, emits one POST, never auto-retries and labels browser save as unconfirmed", async () => {
  let calls = 0, downloads = 0; const c = cmd(), reply = await response(c);
  const client = new UnifiedExportClient({ selection: c, actorId: id(1), randomId: () => c.operationId, available: () => true,
    apiFetch: async (url, init) => { calls++; assert.equal(url, "/api/merchant-enterprise/attendance/unified-export"); assert.equal(init?.method, "POST"); return Response.json(reply); }, deliver: () => { downloads++; } });
  await client.download(false); assert.equal(calls, 0); await client.download(true); assert.equal(calls, 1); assert.equal(downloads, 1); assert.match(client.getSnapshot().message, /请在下载记录确认/); client.invalidate();
});
test("late/hidden response, duplicate receipt, wrong filename or forged source version cannot download", async () => {
  const c = cmd(), fresh = await response(c); let downloads = 0;
  for (const reply of [{ ...fresh, filename: "legacy.csv" }, { ...fresh, receipt: { ...fresh.receipt, reportVersion: "old" } }, { ...fresh, replayed: true, csv: null, filename: null, viewerEmployeeId: null, accessValidUntil: null }]) {
    const client = new UnifiedExportClient({ selection: c, actorId: id(1), randomId: () => c.operationId, available: () => true, apiFetch: async () => Response.json(reply), deliver: () => { downloads++; } });
    await client.download(true); assert.equal(downloads, 0); client.invalidate();
  }
  let release!: (v: Response) => void; const pending = new Promise<Response>(resolve => { release = resolve; });
  const client = new UnifiedExportClient({ selection: c, actorId: id(1), randomId: () => c.operationId, available: () => true, apiFetch: () => pending, deliver: () => { downloads++; } });
  const job = client.download(true); client.invalidate(); release(Response.json(fresh)); await job; assert.equal(downloads, 0);
});
test("denial hides parent results; reconciliation clears current report; failed response never downloads or silently retries", async () => {
  for (const [code, status, denied, stale] of [["attendance_export_denied", 403, 1, 0], ["unauthorized", 401, 1, 0], ["attendance_report_reconciliation_required", 422, 0, 1], ["attendance_export_denied", 500, 0, 0]] as const) {
    let calls = 0, cleared = 0, invalid = 0, downloads = 0; const c = cmd();
    const client = new UnifiedExportClient({ selection: c, actorId: id(1), randomId: () => c.operationId, available: () => true,
      apiFetch: async () => { calls++; return Response.json({ ok: false, error: code }, { status }); }, deliver: () => { downloads++; }, onDenied: () => { cleared++; }, onStale: () => { invalid++; } });
    await client.download(true); assert.equal(calls, 1); assert.equal(downloads, 0); assert.equal(cleared, denied); assert.equal(invalid, stale); client.invalidate();
  }
});
test("network time cannot extend a finite manager export grant", async () => {
  for (const [elapsed, grant] of [[1100, 1000], [0.5, 1]]) {
    const c = cmd("manager"), reply = await response(c); let now = 0, downloads = 0, denied = 0;
    const client = new UnifiedExportClient({ selection: c, actorId: id(90), randomId: () => c.operationId, available: () => true, now: () => now,
      apiFetch: async () => { now = elapsed; return Response.json({ ...reply, accessValidUntil: new Date(Date.parse(reply.receipt.asOf) + grant).toISOString().replace("Z", "000Z") }); },
      deliver: () => { downloads++; }, onDenied: () => { denied++; } });
    await client.download(true); assert.equal(downloads, 0); assert.equal(denied, 1); client.invalidate();
  }
});
