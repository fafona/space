import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceTerminalClient } from "./merchantAttendanceTerminalClient";
const id="00000000-0000-4000-8000-000000000001",siteId="99990001",secret="A".repeat(43);
const item={id,label:"前台",locationId:id,locationName:"门店",timeZone:"UTC",state:"pending",createdAt:"2026-10-01T10:00:00.000000Z",
  pairExpiresAt:"2026-10-01T10:05:00.000000Z",pairedAt:null,deviceExpiresAt:null,revokedAt:null};
const response=(items:unknown[]=[])=>Response.json({ok:true,siteId,items,nextCursor:null,moduleEnabled:true});
test("lost owner create response recovers with GET only, retains the original token",async()=>{
  const requests:{path:string;init?:RequestInit}[]=[];let stored=false;
  const client=new AttendanceTerminalClient({siteId,randomId:()=>id,randomSecret:()=>secret,apiFetch:async(path,init)=>{
    requests.push({path,init});if(init?.method==='POST'){stored=true;throw Error('lost');}return response(stored?[item]:[]);
  }});
  await client.initialize();await client.create(id,'前台');assert.equal(client.getSnapshot().phase,'unconfirmed');
  await client.create(id,'another');assert.equal(requests.length,2);
  await client.load();assert.equal(client.getSnapshot().phase,'ready');assert.equal(client.getSnapshot().pairToken,`${siteId}.${id}.${secret}`);
  assert.equal(requests.filter(r=>r.init?.method==='POST').length,1);assert(requests.at(-1)?.path.includes(`terminalId=${id}`));
  client.hide();assert.equal(client.getSnapshot().pairToken,null);assert.equal(client.getSnapshot().pending,null);assert.equal(client.getSnapshot().result,null);client.dispose();
});
test("unconfirmed owner retry uses identical intent, never new ID or secret",async()=>{
  const posts:string[]=[];let attempts=0;
  const client=new AttendanceTerminalClient({siteId,randomId:()=>id,randomSecret:()=>secret,apiFetch:async(_url,init)=>{
    if(init?.method==='POST'){posts.push(String(init.body));if(++attempts===1)throw Error('lost');return response([item]);}return response();
  }});
  await client.initialize();await client.create(id,'前台');await client.load();assert.equal(client.getSnapshot().phase,'unconfirmed');
  await client.retry();assert.equal(posts.length,2);assert.equal(posts[0],posts[1]);assert.equal(client.getSnapshot().phase,'ready');client.dispose();
});
test("stale hidden-page response cannot restore secrets or metadata",async()=>{
  let resolve:(value:Response)=>void=()=>{};
  const client=new AttendanceTerminalClient({siteId,randomId:()=>id,randomSecret:()=>secret,apiFetch:async(_url,init)=>init?.method==='POST'?new Promise(r=>{resolve=r;}):response()});
  await client.initialize();const pending=client.create(id,'前台');client.hide();resolve(response([item]));await pending;
  assert.equal(client.getSnapshot().phase,'blocked');assert.equal(client.getSnapshot().pairToken,null);assert.equal(client.getSnapshot().result,null);client.dispose();
});
test("revocation remains possible when module paused and failed auth hides data",async()=>{
  let denied=false,posts=0;
  const client=new AttendanceTerminalClient({siteId,apiFetch:async(_url,init)=>{
    if(denied)return Response.json({ok:false,error:'attendance_access_denied'},{status:403});
    if(init?.method==='POST')posts++;
    return Response.json({ok:true,siteId,items:[init?.method==='POST'?{...item,state:'revoked',revokedAt:item.createdAt}:item],nextCursor:null,moduleEnabled:false});
  }});
  await client.initialize();await client.create(id,'ignored');assert.equal(posts,0);await client.revoke(id);assert.equal(posts,1);
  assert.equal(client.getSnapshot().result?.items[0].state,'revoked');denied=true;await client.load();assert.equal(client.getSnapshot().result,null);client.dispose();
});
