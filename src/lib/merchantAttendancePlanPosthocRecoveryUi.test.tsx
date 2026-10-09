import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import ExceptionWorkspace, { PlanExceptionDetail, PlanExceptionEntry, planPosthocRecoveryTarget } from "../components/enterprise/MerchantAttendancePlanExceptionWorkspace";
import PosthocWorkspace from "../components/enterprise/MerchantAttendancePlanPosthocWorkspace";
import { AttendancePlanPosthocClient, planPosthocPendingKey, type PlanPosthocPending, type PlanPosthocStorage } from "./merchantAttendancePlanPosthocClient";
import { PLAN_POSTHOC_API } from "./merchantAttendancePlanPosthocHttp";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { posthocUiValue, posthocUiCommand, posthocUiSaved, posthocUiQuery, posthocUiId as id } from "../../scripts/fixtures/attendance-plan-posthoc-ui-model";
import { posthocReviewWire } from "../../scripts/fixtures/attendance-plan-posthoc-review-model";
import { exceptionUiQuery } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { parsePlanExceptionResponse } from "./merchantAttendancePlanExceptions";

const base = posthocUiValue(), target = { workerId: base.worker.workerId, slotId: base.slot.id };
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(match => match[1]);
function setup(fetcher: AttendanceApiFetch, present = true) {
  const pending: PlanPosthocPending = { version: 1, actorId: base.actorId, query: posthocUiQuery(), command: posthocUiCommand() };
  const raw = JSON.stringify(pending), key = planPosthocPendingKey(base.siteId, base.actorId, target.workerId, target.slotId);
  const otherKey = planPosthocPendingKey(base.siteId, id(208999), target.workerId, target.slotId), bytes = new Map([[otherKey, "PRIVATE_OTHER_SCOPE"]]);
  if (present) bytes.set(key, raw);
  const reads: string[] = [], writes: string[] = [], removals: string[] = [];
  const storage: PlanPosthocStorage = { getItem: name => { reads.push(name); return bytes.get(name) ?? null; },
    setItem: (name, value) => { writes.push(name); bytes.set(name, value); }, removeItem: name => { removals.push(name); bytes.delete(name); } };
  const client = new AttendancePlanPosthocClient({ siteId: base.siteId, actorId: base.actorId, ...target, enabled: false, apiFetch: fetcher, storage: () => storage });
  const props = { siteId: base.siteId, actorId: base.actorId, ...target, enabled: false, recoveryOnly: true, client, onClose: () => {} };
  return { client, props, pending, raw, key, otherKey, bytes, reads, writes, removals };
}

test("owner flag-off exposes a known-target read-only entrance without broad storage discovery; self remains unchanged", () => {
  let calls = 0; const apiFetch: AttendanceApiFetch = async () => { calls++; throw Error("SSR must not request"); };
  const owner = render(<PlanExceptionEntry siteId={base.siteId} access="owner" actorId={base.actorId} enabled={false} onOpen={() => { calls++; }}/>);
  assert(owner.includes("按已知人员／排班核对采用原号"));
  assert.equal(render(<PlanExceptionEntry siteId={base.siteId} access="self" actorId={base.worker.employeeId} enabled={false} onOpen={() => { calls++; }}/>), "");
  const html = render(<ExceptionWorkspace siteId={base.siteId} access="owner" actorId={base.actorId} enabled={false} apiFetch={apiFetch} onClose={() => {}}/>);
  for (const text of ["恢复采用的考勤人员编号", "恢复采用的排班编号", "打开该目标的采用原号核对"]) assert(html.includes(text));
  assert(!html.includes("读取本排班当前依据")); assert(!html.includes("确认保存异常处理"));
  const self = render(<ExceptionWorkspace siteId={base.siteId} access="self" actorId={base.worker.employeeId} enabled={false} apiFetch={apiFetch} onClose={() => {}}/>);
  assert(!self.includes("按已知目标恢复采用原号")); assert.equal(calls, 0);
});

test("known target requires two exact UUIDs and returns no invented current detail or evidence", () => {
  assert.deepEqual(planPosthocRecoveryTarget(target.workerId, target.slotId), { ...target, recoveryOnly: true });
  for (const bad of ["", "unknown", target.workerId + "\n", " " + target.workerId, target.workerId.toUpperCase()]) {
    if (bad === target.workerId) continue;
    assert.equal(planPosthocRecoveryTarget(bad, target.slotId), null); assert.equal(planPosthocRecoveryTarget(target.workerId, bad), null);
  }
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendancePlanExceptionWorkspace.tsx", import.meta.url), "utf8");
  const entrance = source.slice(source.indexOf('aria-label="按已知目标恢复采用原号"'), source.indexOf("{pending &&"));
  assert(entrance.includes("planPosthocRecoveryTarget(recoveryWorkerId, recoverySlotId)")); assert(entrance.includes("setPosthoc(target)"));
  assert(!entrance.includes("client.detail(")); assert(!entrance.includes("sessionStorage"));
  assert(source.includes('const enabled = !recoveryOnly && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED === "1"'));
});

test("read-only child exposes only explicit recover and return, never candidate/evaluation/mutation/retirement controls", async () => {
  const h = setup(async () => { throw Error("must remain local"); }); await h.client.initialize();
  const html = render(<PosthocWorkspace {...h.props}/>), actions = buttons(html);
  assert.deepEqual(actions, ["返回异常核查", "只核对原编号"]);
  assert(html.includes(h.pending.command.operationId)); assert(!html.includes(h.pending.command.reason));
  assert(!html.includes("明确采用或撤销")); assert(!html.includes("当前候选"));
  assert(h.reads.every(key => key === h.key)); assert.deepEqual(h.writes, []); assert.deepEqual(h.removals, []);
});

test("flag-off exact recovery uses171 alone even when174 current source would fail; no automatic GET or POST", async () => {
  const calls: string[] = [];
  const h = setup(async (url, init) => {
    calls.push(url); assert.equal(init?.method, "GET"); assert(url.startsWith(PLAN_POSTHOC_API + "?"));
    assert.equal(new URL(url, "https://synthetic.invalid").searchParams.get("mode"), "recover");
    return Response.json({ ok: true, canWrite: false, data: posthocUiSaved() });
  });
  await h.client.initialize(); assert.deepEqual(calls, []); await h.client.retry(); assert.deepEqual(calls, []);
  await h.client.recover(); assert.equal(calls.length, 1); assert.equal(h.client.getSnapshot().pending, null);
  assert.equal(h.client.getSnapshot().result!.preview, null); assert.deepEqual(h.removals, [h.key]);
  assert.equal(h.bytes.get(h.otherKey), "PRIVATE_OTHER_SCOPE"); assert(h.reads.every(key => key === h.key)); assert.deepEqual(h.writes, []);
  assert.deepEqual(buttons(render(<PosthocWorkspace {...h.props}/>)), ["返回异常核查"]);
});

test("no exact pending and failed original lookup never search another key or fall back to current source", async () => {
  let calls = 0;
  const empty = setup(async () => { calls++; throw Error("unexpected"); }, false); await empty.client.initialize(); await empty.client.recover();
  assert.equal(calls, 0); assert(buttons(render(<PosthocWorkspace {...empty.props}/>)).length === 1);
  assert(empty.reads.every(key => key === empty.key)); assert.equal(empty.bytes.get(empty.otherKey), "PRIVATE_OTHER_SCOPE");
  const denied = setup(async () => { calls++; return Response.json({ ok: false, error: "attendance_plan_posthoc_adoption_not_found" }, { status: 404 }); });
  await denied.client.initialize(); await denied.client.recover(); assert.equal(calls, 1);
  assert.equal(denied.bytes.get(denied.key), denied.raw); assert.equal(denied.client.getSnapshot().result, null); assert.deepEqual(denied.removals, []);
  const corrupt = setup(async () => { throw Error("unexpected"); }); corrupt.bytes.set(corrupt.key, "invalid saved bytes"); await corrupt.client.initialize();
  assert.equal(corrupt.client.getSnapshot().phase, "blocked"); assert(!render(<PosthocWorkspace {...corrupt.props}/>).includes("此目标尚无可核对"));
  assert.equal(corrupt.bytes.get(corrupt.key), "invalid saved bytes"); assert.deepEqual(corrupt.removals, []);
});

test("pause and scope mismatch hide late receipt content while preserving the exact original intent", async () => {
  let release!: (response: Response) => void, requested!: () => void;
  const reached = new Promise<void>(resolve => { requested = resolve; });
  const h = setup(async () => { requested(); return new Promise<Response>(resolve => { release = resolve; }); });
  await h.client.initialize(); const recovering = h.client.recover(); await reached; h.client.pause();
  release(Response.json({ ok: true, canWrite: false, data: posthocUiSaved() })); await recovering;
  assert.equal(h.client.getSnapshot().result, null); assert.equal(h.bytes.get(h.key), h.raw); assert.deepEqual(h.removals, []);
  for (const patch of [{ active: false }, { workerId: id(208997) }, { slotId: id(208998) }]) {
    const html = render(<PosthocWorkspace {...h.props} {...patch}/>); assert(!html.includes(h.pending.command.operationId)); assert(!html.includes(h.pending.command.reason));
  }
});

test("ordinary workspace copy explains explicit formal refresh and does not claim the completed integration is missing", async () => {
  const h = setup(async () => { throw Error("SSR must not request"); }, false), html = render(<PosthocWorkspace {...h.props} recoveryOnly={false}/>);
  assert(html.includes("保存成功不等于结案")); assert(html.includes("明确重新读取正式依据并另行保存处理结论"));
  assert(!html.includes("接线尚未在本工作区完成")); assert(buttons(html).includes("读取本排班采用与当前候选"));
});

test("newer employee notes are independently visible without changing source-stale meaning or replacing the saved decision", () => {
  const reminder = "该决定之后有新的本人说明，尚待负责人再次处理；已读不会代替处理或周期确认。";
  for (const access of ["owner", "self"] as const) for (const truncated of [false, true]) {
    const data = posthocReviewWire({ access }), authUserId = access === "owner" ? base.actorId : base.worker.employeeAuthUserId;
    const parse = () => parsePlanExceptionResponse({ ok: true, moduleEnabled: true, data }, exceptionUiQuery(access), { authUserId });
    assert(!render(<PlanExceptionDetail result={parse()}/>).includes(reminder));
    const saved = structuredClone(data.detail!.latestDecision!), stale = data.detail!.stale;
    const notes = Array.from({ length: truncated ? 26 : 1 }, (_, index) => ({ operationId: id(208800 + index), revision: saved.revision + index + 1,
      actorId: base.worker.employeeAuthUserId, kind: "note" as const, outcome: null, note: "Synthetic subsequent employee explanation", decisionOperationId: saved.operationId, recordedAt: data.readAt })).reverse();
    data.detail!.revision = notes[0].revision;
    data.detail!.history = truncated ? notes.slice(0, 25) : [...notes, ...data.detail!.history]; data.detail!.historyTruncated = truncated;
    const value = parse(), html = render(<PlanExceptionDetail result={value}/>);
    assert(html.includes(reminder)); assert(html.includes(saved.note)); assert(html.includes(saved.operationId));
    assert.deepEqual(value.detail!.latestDecision, saved); assert.equal(value.detail!.stale, stale);
    if (access === "owner") { assert.equal(value.detail!.stale, false); assert(!html.includes("历史决定与当前依据已不同")); }
    data.detail!.latestDecision!.readAt = data.readAt;
    assert(render(<PlanExceptionDetail result={parse()}/>).includes(reminder));
  }
});
