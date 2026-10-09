import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup as render} from "react-dom/server";
import Panel,{CorrectionDelegationGrantForm,CorrectionDelegationGrantView,CorrectionDelegationDetailView,CorrectionDelegationReceipt,
  emptyCorrectionGrantDraft,correctionDelegationReasonValid,correctionDelegationUtc,confirmCorrectionDelegation,correctionDelegationPorts} from "../components/enterprise/MerchantAttendanceCorrectionDelegationPanel";
import Launcher,{correctionDelegationLauncherIdentityValid,correctionDelegationLauncherVisible} from "../components/enterprise/MerchantAttendanceCorrectionDelegationLauncher";
import {KnownAttendanceRecoveryEntry,AttendanceRecoveryReceiptView} from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import {correctionDelegationId as id,correctionDelegationOwner as owner,correctionDelegationEmployee as employee,correctionDelegationAuth as auth,
  correctionDelegationGrant,correctionDelegationDetail,correctionDelegationCatalogItem,correctionDelegationQuery,correctionDelegationWire,correctionDelegationReadAt} from "./merchantAttendanceCorrectionDelegationTestFixtures";
const no=()=>{},siteId="99990001",choices={delegate:correctionDelegationCatalogItem("delegates"),worker:correctionDelegationCatalogItem("workers"),location:correctionDelegationCatalogItem("locations")};
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
test("initial owner and delegate SSR are local only, no automatic read or write",()=>{
  let requests=0;for(const access of ["owner","delegate"] as const){const html=render(<Panel siteId={siteId} access={access} actorId={access==="owner"?owner:employee} authUserId={access==="owner"?owner:auth} apiFetch={async()=>{requests++;throw Error("no");}} enabled onClose={no}/>);
    assert.match(html,access==="owner"?/首次补正审批委托管理/:/受托首次补正审批/);assert.doesNotMatch(html,/Synthetic worker|Synthetic requested correction/);
  }assert.equal(requests,0);
});
test("front flag defaults closed and launcher rejects owner employee-id substitution",()=>{
  assert.equal(correctionDelegationLauncherVisible(false,false,false),false);assert.equal(correctionDelegationLauncherVisible(false,true,false),true);
  assert.equal(correctionDelegationLauncherIdentityValid("owner",employee,auth),false);assert.equal(correctionDelegationLauncherIdentityValid("owner",owner,owner),true);
  assert.equal(correctionDelegationLauncherIdentityValid("delegate",employee,auth),true);assert.equal(correctionDelegationLauncherIdentityValid("delegate","bad",auth),false);
  assert.equal(render(<Launcher siteId={siteId} access="owner" actorId={owner} authUserId={owner} enabled={false} apiFetch={async()=>{throw Error("no");}}/>),"");
});
test("grant form defaults includePending false and requires explicit acknowledgment",()=>{
  const d={...emptyCorrectionGrantDraft(),from:"2026-10-08T10:00",until:"2026-10-09T10:00",reason:"Synthetic bounded grant"};assert.equal(d.includePending,false);
  const html=render(<CorrectionDelegationGrantForm choices={choices} draft={d} disabled={false} onDraft={no} onGrant={no}/>);
  assert.match(html,/aria-label="包含已有待审补正"[^>]*\/?>/);assert.doesNotMatch(html,/aria-label="包含已有待审补正"[^>]*checked/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>明确授予首次补正委托/);assert.match(html,/日期按 UTC，不是本机当地时区/);
});
test("only complete distinct catalog identities, increasing dates and acknowledged reason enable grant",()=>{
  const draft={...emptyCorrectionGrantDraft(),from:"2026-10-08T10:00",until:"2026-10-09T10:00",reason:"Synthetic",acknowledged:true};
  const valid=render(<CorrectionDelegationGrantForm choices={choices} draft={draft} disabled={false} onDraft={no} onGrant={no}/>);assert.doesNotMatch(valid,/<button[^>]*disabled=""[^>]*>明确授予首次补正委托/);
  for(const wrong of [{...choices,worker:null},{...choices,worker:{...choices.worker,employeeId:choices.delegate.employeeId}},{...choices,worker:{...choices.worker,employeeAuthUserId:choices.delegate.employeeAuthUserId}}]){
    assert.match(render(<CorrectionDelegationGrantForm choices={wrong} draft={draft} disabled={false} onDraft={no} onGrant={no}/>),/<button[^>]*disabled=""[^>]*>明确授予首次补正委托/);
  }
  assert.match(render(<CorrectionDelegationGrantForm choices={choices} draft={{...draft,until:draft.from}} disabled={false} onDraft={no} onGrant={no}/>),/<button[^>]*disabled=""[^>]*>明确授予首次补正委托/);
});
test("UTC input validates real calendar, requires explicit minute shape and never guesses local DST",()=>{
  assert.equal(correctionDelegationUtc("2026-10-25T02:30"),"2026-10-25T02:30:00.000000Z");
  for(const v of ["2026-02-30T10:00","2026-10-08","2026-10-08T10:00Z","2026-10-08T25:00","0000-01-01T00:00"])assert.throws(()=>correctionDelegationUtc(v));
});
test("grant reason 200 and correction review 500 are Unicode scalar bounded, no controls",()=>{
  assert.equal(correctionDelegationReasonValid("字".repeat(200)),true);assert.equal(correctionDelegationReasonValid("字".repeat(201)),false);
  assert.equal(correctionDelegationReasonValid("😀".repeat(500),500),true);assert.equal(correctionDelegationReasonValid("字".repeat(501),500),false);
  for(const v of [""," reason","reason ","two\nlines"])assert.equal(correctionDelegationReasonValid(v),false);
});
test("fresh detail displays original AND requested spans and paid/unpaid breaks without fabrication",()=>{
  const d=correctionDelegationDetail();d.original.breaks=[{startAt:"2026-10-03T08:20:00.000000Z",endAt:"2026-10-03T08:30:00.000000Z",paid:false}];d.proposal.breaks=[{startAt:"2026-10-03T08:22:00.000000Z",endAt:"2026-10-03T08:32:00.000000Z",paid:true}];
  const html=render(<CorrectionDelegationDetailView detail={d} disabled={false}/>);for(const value of ["原始完整记录","员工申请调整",d.original.endAt,d.proposal.endAt,d.original.breaks[0].startAt,d.proposal.breaks[0].startAt,"带薪","无薪","保存地点","版本 3"])assert(html.includes(value));
  assert.doesNotMatch(html,/连续修订批准|设置 PIN|代员工确认|原始事件 JSON/);
});
test("blocked detail cannot offer approval but exposes permitted reject plus bounded warning",()=>{
  const d={...correctionDelegationDetail(),blocked:true,blockers:["overlap_other_session"],canApprove:false,canReject:true};const html=render(<CorrectionDelegationDetailView detail={d} disabled={false}/>);
  assert.match(html,/存在阻批准条件/);assert.doesNotMatch(html,/明确批准受托补正/);assert.match(html,/明确驳回受托补正/);assert.match(html,/aria-label="受托补正审核理由"/);assert.match(html,/范围外或混合冲突只显示限制/);
});
test("owner can see safe revoke for saved active head even unusable; delegate and revoked head cannot",()=>{
  const g={...correctionDelegationGrant(),usable:false};assert.match(render(<CorrectionDelegationGrantView grant={g} owner disabled={false}/>),/明确撤销补正委托/);
  assert.doesNotMatch(render(<CorrectionDelegationGrantView grant={g} owner={false} disabled={false}/>),/明确撤销补正委托/);
  assert.doesNotMatch(render(<CorrectionDelegationGrantView grant={{...g,status:"revoked",revision:2}} owner disabled={false}/>),/明确撤销补正委托/);
});
test("minimal receipt displays persisted identifiers only, never resurrects detail or command reason",()=>{
  const result=correctionDelegationWire(correctionDelegationQuery("delegate","recover"));assert.equal(result.protocol,"delegated-corrections-v1");if(result.protocol!=="delegated-corrections-v1")throw Error("fixture");
  result.receipt={operationId:id(30),requestId:id(20),grantId:id(10),action:"approve",status:"approved",actorId:auth,recordedAt:correctionDelegationReadAt,commandFingerprint:"a".repeat(64)};
  const html=render(<CorrectionDelegationReceipt result={result}/>);assert.match(html,/已批准/);assert.match(html,/不恢复权限/);assert(html.includes(id(30)));assert.doesNotMatch(html,/Synthetic|原始完整记录|审核理由|a{64}/);
});
test("confirmation cancel, scope change during dialog and stale snapshot run no action",()=>{
  let calls=0,live=true;assert.equal(confirmCorrectionDelegation(()=>false,()=>true,()=>calls++),false);
  assert.equal(confirmCorrectionDelegation(()=>{live=false;return true;},()=>live,()=>calls++),false);assert.equal(calls,0);
  assert.equal(confirmCorrectionDelegation(()=>true,()=>true,()=>calls++),true);assert.equal(calls,1);
});
test("scope guarded ports reject reentrant storage and cancel late API response",async()=>{
  let live=true,writes=0;const ports=correctionDelegationPorts(async()=>{live=false;return Response.json({ignored:true});},()=>({getItem:()=>{live=false;return "secret";},setItem:()=>{writes++;},removeItem:()=>{writes++;}}),()=>live);
  assert.throws(()=>ports.storage().getItem("key"),/identity_changed/);assert.throws(()=>ports.storage().setItem("key","v"),/identity_changed/);assert.equal(writes,0);
  live=true;await assert.rejects(ports.apiFetch("/bounded",{method:"GET"}),/identity_changed/);
});
test("independent recovery row and receipt clearly identify correction without application body",()=>{
  const entry={kind:"correction" as const,storageKey:"ignored",siteId,access:"delegate" as const,anchorId:employee,authUserId:auth,operationId:id(30),commandFingerprint:"b".repeat(64)};
  const html=render(<KnownAttendanceRecoveryEntry entry={entry}/>)+render(<AttendanceRecoveryReceiptView receipt={{kind:"correction",operationId:id(30),grantId:id(10),requestId:id(20),actorId:auth,action:"reject",recordedAt:correctionDelegationReadAt}}/>);
  assert.match(html,/首次补正审批委托原操作/);assert.match(html,/读取这个原编号/);assert.match(html,/不显示申请正文/);assert.doesNotMatch(html,/补正审批委托原操作.{0,20}重新提交|b{64}/);
});
test("parent integration is independent Manager capability, actual Auth and distinct leave guard",()=>{
  const manager=read("../components/admin/MerchantEnterpriseManager.tsx"),start=manager.indexOf('{tab === "overview" && actor.type === "employee" && can(actor, "attendance.correction.review")');assert(start>0);
  const block=manager.slice(start,manager.indexOf("</>",start)>0?manager.indexOf("</>",start):start+1200).slice(0,1000);
  assert.match(block,/actorId=\{actor.id\} authUserId=\{periodDelegationAuthId\}/);assert.match(block,/registerLeaveGuard=\{registerCorrectionLeaveGuard\}/);assert.doesNotMatch(block,/attendance\.self\.view|selfWorkerId/);
  assert.match(manager,/correctionLeaveGuardRef\.current\?\.scope === attendanceLeaveScope/);
  const admin=read("../components/enterprise/MerchantAttendanceAdminPanel.tsx");assert.match(admin,/authUserId === ownerId && <CorrectionDelegationLauncher/);assert.match(admin,/registerChild\("correction-delegation"\)/);
});
test("render-time scope fences, hide clear, exact pending key and explicit actions remain wired",()=>{
  const panel=read("../components/enterprise/MerchantAttendanceCorrectionDelegationPanel.tsx"),launcher=read("../components/enterprise/MerchantAttendanceCorrectionDelegationLauncher.tsx");
  assert.match(panel,/live\.current\.fetch !== props\.apiFetch/);assert.match(panel,/client\.getSnapshot\(\) === snapshot/);assert.match(panel,/flushSync\(\(\) => \{ invalidate\(\); setShown\(false\)/);
  assert.match(panel,/visibilitychange/);assert.match(panel,/beforeunload/);assert.match(panel,/safeRevoke && access === "owner"/);assert.doesNotMatch(panel,/setInterval|client\.confirm\(|client\.export\(/);
  assert.match(launcher,/correctionDelegationPendingKey\(siteId, access, actorId\)/);assert.match(launcher,/maxWidth: "calc\(100vw - 1rem\)"/);
});
