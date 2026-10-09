import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Workspace, { PeriodClosureV2Pages, periodClosureV2Controls, periodClosureV2Ports } from "../components/enterprise/MerchantAttendancePeriodClosureV2Workspace";
import { AttendancePeriodClosureV2Client, type PeriodClosureV2ClientState, type PeriodClosureV2View } from "./merchantAttendancePeriodClosureV2Client";
import { parsePeriodClosureV2Response, type PeriodClosureV2Query, type PeriodClosureV2Result } from "./merchantAttendancePeriodClosureV2";
import { periodClosureUiArtifact, periodClosureUiSummary, periodClosureUiEntry, periodClosureUiCommand,
  periodClosureUiQuery, periodClosureUiId as id, periodClosureUiOwner as owner, periodClosureUiEmployee as employee } from "../../scripts/fixtures/attendance-period-closure-ui-model";

// Synthetic UI-only values. SQL and protocol correctness are tested separately.
const source = () => readFileSync(new URL("../components/enterprise/MerchantAttendancePeriodClosureV2Workspace.tsx", import.meta.url), "utf8");
const baseQuery = periodClosureUiQuery("detail");
let requests = 0;
const props = { siteId: baseQuery.siteId, access: "owner" as const, actorId: owner, workerId: baseQuery.workerId,
  fromDate: baseQuery.fromDate, throughDate: baseQuery.throughDate,
  apiFetch: async () => { requests++; throw Error("UI render must not request"); }, onClose: () => {} };
const common = { protocol: "period-closure-v2" as const, siteId: props.siteId, workerId: props.workerId, actorId: owner, access: props.access, readAt: "2026-10-08T00:00:00.000001Z" };
function detail(): Extract<PeriodClosureV2View, { kind: "detail" }> {
  return { ...common, moduleEnabled: true, kind: "detail", period: { ...periodClosureUiSummary(), revision: 101, currentVersion: 21, state: "confirmed", confirmedVersion: 21 },
    artifact: periodClosureUiArtifact(), artifactVersion: 21, sourceChanged: false, operation: null, replayed: false };
}
function state(): PeriodClosureV2ClientState {
  const query: PeriodClosureV2Query = { ...baseQuery, cursor: null };
  return { phase: "ready", query, result: detail(), pending: null, definitiveRejection: null, message: "Synthetic read",
    navigation: { workerId: query.workerId, fromDate: query.fromDate, throughDate: query.throughDate, periodId: query.periodId } };
}
const controls = (s = state(), overrides: Partial<Parameters<typeof periodClosureV2Controls>[1]> = {}, shown = true, enabled = true, reason = "明确核对") => periodClosureV2Controls(s, { ...props, ...overrides }, shown, enabled, reason);
const noActions = (value: ReturnType<typeof controls>) => assert(Object.values(value.allowed).every(v => v === false));
const noop = () => {};
function page(result: Extract<PeriodClosureV2Result, { kind: "list" | "history" | "versions" }>, canRead = true) {
  return renderToStaticMarkup(<PeriodClosureV2Pages result={result} canRead={canRead} list={noop} select={noop} history={noop} versions={noop} detail={noop}/>);
}

test("V2 workspace SSR performs zero HTTP and distinguishes owner/self without enabling default-off writes", () => {
  const previous = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED;
    const a = renderToStaticMarkup(<Workspace {...props}/>), b = renderToStaticMarkup(<Workspace {...props} access="self" actorId={employee} enabled/>);
    assert.match(a, /data-period-closure-v2/); assert.match(a, /新操作入口关闭/); assert.match(a, /预览完整周期资料/);
    assert.match(a, /封存及重开仅当前负责人操作/); assert.match(b, /不能代负责人封存或重开/); assert.doesNotMatch(b, /预览完整周期资料/);
    for (const html of [a, b]) { assert.match(html, /沉默、已读或负责人回复不代替本人确认/); assert.match(html, /64 MiB/); assert.match(html, /单次最多 31 日/); assert.match(html, /旧档案不改写、不删除/); }
    assert.equal(requests, 0);
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED; else process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED = previous; }
});

test("fresh current detail alone grants role-limited actions; old 20/100 lifetime thresholds do not disable continuation", () => {
  const a = controls(); assert.equal(a.allowed.seal, true); assert.equal(a.allowed.confirm, false); assert.equal(a.allowed.dispute, false); assert.equal(a.allowed.send, false);
  const s = state(), r = detail(); r.period.state = "review"; r.period.confirmedVersion = null; r.access = "self";
  const self = controls({ ...s, query: { ...s.query!, access: "self" }, result: r }, { access: "self" });
  assert.equal(self.allowed.confirm, true); assert.equal(self.allowed.dispute, true); assert.equal(self.allowed.seal, false); assert.equal(self.allowed.respond, false); assert.equal(self.allowed.reopen, false);
});

test("recover/export/fixed-version and POST receipt are never fresh-write authority", () => {
  const s = state();
  for (const mode of ["recover", "export"] as const) {
    const c = controls({ ...s, query: { ...s.query!, mode, operationId: mode === "recover" ? id(900) : null, version: mode === "export" ? 21 : null } });
    noActions(c); assert.equal(c.canEditReason, false); assert.equal(c.canOutput, false);
  }
  noActions(controls({ ...s, query: { ...s.query!, version: 21 } }));
  noActions(controls({ ...s, result: { ...detail(), operation: periodClosureUiEntry() } }));
  noActions(controls({ ...s, navigation: null }));
});

test("explicit list selection uses the complete saved range; foreign recovery cannot adopt that navigation", () => {
  const s = state(), narrower = { fromDate: "2026-09-02", throughDate: "2026-09-02" };
  assert.equal(controls(s, narrower).allowed.seal, true);
  const recovered = { ...s, navigation: null, query: { ...s.query!, mode: "recover" as const, operationId: id(900) } };
  const c = controls(recovered, narrower); assert.equal(c.matchesNavigation, false); assert.equal(c.canOutput, false); noActions(c);
  assert.equal(controls({ ...s, query: { ...s.query!, workerId: id(7777) } }).matchesNavigation, false);
  assert.equal(controls({ ...s, query: { ...s.query!, siteId: "99999999" } }).matchesNavigation, false);
  assert.equal(controls({ ...s, query: { ...s.query!, periodId: id(7777) } }).matchesNavigation, false);
});

test("pending, busy, hidden and invalid reasons cannot authorize a new action or output", () => {
  const s = state(), pending = { format: 2 as const, actorId: owner, employeeId: employee, employeeAuthUserId: id(3), query: s.query!, command: periodClosureUiCommand() };
  for (const changed of [{ ...s, pending }, { ...s, phase: "loading" as const }, { ...s, phase: "saving" as const }, { ...s, phase: "blocked" as const }]) {
    noActions(controls(changed)); assert.equal(controls(changed).canOutput, false);
  }
  noActions(controls(s, {}, false)); assert.equal(controls(s, {}, false).canOutput, false);
  for (const reason of ["", " 前置空格", "尾随空格 ", "换\n行", "控制\u0085字符", "x".repeat(501)]) noActions(controls(s, {}, true, true, reason));
});

test("changed or unknown current source blocks confirm/seal; paused owner can explicitly reopen only fresh sealed detail", () => {
  const s = state();
  for (const sourceChanged of [true, null]) assert.equal(controls({ ...s, result: { ...detail(), sourceChanged } }).allowed.seal, false);
  const sealed = { ...detail(), period: { ...detail().period, state: "sealed" as const, sealed: true } };
  const c = controls({ ...s, result: { ...sealed, moduleEnabled: false } }, {}, true, false);
  assert.equal(c.allowed.reopen, true); for (const action of ["send", "confirm", "dispute", "respond", "seal"] as const) assert.equal(c.allowed[action], false);
  noActions(controls({ ...s, result: sealed, query: { ...s.query!, mode: "recover", operationId: id(900) } }, {}, true, false));
});

test("preview permits unresolved review material but not in-progress or unresolved outage; self cannot send", () => {
  const s = state();
  for (const blockers of [[], ["pending_leave", "unresolved_review"], ["period_in_progress"], ["unresolved_outage"]]) {
    const preview: PeriodClosureV2View = { ...common, moduleEnabled: true, kind: "preview", preview: { artifact: periodClosureUiArtifact(), period: null, blockers } };
    const selected = { ...s.navigation!, periodId: null }, q = { ...s.query!, mode: "preview" as const, periodId: null };
    const x = { ...s, query: q, navigation: selected, result: preview };
    assert.equal(controls(x).allowed.send, !blockers.includes("period_in_progress") && !blockers.includes("unresolved_outage"));
    assert.equal(controls({ ...x, query: { ...q, access: "self" } }, { access: "self" }).allowed.send, false);
  }
});

test("list renders exactly the supplied 25 metadata rows with explicit server-page controls", () => {
  const items = Array.from({ length: 25 }, (_, n) => ({ ...periodClosureUiSummary(), periodId: id(2000 + n), workerName: n === 0 ? "<img onerror=bad>" : "Synthetic worker", openedAt: "2026-10-07T00:00:00.000001Z" }));
  const r: Extract<PeriodClosureV2Result, { kind: "list" }> = { ...common, kind: "list", items, nextCursor: null };
  const html = page(r); assert.equal((html.match(/读取保存版本<\/button>/g) ?? []).length, 25);
  assert.match(html, /与导航日期相交/); assert.match(html, /每页最多 25 条/); assert.match(html, /周期列表服务器分页/); assert.match(html, /刷新列表第一页/); assert.match(html, /本次列表已到末页/);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|textarea|保存版本并发起核对/);
});

test("history renders one 50-entry descending page with explicit continuation, not a full lifetime count", () => {
  const p = { ...periodClosureUiSummary(), revision: 151, currentVersion: 21 };
  const items = Array.from({ length: 50 }, (_, n) => ({ ...periodClosureUiEntry(), operationId: id(3000 + n), revision: 151 - n, version: 21, reason: `Synthetic history ${n}` }));
  const r: Extract<PeriodClosureV2Result, { kind: "history" }> = { ...common, kind: "history", period: p, items,
    nextCursor: { siteId: props.siteId, access: props.access, workerId: props.workerId, fromDate: props.fromDate, throughDate: props.throughDate,
      kind: "history", periodId: p.periodId, atRevision: 151, beforeRevision: 102 } };
  const html = page(r); assert.equal((html.match(/Synthetic history /g) ?? []).length, 50); assert.match(html, /修订 151/); assert.match(html, /修订 102/);
  assert.doesNotMatch(html, /修订 101/); assert.match(html, /每页最多 50 条/); assert.match(html, /周期历史服务器分页/); assert.match(html, /本页不是完整历史/);
  assert.doesNotMatch(html, /textarea|下载本保存版本|<select/);
});

test("version page renders only its 20 persisted rows and allows explicit old-version selection above v20", () => {
  const p = { ...periodClosureUiSummary(), revision: 1001, currentVersion: 301 };
  const items = Array.from({ length: 20 }, (_, n) => ({ version: 301 - n, operationId: id(4000 + n), recordedAt: "2026-10-07T00:00:00.000001Z", artifactId: id(5000 + n), sourceFingerprint: "a".repeat(64), artifactBytes: 1024, artifactSha256: "b".repeat(64) }));
  const html = page({ ...common, kind: "versions", period: p, items, nextCursor: null });
  assert.equal((html.match(/查看保存版本 /g) ?? []).length, 20); assert.match(html, /查看保存版本 301/); assert.match(html, /查看保存版本 282/); assert.doesNotMatch(html, /查看保存版本 281/);
  assert.match(html, /每页最多 20 个保存版本/); assert.match(html, /保存版本服务器分页/); assert.match(html, /选择后才读取该版正文/); assert.doesNotMatch(html, /textarea|<select/);
});

test("history/version metadata pages cannot be used to write or export even when navigation and counters match", () => {
  const s = state(), period = detail().period;
  for (const kind of ["history", "versions"] as const) {
    const c = controls({ ...s, query: { ...s.query!, mode: kind }, result: { ...common, moduleEnabled: true, kind, period, items: [], nextCursor: null } });
    noActions(c); assert.equal(c.canEditReason, false); assert.equal(c.canOutput, false);
  }
});

test("lifetime/dirty guards, exact client calls and controlled fixed-artifact output remain explicit", () => {
  const code = source();
  for (const token of ["registerLeaveGuard?.(leave)", "beforeunload", "pagehide", "pageshow", "visibilitychange", "client.initialize()", "client.pause()", "printController.current?.abort()", "snapshot !== client.getSnapshot()", "sessionStorage"]) assert(code.includes(token), token);
  assert.match(code, /读取或翻页会清除未提交理由/); assert.match(code, /if \(document\.hidden\) \{ invalidate\(\); clear\(\); setShown\(false\); \} else if \(isCurrent\(\)\) void client\.initialize\(\)/);
  assert.match(code, /client\.selectPeriod\(item\)/); assert.match(code, /client\.history\(periodId, cursor\)/); assert.match(code, /client\.versions\(periodId, cursor\)/);
  assert.match(code, /client\.exportVersion/); assert.match(code, /buildPeriodClosureOutput\(saved/); assert.match(code, /deliverAttendancePrint/);
  assert.match(code, /detail\.operation === null/); assert.match(code, /canOutput:[^\n]+query\?\.mode === "detail"/);
  assert.doesNotMatch(code, /localStorage|setInterval|\.retry\(|client\.dispose|Array\.from|result\.history|fetch\(/);
});

test("a captured storage handle and requester reject a changed live scope before touching durable pending", async () => {
  let live = true, reads = 0, writes = 0, removes = 0, calls = 0;
  const ports = periodClosureV2Ports(async () => { calls++; return new Response("ok"); }, () => ({
    getItem: () => { reads++; return "original bytes"; }, setItem: () => { writes++; }, removeItem: () => { removes++; },
  }), () => live);
  const savedHandle = ports.storage(); assert.equal(savedHandle.getItem("pending"), "original bytes"); live = false;
  assert.throws(() => ports.storage(), /identity_changed/); assert.throws(() => savedHandle.getItem("pending"), /identity_changed/);
  assert.throws(() => savedHandle.setItem("pending", "replacement"), /identity_changed/); assert.throws(() => savedHandle.removeItem("pending"), /identity_changed/);
  await assert.rejects(ports.apiFetch("/synthetic", undefined), /identity_changed/);
  assert.deepEqual({ reads, writes, removes, calls }, { reads: 1, writes: 0, removes: 0, calls: 0 });
});

test("late HTTP headers after scope replacement are rejected and their unused body is cancelled", async () => {
  let live = true, finish!: (response: Response) => void, cancelled = 0;
  const ports = periodClosureV2Ports(async () => new Promise<Response>(resolve => { finish = resolve; }), () => ({ getItem: () => null, setItem: noop, removeItem: noop }), () => live);
  const request = ports.apiFetch("/synthetic", undefined); live = false;
  finish(new Response(new ReadableStream({ cancel: () => { cancelled++; } })));
  await assert.rejects(request, /identity_changed/); assert.equal(cancelled, 1);
});

test("real V2 client cannot clear a legacy pending receipt after headers arrived but live scope changed during body read", async () => {
  let live = true, reads = 0, mutations = 0, releaseBody!: () => void, bodyRead!: () => void;
  const waitingForBody = new Promise<void>(resolve => { bodyRead = resolve; }), values = new Map<string, string>();
  const command = periodClosureUiCommand(), pending = { format: 1, actorId: owner, employeeId: employee, employeeAuthUserId: id(3), query: baseQuery, command };
  const { moduleEnabled, ...saved } = detail();
  const wire = { ok: true, moduleEnabled, data: { ...saved, artifactVersion: 1, sourceChanged: null, operation: periodClosureUiEntry(command), replayed: true } };
  parsePeriodClosureV2Response(wire, { ...baseQuery, mode: "recover", cursor: null, operationId: command.operationId }, { ownerId: owner }, command);
  const payload = new TextEncoder().encode(JSON.stringify(wire));
  const ports = periodClosureV2Ports(async (_path, init) => {
    reads++; assert.equal(init?.method, "GET");
    return new Response(new ReadableStream<Uint8Array>({
      // A full initial queue prevents an eager pull before transport actually
      // receives the headers and consumes the first byte with its body reader.
      start(controller) { controller.enqueue(payload.slice(0, 1)); releaseBody = () => { controller.enqueue(payload.slice(1)); controller.close(); }; },
      pull() { bodyRead(); },
    }), { headers: { "content-type": "application/json" } });
  }, () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { mutations++; values.set(key, value); }, removeItem: key => { mutations++; values.delete(key); } }), () => live);
  const client = new AttendancePeriodClosureV2Client({ ...props, enabled: false, ...ports });
  const raw = JSON.stringify(pending, null, 2); values.set(client.storageKey, raw); await client.initialize(); assert.equal(reads, 0);
  const recovery = client.recover(); await waitingForBody; live = false; releaseBody(); await recovery;
  assert.equal(reads, 1); assert.equal(mutations, 0); assert.equal(values.get(client.storageKey), raw); assert.equal(client.getSnapshot().pending?.command.operationId, command.operationId);
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "unconfirmed");
});

test("render-time token binds every scope field and cannot reauthorize an older A to B to A controller", () => {
  const code = source();
  for (const field of ["props.siteId", "props.access", "props.actorId", "props.workerId", "props.fromDate", "props.throughDate"]) assert(code.includes(field));
  assert.match(code, /live\.current\.apiFetch !== props\.apiFetch/); assert.match(code, /live\.current\.enabled !== enabled/);
  assert.match(code, /token: live\.current\.token \+ 1/); assert.match(code, /live\.current\.token === token/);
  assert.match(code, /periodClosureV2Ports\(apiFetch, \(\) => sessionStorage, isCurrent\)/);
  assert.match(code, /const current = \(\) => isCurrent\(\) && authorized\(\)/);
});
