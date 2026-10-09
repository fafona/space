import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePrintClient, type AttendancePrintKind, type AttendancePrintDelivery } from "./merchantAttendancePrintClient";
import { buildAttendancePrintDocument } from "./merchantAttendancePrintDocument";
import { parseTimesheetExportSource, buildTimesheetExportCsv, timesheetExportFilename, type TimesheetExportCommand } from "./merchantAttendanceTimesheetExport";
import { parseUnifiedExportSource, buildUnifiedExportCsv, unifiedExportFilename } from "./merchantAttendanceUnifiedExport";
import { ATTENDANCE_REPORT_SOURCE_VERSION } from "./merchantAttendanceTimesheet";
import { timesheetExportCommand, timesheetExportWire } from "../../scripts/fixtures/attendance-timesheet-export-model";
import { unifiedExportWire } from "../../scripts/fixtures/attendance-unified-export-model";
import { timesheetId as id } from "../../scripts/fixtures/attendance-timesheet-model";

function response(kind: AttendancePrintKind, command: TimesheetExportCommand) {
  const common = { ok: true, moduleEnabled: false, replayed: false, viewerEmployeeId: command.query.access === "owner" ? null : command.query.access === "self" ? id(2) : id(90), accessValidUntil: null as string | null };
  if (kind === "unified") {
    const parsed = parseUnifiedExportSource(unifiedExportWire(command), command);
    return { ...common, receipt: parsed.receipt, csv: buildUnifiedExportCsv(parsed.report!, parsed.receipt), filename: unifiedExportFilename(command) };
  }
  const wire = timesheetExportWire(command); wire.report.sourceVersion = ATTENDANCE_REPORT_SOURCE_VERSION;
  const parsed = parseTimesheetExportSource(wire, command, ATTENDANCE_REPORT_SOURCE_VERSION);
  return { ...common, receipt: parsed.receipt, csv: buildTimesheetExportCsv(parsed.report!, parsed.receipt), filename: timesheetExportFilename(command) };
}
type Options = ConstructorParameters<typeof AttendancePrintClient>[0];
function fixture(kind: AttendancePrintKind = "timesheet", access: "owner" | "self" | "manager" = "owner", change?: (body: ReturnType<typeof response>) => unknown, extra: Partial<Options> = {}) {
  let requests = 0, deliveries = 0, denied = 0, stale = 0, clock = 0, available = true, next = 800;
  const command = timesheetExportCommand(access), documents: AttendancePrintDelivery[] = [];
  const client = new AttendancePrintClient({ kind, selection: { siteId: command.siteId, query: command.query }, actorId: access === "owner" ? id(1) : access === "self" ? id(2) : id(90),
    apiFetch: async (url, init) => {
      requests++; assert.equal(url, `/api/merchant-enterprise/attendance/${kind === "unified" ? "unified-export" : "timesheet-export"}`);
      assert.equal(init?.method, "POST"); assert.equal(init.cache, "no-store");
      const body = response(kind, JSON.parse(String(init.body))); return Response.json(change ? change(body) : body);
    }, available: () => available, deliver: async document => { assert(document.authorized()); documents.push(document); deliveries++; },
    onDenied: () => { denied++; }, onStale: () => { stale++; }, randomId: () => id(next++), now: () => clock, ...extra });
  return { client, documents, counts: () => ({ requests, deliveries, denied, stale }), setClock: (value: number) => { clock = value; },
    hide: () => { available = false; client.invalidate(); }, command };
}
for (const kind of ["timesheet", "unified"] as const) {
  test(`${kind}: three scopes reauthorize only after acknowledgement, allow authorized paused history and never persist documents in state`, async () => {
    for (const access of ["owner", "self", "manager"] as const) {
      const f = fixture(kind, access); assert.equal(f.counts().requests, 0); await f.client.print(false); assert.equal(f.counts().requests, 0);
      await f.client.print(true); assert.equal(f.counts().requests, 1); assert.equal(f.counts().deliveries, 1);
      assert.match(f.documents[0].html, new RegExp(`data-attendance-print-document="${kind}"`));
      assert.match(f.client.getSnapshot().message, /无法确认是否出纸或保存/);
      assert(!("html" in f.client.getSnapshot())); assert(!("csv" in f.client.getSnapshot()));
      const old = f.client.getSnapshot().operationId; await f.client.print(true); assert.notEqual(f.client.getSnapshot().operationId, old);
      assert(f.documents[0].signal.aborted); assert.equal(f.counts().requests, 2);
      f.hide(); assert(f.documents[1].signal.aborted); await f.client.print(true); assert.equal(f.counts().requests, 2);
    }
  });
  test(`${kind}: viewer, envelope, receipt, filename and structured CSV mismatches fail closed`, async () => {
    const cases = [(b: ReturnType<typeof response>) => ({ ...b, viewerEmployeeId: id(91) }),
      (b: ReturnType<typeof response>) => ({ ...b, extra: true }), (b: ReturnType<typeof response>) => ({ ...b, filename: "x.html" }),
      (b: ReturnType<typeof response>) => ({ ...b, receipt: { ...b.receipt, workerId: id(99) } }),
      (b: ReturnType<typeof response>) => ({ ...b, receipt: { ...b.receipt, scopeRevision: 2 } }),
      (b: ReturnType<typeof response>) => ({ ...b, csv: '\ufeff"记录类型","口径",\r\n' }),
      (b: ReturnType<typeof response>) => ({ ...b, csv: b.csv.replaceAll(id(4), id(99)) }),
      (b: ReturnType<typeof response>) => ({ ...b, csv: b.csv.replaceAll(b.receipt.operationId, id(998)) }),
      (b: ReturnType<typeof response>) => ({ ...b, csv: b.csv.replace('"a'.padEnd(65, "a") + '"', '"' + "b".repeat(64) + '"') })];
    for (const change of cases) { const f = fixture(kind, "manager", change); await f.client.print(true); assert.equal(f.counts().deliveries, 0); assert.equal(f.client.getSnapshot().phase, "blocked"); f.client.invalidate(); }
  });
  test(`${kind}: receipt-only replay has no document and never repeats a POST automatically`, async () => {
    const f = fixture(kind, "owner", body => ({ ...body, replayed: true, csv: null, filename: null, viewerEmployeeId: null, accessValidUntil: null }));
    await f.client.print(true); assert.equal(f.counts().deliveries, 0); assert.equal(f.counts().requests, 1); assert.match(f.client.getSnapshot().message, /不会自动重试/);
  });
  test(`${kind}: manager lease includes request, render and asynchronous delivery time, all roles have five minute ceiling`, async () => {
    const lease = (body: ReturnType<typeof response>) => ({ ...body, accessValidUntil: "2026-09-30T12:00:01.000000Z" });
    const before = fixture(kind, "manager", body => { before.setClock(999); return lease(body); });
    await before.client.print(true); assert.equal(before.counts().deliveries, 0);
    const render = fixture(kind, "manager", lease, { buildDocument: (...args) => { render.setClock(999); return buildAttendancePrintDocument(...args); } });
    await render.client.print(true); assert.equal(render.counts().deliveries, 0);
    let printed = 0;
    const loaded = fixture(kind, "manager", lease, { deliver: async doc => { loaded.setClock(999); if (!doc.authorized()) throw Error("attendance_print_expired"); printed++; } });
    await loaded.client.print(true); assert.equal(printed, 0);
    const fresh = fixture(kind, "manager", lease); fresh.setClock(0); await fresh.client.print(true); assert.equal(fresh.counts().deliveries, 1);
    fresh.setClock(998); assert(fresh.documents[0].authorized()); fresh.setClock(999); assert(!fresh.documents[0].authorized()); fresh.client.invalidate();
    for (const access of ["owner", "self", "manager"] as const) {
      const f = fixture(kind, access, body => { f.setClock(300000); return body; }); await f.client.print(true); assert.equal(f.counts().deliveries, 0);
    }
    const wrongLease = fixture(kind, "owner", lease); await wrongLease.client.print(true); assert.equal(wrongLease.counts().deliveries, 0); assert.equal(wrongLease.counts().denied, 1);
  });
  test(`${kind}: duplicate clicks, late response, hide and cleanup cannot deliver an obsolete document`, async () => {
    let release!: (value: Response) => void, requests = 0;
    const f = fixture(kind, "owner", undefined, { apiFetch: async () => { requests++; return new Promise<Response>(resolve => { release = resolve; }); } });
    const pending = f.client.print(true); await f.client.print(true); assert.equal(requests, 1);
    f.hide(); release(Response.json(response(kind, f.command))); await pending;
    assert.equal(f.counts().deliveries, 0); assert.equal(f.client.getSnapshot().operationId, null);
  });
  test(`${kind}: explicit authorization denials notify the parent, network and print uncertainty never auto-retry`, async () => {
    for (const [code, status] of [["employee_password_authentication_required", 403], ["attendance_export_denied", 403], ["attendance_worker_changed", 409]] as const) {
      const f = fixture(kind, "self", undefined, { apiFetch: async () => Response.json({ ok: false, error: code }, { status }) });
      await f.client.print(true); assert.equal(f.counts().deliveries, 0); assert.equal(f.counts().denied, 1);
    }
    for (const code of ["network", "attendance_print_unavailable", "attendance_print_uncertain"] as const) {
      let calls = 0;
      const f = fixture(kind, "owner", undefined, code === "network" ? { apiFetch: async () => { calls++; throw Error(code); } }
        : { deliver: async () => { calls++; throw Error(code); } });
      await f.client.print(true); assert.equal(calls, 1); assert.equal(f.client.getSnapshot().phase, "blocked");
      assert.match(f.client.getSnapshot().message, code === "attendance_print_unavailable" ? /不会改为打印整个后台/ : /不会自动/);
    }
  });
}
