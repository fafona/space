import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const review=read("src/components/enterprise/MerchantAttendanceCorrectionReviewPanel.tsx");
const panel=read("src/components/enterprise/MerchantAttendanceCorrectionDecisionPanel.tsx");
const client=read("src/lib/merchantAttendanceCorrectionDecisionClient.ts");
test("decision UI is separate lazy opt-in with both request entry and owner-wide recovery entry",()=>{
  assert.match(review,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DECISIONS_ENABLED === "1"/);
  assert.match(review,/lazy\(\(\)=>import\("\.\/MerchantAttendanceCorrectionDecisionPanel"\)\)/);
  assert.match(review,/decisionsEnabled&&decisionTarget!==undefined/);
  assert.match(review,/openDecision\(null\)/);assert.match(review,/openDecision\(r.item.requestId\)/);
  assert.match(review,/ownerId=\{ownerId\}/);assert.match(review,/decision=\{result.decision\} decisionContext/);
  assert.doesNotMatch(review,/method:\s*"POST"/);
});
test("approval is never preselected and both intent edits reset explicit acknowledgement",()=>{
  assert.match(panel,/useState<""\|"approve"\|"reject">\(""\)/);
  assert.match(panel,/setAction\(e.target.value as typeof action\);setAck\(false\)/);
  assert.match(panel,/setReason\(e.target.value\);setAck\(false\)/);
  assert.match(panel,/!disabled&&action&&ack&&permitted&&validReason/);
  for(const text of ["不默认批准","员工可见","当前不支持撤销审批决定","原始打卡","周期报表","工资","先查收据，再用原编号重试"])assert.ok(panel.includes(text));
  assert.match(read("src/lib/merchantAttendanceCorrectionRules.ts"),/未作决定的申请可按当前权限撤回/);
});
test("hidden/unmounted screen drops sensitive preview, warns on drafts/pending, and restores by GET",()=>{
  for(const text of ["visibilitychange","beforeunload","client.pause()","client.hasLeaveRisk()","window.sessionStorage","leaveDraft()"])assert.ok(panel.includes(text));
  assert.match(panel,/setDirty\(false\);if\(document.visibilityState==="hidden"\)client.pause\(\);else void restore\(!initializedRef.current\)/);
  assert.match(panel,/key=\{`\$\{props.siteId\}:\$\{props.ownerId\}`\}/);
  assert.doesNotMatch(panel,/localStorage|setInterval|navigator.geolocation|dangerouslySetInnerHTML/);
});
test("first hidden mount keeps the initial target until visible and isolates stale initialization",()=>{
  assert.match(panel,/let active=true;initializedRef.current=false/);
  assert.match(panel,/await client.initialize\(first\?initialRequestId:undefined\);if\(active\)initializedRef.current=true/);
  assert.match(panel,/if\(document.visibilityState!=="hidden"\)void restore\(true\)/);
  assert.match(panel,/return\(\)=>\{active=false;document.removeEventListener\("visibilitychange",visible\);client.pause\(\);\}/);
});
test("outer leave guard shares close confirmations, rejects without pausing and never clears original intent",()=>{
  const guard=panel.slice(panel.indexOf("const leavePanel="),panel.indexOf("const leaveDraft="));
  assert.match(panel,/registerLeaveGuard\?:\(guard:\(\(\)=>boolean\)\|null\)=>void/);
  assert.match(guard,/if\(dirty&&!window.confirm\([^\n]+\)\)return false/);
  assert.match(guard,/if\(client.hasLeaveRisk\(\)&&!window.confirm\([^\n]+\)\)return false/);
  assert.match(guard,/client.pause\(\);return true/);
  assert.match(guard,/registerLeaveGuard\?\.\(leavePanel\);return\(\)=>registerLeaveGuard\?\.\(null\)/);
  assert.match(panel,/if\(leavePanel\(\)\)onClose\(\)/);
  assert.doesNotMatch(guard,/setDirty|removeItem|initialize|submit|retry/);
});
test("pending contains exact command only, bounded response/deadline and no automatic POST on initialize",()=>{
  assert.match(client,/raw.length>8192/);assert.match(client,/maxBytes:262144/);
  assert.match(client,/"command,ownerId,siteId"/);assert.match(client,/pending\?\.command.requestId/);
  assert.match(client,/private samePending\(\)/);assert.match(client,/this.options.storage\(\).setItem\(this.storageKey,raw\)/);
  const initialize=client.slice(client.indexOf("initialize=async"),client.indexOf("submit=async"));
  assert.match(initialize,/await this.request\(null,false\)/);assert.doesNotMatch(initialize,/"POST"|this.request\(.*command/);
  assert.doesNotMatch(client,/setInterval|localStorage|sendBeacon/);
});
test("uncertain transient evidence changes cannot clear intent, only exact receipt or permanent fence",()=>{
  assert.match(client,/correctionDecisionReceiptMatches\(p.command,result.receipt\)/);
  assert.match(client,/result.decision.operationId!==p.command.operationId/);
  assert.match(client,/result.review.item.revision>p.command.expectedRevision/);
  assert.match(client,/\["attendance_version_conflict","attendance_correction_decided"\]\.includes/);
  assert.doesNotMatch(client,/\[.*"attendance_correction_evidence_changed".*\]\.includes/);
});
test("browser checks only own loopback harness and existing isolated Chromium contexts",()=>{
  const browser=read("scripts/merchant-attendance-correction-decision-browser-check.mjs");
  assert.match(browser,/chromium.launch\(\{headless:true\}\)/);assert.match(browser,/new URL\(route.request\(\).url\(\)\).origin!==origin/);
  assert.match(browser,/finally\{await context.close\(\);\}/);assert.match(browser,/await browser\?\.close\(\)/);assert.match(browser,/child.kill\(\)/);
  assert.doesNotMatch(browser,/launchPersistentContext|storageState|process.env|\.env|tracing.start|recordVideo/);
});
test("history/current source cards are distinct, responsive and cannot relabel rejection as approval",()=>{
  for(const text of ["本次审批结果","当前有效工时","decisionEffect","current.lineage.rootRequestId!==r.review.item.requestId","md:grid-cols-2","不代表工资结算","不是周期截取合计"])assert(panel.includes(text));
  assert(!panel.includes("r.effective"));assert(review.includes('NEXT_PUBLIC_FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED === "1"'));
  assert(client.includes('parseCurrentCorrectionResponse(raw,q)'));assert(client.includes('faolla:attendance:correction-decision:v1:'));
  assert(client.includes('!command&&(result.effectiveChanged||result.receipt&&!result.replayed)'));
});
