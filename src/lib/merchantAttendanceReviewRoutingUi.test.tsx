import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel,{ReviewRoutingEntryView} from "../components/enterprise/MerchantAttendanceReviewRoutingPanel";
import Launcher from "../components/enterprise/MerchantAttendanceReviewRoutingLauncher";
import Self from "../components/enterprise/MerchantAttendanceReviewRoutingSelf";
import { KnownAttendanceRecoveryEntry,AttendanceRecoveryReceiptView } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import { routingSite,routingOwner,routingDetail,routingReceipt } from "../../scripts/fixtures/attendance-review-routing-model";
import { readWorkArrangementSelectedDetail } from "../components/enterprise/MerchantAttendanceWorkArrangementPanel";
import { AttendanceWorkArrangementClient } from "./merchantAttendanceWorkArrangementClient";
import { workArrangementHttp,workArrangementDetail,workArrangementOwner,workArrangementId } from "../../scripts/fixtures/attendance-work-arrangement-model";
test("198 owner launcher and panel initially perform no HTTP and expose explicit controls",()=>{let calls=0;const props={siteId:routingSite,authUserId:routingOwner,apiFetch:async()=>{calls++;throw Error();},enabled:false,onClose:()=>{}};const launcher=renderToStaticMarkup(<Launcher {...props}/>);assert.match(launcher,/办理责任/);const panel=renderToStaticMarkup(<Panel {...props}/>);assert.match(panel,/读取办理责任列表/);assert.match(panel,/读取指定申请办理详情/);assert.doesNotMatch(panel,/确认登记所选办理人/);assert.equal(calls,0);});
test("198 self initial render exposes only explicit read and no delegate/material IDs",()=>{const f=routingDetail();let calls=0;const markup=renderToStaticMarkup(<Self siteId={routingSite} authUserId={f.request.employeeAuthUserId} family={f.request.family} requestId={f.request.requestId} apiFetch={async()=>{calls++;throw Error();}}/>);assert.match(markup,/读取办理去向/);assert.doesNotMatch(markup,/grantId|delegateAuthUserId|canApprove/);assert.equal(calls,0);});
test("198 saved responsibility and minimal recovery receipt are labelled without approval grant",()=>{const f=routingDetail();assert.ok(f.current);const markup=renderToStaticMarkup(<ReviewRoutingEntryView entry={f.current}/>);assert.match(markup,/提交时固定/);const receipt={kind:"review-routing" as const,...routingReceipt()};const r=renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={receipt}/>);assert.match(r,/办理责任已登记/);assert.match(r,/不恢复当前审批权限/);assert.doesNotMatch(r,/明确登记 😀/);const e=renderToStaticMarkup(<KnownAttendanceRecoveryEntry entry={{kind:"review-routing",storageKey:"synthetic",siteId:routingSite,authUserId:routingOwner,family:"correction",operationId:receipt.operationId,commandFingerprint:receipt.commandFingerprint}}/>);assert.match(e,/办理责任登记／接手原操作/);});
test("198 original work target initializes idle then performs exactly one fresh detail GET; blocked/pending/auth-change perform none",async()=>{
  const selected=workArrangementDetail("owner"),query={siteId:routingSite,access:"owner" as const,requestId:selected.requestId,operationId:null,beforeAt:null,beforeId:null,preview:null};
  const pending=JSON.stringify({version:1,anchorId:workArrangementOwner,actorId:workArrangementOwner,employeeId:null,query,
    command:{action:"reject",operationId:workArrangementId(55),requestId:selected.requestId,expectedRevision:1,reason:"Synthetic pending"}});
  for(const [raw,outcome,reads] of [[null,"read",1],["malformed","blocked",0],[pending,"blocked",0]] as const){
    const calls:Array<{url:string;method:string|undefined}>=[],client=new AttendanceWorkArrangementClient({siteId:routingSite,access:"owner",actorId:workArrangementOwner,enabled:true,
      storage:()=>({getItem:()=>raw,setItem:()=>{throw Error("no write");},removeItem:()=>{throw Error("no remove");}}),apiFetch:async(url,init)=>{calls.push({url,method:init?.method});
        const response=workArrangementHttp("owner");response.detail=selected;return new Response(JSON.stringify(response),{headers:{"Content-Type":"application/json"}});}});
    assert.equal(await readWorkArrangementSelectedDetail(client,selected.requestId,()=>true),outcome);assert.equal(calls.length,reads);
    if(reads){assert.equal(calls[0].method,"GET");assert.equal(new URL(calls[0].url,"https://fixture.invalid").searchParams.get("requestId"),selected.requestId);assert.equal(client.getSnapshot().result?.detail?.requestId,selected.requestId);}
  }
  let calls=0;const stale=new AttendanceWorkArrangementClient({siteId:routingSite,access:"owner",actorId:workArrangementOwner,enabled:true,storage:()=>({getItem:()=>null,setItem:()=>{},removeItem:()=>{}}),apiFetch:async()=>{calls++;throw Error();}});
  assert.equal(await readWorkArrangementSelectedDetail(stale,selected.requestId,()=>false),"stale");assert.equal(calls,0);
});
