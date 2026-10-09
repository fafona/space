// SOURCE/SSR and legal synthetic wire only. No browser, SQL, real Auth or HTTP.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { CycleIntentPreparationView, CycleIntentReceiptView, cycleIntentPanelCommand, confirmCycleIntentAction,
  cycleIntentSharedPeriodKey, cycleIntentPeriodSlotBusy, cycleIntentCanOpenSend, cycleIntentCompositeLeave, cycleIntentDelegateScopeKey } from "./MerchantAttendanceCycleIntentPanel";
import Launcher from "./MerchantAttendanceCycleIntentLauncher";
import { parseCycleIntentResult } from "../../lib/merchantAttendanceCycleIntentResult";
import { cycleModel, cycleOwner, cycleId } from "../../../scripts/fixtures/attendance-cycle-intent-model";
import { periodClosurePendingKey } from "../../lib/merchantAttendancePeriodClosureClient";
import { periodDelegatedClosurePendingKey } from "../../lib/merchantAttendancePeriodDelegatedClosureClient";
import type { CycleIntentResult } from "../../lib/merchantAttendanceCycleIntentResult";
const no = () => {}, scope = { siteId: "99990001", access: "owner" as const, workerId: cycleId(2), grantId: null };
const panelSource = readFileSync(new URL("./MerchantAttendanceCycleIntentPanel.tsx", import.meta.url), "utf8");
const launcherSource = readFileSync(new URL("./MerchantAttendanceCycleIntentLauncher.tsx", import.meta.url), "utf8");
test("200 owner/delegate SSR exposes only explicit intent operations, no initial network or automatic send", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected HTTP"); };
  for (const access of ["owner", "delegate"] as const) {
    const html = render(<Panel scope={{ ...scope, access, grantId: access === "owner" ? null : cycleId(20) }} actorId={cycleOwner} apiFetch={apiFetch} isCurrentAuth={() => true} onClose={no}/>);
    assert.match(html, /周期采用意向/); assert.match(html, /首次送审须显式打开独立工作区/); assert.match(html, /读取本地状态（不联网）/);
    assert.match(html, /仅 GET 核验原编号/); assert.match(html, /取消未关联意向/); assert(!html.includes("data-cycle-preparation"));
    assert(!html.includes("data-cycle-detail")); assert(!html.includes("data-cycle-list"));
    assert(!/>(?:送审|生成工时表|自动采用)<\/button>/.test(html));
  }
  assert.equal(calls, 0);
});
test("200 lazy launcher has no initial Panel or network; inactive/invalidated Auth renders nothing", () => {
  let calls = 0; const props = { scope, actorId: cycleOwner, apiFetch: async () => { calls++; throw Error("no HTTP"); } };
  const html = render(<Launcher {...props} isCurrentAuth={() => true}/>); assert.match(html, /周期采用意向/); assert(!html.includes("<dialog")); assert(!html.includes("周期参考日期"));
  assert.equal(render(<Launcher {...props}/>), ""); assert.equal(render(<Panel {...props} onClose={no}/>), "");
  const invalidated = () => { throw Error("Auth check failed"); };
  assert.equal(render(<Launcher {...props} isCurrentAuth={invalidated}/>), ""); assert.equal(render(<Panel {...props} isCurrentAuth={invalidated} onClose={no}/>), "");
  assert.equal(render(<Launcher {...props} active={false}/>), ""); assert.equal(render(<Launcher {...props} isCurrentAuth={() => false}/>), "");
  assert.equal(render(<Panel {...props} isCurrentAuth={() => false} onClose={no}/>), ""); assert.equal(calls, 0);
});
test("200 exact accept command uses verified saved source and both CASes, never caller-edited dates", async () => {
  const f = await cycleModel(), q = { ...f.scope, mode: "prepare" as const, anchorDate: f.command.anchorDate };
  const result = await parseCycleIntentResult(f.result({ kind: "preparation", source: f.source, anchorDate: q.anchorDate,
    activation: { revision: 1, active: true }, frameHead: { revision: 0, lastOperationId: null } }), q, cycleOwner, null, "sql");
  assert.equal(result.data.kind, "preparation"); if (result.data.kind !== "preparation") throw Error();
  const prepared = result.data;
  const before = structuredClone(prepared), pair = cycleIntentPanelCommand(f.scope, prepared, "accept", "明确采用，不送审", cycleId(80));
  assert.equal(pair.query.mode, "detail"); assert.equal(pair.command.action, "accept"); if (pair.command.action !== "accept") throw Error();
  assert.equal(pair.command.intentId, cycleId(80)); assert.equal(pair.command.operationId, pair.command.intentId);
  assert.equal(pair.command.fromDate, result.data.preparation.range!.fromDate); assert.equal(pair.command.throughDate, result.data.preparation.range!.throughDate);
  assert.equal(pair.command.expectedPreparationFingerprint, result.data.preparation.preparationFingerprint);
  assert.equal(pair.command.expectedWorkerVersion, f.source.workerIdentity.workerVersion); assert.equal(pair.command.expectedEmployeeVersion, f.source.workerIdentity.employeeVersion);
  assert.equal(pair.command.expectedFrameRevision, 0); assert.equal(pair.command.expectedFrameHeadOperationId, null); assert.deepEqual(result.data, before);
  assert.throws(() => cycleIntentPanelCommand(f.scope, { ...prepared, frameHead: null }, "accept", "reason", cycleId(81)));
  assert.throws(() => cycleIntentPanelCommand(f.scope, { ...prepared, preparation: { ...prepared.preparation, state: "consumer_disabled", range: null } }, "accept", "reason", cycleId(81)));
  const html = render(<CycleIntentPreparationView data={result.data}/>); assert.match(html, /民事日/); assert.match(html, /不是已采用、已送审/);
});
test("200 cancel requires newly read original accept head and retains original intent fingerprint", async () => {
  const f = await cycleModel(), result = await parseCycleIntentResult(f.result({ kind: "detail", intent: f.intent, head: f.receipt }), f.query, cycleOwner);
  if (result.data.kind !== "detail") throw Error(); const detail = result.data, pair = cycleIntentPanelCommand(f.scope, detail, "cancel", "取消未关联意向", cycleId(81));
  assert.equal(pair.command.action, "cancel"); if (pair.command.action !== "cancel") throw Error();
  assert.equal(pair.command.expectedHeadOperationId, f.receipt.operationId); assert.equal(pair.command.expectedRevision, 1);
  assert.equal(pair.command.expectedIntentFingerprint, f.intent.intentFingerprint);
  assert.throws(() => cycleIntentPanelCommand(f.scope, { ...detail, head: { ...detail.head, action: "cancel", revision: 2 } }, "cancel", "reason", cycleId(82)));
  const receipt = render(<CycleIntentReceiptView receipt={f.receipt}/>); assert.match(receipt, /请重新读取当前详情/); assert(!receipt.includes("采用成功并已送审"));
});
test("200 native confirm must recheck live authority/epoch immediately after confirmation", () => {
  let sends = 0, live = true;
  assert.equal(confirmCycleIntentAction(() => false, () => true, () => sends++), false);
  assert.equal(confirmCycleIntentAction(() => { live = false; return true; }, () => live, () => sends++), false); assert.equal(sends, 0);
  assert.equal(confirmCycleIntentAction(() => true, () => true, () => sends++), true); assert.equal(sends, 1);
});
test("200 parent shares the original period slot; every nonnull format is busy and retained", () => {
  const ownerKey = cycleIntentSharedPeriodKey(scope, cycleOwner); assert.equal(ownerKey, periodClosurePendingKey(scope.siteId, "owner", cycleOwner));
  const d = { siteId: scope.siteId, actorEmployeeId: cycleId(60), expectedAuthUserId: cycleOwner, grantId: cycleId(20), workerId: scope.workerId,
    targetEmployeeId: cycleId(61), targetAuthUserId: cycleId(62), authorizedFromDate: "2026-10-01", authorizedThroughDate: "2026-10-31" };
  const delegated = { ...scope, access: "delegate" as const, grantId: d.grantId };
  const key = cycleIntentSharedPeriodKey(delegated, cycleOwner, d); assert.equal(key, periodDelegatedClosurePendingKey(d));
  assert.equal(cycleIntentSharedPeriodKey(delegated, cycleOwner), null);
  for (const patch of [{ workerId: cycleId(98) }, { grantId: cycleId(98) }, { expectedAuthUserId: cycleId(98) }, { extra: true }])
    assert.equal(cycleIntentSharedPeriodKey(delegated, cycleOwner, { ...d, ...patch }), null);
  assert.equal(cycleIntentSharedPeriodKey(scope, cycleOwner, d), null);
  for (const raw of ["", "null", "{", '{"format":1}', '{"format":2}', '{"format":3,"kind":"operational_cycle"}', '{"format":99}']) {
    let reads = 0; assert.equal(cycleIntentPeriodSlotBusy(key, { getItem(k) { reads++; assert.equal(k, key); return raw; } }), true); assert.equal(reads, 1);
  }
  assert.equal(cycleIntentPeriodSlotBusy(key, { getItem: () => null }), false);
  assert.equal(cycleIntentPeriodSlotBusy(key, { getItem() { throw Error("unavailable"); } }), true);
  assert.equal(cycleIntentPeriodSlotBusy(null, { getItem() { throw Error("must not read unknown key"); } }), true);
  assert.notEqual(cycleIntentDelegateScopeKey(d), cycleIntentDelegateScopeKey({ ...d, authorizedThroughDate: "2026-10-30" }));
});
test("200 send child requires actual scope; linked head remains readable for original-number recovery only", async () => {
  const f = await cycleModel(), detail = await parseCycleIntentResult(f.result({ kind: "detail", intent: f.intent, head: f.receipt }), f.query, cycleOwner);
  assert.equal(cycleIntentCanOpenSend(detail, f.scope, cycleOwner), true);
  assert.equal(cycleIntentCanOpenSend(detail, f.scope, cycleId(99)), false);
  assert.equal(cycleIntentCanOpenSend(detail, { ...f.scope, workerId: cycleId(99) }, cycleOwner), false);
  if (detail.data.kind !== "detail") throw Error();
  // UI binder-only variants: these are not asserted to be SQL/parsed grants.
  const d = { siteId: f.scope.siteId, actorEmployeeId: cycleId(60), expectedAuthUserId: cycleOwner, grantId: cycleId(20), workerId: f.scope.workerId,
    targetEmployeeId: f.intent.employeeId, targetAuthUserId: f.intent.employeeAuthUserId, authorizedFromDate: "2026-10-01", authorizedThroughDate: "2026-10-31" };
  const delegated = { ...f.scope, access: "delegate" as const, grantId: d.grantId };
  const v = { ...detail, data: { ...detail.data, intent: { ...detail.data.intent, access: "delegate", grantId: d.grantId } } } as CycleIntentResult;
  assert.equal(cycleIntentCanOpenSend(v, delegated, cycleOwner, d), true); assert.equal(cycleIntentCanOpenSend(v, delegated, cycleOwner), false);
  for (const patch of [{ targetEmployeeId: cycleId(99) }, { targetAuthUserId: cycleId(99) }, { authorizedFromDate: "2026-10-06" }, { authorizedThroughDate: "2026-10-10" }])
    assert.equal(cycleIntentCanOpenSend(v, delegated, cycleOwner, { ...d, ...patch }), false);
  const linked = { ...detail, data: { ...detail.data, head: { ...detail.data.head, action: "link", revision: 2, periodId: cycleId(98), sendOperationId: cycleId(99) } } } as CycleIntentResult;
  assert.equal(cycleIntentCanOpenSend(linked, f.scope, cycleOwner), true);
});
test("200 one fixed parent guard respects child veto and does not reconfirm the child's shared period slot", () => {
  let prompts = 0, childCalls = 0; const yes = () => { prompts++; return true; };
  assert.equal(cycleIntentCompositeLeave(() => { childCalls++; return false; }, () => true, () => true, yes), false);
  assert.equal(prompts, 0); assert.equal(childCalls, 1);
  assert.equal(cycleIntentCompositeLeave(() => true, () => false, () => true, yes), true); assert.equal(prompts, 0);
  assert.equal(cycleIntentCompositeLeave(null, () => false, () => true, yes), true); assert.equal(prompts, 1);
  assert.equal(cycleIntentCompositeLeave(() => true, () => true, () => true, () => false), false);
});
test("200 SOURCE sync scope invalidation, hidden clearing, original GET-only recovery and frozen pagination remain explicit", () => {
  for (const token of ["marker.access !== s.access", "marker.workerId !== s.workerId", "marker.grantId !== s.grantId", "marker.actorId !== props.actorId",
    "marker.apiFetch !== props.apiFetch", "marker.isCurrentAuth !== props.isCurrentAuth", "marker.enabled !== props.enabled", "return null", "mounted.current && visible.current && !document.hidden",
    'document.addEventListener("visibilitychange", visibility)', 'window.addEventListener("pagehide", pause)', "epoch.current++; client.pause()", "setPending(null); setBlocked(true)",
    "registerLeaveGuard?.(mayLeave)", "working.current || stored() || dirty()", "await client.load()", "await client.read(query)", "await client.recover()", "await client.post(pair.query, pair.command)",
    "只能按保存的原范围核验，不重发 POST", "const lock = busy || blocked", "current() && token === epoch.current", "cursor: result.nextCursor", "每页最多 25 条"])
    assert(panelSource.includes(token), token);
  assert(!panelSource.includes("removeItem(")); assert(!panelSource.includes("setInterval(")); assert(!panelSource.includes("JSON.stringify(data)"));
  assert(launcherSource.includes('lazy(() => import("./MerchantAttendanceCycleIntentPanel"))')); assert(launcherSource.includes("(!beforeOpen || beforeOpen())"));
  assert(launcherSource.includes("else if (!element.open) element.showModal()")); assert(launcherSource.includes('maxWidth: "calc(100vw - 1rem)"'));
  for (const token of ["marker.delegateScopeKey !== delegateScopeKey", "periodStored()", "!latest.current.sendDetail", "setSendDetail(null)",
    'lazy(() => import("./MerchantAttendanceCycleSendPanel"))', "if (sendDetail) return", "registerLeaveGuard={registerSendGuard}", "pauseClient(); clear(); setSendDetail(null)", "disabled={lock || periodBusy}"])
    assert(panelSource.includes(token), token);
  assert(launcherSource.includes("outerRegister?.(leave)")); assert(launcherSource.includes("guard.current = value; }, []"));
  assert(!launcherSource.includes("outerRegister?.(value)")); assert(launcherSource.includes("d.authorizedFromDate, d.authorizedThroughDate"));
  assert(launcherSource.includes("marker.fetch !== props.apiFetch")); assert(launcherSource.includes("marker.auth !== props.isCurrentAuth"));
});
test("200 actual owner host uses worker row, actual Auth and independent timesheet_cycle activation with parent guards", () => {
  const text = readFileSync(new URL("./MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  for (const token of ['NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED === "1"', 'consumer="timesheet_cycle"', 'registerChild("timesheet-cycle-activation")',
    'authUserId === ownerId && isCurrentAuth && <CycleIntentLauncher', 'scope={{ siteId, access: "owner", workerId: item.id, grantId: null }} actorId={authUserId}',
    'registerChild(`cycle-worker:${item.id}`)', 'isCurrentAuth={cycleAuthCurrent}', '!cycleAuthCurrent()', 'client.getSnapshot().phase !== "ready"',
    'parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size', 'window.sessionStorage.getItem(client.storageKey) === null']) assert(text.includes(token), token);
  assert(!text.includes("AttendanceCycleSendClient")); assert(!text.includes("cycleSendCommandFingerprint("));
});
