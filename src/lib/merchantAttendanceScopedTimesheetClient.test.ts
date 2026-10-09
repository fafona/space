import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {AttendanceScopedTimesheetClient} from "./merchantAttendanceScopedTimesheetClient";
import {parseScopedTimesheetResponse} from "./merchantAttendanceScopedTimesheetResponse";
import {parseScopedContextQuery,parseScopedContext,scopedPairKey} from "./merchantAttendanceScopedTimesheetContext";
import {createScopedClientFixture,scopedActor,scopedComputed,scopedContextFixture} from "../../scripts/fixtures/attendance-scoped-timesheet-client-model";
import {scopedSelfQuery,scopedManagerQuery} from "../../scripts/fixtures/attendance-scoped-timesheet-model";
const siteId=scopedSelfQuery.siteId;
function setup(t:TestContext,access:"self"|"manager"="manager",extra:Partial<ConstructorParameters<typeof AttendanceScopedTimesheetClient>[0]>={}){
  const f=createScopedClientFixture(),client=new AttendanceScopedTimesheetClient({siteId,actorId:scopedActor(access),access,apiFetch:f.apiFetch,timeoutMs:300,...extra});
  t.after(()=>{client.invalidate();f.release();});return {f,client};
}
const dates=(c:AttendanceScopedTimesheetClient)=>c.setDates("2026-09-01","2026-09-30");
async function ready(t:TestContext,access:"self"|"manager"="manager"){
  const x=setup(t,access);await x.client.initialize();if(access==="manager")x.client.selectPair(scopedPairKey(x.client.getSnapshot().context!.items[0]));dates(x.client);return x;
}
test("self initialization uses server date and own binding, no owner API or automatic report",async t=>{
  const {f,client}=setup(t,"self");await client.initialize();assert.equal(client.getSnapshot().throughDate,"2026-10-02");assert.equal(client.getSnapshot().fromDate,"2026-09-26");dates(client);assert.equal(f.calls.length,1);assert.equal(client.getSnapshot().context!.worker!.id,scopedManagerQuery.access==="manager"?scopedManagerQuery.workerId:"");
  await client.load();assert.equal(client.getSnapshot().result?.access,"self");assert(f.calls[1].url.includes("expectedWorkerId="));assert(f.calls.every(c=>c.method==="GET"&&!/\/admin|\/choices/.test(c.url)));
});
test("manager same worker different location stays an explicit pair and clears prior result",async t=>{
  const {f,client}=await ready(t);await client.load();const calls=f.calls.length;const second=client.getSnapshot().context!.items[1];client.selectPair(scopedPairKey(second));assert.equal(client.getSnapshot().result,null);assert.equal(f.calls.length,calls);
  await client.load();assert.equal(client.getSnapshot().result?.locationId,second.locationId);
});
test("paging/search clear selection and include scope version only with keyset cursor",async t=>{
  const {client,f}=await ready(t);await client.load();const c=client.getSnapshot().context!;await client.loadContext("",c.nextCursor);assert.equal(client.getSnapshot().pair,null);assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().context?.items.length,2);assert(f.calls.at(-1)!.url.includes("scopeRevision=1"));
  await client.loadContext("不存在");assert.equal(client.getSnapshot().context?.items.length,0);
});
test("invalid date can be corrected with same authorized pair, no request on bad range",async t=>{
  const {f,client}=await ready(t),count=f.calls.length;client.setDates("2026-09-01","2026-10-03");await client.load();assert.equal(f.calls.length,count);assert(client.getSnapshot().pair);dates(client);await client.load();assert(client.getSnapshot().result);
});
test("revoked, rebound, changed scope, wrong totals and actor discard all private state",async t=>{
  for(const mode of ["denied","rebound","revision","tampered","wrongactor","large","offline"]){const {f,client}=await ready(t);await client.load();f.mode(mode);await client.load();assert.equal(client.getSnapshot().phase,"blocked",mode);assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().context,null);assert.equal(client.getSnapshot().pair,null);}
});
test("superseded and hidden requests cannot publish late bodies",async t=>{
  const {f,client}=await ready(t);client.setSearch("private name");f.mode("held");const pending=client.load();await Promise.resolve();client.invalidate();f.release();await pending;
  assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().fromDate,"");assert.equal(client.getSnapshot().searchDraft,"");assert(f.calls.at(-1)!.signal?.aborted);
});
test("changing dates during delayed request prevents stale report writeback",async t=>{
  const {f,client}=await ready(t);f.mode("held");const pending=client.load();await Promise.resolve();client.setDates("2026-09-02","2026-09-30");f.release();await pending;assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().fromDate,"2026-09-02");
});
test("finite grant expiry is relative to server snapshot and monotonic roundtrip not device wall clock",async t=>{
  let clock=0;const {f,client}=setup(t,"manager",{monotonicNow:()=>clock});f.mode("expiring");await client.initialize();client.selectPair(scopedPairKey(client.getSnapshot().context!.items[0]));dates(client);f.mode("normal");await client.load();assert(client.getSnapshot().result);
  clock=5000;const count=f.calls.length;await client.load();assert.equal(client.getSnapshot().context,null);assert.equal(f.calls.length,count);assert.match(client.getSnapshot().message,/到期/);
});
test("display lease cannot be prolonged by repeated report reads and expires without network",async t=>{
  let clock=0;const {f,client}=setup(t,"self",{monotonicNow:()=>clock});await client.initialize();dates(client);clock=299000;await client.load();assert(client.getSnapshot().result);clock=300001;const count=f.calls.length;await client.load();assert.equal(client.getSnapshot().result,null);assert.equal(f.calls.length,count);
});
test("slow headers and malformed HTTP never retain older report",async t=>{
  const {f,client}=await ready(t);await client.load();f.mode("held");await client.load();assert.equal(client.getSnapshot().phase,"blocked");assert.equal(client.getSnapshot().context,null);
});
test("computed scope wire never becomes owner data and independently checks all totals",()=>{
  for(const q of [scopedSelfQuery,scopedManagerQuery]){const wire=scopedComputed(q),before=structuredClone(wire),r=parseScopedTimesheetResponse(wire,q,scopedActor(q.access));assert.equal("employeeId" in r,false);assert.equal(r.coverage,"authorized-complete-sessions-v1");assert.deepEqual(wire,before);
    for(const patch of [{employeeId:null},{access:"owner"},{coverage:"full-person"},{viewerEmployeeId:scopedActor(q.access==="self"?"manager":"self")},{accessValidUntil:wire.asOf}])assert.throws(()=>parseScopedTimesheetResponse({...wire,...patch},q,scopedActor(q.access)));
    wire.days[0].selected.workedUs++;assert.throws(()=>parseScopedTimesheetResponse(wire,q,scopedActor(q.access)));
  }
});
test("context query forbids foreign identities, self selectors, duplicates and unversioned cursors",()=>{
  const base="https://local.invalid/?siteId="+siteId+"&access=";
  for(const tail of ["self&workerId=x","self&search=x","manager&authUserId=x","manager&search=x&search=y","manager&cursor=x","manager&scopeRevision=1"])assert.throws(()=>parseScopedContextQuery(base+tail));
  assert.equal(parseScopedContextQuery(base+"self").search,"");
});
test("context response enforces ordered bounded pairs and self-only profile",()=>{
  const q=parseScopedContextQuery("https://local.invalid/?siteId="+siteId+"&access=manager"),v=scopedContextFixture(q);assert.equal(parseScopedContext(v,q).items.length,25);
  assert.throws(()=>parseScopedContext({...v,items:[v.items[1],v.items[0]],nextCursor:null},q));assert.throws(()=>parseScopedContext({...v,worker:{id:"x"}},q));assert.throws(()=>parseScopedContext({...v,items:[...v.items,...v.items]},q));
  const self={...q,access:"self" as const};assert.throws(()=>parseScopedContext({...scopedContextFixture(self),items:[v.items[0]]},self));
});
