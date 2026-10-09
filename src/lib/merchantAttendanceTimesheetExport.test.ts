import assert from "node:assert/strict";
import test from "node:test";
import {parseTimesheetExportCommand as command,parseTimesheetExportSource as source,buildTimesheetExportCsv as csv,timesheetExportFilename} from "./merchantAttendanceTimesheetExport";
import {executeTimesheetExport} from "./merchantAttendanceTimesheetExport.server";
import {timesheetExportCommand as cmd,timesheetExportWire as wire} from "../../scripts/fixtures/attendance-timesheet-export-model";
import {firstApprovalSourceV2,sheetEffect,sheetEvent,timesheetId as id} from "../../scripts/fixtures/attendance-timesheet-model";

test("export command has exact bounded dates, principal-free query, continuous self identity and explicit manager version",()=>{
  for(const access of ["owner","self","manager"] as const){const c=cmd(access);assert.deepEqual(command(c),c);
    for(const patch of [{employeeId:id(2)},{authUserId:id(1)},{operationId:"bad"}])assert.throws(()=>command({...c,...patch}));
    for(const patch of [{access:"all"},{throughDate:"2026-10-02"},{expectedTimeZone:"invalid"},{expectedWorkerId:id(9),workerId:id(8)},{asOf:wire().report.asOf}])assert.throws(()=>command({...c,query:{...c.query,...patch}}));
  }
  assert.throws(()=>command({...cmd("self"),query:{...cmd("self").query,expectedWorkerId:null}}));
  for(const value of [null,0,1.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>command({...cmd("manager"),query:{...cmd("manager").query,expectedScopeRevision:value}}));
});
test("receipt strictly binds source/query and replay cannot smuggle earlier contents",()=>{
  for(const access of ["owner","self","manager"] as const){const c=cmd(access),v=wire(c);assert.equal(source(v,c).report?.workerId,id(4));
    for(const patch of [{operationId:id(801)},{siteId:"99990008"},{workerId:id(8)},{locationId:id(8)},{sourceSha256:"g".repeat(64)},{sessionCount:2},{sourceBytes:1048577},{downloadConfirmed:true},{status:"downloaded"},{recordedAt:"2001-01-01T00:00:00.000000Z"},{extra:"private"}])assert.throws(()=>source({...v,receipt:{...v.receipt,...patch}},c));
    assert.deepEqual(source({...v,replayed:true,report:null},c),{receipt:v.receipt,replayed:true,report:null});
    assert.throws(()=>source({...v,replayed:true},c));assert.throws(()=>source({...v,report:null},c));
  }
});
test("CSV preserves exact amounts, replacements, immutable event/approval references and formulas are text",()=>{
  const c=cmd(),v=wire();v.report.workerName='=HYPERLINK("https://evil.invalid")';v.report.workerNo='@SUM(1)';
  v.report.items[0].effect=sheetEffect({startAt:"2026-09-05T08:00:00.000000Z",endAt:"2026-09-05T15:00:00.000001Z",breaks:[]});
  const r=source(v,c),text=csv(r.report!,r.receipt);
  assert(text.startsWith("\ufeff"));assert(text.endsWith("\r\n"));assert(text.includes("'@SUM(1)"));assert(text.includes("'=HYPERLINK"));
  for(const expected of ["28800000000","25200000001","'-3599999999",id(101),id(102),id(30),id(40),"不是 CSV 校验值","不可混合累加","attendance-timesheet-v1"])assert(text.includes(expected),expected);
  assert(!text.includes("employeeId"));assert(!text.includes("actorEmployeeId"));assert(!text.includes("latitude"));
  assert.match(timesheetExportFilename(c),/^attendance-99990009-2026-09-01-2026-09-30-[a-f0-9-]+\.csv$/);
});
for(const [kind,expected] of [
  ["original",[28800000000,0,0,28800000000]],
  ["selected",[25200000003,1800000001,1800000001,23400000002]],
  ["difference",[-3599999997,1800000001,1800000001,-5399999998]],
] as const)test("CSV summary "+kind+" aligns exact amounts with real headers and leaves status blank",()=>{
  const c=cmd(),v=wire();
  v.report.items[0].effect=sheetEffect({startAt:"2026-09-05T08:00:00.000000Z",endAt:"2026-09-05T15:00:00.000003Z",
    breaks:[{startAt:"2026-09-05T10:00:00.000001Z",endAt:"2026-09-05T10:30:00.000002Z",paid:true}]});
  const r=source({...v,report:firstApprovalSourceV2(v.report)},c,"raw-and-approved-v2");
  // Every CSV field is quoted; parse escaped quotes rather than searching for
  // amounts that could also occur under the wrong column or in another row.
  const lines=csv(r.report!,r.receipt).slice(1).trimEnd().split("\r\n");
  const cells=(line:string)=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match=>match[1].replaceAll('""','"'));
  const headers=cells(lines[0]);
  assert.equal(headers.length,15);assert.equal(new Set(headers).size,headers.length);
  const rows=lines.slice(1).map(line=>{
    const values=cells(line);assert.equal(values.length,headers.length);
    return Object.fromEntries(headers.map((header,index)=>[header,values[index]]));
  }).filter(row=>row["记录类型"]==="汇总");
  assert.equal(rows.length,3);
  const row=rows.find(value=>value["口径"]===kind);assert(row);
  const amountHeaders=["起止微秒","休息微秒","带薪休息微秒","工作微秒"];
  // Negative numeric text retains the existing spreadsheet-formula protection.
  assert.deepEqual(amountHeaders.map(header=>row[header]),expected.map(value=>(value<0?"'":"")+value));
  for(const header of ["开始 UTC","结束 UTC","班次时区","状态","带薪标记"])assert.equal(row[header],"",header);
});

test("empty and unfinished reports have metadata; open shift/break durations are blank, not zero",()=>{
  const c=cmd();for(const empty of [true,false]){const v=wire();v.report.items=empty?[]:[{startEventId:id(101),events:[sheetEvent(1,"clock_in","2026-09-05T08:00:00.000000Z"),sheetEvent(2,"break_start","2026-09-05T10:00:00.000000Z",true)],effect:null}];
    v.receipt.sessionCount=v.report.items.length;const r=source(v,c),text=csv(r.report!,r.receipt);assert(text.includes("来源读取SHA256"));
    if(empty)assert(!text.includes('"班次完整"'));else{
      assert(text.includes('"","","","","break"'));assert(text.includes('"","","","","open","true"'));assert.equal(r.report?.totals.selected.workedUs,0);
    }
  }
});
test("scoped CSV explicitly warns incomplete coverage and omits account bindings",()=>{
  for(const access of ["self","manager"] as const){const c=cmd(access),r=source(wire(c),c),text=csv(r.report!,r.receipt);
    assert(text.includes("非个人完整月报"));assert(!text.includes(id(2)));assert(!text.includes(id(90)));assert(!text.includes("viewerEmployeeId"));
  }
});
test("executor uses fresh source RPC, exports whitelist only, and replay returns no file",async()=>{
  const c=cmd();let calls=0;
  const run=(data:unknown)=>executeTimesheetExport({command:c,authUserId:id(1)},{rpc:async(name,args)=>{calls++;assert.equal(name,"faolla_attendance_period_export_v2");assert.deepEqual(args,{p_site_id:c.siteId,p_auth_user_id:id(1),p_operation_id:c.operationId,p_query:c.query});return {data,error:null};}});
  const fresh=await run({...wire(),report:{...wire().report,sourceVersion:"raw-and-approved-v2"}});assert(fresh.csv);assert.equal(fresh.replayed,false);assert.equal("report" in fresh,false);
  const replay=await run({...wire(),replayed:true,report:null});assert.equal(replay.csv,null);assert.equal(replay.filename,null);assert.equal(calls,2);
  await assert.rejects(run({...wire(),receipt:{...wire().receipt,sourceSha256:"invalid"}}),/attendance_unavailable/);
  for(const code of ["attendance_export_denied","attendance_operation_conflict","attendance_report_zone_changed","attendance_version_conflict"]){await assert.rejects(executeTimesheetExport({command:c,authUserId:id(1)},{rpc:async()=>({data:null,error:{message:code}})}),new RegExp(code));}
});
