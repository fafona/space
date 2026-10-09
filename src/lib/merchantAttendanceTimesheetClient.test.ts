import assert from "node:assert/strict";
import test from "node:test";
import {AttendanceTimesheetClient} from "./merchantAttendanceTimesheetClient";
import {createTimesheetClientFixture} from "../../scripts/fixtures/attendance-timesheet-client-model";
import {timesheetQuery as q,timesheetOwner,timesheetId as id} from "../../scripts/fixtures/attendance-timesheet-model";
function fixture(){const f=createTimesheetClientFixture();const client=new AttendanceTimesheetClient({siteId:q.siteId,ownerId:timesheetOwner,apiFetch:f.apiFetch,now:()=>new Date("2026-09-30T22:30:00Z"),timeoutMs:1000});return {f,client};}
async function ready(){const x=fixture();await x.client.initialize();x.client.selectWorker(q.workerId);x.client.setDates(q.fromDate,q.throughDate);return x;}
test("initial read uses authoritative merchant date, bounded choices, no automatic report",async()=>{
  const {f,client}=fixture();await client.initialize();assert.equal(client.getSnapshot().throughDate,"2026-10-01");assert.equal(client.getSnapshot().fromDate,"2026-09-25");assert.equal(client.getSnapshot().worker,null);assert.equal(client.getSnapshot().choices?.items.length,25);assert.equal(f.calls.length,2);
});
test("explicit query displays approved replacement with a negative difference using GET only",async()=>{
  const {f,client}=await ready();await client.load();assert.equal(client.getSnapshot().result?.totals.difference.workedUs,-3600000000);assert(f.calls.every(c=>c.method==="GET"));assert(!f.calls.at(-1)!.url.includes("ownerId"));
});
test("date and worker changes immediately clear prior results and never autofetch",async()=>{
  const {f,client}=await ready();await client.load();const count=f.calls.length;client.setDates("2026-09-02",q.throughDate);assert.equal(client.getSnapshot().result,null);assert.equal(f.calls.length,count);
  await client.load();client.selectWorker(id(5));assert.equal(client.getSnapshot().result,null);await client.load();assert.equal(client.getSnapshot().result?.employeeId,null);assert.equal(client.getSnapshot().result?.rows.length,0);
});
test("superseded delayed response cannot replace a newer worker result",async()=>{
  const {f,client}=await ready();f.mode("held");const pending=client.load();await Promise.resolve();client.selectWorker(id(5));f.mode("normal");await client.load();f.release();await pending;
  assert.equal(client.getSnapshot().result?.workerId,id(5));assert.equal(client.getSnapshot().result?.rows.length,0);assert(f.calls.find(c=>c.url.includes("timesheet"))?.signal?.aborted);
});
test("hidden/unmounted state drops names, dates and results and ignores late bodies",async()=>{
  const {f,client}=await ready();f.mode("held");const pending=client.load();await Promise.resolve();client.invalidate();f.release();await pending;
  assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().choices,null);assert.equal(client.getSnapshot().worker,null);assert.equal(client.getSnapshot().fromDate,"");assert.equal(client.getSnapshot().timeZone,null);
});
test("failures discard result and person labels; paused collection still permits history",async()=>{
  for(const mode of ["denied","offline","large","tampered"]){const {f,client}=await ready();await client.load();f.mode(mode);await client.load();assert.equal(client.getSnapshot().phase,"blocked",mode);assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().worker,null);assert.equal(client.getSnapshot().choices,null);}
  const {f,client}=await ready();f.mode("paused");await client.load();assert.equal(client.getSnapshot().result?.moduleEnabled,false);
});
test("invalid ranges send no report request, zero choices never auto-select",async()=>{
  const {f,client}=await ready();const count=f.calls.length;client.setDates("2026-09-01","2026-10-02");await client.load();assert.equal(f.calls.length,count);assert.equal(client.getSnapshot().result,null);
  await client.loadChoices("no-match");assert.equal(client.getSnapshot().choices?.items.length,0);assert.equal(client.getSnapshot().worker,null);
});
test("worker search/pagination clear selection and use bounded cursor, not all-person fetch",async()=>{
  const {client}=await ready();const cursor=client.getSnapshot().choices!.nextCursor;await client.loadChoices("",cursor);assert.equal(client.getSnapshot().choices?.items.length,2);assert.equal(client.getSnapshot().worker,null);assert.equal(client.getSnapshot().choices?.nextCursor,null);
  await client.loadChoices("HISTORY-B");assert.equal(client.getSnapshot().choices?.items.length,1);client.selectWorker(id(5));assert.equal(client.getSnapshot().worker?.eligible,false);
});
test("slow headers timeout is bounded and does not retain stale result",async()=>{
  const {f,client}=await ready();f.mode("held");await client.load();assert.equal(client.getSnapshot().phase,"blocked");assert.equal(client.getSnapshot().result,null);f.release();
});
test("unconfigured enterprise does not query workers or reports",async()=>{
  const {f,client}=fixture();f.mode("unconfigured");await client.initialize();assert.equal(client.getSnapshot().phase,"blocked");assert.equal(client.getSnapshot().timeZone,null);assert.equal(f.calls.length,1);assert.match(client.getSnapshot().message,/保存企业设置/);
});
test("invalid date is correctable without reloading people or losing selection",async()=>{
  const {client}=await ready();client.setDates("2026-09-01","2026-10-02");await client.load();assert.equal(client.getSnapshot().worker?.id,q.workerId);assert.match(client.getSnapshot().message,/31 个自然日/);
  client.setDates(q.fromDate,q.throughDate);await client.load();assert.equal(client.getSnapshot().result?.workerId,q.workerId);
});
test("changed enterprise timezone rejects rather than silently relabelling query dates",async()=>{
  const {f,client}=await ready();f.mode("zonechanged");await client.load();assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().worker,null);assert.match(client.getSnapshot().message,/时区已经改变/);
});
test("HTML redirects, oversized JSON and incomplete body never render partial reports",async()=>{
  for(const mode of ["html","oversize","partial"]){
    const f=createTimesheetClientFixture();let canceled=false;
    const client=new AttendanceTimesheetClient({siteId:q.siteId,ownerId:timesheetOwner,timeoutMs:1000,apiFetch:async(url,init)=>{
      if(!url.includes("/timesheet?"))return f.apiFetch(url,init);
      if(mode==="html")return new Response("<html>login</html>",{headers:{"Content-Type":"text/html"}});
      if(mode==="oversize")return Response.json({ok:true,moduleEnabled:true,data:"x".repeat(1048576)});
      return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"ok":true,'));},cancel(){canceled=true;}}),{headers:{"Content-Type":"application/json"}});
    }});
    await client.initialize();client.selectWorker(q.workerId);client.setDates(q.fromDate,q.throughDate);await client.load();assert.equal(client.getSnapshot().phase,"blocked",mode);assert.equal(client.getSnapshot().result,null);if(mode==="partial")assert.equal(canceled,true);
  }
});
