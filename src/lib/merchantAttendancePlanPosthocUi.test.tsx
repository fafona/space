import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Summary from "../components/enterprise/MerchantAttendancePlanPosthocSummary";
import type { PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

// Detached display values, not HTTP receipts or historical-identity proof. The
// production caller must supply a result accepted by the new strict parser.
function value(): PlanPosthocResult {
  const source = exceptionUiEligibleSource(), session = { kind: "session" as const, startEventId: id(700), lastEventId: id(701), lastSequence: 4, effectOperationId: id(702), effectRevision: 2 };
  const missing = { kind: "missing" as const, requestId: id(710), rootRequestId: id(709), approvalOperationId: id(711) };
  const operation = { operationId: id(720), revision: 1, action: "apply" as const, actorId: source.actorId, employeeId: source.worker.employeeId!, employeeAuthUserId: source.worker.employeeAuthUserId!,
    reason: "合成：逐项核对事后采用，不改打卡", sources: [session, missing], sourceFingerprint: "a".repeat(64), recordedAt: source.readAt };
  const candidates: NonNullable<PlanPosthocResult["preview"]>["candidates"] = [
      { reference: session, original: { startAt: "2026-10-08T08:02:00.000001Z", endAt: "2026-10-08T16:00:00.000009Z" },
        selected: { startAt: "2026-10-08T08:00:00.000003Z", endAt: "2026-10-08T16:00:00.000009Z" }, locationId: source.slot.locationId, timeZone: "Saved/Alias", available: false, blockers: ["approval_missing"], claim: null },
      { reference: missing, original: null, selected: { startAt: "2026-10-08T17:00:00.000004Z", endAt: "2026-10-08T18:00:00.000005Z" }, locationId: source.slot.locationId,
        timeZone: "Saved/Alias", available: false, blockers: ["claimed_elsewhere"], claim: { slotId: id(730), operationId: id(731), revision: 2 } },
    ];
  return { protocol: "plan-posthoc-adoption-v1", siteId: source.siteId, actorId: source.actorId, worker: source.worker, slot: source.slot, revision: 1,
    current: operation, history: [structuredClone(operation)], historyTruncated: false, receipt: null, readAt: source.readAt,
    preview: { fingerprint: "b".repeat(64), eligible: false, blockers: ["context_unknown"], approval: null, candidates,
      source: { protocol: "posthoc-adoption-preview-v1", basis: source.source, caseId: id(740), caseRevision: 1, revision: 1,
        currentOperationId: operation.operationId, candidates: structuredClone(candidates), approval: null, blockers: ["context_unknown"] } } };
}
test("unverified or pending caller values cannot render successful status, identifiers or saved reasons", () => {
  const data = value(), props = { verification: "unverified" as const, result: data, view: "saved" as const, pending: { command: { reason: "local secret draft", operationId: id(999) } } };
  const html = render(<Summary {...props}/>);
  assert.match(html, /操作结果尚未核验/); assert(!html.includes("已保存事后采用")); assert(!html.includes(data.current!.reason));
  for (const secret of [id(999), "local secret draft", data.slot.id, data.worker.employeeId!, data.current!.operationId]) assert(!html.includes(secret));
});
test("verified saved view displays apply/revoke references and reasons without stealing current candidate endpoints", () => {
  const data = value(); data.current = { ...data.current!, operationId: id(721), revision: 2, action: "revoke", sources: [], reason: "合成：撤销这份采用，不撤销批准" };
  data.history.unshift(structuredClone(data.current)); data.revision = 2;
  const html = render(<Summary verification="verified" result={data} view="saved"/>);
  for (const text of ["已保存事后采用", "已保存撤销采用", "不减少已记录工时", "不含历史端点快照", "当前来源和身份未在此重新评价"]) assert(html.includes(text), text);
  assert(html.includes(id(709))); assert(html.includes(id(702))); assert(html.includes(id(711)));
  assert(!html.includes("2026-10-08T08:02:00.000001Z")); assert(!html.includes("2026-10-08T17:00:00.000004Z"));
  assert(!html.includes("data-plan-posthoc-preview")); assert(!html.includes('type="submit"'));
});
test("current candidate view keeps original and selected endpoints distinct and missing has no fabricated original", () => {
  const html = render(<Summary verification="verified" result={value()} view="current"/>);
  for (const endpoint of ["2026-10-08T08:02:00.000001Z", "2026-10-08T08:00:00.000003Z", "2026-10-08T17:00:00.000004Z"]) assert(html.includes(endpoint));
  assert.equal((html.match(/data-plan-posthoc-original="true"|data-plan-posthoc-original=""/g) ?? []).length, 1);
  assert.match(html, /批准漏卡没有原始打卡端点/); assert.match(html, /当前不可采用或有未解决限制/);
  assert.match(html, /不是采用当时的端点快照/); assert.match(html, /approval_missing/); assert.match(html, /claimed_elsewhere/);
  assert.match(html, /已有采用占用/); assert(html.includes(id(730))); assert.match(html, /不自动迁移或拆分/);
});
test("available means a current selectable candidate, not new saved adoption or proven current applicability", () => {
  const data = value(); data.current = null; data.history = []; data.revision = 0;
  data.preview!.eligible = true; data.preview!.blockers = []; data.preview!.candidates[0].available = true; data.preview!.candidates[0].blockers = [];
  const html = render(<Summary verification="verified" result={data} view="current"/>);
  assert.match(html, /尚未因此保存采用/); assert.match(html, /仍须明确选择、理由及提交后重新核验/);
  assert.match(html, /不能单凭编号、姓名或当前绑定补造历史身份证明/); assert(!html.includes("已保存事后采用")); assert(!html.includes("已证明当前有效"));
});
test("source and history absence or truncation do not become zero attendance or a complete history claim", () => {
  const data = value(); data.current = null; data.history = []; data.historyTruncated = true; data.preview = null;
  const html = render(<Summary verification="verified" result={data} view="current"/>);
  assert.match(html, /不代表没有真实工作/); assert.match(html, /本次没有当前候选预览/); assert.match(html, /这里只返回部分历史/); assert.match(html, /本次没有返回历史操作/);
});
test("saved UTC microseconds and zone text render without today's timezone or clock calculation", () => {
  const original = Intl.DateTimeFormat;
  try { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: () => { throw Error("timezone recalculation forbidden"); } });
    const html = render(<Summary verification="verified" result={value()} view="current"/>);
    assert.match(html, /Saved\/Alias/); assert.match(html, /2026-10-08T16:00:00.000009Z/);
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: original }); }
});
test("bounded local pages disclose truncation while retaining full records outside the visible page", () => {
  const data = value(), base = data.history[0], candidate = data.preview!.candidates[0];
  data.history = Array.from({ length: 25 }, (_, n) => ({ ...base, operationId: id(1000 + n), revision: 25 - n, reason: `history-row-${n}` }));
  data.current = null; data.historyTruncated = true;
  data.preview!.candidates = Array.from({ length: 25 }, (_, n) => ({ ...candidate, locationId: id(2000 + n) }));
  const html = render(<Summary verification="verified" result={data} view="current"/>);
  assert.equal((html.match(/history-row-/g) ?? []).length, 10); assert(!html.includes("history-row-10"));
  assert.equal((html.match(/data-plan-posthoc-candidate=/g) ?? []).length, 10); assert.match(html, /采用候选本地分页/); assert.match(html, /采用历史本地分页/);
  assert.match(html, /本次返回 25 项/); assert.equal(data.history.length, 25); assert.equal(data.preview!.candidates.length, 25);
});
test("hostile reasons escape and the component has no network, storage, mutation or flag-hidden history path", () => {
  const data = value(); data.current!.reason = '<img src=x onerror="secret">';
  const html = render(<Summary verification="verified" result={data} view="saved"/>);
  assert(!html.includes("<img")); assert.match(html, /&lt;img/); assert.match(html, /min-w-0/); assert.match(html, /break-all/);
  const text = readFileSync(new URL("../components/enterprise/MerchantAttendancePlanPosthocSummary.tsx", import.meta.url), "utf8");
  for (const forbidden of ["fetch(", "localStorage", "sessionStorage", "setInterval", "process.env", "new Date", "Intl.", "onApply", "onRevoke", "type=\"submit\""]) assert(!text.includes(forbidden), forbidden);
});
