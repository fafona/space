import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Workspace, { PlanExceptionDetail, PlanExceptionOutcomeOptions, planExceptionOutcomeAllowed } from "../components/enterprise/MerchantAttendancePlanExceptionWorkspace";
import { EventNotificationSummary } from "../components/enterprise/MerchantAttendanceEventNotificationsPanel";
import { AttendancePlanExceptionClient, type PlanExceptionStorage } from "./merchantAttendancePlanExceptionClient";
import { parsePlanExceptionResponse } from "./merchantAttendancePlanExceptions";
import { parseEventNotificationsDetail } from "./merchantAttendanceEventNotifications";
import { posthocReviewSource, posthocReviewWire } from "../../scripts/fixtures/attendance-plan-posthoc-review-model";
import { exceptionUiId as id, exceptionUiQuery as query, exceptionUiSite as site, exceptionUiOwner as owner, exceptionUiEmployee as employee,
  exceptionUiAuth as auth, exceptionUiWorker as worker, exceptionUiSlot as slot } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { eventNotificationsDetail } from "../../scripts/fixtures/attendance-event-notifications-model";

const full = () => posthocReviewSource({ fullLeave: true });
function result(access: "owner" | "self" = "owner") {
  return parsePlanExceptionResponse({ ok: true, moduleEnabled: true, data: posthocReviewWire({ source: full(), access }) }, query(access), access === "owner" ? { ownerId: owner } : { employeeId: employee });
}
test("independent not-applicable option is off by default, requires full basis and never clears", () => {
  assert(!render(<PlanExceptionOutcomeOptions canConclude={false} canClear={false} clearanceEnabled/>).includes('value="not_applicable"'));
  assert.match(render(<PlanExceptionOutcomeOptions canConclude={false} canClear={false} clearanceEnabled posthocReviewEnabled/>), /value="not_applicable" disabled=""/);
  assert.match(render(<PlanExceptionOutcomeOptions canConclude={false} canClear={false} clearanceEnabled posthocReviewEnabled canNotApplicable/>), /value="not_applicable">/);
  assert(!planExceptionOutcomeAllowed("not_applicable", true, true, true, true, false));
  assert(!planExceptionOutcomeAllowed("not_applicable", true, true, true, false, true));
  assert(planExceptionOutcomeAllowed("not_applicable", false, false, false, true, true));
});
test("owner current and employee saved full leave display distinct not-applicable without claiming normal attendance", () => {
  for (const access of ["owner", "self"] as const) {
    const value = result(access), html = render(<PlanExceptionDetail result={value}/>);
    for (const text of ["本次迟到／早退不适用", "采用／撤销理由", "不是正常出勤或工资结论", "获批覆盖", "不改原始打卡"]) assert(html.includes(text), text);
    assert.equal((html.match(/整段获批请假，本项不适用/g) ?? []).length, 2);
    assert(!html.includes("依据不足，未作判断"));
    if (access === "self") { assert(html.includes("保存时的事后依据与请假边缘")); assert(html.includes("当前未重查")); assert(!html.includes("本次人工核对资料")); }
  }
});
test("React escapes saved reasons; no HTML injection and no SSR requests with either flag", () => {
  const value = structuredClone(result("self")), evidence = value.detail!.latestDecision!.evidence;
  assert.equal(evidence.policy, "owner-confirmed-plan-edges-posthoc-v3");
  if (evidence.policy !== "owner-confirmed-plan-edges-posthoc-v3") throw Error("fixture");
  evidence.evaluation.posthoc.current!.reason = '<img src=x onerror="bad()">';
  const html = render(<PlanExceptionDetail result={value}/>); assert(html.includes("&lt;img")); assert(!html.includes('<img src="x"'));
  let requests = 0;
  for (const posthocReviewEnabled of [false, true]) render(<Workspace siteId={site} access="owner" actorId={owner} enabled posthocReviewEnabled={posthocReviewEnabled} apiFetch={async () => { requests++; throw Error("unexpected"); }} onClose={() => {}}/>);
  assert.equal(requests, 0);
});
test("new notification type is existing-case only and renders narrow saved meaning", () => {
  const base = eventNotificationsDetail("plan_exception"); assert.equal(base.sourceCategory, "plan_exception");
  if (base.sourceCategory !== "plan_exception") throw Error("fixture");
  const raw = { ...base, sourceOperationId: id(207600), sourceRevision: 2, type: "not_applicable", summary: { ...base.summary, outcome: "not_applicable" } };
  const parsed = parseEventNotificationsDetail(raw), html = render(<EventNotificationSummary detail={parsed}/>);
  assert(html.includes("本次迟到／早退规则不适用")); assert(html.includes("当前来源未重新核查"));
  for (const patch of [{ sourceRevision: 1 }, { sourceOperationId: base.sourceId }, { type: "cleared" }, { summary: { ...raw.summary, outcome: "confirmed" } }]) assert.throws(() => parseEventNotificationsDetail({ ...raw, ...patch }));
});
function clientSetup(enabled: boolean | undefined, options: { source?: ReturnType<typeof full>; pending?: string; found?: boolean } = {}) {
  const values = new Map<string, string>(), calls: string[] = [], writes: string[] = [];
  const storage: PlanExceptionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push(value); }, removeItem: key => { values.delete(key); } };
  const client = new AttendancePlanExceptionClient({ siteId: site, access: "owner", actorId: owner, enabled: true, posthocReviewEnabled: enabled,
    storage: () => storage, operationId: () => id(207901), apiFetch: async (_url, init = {}) => {
      calls.push(init.method ?? "GET");
      if (init.method === "POST") throw Error("Synthetic response lost after explicit send");
      const recover = String(_url).includes("mode=recover"), data = posthocReviewWire({ source: options.source ?? full(), mode: recover ? "recover" : "detail", receipt: recover && options.found === true });
      return new Response(JSON.stringify({ ok: true, moduleEnabled: true, data }), { headers: { "content-type": "application/json" } });
    } });
  if (options.pending) values.set(client.storageKey, options.pending);
  return { client, values, calls, writes };
}
test("fresh v3 decisions cannot bypass the client flag through old outcomes; reads still work", async () => {
  for (const enabled of [undefined, false]) for (const outcome of ["not_applicable", "confirmed", "follow_up"] as const) {
    const x = clientSetup(enabled, { source: outcome === "not_applicable" ? full() : posthocReviewSource() });
    await x.client.initialize(); await x.client.detail(worker, slot); assert.equal(x.client.getSnapshot().phase, "ready");
    await x.client.decide(outcome, "explicit reason"); assert.deepEqual(x.calls, ["GET"]); assert.equal(x.writes.length, 0);
  }
});
test("enabled explicit not-applicable send retains only bounded original command after lost response", async () => {
  const x = clientSetup(true); await x.client.initialize(); await x.client.detail(worker, slot); await x.client.decide("not_applicable", "explicit reason");
  assert.deepEqual(x.calls, ["GET", "POST"]); assert.equal(x.client.getSnapshot().phase, "unconfirmed");
  assert.equal(x.writes.length, 1); const raw = x.values.get(x.client.storageKey)!; assert.equal(JSON.parse(raw).command.outcome, "not_applicable");
  for (const text of ["leaveEdges", "observations", "sessions", "candidate"]) assert(!raw.includes(text));
  const paused = clientSetup(false, { pending: raw }); await paused.client.initialize(); await paused.client.retry();
  assert.deepEqual(paused.calls, ["GET"]); assert.equal(paused.values.get(paused.client.storageKey), raw);
});
test("existing v3 original receipt recovers after flag off without repost or discard", async () => {
  const wire = posthocReviewWire({ source: full(), mode: "recover", receipt: true }), command = wire.receipt!.command;
  const raw = JSON.stringify({ version: 1, actorId: owner, employeeId: employee, employeeAuthUserId: auth, query: query("owner", "decide", command.operationId), command });
  const x = clientSetup(false, { pending: raw, found: true }); await x.client.initialize(); await x.client.retry();
  assert.deepEqual(x.calls, ["GET"]); assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.values.get(x.client.storageKey), undefined);
});
