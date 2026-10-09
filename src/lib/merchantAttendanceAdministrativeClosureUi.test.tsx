// Pure SSR and source-wiring checks, not browser, real Auth or SQL acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { AdministrativeClosureEvidence, AdministrativeClosureEntryView, AdministrativeClosureReceiptView } from "../components/enterprise/MerchantAttendanceAdministrativeClosurePanel";
import Launcher from "../components/enterprise/MerchantAttendanceAdministrativeClosureLauncher";
import { AttendanceRecoveryReceiptView, KnownAttendanceRecoveryEntry } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import { closureSite, closureOwner, closureSelf, closureId, closureSavedDetail, closureCandidate, closureReceiptResult, closureResult } from "./merchantAttendanceAdministrativeClosureTestFixtures";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
test("195 owner/self panels render inert and off still exposes saved read without a new closure button", () => {
  let calls = 0;
  for (const access of ["owner", "self"] as const) {
    const html = renderToStaticMarkup(<Panel siteId={closureSite} access={access} authUserId={access === "owner" ? closureOwner : closureSelf} enabled={false}
      apiFetch={async () => { calls++; throw Error("SSR must not request"); }} isCurrentAuth={() => true} onClose={() => {}}/>);
    assert.match(html, /读取已保存行政记录/); assert.match(html, /新的行政结案入口未开放/); assert.match(html, /不推算工时、工资或缺勤/);
    assert(!html.includes("确认行政结案")); assert(!html.includes("读取可核验人员")); assert(!html.includes("来源指纹")); assert.match(html, /min-w-0 max-w-full/);
  }
  assert.equal(calls, 0);
});
test("195 owner launcher remains reachable without rollout or local pending and exposes no writer on mount", () => {
  let requests = 0;
  const html = renderToStaticMarkup(<Launcher siteId={closureSite} access="owner" authUserId={closureOwner} enabled={false} apiFetch={async () => { requests++; throw Error("No network"); }}/ >);
  assert.match(html, /行政结案记录与原号核验/); assert(!html.includes("行政结案工作区")); assert.equal(requests, 0);
});
test("195 candidate and saved evidence distinguish raw tail, saved snapshot and administrative boundary", async () => {
  const candidate = renderToStaticMarkup(<AdministrativeClosureEvidence detail={closureCandidate()} mode="candidate"/>);
  assert.match(candidate, /提交时仍会再次核对/); assert.match(candidate, /最后真实事件/); assert.match(candidate, /clock_in/); assert(!candidate.includes("核验结束时刻"));
  const saved = renderToStaticMarkup(<AdministrativeClosureEvidence detail={await closureSavedDetail()} mode="detail"/>);
  assert.match(saved, /当时保存的行政依据/); assert.match(saved, /不是补造的打卡/); assert.match(saved, /不计为已核实工时/);
});
test("195 self disagreement remains visible after owner reply; all reasons are escaped, not injected", async () => {
  const d = await closureSavedDetail("owner", true); assert(d.currentEntry);
  const html = renderToStaticMarkup(<AdministrativeClosureEvidence detail={d} mode="detail"/>);
  assert.match(html, /负责人回复不会抹去异议/); assert.match(html, /本人异议/);
  const escaped = renderToStaticMarkup(<AdministrativeClosureEntryView entry={{ ...d.currentEntry, reason: '<script>private</script>' }}/>);
  assert(!escaped.includes("<script>")); assert.match(escaped, /&lt;script&gt;/);
});
test("195 receipt-only recovery never implies fresh source/write authority, and null never implies failure", async () => {
  const receipt = renderToStaticMarkup(<AdministrativeClosureReceiptView result={await closureReceiptResult()}/>); assert.match(receipt, /不是新操作授权/); assert(!receipt.includes("Synthetic verified"));
  const empty = renderToStaticMarkup(<AdministrativeClosureReceiptView result={closureResult({ kind: "receipt", receipt: null }, { siteId: closureSite, access: "owner", mode: "recover", operationId: closureId(100) })}/>);
  assert.match(empty, /不能据此认定失败/); assert.match(empty, /不会清除原编号/);
});
test("195 panel scope fence, hide and parent guard preserve pending; only deliberate reads and writes are called", () => {
  const text = source("../components/enterprise/MerchantAttendanceAdministrativeClosurePanel.tsx");
  assert.match(text, /liveMarker\.current = marker/); assert.match(text, /liveMarker\.current === marker/); assert.match(text, /mounted\.current &&/);
  assert.match(text, /registerLeaveGuard\?\.\(leave\)/); assert.match(text, /dirty\.current \|\| client\.hasLeaveRisk\(\)/);
  assert.match(text, /document\.hidden\) flushSync\(\(\) => \{ client\.pause\(\); clear\(\); \}\)/);
  assert.match(text, /else void client\.initialize\(\)/); assert.match(text, /mounted\.current = false; client\.pause\(\)/);
  assert(!text.includes("client.dispose()")); assert(!text.includes("removeItem")); assert.match(text, /parseCorrectionTimeInput\(currentDraft\.time, d\.frame\.timeZone\)/);
  assert.match(text, /verifiedEndAt <= state\.result\.readAt/); assert.match(text, /window\.confirm\("确认提交当前说明/);
});
test("195 independent self page validates real Auth and accepts only site, never claimed employee identity or active gate", () => {
  const page = source("../components/enterprise/MerchantAttendanceAdministrativeClosurePage.tsx"), route = source("../app/enterprise/attendance-administrative-closures/page.tsx");
  assert.match(page, /supabase\.auth\.getUser\(session\.access_token\)/); assert.match(page, /result\.data\.user\?\.id !== session\.user\.id/);
  assert.match(page, /access="self" authUserId=\{authUserId\}/); assert.match(page, /enabled=\{false\}/); assert.match(page, /site\.length === 8/);
  assert(!page.includes("localStorage")); assert(!page.includes("employeeId=")); assert(!page.includes("requireMerchantEnterpriseEntitlement")); assert.match(route, /No active membership/);
});
test("195 host entries stay separate from old lifecycle and parent draft/pending cannot be bypassed", () => {
  const admin = source("../components/enterprise/MerchantAttendanceAdminPanel.tsx"), self = source("../components/enterprise/MerchantAttendanceSelfPanel.tsx"), selector = source("../app/enterprise/EnterpriseSelectorClient.tsx");
  assert.match(admin, /authUserId === ownerId && <AdministrativeClosureLauncher/); assert.match(admin, /registerChild\("administrative-closure"\)/);
  const scope = admin.slice(admin.indexOf("<AdministrativeClosureLauncher"), admin.indexOf("<AdministrativeClosureLauncher") + 1100);
  assert.match(scope, /parentDraft\.current/); assert.match(scope, /childGuards\.current\.size/); assert.match(scope, /sessionStorage\.getItem\(client\.storageKey\) === null/);
  assert.match(self, /if \(!combinedOutageLeaveGuard\(\)\) return;[\s\S]{0,360}window\.location\.assign\("\/enterprise\/attendance-administrative-closures"\)/);
  assert.match(selector, /href="\/enterprise\/attendance-administrative-closures"/);
});
test("195 aggregate recovery labels new kind accurately without disclosing source or giving approval authority", async () => {
  const r = await closureReceiptResult(); assert(r.data.kind === "receipt" && r.data.receipt);
  const html = renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={{ kind: "administrative-closure", ...r.data.receipt }}/>);
  assert.match(html, /行政结案已保存/); assert.match(html, /不显示说明或员工来源/); assert(!html.includes("Synthetic verified"));
  const entry = renderToStaticMarkup(<KnownAttendanceRecoveryEntry entry={{ kind: "administrative-closure", storageKey: "synthetic", siteId: closureSite, authUserId: closureOwner, operationId: closureId(100), commandFingerprint: "a".repeat(64) }}/>);
  assert.match(entry, /行政结案／异议／回复原操作/); assert.match(entry, /读取这个原编号/);
});
