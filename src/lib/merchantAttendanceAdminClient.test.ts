import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAdminClient } from "./merchantAttendanceAdminClient";
import type { AttendanceAdminCommand, AttendanceAdminResult } from "./merchantAttendanceAdmin";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const settings={timeZone:"UTC",enabled:false,webClockEnabled:false,webBreakPaid:false};
function setup() {
  const map=new Map<string,string>();let writes=0,gets=0,version=0;let mode="normal";let moduleEnabled=true;let held:(()=>void)|null=null;
  const receipts=new Map<string,AttendanceAdminResult["receipt"]>();
  const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
  const apiFetch=async(url:string,init:RequestInit={})=>{
    const q=new URL(url,"https://www.faolla.com").searchParams;
    const result=(operationId:string|null,view="settings"):AttendanceAdminResult=>({siteId:"99990001",version,settings:version?settings:null,view:view as AttendanceAdminResult["view"],items:[],nextCursor:null,receipt:operationId?receipts.get(operationId)??null:null});
    if(init.method!=="POST"){gets++;if(mode==="offline")throw Error("offline");return Response.json({ok:true,moduleEnabled,...result(q.get("operationId"),q.get("view")??"settings")});}
    writes++;assert.equal(map.size,1,"persist before POST");
    if(!moduleEnabled)return Response.json({ok:false,error:"attendance_platform_paused"},{status:403});
    if(mode==="hold")await new Promise<void>(r=>{held=r;});
    if(mode==="offline")throw Error("offline");
    if(mode==="denied")return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
    if(mode==="proxy")return Response.json({ok:false,error:"upstream_uncertain"},{status:400});
    if(mode==="html")return new Response("<html>oops</html>",{status:200,headers:{"Content-Type":"text/html"}});
    const body=JSON.parse(init.body as string) as AttendanceAdminCommand;
    if(!receipts.has(body.operationId)) {
      if(body.expectedVersion!==version)return Response.json({ok:false,error:"attendance_version_conflict"},{status:409});
      version++;receipts.set(body.operationId,{operationId:body.operationId,version,kind:body.kind,targetId:body.kind==="settings"?null:body.values.id});
    }
    if(mode==="lost")throw Error("lost_after_commit");
    return Response.json({ok:true,moduleEnabled,...result(body.operationId)});
  };
  let op=0;
  const make=(extra: Partial<ConstructorParameters<typeof AttendanceAdminClient>[0]>={})=>new AttendanceAdminClient({siteId:"99990001",ownerId:id(9),storage:()=>storage,apiFetch,randomId:()=>id(++op),...extra});
  return {make,map,storage,receipts,counts:()=>({writes,gets,version}),mode:(s:string)=>{mode=s;},pause:()=>{moduleEnabled=false;},release:()=>held?.(),bump:()=>{version++;}};
}
test("config saves persist intent first and double-click creates one request",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode("hold");const first=c.submit({kind:"settings",values:settings},0);
  await Promise.resolve();await c.submit({kind:"settings",values:settings},0);s.release();await first;
  assert.equal(s.counts().writes,1);assert.equal(c.getSnapshot().pending,null);assert.match(c.getSnapshot().message,/已确认/);
});
test("lost config response recovers receipt on remount without another POST",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode("lost");await c.submit({kind:"settings",values:settings},0);
  assert.equal(c.getSnapshot().phase,"unconfirmed");c.dispose();s.mode("normal");const next=s.make();await next.initialize();
  assert.equal(s.counts().writes,1);assert.equal(next.getSnapshot().pending,null);assert.match(next.getSnapshot().message,/已确认/);
});
test("unknown receipt keeps same operation until explicit retry",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode("offline");await c.submit({kind:"settings",values:settings},0);const op=c.getSnapshot().pending!.command.operationId;
  s.mode("normal");await c.load();assert.equal(c.getSnapshot().pending?.command.operationId,op);await c.retry();assert.equal(s.counts().version,1);assert.ok(s.receipts.has(op));
});
test("newer version fences unresolved original command without pretending success",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode("offline");await c.submit({kind:"settings",values:settings},0);s.bump();s.mode("normal");await c.load();
  assert.equal(c.getSnapshot().pending,null);assert.match(c.getSnapshot().message,/未找到/);assert.equal(s.counts().writes,1);
});
test("first rejection clears intent but retry rejection preserves possible old commit",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode("denied");await c.submit({kind:"settings",values:settings},0);assert.equal(c.getSnapshot().pending,null);
  s.mode("normal");await c.load();s.mode("offline");await c.submit({kind:"settings",values:settings},0);s.mode("denied");await c.retry();assert.ok(c.getSnapshot().pending);assert.equal(c.getSnapshot().result,null);
});
for(const mode of ["proxy","html"])test(`uncertain ${mode} response retains intent`,async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode(mode);await c.submit({kind:"settings",values:settings},0);assert.equal(c.getSnapshot().phase,"unconfirmed");assert.ok(c.getSnapshot().pending);
});
test("blocked, corrupt or silently failing storage never posts",async()=>{
  const s=setup();const c=s.make({storage:()=>({...s.storage,setItem:()=>{}})});await c.initialize();await c.submit({kind:"settings",values:settings},0);assert.equal(s.counts().writes,0);
  s.map.set(c.storageKey,"corrupt");const n=s.make();await n.initialize();assert.equal(n.getSnapshot().phase,"blocked");assert.equal(s.map.get(c.storageKey),"corrupt");
});
test("old draft version is not silently upgraded after newer reads",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.bump();await c.load();await c.submit({kind:"settings",values:settings},0);assert.match(c.getSnapshot().message,/已被修改/);assert.equal(s.counts().version,1);
});
test("same-tab instance cannot overwrite an existing unresolved operation",async()=>{
  const s=setup(),a=s.make(),b=s.make();await a.initialize();await b.initialize();s.mode("offline");await a.submit({kind:"settings",values:settings},0);await b.submit({kind:"settings",values:settings},0);
  assert.equal(s.counts().writes,1);assert.equal(a.getSnapshot().pending?.command.operationId,b.getSnapshot().pending?.command.operationId);
});
test("owner and tenant storage scopes are distinct; disposal ignores late responses",async()=>{
  const s=setup(),c=s.make(),other=s.make({ownerId:id(8)});assert.notEqual(c.storageKey,other.storageKey);await c.initialize();s.mode("hold");const work=c.submit({kind:"settings",values:settings},0);await Promise.resolve();c.dispose();s.release();await work;assert.ok(c.getSnapshot().pending);
});
test("invalid form stays editable without persistence or POST",async()=>{
  const s=setup(),c=s.make();await c.initialize();const confirmed=await c.submit({kind:"settings",values:{...settings,timeZone:"Europe/Fake"}},0);
  assert.ok(!confirmed,"invalid form must not close the editor");
  assert.equal(c.getSnapshot().phase,"ready");assert.equal(s.counts().writes,0);assert.equal(s.map.size,0);assert.match(c.getSnapshot().message,/时区/);
});
test("confirmed list save stays on its list with confirmation and no second write",async()=>{
  const s=setup(),c=s.make();await c.initialize();await c.load("locations",null,"");
  const confirmed=await c.submit({kind:"location",values:{id:id(33),name:"Main",timeZone:"UTC",active:true}},0);
  assert.equal(confirmed,true,"confirmed list save can close its editor after the list refresh");
  assert.equal(c.getSnapshot().result?.view,"locations");assert.match(c.getSnapshot().message,/已确认/);assert.equal(s.counts().writes,1);
});
test("paused config is readable but cannot create pending writes",async()=>{
  const s=setup(),c=s.make();s.pause();await c.initialize();await c.submit({kind:"settings",values:settings},0);
  assert.equal(c.getSnapshot().phase,"ready");assert.equal(c.getSnapshot().result?.moduleEnabled,false);assert.equal(s.counts().writes,0);assert.equal(s.map.size,0);
});
test("pause after a lost response still recovers original receipt without writing",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.mode("lost");await c.submit({kind:"settings",values:settings},0);c.dispose();s.pause();s.mode("normal");
  const next=s.make();await next.initialize();assert.equal(s.counts().writes,1);assert.equal(next.getSnapshot().pending,null);assert.match(next.getSnapshot().message,/已确认/);assert.equal(next.getSnapshot().result?.moduleEnabled,false);
});
test("pause after form load rejects stale save; unconfirmed retry retains intent",async()=>{
  const s=setup(),c=s.make();await c.initialize();s.pause();await c.submit({kind:"settings",values:settings},0);
  assert.equal(c.getSnapshot().pending,null);assert.match(c.getSnapshot().message,/暂停/);assert.equal(s.counts().version,0);
  const n=setup(),a=n.make();await a.initialize();n.mode("offline");await a.submit({kind:"settings",values:settings},0);n.pause();n.mode("normal");await a.retry();
  assert.ok(a.getSnapshot().pending);assert.equal(a.getSnapshot().phase,"unconfirmed");assert.equal(n.counts().version,0);
});
test("missing admission status is not accepted as a writable server response",async()=>{
  const s=setup(),c=s.make({apiFetch:async()=>Response.json({ok:true,siteId:"99990001",version:0,settings:null,view:"settings",items:[],nextCursor:null,receipt:null})});
  await c.initialize();assert.equal(c.getSnapshot().phase,"blocked");await c.submit({kind:"settings",values:settings},0);assert.equal(s.map.size,0);
});

const readAuthorizationErrors = [
  ["unauthorized", 401], ["attendance_access_denied", 403], ["employee_password_authentication_required", 403],
  ["enterprise_management_disabled", 403], ["forbidden_origin", 403],
] as const;
const readSuccess = (moduleEnabled = true) => Response.json({ ok: true, moduleEnabled, siteId: "99990001", version: 0,
  settings: null, view: "settings", items: [], nextCursor: null, receipt: null });
function heldResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { resolve, promise };
}
for (const [error, status] of readAuthorizationErrors) test(`admin GET ${error} advances only the monotonic child invalidation epoch`, async () => {
  const s = setup(); let rejected = false; const methods: string[] = [];
  const c = s.make({ apiFetch: async (_path, init) => {
    methods.push(init?.method ?? "GET");
    return rejected ? Response.json({ ok: false, error }, { status }) : readSuccess(false);
  } });
  assert.equal(c.getSnapshot().authorizationEpoch, 0);
  await c.initialize(); rejected = true; await c.load();
  assert.equal(c.getSnapshot().authorizationEpoch, 1); assert.equal(c.getSnapshot().result, null);
  await c.initialize(); assert.equal(c.getSnapshot().authorizationEpoch, 2, "initialize never resets a denial epoch");
  rejected = false; await c.initialize();
  assert.equal(c.getSnapshot().authorizationEpoch, 2); assert.equal(c.getSnapshot().phase, "ready");
  assert.equal(c.getSnapshot().result?.moduleEnabled, false); assert.deepEqual(methods, ["GET", "GET", "GET", "GET"]);
  assert.equal(s.map.size, 0);
});
test("admin denied GET preserves exact unknown config intent and unrelated storage", async () => {
  const s = setup(), old = s.make(); await old.initialize(); s.mode("offline");
  await old.submit({ kind: "settings", values: settings }, 0); old.dispose();
  const raw = s.map.get(old.storageKey); s.map.set("unrelated", "keep");
  const c = s.make({ apiFetch: async (_path, init) => {
    assert.equal(init?.method, "GET"); return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
  } });
  await c.initialize();
  assert.equal(c.getSnapshot().authorizationEpoch, 1); assert.equal(c.getSnapshot().phase, "unconfirmed");
  assert.equal(s.map.get(c.storageKey), raw); assert.deepEqual(c.getSnapshot().pending, JSON.parse(raw!));
  assert.equal(s.map.get("unrelated"), "keep"); assert.equal(s.counts().writes, 1);
});
test("admin transient, business, malformed and storage failures never signal child authorization loss", async () => {
  const cases = [
    () => Response.json({ ok: false, error: "attendance_unavailable" }, { status: 503 }),
    () => Response.json({ ok: false, error: "attendance_rate_limited" }, { status: 429 }),
    ...["attendance_platform_paused", "attendance_disabled", "attendance_web_disabled", "unknown"].map(error =>
      () => Response.json({ ok: false, error }, { status: 403 })),
    () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 500 }),
    () => Response.json({ ok: true, error: "attendance_access_denied" }, { status: 403 }),
    () => Response.json({ ok: false, error: "unauthorized", extra: true }, { status: 401 }),
    () => new Response("login", { status: 401, headers: { "Content-Type": "text/html" } }),
    () => { throw Error("offline"); },
  ];
  for (const response of cases) {
    const s = setup(), c = s.make({ apiFetch: async () => response() }); await c.initialize();
    assert.equal(c.getSnapshot().authorizationEpoch, 0);
  }
  const s = setup(), c = s.make(); s.map.set(c.storageKey, "invalid pending"); await c.initialize();
  assert.equal(c.getSnapshot().authorizationEpoch, 0); assert.equal(s.counts().gets, 0);
});
test("admin stale or disposed GET denial cannot advance the current authorization epoch", async () => {
  for (const restart of [false, true]) {
    const s = setup(), held = heldResponse(); let count = 0;
    const c = s.make({ apiFetch: async () => ++count === 1 ? held.promise : readSuccess() });
    const before = c.initialize(); c.dispose();
    if (restart) await c.initialize();
    held.resolve(Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 })); await before;
    assert.equal(c.getSnapshot().authorizationEpoch, 0);
    if (restart) assert.equal(c.getSnapshot().phase, "ready");
  }
});
test("admin timed-out GET ignores a late explicit denial even when transport ignores abort", async () => {
  const s = setup(), held = heldResponse(); let signal: AbortSignal | null = null;
  const c = s.make({ timeoutMs: 5, apiFetch: async (_path, init) => { signal = init?.signal ?? null; return held.promise; } });
  await c.initialize(); assert.equal((signal as AbortSignal | null)?.aborted, true);
  held.resolve(Response.json({ ok: false, error: "unauthorized" }, { status: 401 }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(c.getSnapshot().authorizationEpoch, 0);
});
test("admin authorization epoch does not change any first POST or retry pending-cleanup rule", async () => {
  for (const [error, status, clears] of [["attendance_access_denied", 403, true], ["attendance_platform_paused", 403, true],
    ["unauthorized", 401, false], ["enterprise_management_disabled", 403, false]] as const) {
    const s = setup(), c = s.make({ apiFetch: async (_path, init) => init?.method === "POST"
      ? Response.json({ ok: false, error }, { status }) : readSuccess() });
    await c.initialize(); await c.submit({ kind: "settings", values: settings }, 0);
    assert.equal(c.getSnapshot().authorizationEpoch, 0); assert.equal(c.getSnapshot().pending === null, clears);
  }
  const s = setup(), c = s.make(); await c.initialize(); s.mode("offline");
  await c.submit({ kind: "settings", values: settings }, 0); const raw = s.map.get(c.storageKey);
  s.mode("denied"); await c.retry(); assert.equal(c.getSnapshot().authorizationEpoch, 0);
  assert.equal(s.map.get(c.storageKey), raw);
});
test("admin confirmed POST followed by denied list GET invalidates children without undoing its receipt", async () => {
  const s = setup(); let posted = false, posts = 0;
  const c = s.make({ apiFetch: async (path, init) => {
    if (init?.method !== "POST") {
      if (posted) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      const view = new URL(path, "https://fixture.invalid").searchParams.get("view");
      return Response.json({ ok: true, moduleEnabled: true, siteId: "99990001", version: 0, settings: null, view, items: [], nextCursor: null, receipt: null });
    }
    posted = true; posts++; const command = JSON.parse(init.body as string) as AttendanceAdminCommand;
    return Response.json({ ok: true, moduleEnabled: true, siteId: "99990001", version: 1, settings, view: "settings", items: [], nextCursor: null,
      receipt: { operationId: command.operationId, version: 1, kind: command.kind, targetId: command.kind === "settings" ? null : command.values.id } });
  } });
  await c.initialize(); await c.load("locations", null, "");
  assert.equal(await c.submit({ kind: "location", values: { id: id(33), name: "Main", timeZone: "UTC", active: true } }, 0), true);
  assert.equal(posts, 1); assert.equal(c.getSnapshot().authorizationEpoch, 1);
  assert.equal(c.getSnapshot().pending, null); assert.equal(s.map.size, 0); assert.match(c.getSnapshot().message, /不需要重复保存/);
});
