import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Workspace,{PeriodDelegatedClosurePages,PeriodDelegatedClosureCandidate,periodDelegatedClosureControls,
  periodDelegatedClosurePorts,confirmPeriodDelegatedClosureAction,type PeriodDelegatedClosureWorkspaceProps} from "../components/enterprise/MerchantAttendancePeriodDelegatedClosureWorkspace";
import type { PeriodDelegatedClosureClientState,PeriodDelegatedClosureView } from "./merchantAttendancePeriodDelegatedClosureClient";
import type { PeriodDelegatedClosureQuery } from "./merchantAttendancePeriodDelegatedClosure";
import type { PeriodDelegatedArtifactDraft } from "./merchantAttendancePeriodClosure";
import type { AttendanceTimesheetResult } from "./merchantAttendanceTimesheet";
import { periodClosureUiArtifact,periodClosureUiSummary,periodClosureUiQuery,periodClosureUiEntry,periodClosureUiCommand,periodClosureUiId as id } from "../../scripts/fixtures/attendance-period-closure-ui-model";

// These are UI-only normalized fixtures. Strict source/authority parsers and
// actual SQL authorization have independent tests; SSR is not browser evidence.
const artifact=periodClosureUiArtifact(),oldQuery=periodClosureUiQuery("detail"),grantId=id(61001),actorEmployeeId=id(61002),expectedAuthUserId=id(61003);
let requests=0;
const props:PeriodDelegatedClosureWorkspaceProps={siteId:oldQuery.siteId,workerId:oldQuery.workerId,grantId,actorEmployeeId,expectedAuthUserId,
  targetEmployeeId:artifact.worker.employeeId,targetAuthUserId:artifact.worker.employeeAuthUserId,authorizedFromDate:"2026-09-01",authorizedThroughDate:"2026-09-30",
  fromDate:oldQuery.fromDate,throughDate:oldQuery.throughDate,enabled:true,apiFetch:async()=>{requests++;throw Error("SSR must be inert");},onClose:()=>{}};
const common={protocol:"period-delegated-closure-v1" as const,siteId:props.siteId,workerId:props.workerId,grantId,actorId:expectedAuthUserId,employeeId:actorEmployeeId,
  access:"delegate" as const,readAt:"2026-10-08T00:00:00.000001Z",usableActions:["view","send","respond","seal","reopen"] as PeriodDelegatedClosureView["usableActions"],moduleEnabled:true};
function detail():Extract<PeriodDelegatedClosureView,{kind:"detail"}>{return{...common,kind:"detail",period:{...periodClosureUiSummary(),revision:101,currentVersion:21,confirmedVersion:21,state:"confirmed"},
  artifact:periodClosureUiArtifact(),artifactVersion:21,operation:null,replayed:false,sourceChanged:false};}
function state():PeriodDelegatedClosureClientState{return{phase:"ready",pending:null,query:{...oldQuery,mode:"detail",access:"delegate",grantId,cursor:null},result:detail(),message:"UI-only saved values"};}
function draft():PeriodDelegatedArtifactDraft {const a=periodClosureUiArtifact();return{...a,protocol:"attendance-period-artifact-v2",report:{...a.report,access:"delegate",base:a.report.base as AttendanceTimesheetResult}};}
function preview(blockers:string[]=[]):PeriodDelegatedClosureClientState{return{...state(),query:{...state().query!,mode:"preview",periodId:null},
  result:{...common,kind:"preview",preview:{artifact:draft(),period:null,blockers}}};}
const controls=(s=state(),scope=props,shown=true,enabled=true,reason="明确核对")=>periodDelegatedClosureControls(s,scope,shown,enabled,reason);
const noActions=(v:ReturnType<typeof controls>)=>assert(Object.values(v.allowed).every(value=>value===false));
const noop=()=>{};
function page(result:Extract<PeriodDelegatedClosureView,{kind:"list"|"history"|"versions"}>,canRead=true){return renderToStaticMarkup(<PeriodDelegatedClosurePages result={result} canRead={canRead} select={noop} next={noop} detail={noop}/>);}
const code=()=>readFileSync(new URL("../components/enterprise/MerchantAttendancePeriodDelegatedClosureWorkspace.tsx",import.meta.url),"utf8");

test("workspace SSR is inert and introduces no owner/self or employee confirmation controls",()=>{
  const before=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");let storageReads=0;
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,get(){storageReads++;throw Error("SSR must not read storage");}});
  try{for(const enabled of [true,false]){const html=renderToStaticMarkup(<Workspace {...props} enabled={enabled}/>);
    assert.match(html,/data-period-delegated-closure/);assert.match(html,/本人确认与本人争议仍由本人操作/);assert.match(html,/不修改打卡与工时/);
    assert.match(html,/64 MiB/);assert.match(html,/单次最多31日/);assert.match(html,/读取受托周期列表/);assert.match(html,/预览导航日期完整周期/);
    assert.doesNotMatch(html,/>确认本保存版本<|>提出周期争议<|>下载|>打印|<textarea/);if(!enabled)assert.match(html,/只能明确GET核对/);}
    assert.equal(requests,0);assert.equal(storageReads,0);
  }finally{if(before)Object.defineProperty(globalThis,"sessionStorage",before);else Reflect.deleteProperty(globalThis,"sessionStorage");}
});

test("invalid or interchangeable actor/target identities show a closed safe error without HTTP",()=>{
  const html=renderToStaticMarkup(<Workspace {...props} actorEmployeeId={props.targetEmployeeId}/>);
  assert.match(html,/当前授权、身份或日期范围无法核验/);assert.doesNotMatch(html,/读取受托周期列表|textarea/);assert.equal(requests,0);
});

test("fresh current detail permits only its delegated actions, with no20/100 legacy cap",()=>{
  const c=controls();assert.deepEqual(Object.keys(c.allowed),["send","respond","seal","reopen"]);assert.equal(c.allowed.seal,true);assert.equal(c.allowed.respond,true);
  assert.equal(c.allowed.send,false);assert.equal(c.allowed.reopen,false);assert.equal("canOutput" in c,false);
  noActions(controls({...state(),result:{...detail(),usableActions:["view"]}}));
  assert.equal(controls({...state(),result:{...detail(),usableActions:["view","respond"]}}).allowed.seal,false);
});

test("ordinary module-off and component-off both prevent every delegated write including reopen",()=>{
  const sealed={...detail(),period:{...detail().period,state:"sealed" as const,sealed:true}};
  assert.equal(controls({...state(),result:sealed}).allowed.reopen,true);
  noActions(controls({...state(),result:{...sealed,moduleEnabled:false}}));noActions(controls({...state(),result:sealed},props,true,false));
  assert.equal(controls({...state(),result:sealed},props,true,false).canRead,false);
});

test("different site/grant/worker or either real identity never enables controls",()=>{
  for(const patch of [{siteId:"99999999"},{grantId:id(990)},{workerId:id(991)},{actorEmployeeId:id(992)},{expectedAuthUserId:id(993)},
    {targetEmployeeId:id(994)},{targetAuthUserId:id(995)},{authorizedFromDate:"2026-09-02"},{authorizedThroughDate:"2026-09-02"}]){
    const c=controls(state(),{...props,...patch});assert.equal(c.matchesScope,false);noActions(c);}
  noActions(controls({...state(),query:{...state().query!,periodId:id(999)}}));
});

test("saved full-period dates, not the narrower navigation window, remain the write frame",()=>{
  assert.equal(controls(state(),{...props,fromDate:"2026-09-02",throughDate:"2026-09-02"}).allowed.seal,true);
  const changed={...state(),query:{...state().query!,fromDate:"2026-09-02",throughDate:"2026-09-02"}};assert.equal(controls(changed).matchesScope,false);noActions(controls(changed));
});

test("fixed-version detail, history, versions, malformed operation and receipt are not fresh CAS",()=>{
  noActions(controls({...state(),query:{...state().query!,version:21}}));
  noActions(controls({...state(),result:{...detail(),operation:periodClosureUiEntry()}}));
  noActions(controls({...state(),result:{...detail(),replayed:true}}));
  for(const kind of ["history","versions"] as const){const s={...state(),query:{...state().query!,mode:kind},result:{...common,kind,period:detail().period,items:[],nextCursor:null}};
    noActions(controls(s));assert.equal(controls(s).canEditReason,false);}
  const receipt={...state(),query:{...state().query!,mode:"recover" as const,operationId:id(900)},result:{...common,kind:"receipt" as const,usableActions:[],receipt:null}};
  noActions(controls(receipt));assert.equal(controls(receipt).canEditReason,false);
});

test("pending/busy/hidden/invalid reasons block submissions while pending recovery remains explicit",()=>{
  const pending={format:1 as const,scope:{siteId:props.siteId,grantId,workerId:props.workerId,actorEmployeeId,expectedAuthUserId,targetEmployeeId:props.targetEmployeeId,targetAuthUserId:props.targetAuthUserId,
    authorizedFromDate:props.authorizedFromDate,authorizedThroughDate:props.authorizedThroughDate},query:state().query!,command:{...periodClosureUiCommand(),action:"send" as const},commandFingerprint:"a".repeat(64)};
  const s={...state(),pending};noActions(controls(s));assert.equal(controls(s).canRead,false);assert.equal(controls(s,props,true,false).canRecover,true);
  for(const phase of ["loading","saving","blocked","unconfirmed"] as const)noActions(controls({...state(),phase}));
  noActions(controls(state(),props,false));assert.equal(controls(s,props,false).canRecover,false);
  for(const value of [""," 前置空格","尾空格 ","换\n行","bad\u0085","x".repeat(501)])noActions(controls(state(),props,true,true,value));
});

test("preview allows review issues but not unfinished periods or unresolved outages; sealed cannot resend",()=>{
  for(const blockers of [[],["pending_leave","unresolved_review"],["period_in_progress"],["unresolved_outage"]]){
    assert.equal(controls(preview(blockers)).allowed.send,!blockers.some(x=>x==="period_in_progress"||x==="unresolved_outage"));}
  const s=preview(),r=s.result;if(r?.kind!=="preview")throw Error("fixture");
  noActions(controls({...s,query:{...s.query!,periodId:detail().period.periodId},result:{...r,preview:{...r.preview,period:{...detail().period,state:"sealed",sealed:true}}}}));
});

test("seal requires known unchanged source and employee-confirmed current version without unresolved dispute",()=>{
  for(const patch of [{sourceChanged:true},{sourceChanged:null},{artifact:null}])assert.equal(controls({...state(),result:{...detail(),...patch}}).allowed.seal,false);
  for(const patch of [{confirmedVersion:20},{state:"review" as const},{unresolvedDispute:true}])assert.equal(controls({...state(),result:{...detail(),period:{...detail().period,...patch}}}).allowed.seal,false);
});

test("confirm modal cannot cross changed reason, snapshot, generation, identity or a cancelled dialog",()=>{
  let current=true,reason="before",snapshot=1,epoch=1,writes=0;
  const valid=()=>current&&reason==="before"&&snapshot===1&&epoch===1;
  assert.equal(confirmPeriodDelegatedClosureAction(()=>false,valid,()=>writes++),false);
  for(const change of [()=>{current=false;},()=>{reason="after";},()=>{snapshot++;},()=>{epoch++;}]){
    current=true;reason="before";snapshot=1;epoch=1;assert.equal(confirmPeriodDelegatedClosureAction(()=>{change();return true;},valid,()=>writes++),false);}
  assert.equal(writes,0);current=true;reason="before";snapshot=1;epoch=1;assert.equal(confirmPeriodDelegatedClosureAction(()=>true,valid,()=>writes++),true);assert.equal(writes,1);
});

test("scope ports reject already-captured storage handles before reads, writes or retirement",()=>{
  let current=true,reads=0,writes=0,removes=0;
  const ports=periodDelegatedClosurePorts(async()=>new Response("ok"),()=>({getItem(){reads++;return null;},setItem(){writes++;},removeItem(){removes++;}}),()=>current),captured=ports.storage();
  current=false;assert.throws(()=>captured.getItem("k"));assert.throws(()=>captured.setItem("k","v"));assert.throws(()=>captured.removeItem("k"));assert.equal(ports.isCurrentAuth(),false);
  assert.equal(reads+writes+removes,0);
});

test("scope revoked during a storage callback or late response cannot authorize the next step",async()=>{
  let current=true,cancelled=false;const ports=periodDelegatedClosurePorts(async()=>{current=false;return new Response(new ReadableStream({cancel(){cancelled=true;}}));},()=>({
    getItem(){current=false;return "pending";},setItem(){},removeItem(){}}),()=>current);
  assert.throws(()=>ports.storage().getItem("k"));current=true;await assert.rejects(ports.apiFetch("/local",{method:"GET"}));assert.equal(cancelled,true);
});

test("list SSR renders one25 metadata page with escaped labels and no write form",()=>{
  const items=Array.from({length:25},(_,n)=>({...periodClosureUiSummary(),periodId:id(62000+n),workerName:n===0?"<img onerror=bad>":"Worker",openedAt:common.readAt}));
  const html=page({...common,kind:"list",items,nextCursor:null});assert.equal((html.match(/读取受托保存版本<\/button>/g)??[]).length,25);
  assert.match(html,/每页最多25条/);assert.match(html,/本次读取已到末页/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|textarea|保存版本并送本人核对/);
});

test("history and version pages are bounded metadata with explicit server next and no automatic body read",()=>{
  const period=detail().period,history=Array.from({length:50},(_,n)=>({...periodClosureUiEntry(),revision:101-n,operationId:id(63000+n),reason:`History ${n}`}));
  const cursor={kind:"history" as const,siteId:props.siteId,access:"delegate" as const,grantId,workerId:props.workerId,fromDate:props.fromDate,throughDate:props.throughDate,periodId:period.periodId,atRevision:101,beforeRevision:52};
  const html=page({...common,kind:"history",period,items:history,nextCursor:cursor});assert.equal((html.match(/History /g)??[]).length,50);assert.match(html,/本页不是完整历史/);assert.match(html,/读取下一页/);
  const versions=Array.from({length:20},(_,n)=>({version:21-n,operationId:id(64000+n),artifactId:id(65000+n),recordedAt:common.readAt,sourceFingerprint:"a".repeat(64),artifactBytes:1024,artifactSha256:"b".repeat(64)}));
  const vh=page({...common,kind:"versions",period,items:versions,nextCursor:null});assert.equal((vh.match(/查看保存版本 \d+<\/button>/g)??[]).length,20);assert.match(vh,/选择后才读取该版正文/);
  assert.doesNotMatch(vh,/<textarea|下载|打印/);assert.match(page({...common,kind:"versions",period,items:versions,nextCursor:null},false),/<button[^>]*disabled/);
});

test("candidate is explicitly unsaved, escaped, source-paged and never receives fake authority",()=>{
  const a=draft(),row=a.report.base.rows[0];a.worker.workerName="<svg onload=bad>";a.report.base.rows=Array.from({length:12},(_,n)=>({...structuredClone(row),startEventId:id(66000+n)}));a.report.missing=[];
  const html=renderToStaticMarkup(<PeriodDelegatedClosureCandidate artifact={a} blockers={["pending_leave"]}/>);
  assert.match(html,/当前候选，尚未保存/);assert.match(html,/不代表本人已确认/);assert.match(html,/&lt;svg/);assert.doesNotMatch(html,/<svg|<textarea|<pre|data-period-closure-artifact/);
  assert.match(html,/每页最多10条/);assert.match(html,new RegExp(id(66009)));assert.doesNotMatch(html,new RegExp(id(66010)));assert.match(html,/下一页来源/);
  assert.equal(Object.hasOwn(a,"authority"),false);
});

test("workspace source wires synchronous hide, clean guards and explicit-only reads without output paths",()=>{
  const text=code();assert.match(text,/const hide=\(\)=>flushSync\(\(\)=>\{invalidate\(\);clear\(\);setShown\(false\)/);
  assert.match(text,/registerLeaveGuard\?\.\(leaveAll\)/);assert.match(text,/registerLeaveGuard\?\.\(null\)/);
  assert.match(text,/beforeunload/);assert.match(text,/pagehide/);assert.match(text,/void client\.initialize\(\)/);
  assert.match(text,/draft\.current===value/);assert.match(text,/snapshot===client\.getSnapshot\(\)/);assert.match(text,/client\[action\]\(value\)/);
  assert.match(text,/<PeriodClosureSavedReport/);assert.doesNotMatch(text,/client\.(confirm|dispute|exportVersion)|deliverAttendancePrint|buildPeriodClosureOutput|window\.open|dangerouslySetInnerHTML/);
  assert.match(text,/min-w-0/);assert.match(text,/break-all/);assert.match(text,/max-w-full/);
});

test("200 delegate cycle entry requires actual host callback and preserves the original nine-value grant scope",()=>{
  const html=renderToStaticMarkup(<Workspace {...props} cycleEnabled cycleIsCurrentAuth={()=>true}/>);
  assert.match(html,/周期采用意向/);assert.equal(requests,0);
  for(const cycleIsCurrentAuth of [undefined,()=>false,()=>{throw Error("lost Auth");}]){
    const hidden=renderToStaticMarkup(<Workspace {...props} cycleEnabled cycleIsCurrentAuth={cycleIsCurrentAuth}/>);assert.doesNotMatch(hidden,/周期采用意向/);}
  const text=code();
  for(const token of ["cycleIntentAuthCurrent(props.cycleIsCurrentAuth)","cycleChildGuard.current()&&leave()","registerLeaveGuard?.(leaveAll)",
    "beforeOpen={()=>cycleCurrent()&&leave()}","registerLeaveGuard={registerCycleChild}","actorId={props.expectedAuthUserId}","delegateScope={cycleScope}",
    "actorEmployeeId:props.actorEmployeeId","targetEmployeeId:props.targetEmployeeId","targetAuthUserId:props.targetAuthUserId",
    "authorizedFromDate:props.authorizedFromDate,authorizedThroughDate:props.authorizedThroughDate",
    "enabled={enabled&&(props.cycleEnabled??process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED===\"1\")}"])
    assert(text.includes(token),token);
  assert(!text.includes("targetEmployeeId:result"));assert(!text.includes("new AttendanceCycleSendClient"));
});
