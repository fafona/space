import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {timesheetExportCommand,timesheetExportWire} from "../../scripts/fixtures/attendance-timesheet-export-model";
import {unifiedExportCommand,unifiedExportWire} from "../../scripts/fixtures/attendance-unified-export-model";
import {firstApprovalSourceV2,sheetEvent,timesheetId as id,timesheetQuery as q,timesheetOwner} from "../../scripts/fixtures/attendance-timesheet-model";
import {scopedSheetWire,scopedSelfQuery,scopedManagerQuery} from "../../scripts/fixtures/attendance-scoped-timesheet-model";
import {createTimesheetClientFixture} from "../../scripts/fixtures/attendance-timesheet-client-model";
import {createScopedClientFixture,scopedActor} from "../../scripts/fixtures/attendance-scoped-timesheet-client-model";
import {parseAttendanceTimesheetResult,ATTENDANCE_REPORT_SOURCE_VERSION} from "./merchantAttendanceTimesheet";
import {parseAttendanceScopedTimesheetResult} from "./merchantAttendanceScopedTimesheet";
import {scopedPairKey} from "./merchantAttendanceScopedTimesheetContext";
import {currentAttendanceReportVersion} from "./merchantAttendanceCurrentReportVersion";
import {executeAttendanceTimesheet} from "./merchantAttendanceTimesheet.server";
import {executeAttendanceScopedTimesheet} from "./merchantAttendanceScopedTimesheet.server";
import {executeTimesheetExport} from "./merchantAttendanceTimesheetExport.server";
import {AttendanceTimesheetClient} from "./merchantAttendanceTimesheetClient";
import {AttendanceScopedTimesheetClient} from "./merchantAttendanceScopedTimesheetClient";
import {buildTimesheetExportCsv,parseTimesheetExportSource,timesheetExportFilename} from "./merchantAttendanceTimesheetExport";
import {buildUnifiedExportCsv,parseUnifiedExportSource,unifiedExportFilename,unifiedExportQuery} from "./merchantAttendanceUnifiedExport";
import {parseUnifiedSource,parseUnifiedResponse} from "./merchantAttendanceUnifiedTimesheet";
import {buildAttendancePrintDocument as print,type AttendancePrintKind} from "./merchantAttendancePrintDocument";
import type {AdministrativeReportBoundary} from "./merchantAttendanceAdministrativeBoundary";

const version="raw-and-approved-v3";
function proof():AdministrativeReportBoundary{return {protocol:"attendance-administrative-report-boundary-v1",operationId:id(900),startEventId:id(101),startSequence:1,
  startAt:"2026-09-05T08:00:00.000000Z",tailEventId:id(102),tailSequence:2,tailAction:"break_start",tailOccurredAt:"2026-09-05T09:00:00.000000Z",
  verifiedEndAt:"2026-09-05T10:00:00.000000Z",recordedAt:"2026-09-05T11:00:00.000000Z",sourceFingerprint:"a".repeat(64)};}
function wire(access:"owner"|"self"|"manager"="owner"){
  const b=proof(),base=access==="owner"?timesheetExportWire().report:scopedSheetWire(access);
  const event=(n:number,action:Parameters<typeof sheetEvent>[1],at:string)=>({...sheetEvent(n,action,at),...(access==="owner"?{}:{actorEmployeeId:id(2)})});
  return {...base,sourceVersion:version,administrativeUnassessedCount:1,totalsComplete:false,items:[
    {startEventId:id(101),events:[event(1,"clock_in",b.startAt),event(2,"break_start",b.tailOccurredAt)],effect:null,administrativeBoundary:b,predecessorBoundary:null},
    {startEventId:id(103),events:[event(3,"clock_in","2026-09-06T08:00:00.000000Z"),event(4,"clock_out","2026-09-06T10:00:00.000000Z")],effect:null,administrativeBoundary:null,predecessorBoundary:{...b}}]};
}
function exported(kind:AttendancePrintKind,access:"owner"|"self"|"manager"="owner"){
  const command=timesheetExportCommand(access),old=timesheetExportWire(command),receipt={...old.receipt,sessionCount:2};
  if(kind==="timesheet"){
    const parsed=parseTimesheetExportSource({receipt,replayed:false,report:wire(access)},command,version);
    return {csv:buildTimesheetExportCsv(parsed.report!,parsed.receipt),filename:timesheetExportFilename(command),receipt:parsed.receipt};
  }
  const oldUnified=unifiedExportWire(command),p=parseUnifiedExportSource({...oldUnified,receipt:{...oldUnified.receipt,sessionCount:2,sourceCount:3},report:{...oldUnified.report,base:wire(access)}},command);
  return {csv:buildUnifiedExportCsv(p.report!,p.receipt),filename:unifiedExportFilename(command),receipt:p.receipt};
}
const csvRows=(csv:string)=>csv.slice(1).trimEnd().split("\r\n").map(line=>line.slice(1,-1).split('\",\"'));
const fromRows=(rows:string[][])=>"\ufeff"+rows.map(row=>row.map(v=>'"'+v.replaceAll('"','""')+'"').join(",")).join("\r\n")+"\r\n";

test("current dispatch is only explicit v2/v3; immutable legacy constant and old explicit parsers stay strict",()=>{
  assert.equal(ATTENDANCE_REPORT_SOURCE_VERSION,"raw-and-approved-v2");
  for(const sourceVersion of ["raw-and-approved-v2",version])assert.equal(currentAttendanceReportVersion({sourceVersion}),sourceVersion);
  for(const raw of [null,[],{},Object.create({sourceVersion:version}),{sourceVersion:"raw-and-approved-v1"},{sourceVersion:"raw-and-approved-v4"}])assert.throws(()=>currentAttendanceReportVersion(raw));
  for(const v of ["raw-and-approved-v1","raw-and-approved-v2"] as const)assert.throws(()=>parseAttendanceTimesheetResult(wire(),q,v));
});

test("current owner and scoped services use the same authorized RPCs, accept strict v3, never fall back",async()=>{
  for(const access of ["owner","self","manager"] as const){
    const calls:string[]=[],service={rpc:async(name:string)=>{calls.push(name);return {data:wire(access),error:null};}};
    const result=access==="owner"?await executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},service):await executeAttendanceScopedTimesheet({query:access==="self"?scopedSelfQuery:scopedManagerQuery,authUserId:id(1)},service);
    assert.equal(result.sourceVersion,version);assert.equal(result.rows[0].selectedInPeriod,null);assert.equal(result.totals.selected.workedUs,7200000000);
    assert.deepEqual(calls,[access==="owner"?"faolla_attendance_period_report_v2":"faolla_attendance_scoped_period_report_v2"]);
    const bad={rpc:async(name:string)=>{calls.push(name);return {data:{...wire(access),sourceVersion:"raw-and-approved-v4"},error:null};}};
    await assert.rejects(()=>access==="owner"?executeAttendanceTimesheet({query:q,authUserId:id(1)},bad):executeAttendanceScopedTimesheet({query:access==="self"?scopedSelfQuery:scopedManagerQuery,authUserId:id(1)},bad),/attendance_unavailable/);
    assert.equal(calls.length,2);
  }
});

test("current export dispatch preserves strict source and receipt-only replay without a fabricated report",async()=>{
  const command=timesheetExportCommand(),old=timesheetExportWire(command),receipt={...old.receipt,sessionCount:2};let calls=0;
  const service={rpc:async(name:string)=>{calls++;assert.equal(name,"faolla_attendance_period_export_v2");return {data:{receipt,replayed:false,report:wire()},error:null};}};
  const result=await executeTimesheetExport({command,authUserId:timesheetOwner},service);assert(result.csv?.includes("administratively_closed_unassessed"));assert.equal(calls,1);
  const replay=await executeTimesheetExport({command,authUserId:timesheetOwner},{rpc:async()=>({data:{receipt,replayed:true,report:null},error:null})});
  assert.equal(replay.csv,null);assert.equal(replay.filename,null);
  await assert.rejects(()=>executeTimesheetExport({command,authUserId:timesheetOwner},{rpc:async()=>({data:{receipt,replayed:true,report:wire()},error:null})}),/attendance_unavailable/);
});

test("owner current client accepts v3 GET once and invalidation removes the proof and subtotal",async()=>{
  const f=createTimesheetClientFixture();let reads=0;
  const client=new AttendanceTimesheetClient({siteId:q.siteId,ownerId:timesheetOwner,apiFetch:async(url,init)=>{
    if(!url.includes("/timesheet?"))return f.apiFetch(url,init);reads++;assert.equal(init?.method,"GET");
    return Response.json({ok:true,moduleEnabled:false,...parseAttendanceTimesheetResult(wire(),q,version)});
  }});
  try{await client.initialize();client.selectWorker(q.workerId);client.setDates(q.fromDate,q.throughDate);await client.load();
    assert.equal(client.getSnapshot().result?.sourceVersion,version);assert.equal(client.getSnapshot().result?.rows[0].selectedInPeriod,null);assert.equal(reads,1);
    client.invalidate();assert.equal(client.getSnapshot().result,null);
  }finally{client.invalidate();}
});

for(const access of ["self","manager"] as const)test(`${access} current client dispatches strict v3 without changing its existing scope gate`,async()=>{
  const f=createScopedClientFixture();let reads=0;
  const client=new AttendanceScopedTimesheetClient({siteId:q.siteId,actorId:scopedActor(access),access,apiFetch:async(url,init)=>{
    if(!url.includes("/scoped-timesheet?"))return f.apiFetch(url,init);reads++;assert.equal(init?.method,"GET");
    return Response.json({ok:true,moduleEnabled:false,...parseAttendanceScopedTimesheetResult(wire(access),access==="self"?scopedSelfQuery:scopedManagerQuery,version)});
  }});
  try{await client.initialize();if(access==="manager")client.selectPair(scopedPairKey(client.getSnapshot().context!.items[0]));client.setDates(q.fromDate,q.throughDate);await client.load();
    assert.equal(client.getSnapshot().result?.sourceVersion,version);assert.equal(client.getSnapshot().result?.totals.selected.workedUs,7200000000);assert.equal(reads,1);
  }finally{client.invalidate();}
});

test("unified v3 uses administrative end only for coverage, not work; genuine overlaps still reject",()=>{
  const command=unifiedExportCommand(),old=unifiedExportWire(command),query=unifiedExportQuery(command),raw={...old.report,base:wire()};
  const result=parseUnifiedSource(raw,query);assert.equal(result.totals.recordedSelected.workedUs,7200000000);assert.equal(result.totals.missingSelected.workedUs,25200000001);
  assert.equal(result.totals.selected.workedUs,32400000001);assert.equal(result.base.rows[0].selectedInPeriod,null);
  assert.deepEqual(parseUnifiedResponse({...result,ok:true,moduleEnabled:false},query,id(1)),{...result,moduleEnabled:false});
  const overlap=structuredClone(raw);overlap.missing[0].proposal={startAt:"2026-09-05T09:30:00.000000Z",endAt:"2026-09-05T10:30:00.000000Z",breaks:[]};
  assert.throws(()=>parseUnifiedSource(overlap,query),/attendance_report_reconciliation_required/);
  const adjacent=structuredClone(raw);adjacent.missing[0].proposal={startAt:proof().verifiedEndAt,endAt:"2026-09-05T11:00:00.000000Z",breaks:[]};
  assert.equal(parseUnifiedSource(adjacent,query).totals.selected.workedUs,10800000000);
});

for(const kind of ["timesheet","unified"] as const)for(const access of ["owner","self","manager"] as const)test(`${kind}/${access}: v3 CSV and print explicitly retain unknown work and proof without account data`,()=>{
  const file=exported(kind,access),rows=csvRows(file.csv),shift=kind==="unified"?1:0;
  const own=rows.filter(r=>r[3+shift]===id(101)&&/完整$|区间$/.test(r[0]));assert.equal(own.length,4);
  for(const row of own){assert.equal(row[13+shift],"administratively_closed_unassessed");assert.deepEqual(row.slice(9+shift,13+shift),["","","",""]);assert.equal(row[7+shift],"");}
  assert.equal(rows.filter(r=>r[0]==="行政结案旁证").length,12);assert.equal(rows.filter(r=>r[0]==="行政前驱旁证").length,12);
  const html=print(file,kind,file.receipt);
  for(const value of ["已知小计","未知不是 0","工时未核定","不是实测下班","行政前驱旁证","7200000000"])assert(html.includes(value),value);
  for(const secret of [id(2),id(90),"employeeAuthUserId","latitude","longitude"])assert(!html.includes(secret),secret);
  assert(!html.includes("有 1 个尚未结束班次"));
});

for(const kind of ["timesheet","unified"] as const)test(`${kind}: v3 print rejects missing/altered proofs, zeroed unknown amounts and false completeness`,()=>{
  const file=exported(kind),shift=kind==="unified"?1:0;
  const patches:((rows:string[][])=>string[][])[]=[
    rows=>rows.filter(r=>r[0]!=="行政结案旁证"),rows=>rows.filter(r=>!(r[0]==="行政前驱旁证"&&r[4+shift]==="sourceFingerprint")),
    rows=>{rows.find(r=>r[0]==="行政结案旁证"&&r[4+shift]==="tailEventId")![5+shift]=id(999);return rows;},
    rows=>{rows.find(r=>r[0]==="行政结案旁证"&&r[4+shift]==="startSequence")![5+shift]="1e0";return rows;},
    rows=>{rows.find(r=>r[0]==="行政前驱旁证"&&r[4+shift]==="sourceFingerprint")![5+shift]="b".repeat(64);return rows;},
    rows=>{rows.find(r=>r[0]==="元数据"&&r[4+shift]==="合计完整")![5+shift]="true";return rows;},
    rows=>{rows.find(r=>r[0]==="元数据"&&r[4+shift]==="行政结案未核定班次数")![5+shift]="0";return rows;},
    rows=>{rows.find(r=>r[3+shift]===id(101)&&r[0].endsWith("完整"))![9+shift]="0";return rows;},
    rows=>{rows.find(r=>r[0]==="汇总"&&r[1]==="selected")![12+shift]="0";return rows;},
    rows=>{rows.find(r=>r[0]==="元数据"&&r[4+shift]===(kind==="unified"?"原记录来源版本":"来源版本"))![5+shift]="raw-and-approved-v2";return rows;},
  ];
  for(const patch of patches)assert.throws(()=>print({...file,csv:fromRows(patch(csvRows(file.csv)))},kind),/attendance_report_invalid_data/);
});

test("v3 CSV builders do not trust a marker or changed computed proof/amounts",()=>{
  const command=timesheetExportCommand(),old=timesheetExportWire(),receipt={...old.receipt,sessionCount:2};
  const parsed=parseTimesheetExportSource({receipt,replayed:false,report:wire()},command,version);
  const bad=structuredClone(parsed.report!);bad.rows[0].selectedInPeriod={elapsedUs:0,breakUs:0,paidBreakUs:0,workedUs:0};
  assert.throws(()=>buildTimesheetExportCsv(bad,receipt));
  const u=unifiedExportWire(command),p=parseUnifiedExportSource({...u,receipt:{...u.receipt,sessionCount:2,sourceCount:3},report:{...u.report,base:wire()}},command);
  p.report!.totals.selected.workedUs++;assert.throws(()=>buildUnifiedExportCsv(p.report!,p.receipt));
});

// Taken before the current-v3 changes, not regenerated from the changed output.
const oldHashes=[
 ["faae3bf0411753a3f095841a20d609f1f86ba8e61cbbaeeb709008109b5c501e","e3324c03d5d49afc94b3690b07e4a8415d51fdc86b68f81e64fa6fbdbb25b9f4"],
 ["5c916cf9357f6e390fd2639431ff1e661a1e0133c0c4cd5e37d834750c8727a1","7144ea7b608e1b2b1c3daaa28e2fc0cea05b5ed9e83ef0449699ca15a006fe69"],
 ["cb105deaf540c56ebccd2755a507d2bfd67fe9768798fa9d154c06410173f74f","a920339729d6e9a63f38de964a9d7cb87fa28fb6ed499362b3b8553f3594cf59"],
 ["1d713eb1110c327db796c3074edaaebb58586014391c614317c68e00fce7e73d","7bbe39248b7121840b9f39d62f16736db122e77278c32b782d1df29399c32ec1"],
 ["f00bd6fef14f203033dbc87658c7823cc64fc912fb6039a3d252577105033ca0","42016b131079f3bbb15c4434c34a7a09d6dd4b70b0a2f211dd3f745b5aa5145e"],
 ["22f948d16a184a64f3e218e8b2b5152fefb5c722d249f04f04568e7a3a022996","0a6e0bae9862574dc05bff86c9ff200ef07a0a40b778d6d0bb481bdba6d8e98a"],
 ["1c1183d0078798ed24e63bf593e0a8a64c8a2816a6def8a6edcf5fdc92edd51d","b74c3441b5af4a873301581e736c9341322cd064af560cf22b84362d0d43733e"],
 ["5f64a70f0699f90e02d066acdaebe1c2044d937f31dd06e5612c052d3fe6a036","92d386b9989ea518ba15a36db7e53bf9c0d4f7c59c5cd9485bea9854ec6a490a"],
 ["b5f0b109f11018cb2afc648ee3ca6d7850d3696ec8e24c9b0f6c5bf16d7e53fc","fa8a8a3d2666e49c95de4be53e4c005de16cdd418a9ad52715408e6ed88b08d7"]];
test("all nine old owner/self/manager v1/v2 and unified CSV/HTML pairs remain byte-identical",()=>{
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex");let n=0;
  for(const access of ["owner","self","manager"] as const)for(const v of ["v1","v2","unified"] as const){
    const command=timesheetExportCommand(access);let csv:string,filename:string;
    if(v==="unified"){const p=parseUnifiedExportSource(unifiedExportWire(command),command);csv=buildUnifiedExportCsv(p.report!,p.receipt);filename=unifiedExportFilename(command);}
    else{const w=timesheetExportWire(command);if(v==="v2")w.report=firstApprovalSourceV2(w.report);const p=parseTimesheetExportSource(w,command,v==="v2"?"raw-and-approved-v2":"raw-and-approved-v1");csv=buildTimesheetExportCsv(p.report!,p.receipt);filename=timesheetExportFilename(command);}
    assert.deepEqual([hash(csv),hash(print({csv,filename},v==="unified"?"unified":"timesheet"))],oldHashes[n++],`${access}/${v}`);
  }
});
