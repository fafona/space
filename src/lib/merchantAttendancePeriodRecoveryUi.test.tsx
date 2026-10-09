import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import Panel,{KnownAttendanceRecoveryEntry,AttendanceRecoveryReceiptView} from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type {KnownPeriodRecovery,PeriodRecoveryReceipt} from "./merchantAttendancePeriodRecovery";
import type {AttendanceRecoveryReceipt} from "./merchantAttendanceRecovery";

const id=(n:number)=>`60000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const auth=id(1),siteId="99990001",stamp="2026-10-08T10:00:00.000001Z";
function entry(kind:KnownPeriodRecovery["kind"]):KnownPeriodRecovery{return{kind,siteId,authUserId:auth,operationId:id(2),commandFingerprint:"a".repeat(64),
  storageKey:`faolla:attendance:period-${kind==="period-closure"?"delegated-closure":"delegation"}:v1:PRIVATE_STORAGE_SCOPE_NOT_FOR_DISPLAY`};}
function receipt(kind:KnownPeriodRecovery["kind"],action:PeriodRecoveryReceipt["action"]):AttendanceRecoveryReceipt{return{kind,action,operationId:id(2),actorId:auth,
  grantId:id(3),grantRevision:action==="revoke"?2:1,periodId:kind==="period-closure"?id(4):null,periodRevision:kind==="period-closure"?101:null,recordedAt:stamp};}

test("recovery panel SSR stays local-inert and explains both new period formats without new authority",()=>{
  let reads=0,requests=0;const html=renderToStaticMarkup(<Panel authUserId={auth} isCurrentAuth={()=>true} apiFetch={async()=>{requests++;throw Error("No SSR HTTP");}}
    storage={()=>{reads++;throw Error("No SSR storage");}}/>);
  assert.equal(reads,0);assert.equal(requests,0);assert.match(html,/查找本标签页待确认编号/);assert.match(html,/周期/);
  assert.match(html,/不能登录或身份已换绑时/);assert.doesNotMatch(html,/data-attendance-recovery-kind|data-attendance-recovery-receipt|<textarea|<input|<form/);
});

test("two period entries expose only known operation/site, not fingerprints, storage scope or target data",()=>{
  for(const kind of ["period-delegation","period-closure"] as const){const html=renderToStaticMarkup(<KnownAttendanceRecoveryEntry entry={entry(kind)}/>);
    assert.match(html,new RegExp(`data-attendance-recovery-kind="${kind}"`));assert.match(html,new RegExp(siteId));assert.match(html,new RegExp(id(2)));
    assert.match(html,kind==="period-closure"?/受托周期原操作/:/周期授权／撤销原操作/);assert.match(html,/读取这个原编号/);
    assert.doesNotMatch(html,/PRIVATE_STORAGE_SCOPE|aaaaaaaaaaaaaaaa|faolla:attendance|<textarea|审批|确认本保存版本/);
    assert.doesNotMatch(html,new RegExp(auth));}
});

test("busy period entries are disabled and rendering never invokes recovery callback",()=>{
  let calls=0;const html=renderToStaticMarkup(<KnownAttendanceRecoveryEntry entry={entry("period-closure")} busy onRecover={()=>{calls++;}}/>);
  assert.match(html,/<button[^>]*disabled/);assert.equal(calls,0);
});

test("grant and revoke minimum receipts do not restore current permission or invent a period result",()=>{
  for(const action of ["grant","revoke"] as const){const html=renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={receipt("period-delegation",action)}/>);
    assert.match(html,action==="grant"?/已授予委托/:/已撤销委托/);assert.match(html,/不恢复周期查看或审批权限，也不代员工确认/);
    assert.match(html,new RegExp(id(2)));assert.match(html,new RegExp(auth));assert.match(html,new RegExp(stamp));
    assert.doesNotMatch(html,/原周期修订|<button|<textarea|<form/);assert.match(html,/不显示申请正文、理由或其他员工资料/);}
});

test("send respond seal reopen receipts label historical outcomes without offering employee actions or export",()=>{
  const labels={send:"已保存周期并送本人核对",respond:"已保存周期争议回复",seal:"已封存周期",reopen:"已重开周期"};
  for(const action of ["send","respond","seal","reopen"] as const){const html=renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={receipt("period-closure",action)}/>);
    assert.match(html,new RegExp(labels[action]));assert.match(html,/原周期修订 101/);assert.match(html,/只核对保存结果/);
    assert.match(html,/不恢复周期查看或审批权限，也不代员工确认/);assert.doesNotMatch(html,/<button|<textarea|<form|下载|打印|确认本保存版本/);
    assert.doesNotMatch(html,new RegExp(id(4)));assert.doesNotMatch(html,new RegExp(id(3)));}
});

test("receipt values stay escaped even if a rendering caller passes malicious text",()=>{
  const malicious={...receipt("period-closure","respond"),operationId:'<img src=x onerror="bad">',actorId:'<svg onload="bad">'};
  const html=renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={malicious}/>);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);assert.doesNotMatch(html,/<img|<svg|<script/);
});
