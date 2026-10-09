import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceSessionQuery,parseAttendanceSessionResult,summarizeAttendanceSessionRecords,formatAttendanceDurationUs,type AttendanceSessionEvent} from "./merchantAttendanceSession";
import {executeAttendanceSession} from "./merchantAttendanceSession.server";
import {AttendanceSessionClient} from "./merchantAttendanceSessionClient";
import {applyAttendanceEvent,initialAttendanceState,summarizeAttendanceSession,type AttendanceSession} from "./merchantAttendance";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const query={siteId:"99990001",startEventId:id(10)},employeeId=id(1),workerId=id(2),locationId=id(3);
const event=(n:number,action:AttendanceSessionEvent["action"],occurredAt:string,breakPaid:boolean|null=null,timeZone="Europe/Madrid"):AttendanceSessionEvent=>({
  id:id(10+n),locationId,sequence:101+n,action,occurredAt,breakPaid,timeZone,source:"web"});
const events=[event(0,"clock_in","2026-09-01T08:00:00.000000Z"),event(1,"break_start","2026-09-01T10:00:00.000000Z",false),
  event(2,"break_end","2026-09-01T10:30:00.000000Z"),event(3,"break_start","2026-09-01T12:00:00.000000Z",true),
  event(4,"break_end","2026-09-01T12:15:00.000000Z"),event(5,"clock_out","2026-09-01T16:00:00.000000Z")];
const payload=(items:AttendanceSessionEvent[]=events)=>({ok:true,moduleEnabled:false,...query,employeeId,workerId,asOf:"2026-12-01T00:00:00.000000Z",events:items});
const read=(items=events)=>parseAttendanceSessionResult(payload(items),query);
const report=(items=events)=>summarizeAttendanceSessionRecords(read(items));
const H=3600000000;
test("session query rejects target identity, filters, duplicates and fabricated starts",()=>{
  const url=`https://local.invalid/?${new URLSearchParams(query)}`;
  assert.deepEqual(parseAttendanceSessionQuery(url),query);
  for(const field of ["workerId","employeeId","authUserId","fromAt","limit","source","role"])assert.throws(()=>parseAttendanceSessionQuery(`${url}&${field}=x`));
  assert.throws(()=>parseAttendanceSessionQuery(`${url}&siteId=99990002`));assert.throws(()=>parseAttendanceSessionQuery("https://local.invalid/?siteId=99990001"));
});
test("completed shift separates all rest, marked-paid rest and actual recorded work segments",()=>{
  const r=report();assert.equal(r.status,"completed");assert.deepEqual(r.totals,{elapsedUs:8*H,breakUs:.75*H,paidBreakUs:.25*H,workedUs:7.25*H});
  assert.equal(r.breaks.length,2);assert.equal(r.days.length,1);assert.equal(r.timeZone,"Europe/Madrid");
  assert.ok(!("wages" in r)&&!("overtime" in r)&&!("creditedUs" in r.totals!));
});
test("history page boundaries never clip a session; midnight rest is split in start-location time zone",()=>{
  const r=report([event(0,"clock_in","2026-09-01T20:00:00.000000Z"),event(1,"break_start","2026-09-01T21:30:00.000000Z",true),
    event(2,"break_end","2026-09-01T22:30:00.000000Z",null,"UTC"),event(3,"clock_out","2026-09-02T04:00:00.000000Z",null,"Asia/Shanghai")]);
  assert.deepEqual(r.days.map(d=>[d.date,d.elapsedUs,d.breakUs,d.paidBreakUs,d.workedUs]),[
    ["2026-09-01",2*H,.5*H,.5*H,1.5*H],["2026-09-02",6*H,.5*H,.5*H,5.5*H]]);
});
for(const [start,end,expected] of [
  ["2026-03-28T23:00:00.000000Z","2026-03-29T22:00:00.000000Z",23],
  ["2026-10-24T22:00:00.000000Z","2026-10-25T23:00:00.000000Z",25],
] as const)test(`Madrid DST is elapsed UTC time, not presumed 24 hours (${expected})`,()=>{
  const r=report([event(0,"clock_in",start),event(1,"clock_out",end)]);assert.equal(r.totals!.workedUs,expected*H);assert.equal(r.days.length,1);
});
test("microseconds survive day boundaries and submillisecond sessions",()=>{
  const r=report([event(0,"clock_in","2026-09-01T23:59:59.999999Z",null,"UTC"),event(1,"clock_out","2026-09-02T00:00:00.000001Z",null,"UTC")]);
  assert.equal(r.totals!.elapsedUs,2);assert.deepEqual(r.days.map(d=>d.elapsedUs),[1,1]);
  assert.equal(r.days[0].startAt,"2026-09-01T23:59:59.999999Z");assert.equal(r.days[1].endAt,"2026-09-02T00:00:00.000001Z");
  const tiny=report([event(0,"clock_in","2026-09-01T12:00:00.000001Z"),event(1,"clock_out","2026-09-01T12:00:00.000002Z")]);
  assert.equal(tiny.totals!.elapsedUs,1);assert.equal(tiny.days.length,1);
  assert.equal(formatAttendanceDurationUs(1),"0 小时 0 分 0.000001 秒");
  for(const invalid of [-1,.1,Infinity,NaN,2678400000001])assert.throws(()=>formatAttendanceDurationUs(invalid));
});
test("same local clock time during DST fallback is not a zero-length shift",()=>{
  const r=report([event(0,"clock_in","2026-10-25T00:30:00.000000Z"),event(1,"clock_out","2026-10-25T01:30:00.000000Z")]);
  assert.equal(r.totals!.workedUs,H);assert.equal(r.days[0].date,"2026-10-25");
});
test("a skipped local calendar day is not fabricated in daily reconstruction",()=>{
  const r=report([event(0,"clock_in","2011-12-29T10:00:00.000000Z",null,"Pacific/Apia"),event(1,"clock_out","2011-12-31T10:00:00.000000Z",null,"Pacific/Apia")]);
  assert.equal(r.totals!.workedUs,48*H);assert.deepEqual(r.days.map(d=>d.date),["2011-12-29","2011-12-31"]);
});
test("open work and open rest have no fabricated end, durations or daily totals",()=>{
  for(const items of [events.slice(0,1),events.slice(0,2),events.slice(0,3)]){
    const r=report(items);assert.equal(r.endAt,null);assert.equal(r.totals,null);assert.deepEqual(r.days,[]);
    assert.equal(r.openBreak!==null,items.length===2);
  }
});
test("zero duration is preserved, not inflated to minimum clocking granularity",()=>{
  const r=report([events[0],event(1,"clock_out",events[0].occurredAt)]);assert.equal(r.totals!.elapsedUs,0);assert.deepEqual(r.days,[]);
});
test("broken sequences, transitions, IDs, break types and future times fail without partial totals",()=>{
  const variants=[[],[{...events[0],action:"break_end"}],[events[0],{...events[1],sequence:103}],
    [events[0],{...events[1],id:events[0].id}],[events[0],event(1,"clock_in",events[1].occurredAt)],
    [events[0],event(1,"break_end",events[1].occurredAt)],[...events.slice(0,2),event(2,"clock_out",events[2].occurredAt)],
    [...events,event(6,"clock_in","2026-09-02T08:00:00.000000Z")],
    [events[0],{...events[1],occurredAt:"2026-08-01T00:00:00.000000Z"}],
    [events[0],{...events[1],breakPaid:null}],[{...events[0],source:["web"]}],
    [{...events[0],occurredAt:"2027-01-01T00:00:00.000000Z"}],[{...events[0],sequence:0}],
    [{...events[0],timeZone:"UTC+1"}],[{...events[0],id:id(500)}],[{...events[0],breakPaid:true}]];
  for(const items of variants)assert.throws(()=>parseAttendanceSessionResult({...payload(),events:items},query));
  assert.throws(()=>parseAttendanceSessionResult({...payload(),siteId:"99990002"},query));
});
test("31-day completed duration boundary is exact and never truncates a longer session",()=>{
  const start=event(0,"clock_in","2026-09-01T00:00:00.000000Z",null,"UTC");
  assert.equal(report([start,event(1,"clock_out","2026-10-02T00:00:00.000000Z")]).totals!.elapsedUs,31*24*H);
  assert.throws(()=>report([start,event(1,"clock_out","2026-10-02T00:00:00.000001Z")]),/attendance_session_span_too_long/);
});
test("1000 breaks and 2002 facts are bounded and remain small enough for the client response cap",()=>{
  const items=[events[0]];
  for(let n=0;n<1000;n++)items.push(event(n*2+1,"break_start",events[0].occurredAt,n%2===0),event(n*2+2,"break_end",events[0].occurredAt));
  items.push(event(2001,"clock_out",events[0].occurredAt));assert.equal(report(items).breaks.length,1000);
  assert.ok(Buffer.byteLength(JSON.stringify(payload(items)))<1048576);
  assert.throws(()=>read([...items,event(2002,"clock_in",events[0].occurredAt)]));
});
test("raw internal fields and operation/auth identity are stripped before transport",()=>{
  const r=parseAttendanceSessionResult({...payload(),authUserId:id(90),events:events.map(e=>({...e,operationId:id(91),actorAuthUserId:id(92),evidence:{latitude:5}}))},query);
  assert.doesNotMatch(JSON.stringify(r),/operationId|actorAuth|latitude/);
});
test("microsecond projection agrees with existing pure reducer for ordinary millisecond shifts",()=>{
  for(let n=0;n<40;n++){
    const start=Date.parse("2026-09-01T00:00:00.000Z")+n*60000;
    const times=[0,10+n,20+n,60+n].map(m=>new Date(start+m*60000).toISOString());
    const items=[event(0,"clock_in",times[0]),event(1,"break_start",times[1],n%2===0),event(2,"break_end",times[2]),event(3,"clock_out",times[3])];
    let state=initialAttendanceState(query.siteId,workerId),session:AttendanceSession|null=null;
    items.forEach((item,i)=>{const result=applyAttendanceEvent(state,{...item,sequence:i+1,siteId:query.siteId,workerId,operationId:id(400+i)});state=result.state;session=result.completedSession;});
    const old=summarizeAttendanceSession(session!),next=report(items).totals!;
    assert.equal(next.elapsedUs,old.elapsedMs*1000);assert.equal(next.workedUs,old.workedMs*1000);assert.equal(next.breakUs,old.breakMs*1000);assert.equal(next.paidBreakUs,old.paidBreakMs*1000);
  }
});
test("server adapter forwards only verified principal and selected clock-in to the dedicated RPC",async()=>{
  let args:unknown;const r=await executeAttendanceSession({...query,authUserId:id(8)},{rpc:async(name,parameters)=>{assert.equal(name,"faolla_attendance_self_session_v1");args=parameters;return {data:payload(),error:null};}});
  assert.deepEqual(args,{p_site_id:query.siteId,p_auth_user_id:id(8),p_start_event_id:query.startEventId});assert.equal(r.events.length,6);
  await assert.rejects(executeAttendanceSession({...query,authUserId:id(8)},null),/attendance_unavailable/);
  await assert.rejects(executeAttendanceSession({...query,authUserId:id(8)},{rpc:async()=>({data:null,error:{message:"private SQL"}})}),/attendance_unavailable/);
  await assert.rejects(executeAttendanceSession({...query,authUserId:id(8)},{rpc:async()=>({data:payload([events[0],events[2]]),error:null})}),/attendance_session_invalid_records/);
});
const make=(apiFetch:AttendanceApiFetch,timeoutMs?:number)=>new AttendanceSessionClient({...query,employeeId,apiFetch,timeoutMs});
test("session client is idle until explicit load and performs no write, polling or prefetch",async()=>{
  const calls:string[]=[];const c=make(async(url,init)=>{calls.push(url);assert.notEqual(init?.method,"POST");return Response.json(payload());});
  assert.equal(calls.length,0);await c.load();assert.equal(calls.length,1);assert.equal(c.getSnapshot().report!.totals!.workedUs,7.25*H);
  assert.equal(c.getSnapshot().result!.moduleEnabled,false);c.invalidate();assert.equal(c.getSnapshot().report,null);assert.equal(calls.length,1);
});
test("denial, changed employee, malformed and oversized responses clear all prior calculations",async()=>{
  for(const response of [()=>Response.json({ok:false,error:"attendance_access_denied"},{status:403}),
    ()=>Response.json({...payload(),employeeId:id(88)}),()=>Response.json({...payload(),events:[events[0],events[2]]}),
    ()=>Response.json({...payload(),moduleEnabled:"true"}),()=>new Response("x".repeat(1048577),{headers:{"content-type":"application/json"}})]){
    let calls=0;const c=make(async()=>++calls===1?Response.json(payload()):response());await c.load();assert.equal(c.getSnapshot().phase,"ready");
    await c.load();assert.equal(c.getSnapshot().phase,"blocked");assert.equal(c.getSnapshot().result,null);assert.equal(c.getSnapshot().report,null);assert.equal(calls,2);
  }
});
test("hidden or replaced loads abort in flight and ignore late results",async()=>{
  let release!:(r:Response)=>void,signal:AbortSignal|undefined;const c=make(async(_url,init)=>{signal=init?.signal??undefined;return new Promise<Response>(r=>{release=r;});});
  const task=c.load();await Promise.resolve();c.invalidate();assert.equal(signal?.aborted,true);release(Response.json(payload()));await task;assert.equal(c.getSnapshot().report,null);
  let calls=0,old!:(r:Response)=>void;const d=make(async()=>++calls===1?new Promise<Response>(r=>{old=r;}):Response.json(payload(events.slice(0,1))));
  const first=d.load();await Promise.resolve();await d.load();old(Response.json(payload()));await first;assert.equal(d.getSnapshot().report!.status,"working");
});
test("session timeout and HTML responses are not successful calculations or retries",async()=>{
  let calls=0;const c=make(async()=>{calls++;return new Promise<Response>(()=>{});},5);await c.load();assert.equal(c.getSnapshot().phase,"blocked");assert.equal(calls,1);
  const d=make(async()=>new Response("<html>login</html>",{headers:{"content-type":"text/html"}}));await d.load();assert.equal(d.getSnapshot().report,null);
});
test("definitive session denials notify the parent once without needing a JSON auth envelope",async()=>{
  const responses=[
    ()=>new Response("login required",{status:401,headers:{"content-type":"text/html"}}),
    ()=>Response.json({error:"password_required"},{status:403}),
    ()=>Response.json({ok:false,error:"attendance_access_denied"},{status:403}),
    ()=>Response.json({ok:false,error:"attendance_session_not_found"},{status:404}),
    ()=>Response.json({ok:false,error:"attendance_worker_changed"},{status:409}),
  ];
  for(const response of responses){
    let denied=0,calls=0;
    const c=new AttendanceSessionClient({...query,employeeId,expectedWorkerId:workerId,
      apiFetch:async()=>++calls===1?Response.json(payload()):response(),onIdentityInvalidated:()=>{denied++;}});
    await c.load();assert.equal(c.getSnapshot().phase,"ready");assert.equal(denied,0);
    await c.load();assert.equal(denied,1);assert.equal(calls,2);
    assert.equal(c.getSnapshot().result,null);assert.equal(c.getSnapshot().report,null);
    assert.equal(c.getSnapshot().phase,"blocked");
  }
});
test("only structurally valid successful identity mismatches notify the parent; worker expectation is local only",async()=>{
  for(const body of [{...payload(),siteId:"99990002"},{...payload(),employeeId:id(88)},
    {...payload(),workerId:id(88)},payload([{...events[0],id:id(88)},...events.slice(1)])]){
    let denied=0;
    const c=new AttendanceSessionClient({...query,employeeId,expectedWorkerId:workerId,
      apiFetch:async(url,init)=>{
        assert.deepEqual(Object.fromEntries(new URL(url,"https://local.invalid").searchParams),query);
        assert.notEqual(init?.method,"POST");return Response.json(body);
      },onIdentityInvalidated:()=>{denied++;}});
    await c.load();assert.equal(denied,1);assert.equal(c.getSnapshot().result,null);
  }
  // Standalone callers that do not come from a bound history page retain the
  // original optional-worker contract; the server still resolves their worker.
  const standalone=make(async()=>Response.json({...payload(),workerId:id(88)}));
  await standalone.load();assert.equal(standalone.getSnapshot().phase,"ready");
});
test("malformed, transient, rate-limited or unavailable sessions never fabricate a parent revocation",async()=>{
  const cases:Array<()=>Response|Promise<Response>>=[
    ()=>Response.json({ok:true,moduleEnabled:false,siteId:"99990002",employeeId,workerId}),
    ()=>Response.json({...payload(),employeeId:id(88),events:[events[0],events[2]]}),
    ()=>Response.json({...payload(),workerId:"invalid"}),
    ()=>Response.json({...payload(),moduleEnabled:"true"}),
    ()=>Response.json({ok:false,error:"attendance_session_not_found"},{status:500}),
    ()=>Response.json({ok:false,error:"attendance_access_denied"},{status:503}),
    ()=>Response.json({ok:false,error:"attendance_rate_limited"},{status:429}),
    ()=>Response.json({ok:false,error:"attendance_not_available"},{status:404}),
    ()=>Response.json({ok:false,error:"attendance_settings_required"},{status:409}),
    ()=>Response.json({ok:false,error:"attendance_session_invalid_records"},{status:422}),
    ()=>new Response("gateway error",{status:502}),
    ()=>{throw Error("attendance_access_denied");},
  ];
  for(const response of cases){
    let denied=0;
    const c=new AttendanceSessionClient({...query,employeeId,expectedWorkerId:workerId,
      apiFetch:async()=>response(),onIdentityInvalidated:()=>{denied++;}});
    await c.load();assert.equal(c.getSnapshot().phase,"blocked");assert.equal(denied,0);
    assert.equal(c.getSnapshot().result,null);assert.equal(c.getSnapshot().report,null);
  }
  let denied=0,calls=0;
  const timeout=new AttendanceSessionClient({...query,employeeId,timeoutMs:5,
    apiFetch:async()=>{calls++;return new Promise<Response>(()=>{});},onIdentityInvalidated:()=>{denied++;}});
  await timeout.load();assert.equal(denied,0);assert.equal(calls,1);
});
test("session-not-found message acknowledges uncertain ownership or completeness, not nonexistent facts",async()=>{
  const c=make(async()=>Response.json({ok:false,error:"attendance_session_not_found"},{status:404}));
  await c.load();assert.match(c.getSnapshot().message,/无法确认当前本人可查看的完整班次/);
  assert.match(c.getSnapshot().message,/重新查询历史或联系负责人/);assert.match(c.getSnapshot().message,/不会切换人员或修改记录/);
  assert.doesNotMatch(c.getSnapshot().message,/不存在|已删除/);
});
test("hidden, disposed and superseded session requests cannot notify a newer parent selection",async()=>{
  for(const response of [()=>Response.json({ok:false,error:"attendance_session_not_found"},{status:404}),
    ()=>new Response("unauthorized",{status:401}),()=>Response.json({...payload(),workerId:id(88)})]){
    for(const mode of ["hidden","disposed","superseded"] as const){
      let release!:(r:Response)=>void,denied=0,calls=0;
      const c=new AttendanceSessionClient({...query,employeeId,expectedWorkerId:workerId,
        apiFetch:async()=>++calls===1?new Promise<Response>(resolve=>{release=resolve;}):Response.json(payload()),
        onIdentityInvalidated:()=>{denied++;}});
      const pending=c.load();await Promise.resolve();
      if(mode==="hidden")c.invalidate();else if(mode==="disposed")c.dispose();else await c.load();
      release(response());await pending;await Promise.resolve();assert.equal(denied,0);
      if(mode==="superseded")assert.equal(c.getSnapshot().phase,"ready");
      else assert.equal(c.getSnapshot().result,null);
      if(mode==="disposed"){await c.load();assert.equal(calls,1);await c.initialize();assert.equal(calls,2);assert.equal(c.getSnapshot().phase,"ready");}
    }
  }
});
test("synchronous subscriber disposal suppresses a denial callback after the blocked state was emitted",async()=>{
  let denied=0;
  const c=new AttendanceSessionClient({...query,employeeId,
    apiFetch:async()=>Response.json({ok:false,error:"attendance_session_not_found"},{status:404}),
    onIdentityInvalidated:()=>{denied++;}});
  const unsubscribe=c.subscribe(()=>{if(c.getSnapshot().phase==="blocked")c.dispose();});
  await c.load();unsubscribe();assert.equal(denied,0);assert.equal(c.getSnapshot().result,null);
});
