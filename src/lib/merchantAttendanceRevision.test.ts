import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceRevisionInput as parse,parseAttendanceRevisionQuery as query,attendanceRevisionQueryString,parseAttendanceRevisionResult as result} from "./merchantAttendanceRevision";
import {executeAttendanceRevision} from "./merchantAttendanceRevision.server";
import {revisionQuery as q,revisionCommand as c,revisionWithdrawal as w,revisionResponse as wire,revisionDetail as detail} from "../../scripts/fixtures/attendance-revision-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
const input=(command=c)=>({siteId:q.siteId,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,command});
test("revision input and query reject extra identities, missing basis/version, arbitrary decisions and non-exact fields",()=>{
  assert.deepEqual(parse(input()),input());
  for(const patch of [{authUserId:id(1)},{employeeId:id(1)},{allowWrite:true},{siteId:"wrong"},{baseRequestId:"wrong"}])assert.throws(()=>parse({...input(),...patch}));
  for(const patch of [{action:"approve"},{expectedRevision:-1},{expectedRevision:9007199254740989},{expectedBaseOperationId:"bad"},{expectedPolicyRevision:0},{expectedPolicyRevision:1.5},
    {reason:" "},{reason:" leading"},{reason:"newline\n"},{reason:"control\u0085"},{reason:"🙂".repeat(501)},{proposal:{...c.proposal,extra:true}}])assert.throws(()=>parse(input({...c,...patch} as typeof c)));
  for(const key of Object.keys(c)){const command:Record<string,unknown>={...c};delete command[key];assert.throws(()=>parse({...input(),command}));}
  assert.equal(parse(input({...c,reason:"🙂".repeat(500)})).command.reason.length,1000);
  for(const value of [q,detail(),detail(c.operationId)])assert.deepEqual(query("https://local.invalid/?"+attendanceRevisionQueryString(value)),value);
  for(const extra of ["&requestId="+c.operationId,"&mode=detail","&authUserId="+id(1),"&operationId="+c.operationId,"&siteId=99990002"])assert.throws(()=>query("https://local.invalid/?"+attendanceRevisionQueryString(q)+extra));
});
test("preparation preserves original/approved separate from new request; no approval or report effect is implied",()=>{
  const r=result(wire(),q);assert.equal(r.basis.events.at(-1)?.occurredAt,"2026-09-28T16:00:00.000000Z");assert.equal(r.base.proposal.endAt,"2026-09-28T17:00:00.000000Z");
  assert.equal(r.base.workedUs,30600000000);assert.equal(r.item,null);assert.equal(r.approvalAvailable,false);assert.equal(r.effectiveChanged,false);
  for(const patch of [{approvalAvailable:true},{effectiveChanged:true},{employeeId:id(99)},{workerId:id(99)},{revision:-1},{revision:1},{canSubmit:1},{item:{}},{receipt:{}},{secret:"private"}])assert.throws(()=>result({...wire(),...patch},q));
});
test("base declaration recomputes exact amounts and rejects false source identity, chronology, timezone or open basis",()=>{
  for(const patch of [{requestId:id(999)},{revision:2},{workedUs:1},{paidBreakUs:1},{timeZone:"UTC"},{recordedAt:"2026-09-29T00:00:00.000000Z"},{operationId:"bad"}]){const v=wire();Object.assign(v.base,patch);assert.throws(()=>result(v,q));}
  for(const kind of ["open","unknown-source","wrong-person","too-many"]){const v=wire();if(kind==="open")v.basis.events.pop();if(kind==="unknown-source")Object.assign(v.basis.events[0],{source:"unknown"});if(kind==="wrong-person")v.basis.employeeId=id(99);if(kind==="too-many")v.basis.events=Array(203).fill(v.basis.events[0]);assert.throws(()=>result(v,q));}
});
test("submitted and withdrawn request receipts bind full commands and do not change first approval",()=>{
  for(const [mode,command] of [["submitted",c],["withdrawn",w],["withdrawn",c]] as const){const v=wire(mode,command),r=result(v,detail(command.operationId));assert.deepEqual(r.receipt?.command,command);assert.equal(r.base.operationId,c.expectedBaseOperationId);assert.equal(r.effectiveChanged,false);}
  for(const patch of [{revision:2},{requestId:id(99)},{operationId:id(99)},{recordedAt:wire().asOf},{action:"approve"}]){const v=wire("submitted",c);Object.assign(v.receipt!,patch);assert.throws(()=>result(v,detail(c.operationId)));}
  for(const patch of [{reason:"different"},{expectedRevision:1},{expectedPolicyRevision:2},{expectedBaseOperationId:id(99)}]){const v=wire("submitted",c);Object.assign(v.receipt!.command,patch);assert.throws(()=>result(v,detail(c.operationId)));}
});
test("pending and withdrawn statuses cannot manufacture submission/withdrawal capability or conceal current rules",()=>{
  for(const patch of [{pendingRequestId:null},{canSubmit:true},{canWithdraw:false},{revision:2}])assert.throws(()=>result({...wire("submitted"),...patch},detail()));
  for(const patch of [{canWithdraw:true},{revision:1}])assert.throws(()=>result({...wire("withdrawn"),...patch},detail()));
  const v=wire("withdrawn");v.item!.withdrawal!.recordedAt=v.item!.submittedAt;assert.throws(()=>result(v,detail()));
  const locked=wire();locked.currentRules.issues=["period_locked"];locked.currentRules.lockedPeriodCount=1;assert.throws(()=>result(locked,q));locked.canSubmit=false;assert.equal(result(locked,q).canSubmit,false);
  const pendingOther=wire("withdrawn");pendingOther.revision=3;pendingOther.pendingRequestId=id(999);pendingOther.canSubmit=false;assert.equal(result(pendingOther,detail()).item!.status,"withdrawn");
  for(const pendingRequestId of [c.operationId,q.baseRequestId,c.expectedBaseOperationId])assert.throws(()=>result({...pendingOther,pendingRequestId},detail()));
  const even=wire("submitted");even.revision=2;even.item!.revision=2;even.item!.submittedRevision=2;assert.throws(()=>result(even,detail()));
});
test("service executes only new revision RPC, principal comes from server and command receipt is required",async()=>{
  const v=wire("submitted",c);const input={query:detail(),command:c,authUserId:id(77),moduleEnabled:true};let calls=0;
  const run=(data:unknown)=>executeAttendanceRevision(input,{rpc:async(name,args)=>{calls++;assert.equal(name,"faolla_attendance_revision_self_v1");assert.deepEqual(args,{p_site_id:q.siteId,p_auth_user_id:id(77),p_query:{mode:"detail",expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,requestId:c.operationId,operationId:null},p_command:c,p_platform_enabled:true});return {data,error:null};}});
  assert.deepEqual((await run(v)).receipt?.command,c);await assert.rejects(run({...v,receipt:null}),/attendance_unavailable/);assert.equal(calls,2);
  await assert.rejects(executeAttendanceRevision({...input,query:q},{rpc:async()=>{throw Error("should not execute");}}),/attendance_invalid_request/);
  for(const code of ["attendance_revision_base_changed","attendance_revision_unchanged","attendance_correction_period_locked","private SQL"]){await assert.rejects(executeAttendanceRevision(input,{rpc:async()=>({data:null,error:{message:code}})}),new RegExp(code==="private SQL"?"attendance_unavailable":code));}
});
test("paused server never returns submit-enabled response; withdrawal and exact receipt reads remain available",async()=>{
  await assert.rejects(executeAttendanceRevision({query:q,command:null,authUserId:id(1),moduleEnabled:false},{rpc:async()=>({data:wire(),error:null})}),/attendance_unavailable/);
  const v=wire("withdrawn",w);v.canSubmit=false;
  const r=await executeAttendanceRevision({query:detail(),command:w,authUserId:id(1),moduleEnabled:false},{rpc:async()=>({data:v,error:null})});assert.equal(r.receipt?.action,"withdraw");
});
