import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceChoiceLabelsClient } from "./merchantAttendanceChoiceLabelsClient";
import { parseAttendanceChoicesQuery } from "./merchantAttendanceChoices";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const choice = (n: number) => ({ id: id(n), label: `合成人员 ${n}`, detail: `T${n}`, eligible: n !== 2 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function setup(transform?: (body: Record<string, unknown>) => Record<string, unknown>) {
  const calls: string[] = [];
  const apiFetch: AttendanceApiFetch = async (url, init) => {
    calls.push(url); assert.equal(init?.cache, "no-store"); assert.ok(!init?.method || init.method === "GET");
    const q = parseAttendanceChoicesQuery(`https://synthetic.invalid${url}`); assert.ok(q.ids); assert.ok(url.length < 1500);
    const body = { ok: true, moduleEnabled: true, siteId: q.siteId, kind: q.kind,
      items: q.ids.map(x => choice(Number(x.slice(-12)))), nextCursor: null };
    return json(transform ? transform(body) : body);
  };
  return { client: new AttendanceChoiceLabelsClient({siteId:"99990001", apiFetch}), calls, apiFetch };
}
test("200 selected workers resolve in eight bounded requests without discovery, POST or ID mutation", async () => {
  const {client,calls}=setup(); const ids=Array.from({length:200},(_,n)=>id(200-n)), original=[...ids];
  await client.load("workers", ids); assert.equal(client.getSnapshot().phase,"ready"); assert.equal(calls.length,8);
  assert.equal(Object.keys(client.getSnapshot().items).length,200); assert.deepEqual(ids,original);
  assert.equal(client.getSnapshot().items[id(2)].eligible,false);
  await client.load("workers", ids); assert.equal(calls.length,8);
});
test("empty selection makes no requests and location selection has a strict 50 item limit", async () => {
  const {client,calls}=setup(); await client.load("workers",[]); assert.equal(calls.length,0);
  await client.load("locations",Array.from({length:50},(_,n)=>id(n+1))); assert.equal(calls.length,2);
  await client.load("locations",Array.from({length:51},(_,n)=>id(n+1))); assert.equal(client.getSnapshot().phase,"failed"); assert.equal(calls.length,2);
});
test("malformed, sparse, duplicate and over-limit IDs fail before network", async () => {
  const {client,calls}=setup();
  for(const ids of [["*"],[id(1),id(1)],new Array<string>(2),Array.from({length:201},(_,n)=>id(n+1))]) {
    await client.load("workers",ids); assert.equal(client.getSnapshot().phase,"failed");
  }
  assert.equal(calls.length,0);
});
test("already validated choices seed labels without requests; kinds with the same UUID stay separate", async () => {
  const {client,calls}=setup(); await client.load("workers",[id(1)],[choice(1)]); assert.equal(calls.length,0);
  await client.load("locations",[id(1)],[{...choice(1),label:"门店 A"}]); assert.equal(client.getSnapshot().items[id(1)].label,"门店 A");
  await client.load("workers",[id(1)]); assert.equal(client.getSnapshot().items[id(1)].label,choice(1).label); assert.equal(calls.length,0);
});
test("missing IDs remain missing, inactive choices remain selected, manual refresh refetches once", async () => {
  const {client,calls}=setup(body=>({...body,items:[choice(2)]})); const ids=[id(1),id(2)];
  await client.load("workers",ids); assert.deepEqual(client.getSnapshot().missing,[id(1)]);
  assert.equal(client.getSnapshot().items[id(2)].eligible,false); assert.deepEqual(ids,[id(1),id(2)]);
  await client.load("workers",ids); assert.equal(calls.length,1);
  await client.load("workers",ids,[],true); assert.equal(calls.length,2);
});
test("removed choices are pruned and reopened editors do not inherit old name caches", async () => {
  const {client,calls,apiFetch}=setup(); await client.load("workers",[id(1),id(2)]);
  await client.load("workers",[id(1)]); assert.equal(calls.length,1);
  await client.load("workers",[id(1),id(2)]); assert.equal(calls.length,2);
  const other=new AttendanceChoiceLabelsClient({siteId:"99990001",apiFetch}); await other.load("workers",[id(1)]); assert.equal(calls.length,3);
});
test("unexpected kind, tenant, IDs, pagination or missing platform flag never become display data", async () => {
  for(const transform of [()=>({}), (b:Record<string,unknown>)=>({...b,siteId:"99990002"}),
    (b:Record<string,unknown>)=>({...b,kind:"locations"}), (b:Record<string,unknown>)=>({...b,items:[choice(99)]}),
    (b:Record<string,unknown>)=>({...b,nextCursor:id(1)}), (b:Record<string,unknown>)=>({...b,moduleEnabled:undefined})]) {
    const {client}=setup(transform); await client.load("workers",[id(1)]);
    assert.equal(client.getSnapshot().phase,"failed"); assert.deepEqual(client.getSnapshot().items,{});
  }
});
test("later batch failure discards partial names and is not automatically retried", async () => {
  let calls=0;
  const {apiFetch}=setup();
  const client=new AttendanceChoiceLabelsClient({siteId:"99990001",apiFetch:async(url,init)=>{
    if(++calls===2) return json({ok:false,error:"attendance_access_denied"},403); return apiFetch(url,init);
  }});
  await client.load("workers",Array.from({length:26},(_,n)=>id(n+1)));
  assert.equal(calls,2); assert.equal(client.getSnapshot().phase,"failed"); assert.deepEqual(client.getSnapshot().items,{});
});
test("refresh rejection clears cached labels and the next read cannot reuse them", async () => {
  let deny=false, calls=0; const {apiFetch}=setup();
  const client=new AttendanceChoiceLabelsClient({siteId:"99990001",apiFetch:async(url,init)=>{
    calls++; return deny ? json({ok:false,error:"attendance_access_denied"},403) : apiFetch(url,init);
  }});
  await client.load("workers",[id(1)]); deny=true; await client.load("workers",[id(1)],[],true);
  assert.deepEqual(client.getSnapshot().items,{}); deny=false; await client.load("workers",[id(1)]); assert.equal(calls,3);
});
test("selection change aborts old reads and late replies cannot repopulate old names", async () => {
  const pending: Array<{url:string;init?:RequestInit;resolve:(value:Response)=>void}>=[];
  const client=new AttendanceChoiceLabelsClient({siteId:"99990001",apiFetch:(url,init)=>new Promise(resolve=>pending.push({url,init,resolve}))});
  const first=client.load("workers",[id(1)]), second=client.load("locations",[id(2)]);
  assert.equal(pending[0].init?.signal?.aborted,true); assert.deepEqual(client.getSnapshot().items,{});
  pending[1].resolve(json({ok:true,moduleEnabled:true,siteId:"99990001",kind:"locations",items:[choice(2)],nextCursor:null})); await second;
  pending[0].resolve(json({ok:true,moduleEnabled:true,siteId:"99990001",kind:"workers",items:[choice(1)],nextCursor:null})); await first;
  assert.equal(client.getSnapshot().kind,"locations"); assert.deepEqual(Object.keys(client.getSnapshot().items),[id(2)]);
});
test("deadline cancels stalled transport and no additional batches are started", async () => {
  let calls=0, signal: AbortSignal | null | undefined;
  const client=new AttendanceChoiceLabelsClient({siteId:"99990001",timeoutMs:20,apiFetch:(_url,init)=>{
    calls++; signal=init?.signal; return new Promise(()=>{});
  }});
  await client.load("workers",Array.from({length:26},(_,n)=>id(n+1))); assert.equal(calls,1);
  assert.equal(signal?.aborted,true); assert.equal(client.getSnapshot().phase,"failed");
});
