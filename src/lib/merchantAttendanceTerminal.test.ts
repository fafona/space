import assert from "node:assert/strict";
import test from "node:test";
import { parseTerminal, parseTerminalBody, parseTerminalDevice, parseTerminalList, parseTerminalQuery, parseTerminalToken, terminalPairToken, terminalSecret } from "./merchantAttendanceTerminal";
import { executeTerminalAdmin, executeTerminalDevice, terminalHash } from "./merchantAttendanceTerminal.server";
const id = "00000000-0000-4000-8000-000000000001", siteId = "99990001", secret = "A".repeat(43);
const item = { id, locationId: id, label: "前台", locationName: "门店", timeZone: "Europe/Madrid", state: "pending", createdAt: "2026-10-01T10:00:00.000000Z",
  pairExpiresAt: "2026-10-01T10:05:00.000000Z", pairedAt: null, deviceExpiresAt: null, revokedAt: null };
const command = { action: "create" as const, terminalId: id, locationId: id, label: "前台", pairSecret: secret };
test("terminal pairing code is canonical 256-bit encoding and scoped to site/device", () => {
  assert.deepEqual(parseTerminalToken(terminalPairToken(siteId,id,secret)), { siteId, terminalId:id, secret });
  for (const bad of ["123456",secret+"=",secret.slice(1),secret.slice(1)+"B", " "+secret,secret+"\n"]) assert.throws(()=>terminalSecret(bad));
  assert.throws(()=>parseTerminalToken(`${siteId}.${id}.${secret}.extra`));
});
test("terminal body rejects extra privilege claims and malformed input",()=>{
  assert.deepEqual(parseTerminalBody({siteId,command}),{siteId,command});
  for(const key of ["authUserId","allowCreate","deviceHash","clockEnabled"]) assert.throws(()=>parseTerminalBody({siteId,command,[key]:true}));
  for(const change of [{label:"\u0085x"},{label:" "},{locationId:"bad"},{pairSecret:"1"},{action:"clock_in"},{unknown:true}])assert.throws(()=>parseTerminalBody({siteId,command:{...command,...change}}));
});
test("terminal query rejects offsets, duplicates and mixed detail/cursor",()=>{
  assert.deepEqual(parseTerminalQuery(`https://example.test?siteId=${siteId}`),{siteId,cursor:null,terminalId:null});
  for(const suffix of [`&cursor=${id}&terminalId=${id}`,"&offset=0",`&siteId=${siteId}`,"&token=secret"])assert.throws(()=>parseTerminalQuery(`https://example.test?siteId=${siteId}${suffix}`));
});
test("terminal metadata parser enforces state/timestamp coherence and forbids leaked hashes",()=>{
  assert.deepEqual(parseTerminal(item),item);
  for(const change of [{state:"active"},{revokedAt:item.createdAt},{pairExpiresAt:item.createdAt},{deviceExpiresAt:item.pairExpiresAt},{pairHash:secret},{createdAt:"yesterday"}])assert.throws(()=>parseTerminal({...item,...change}));
  const active={...item,state:"active",pairedAt:item.createdAt,deviceExpiresAt:"2026-10-31T10:00:00.000000Z"};
  assert.equal(parseTerminalDevice({siteId,terminal:active,attendanceEnabled:false,clockEnabled:false}).terminal.state,"active");
  assert.throws(()=>parseTerminalDevice({siteId,terminal:active,attendanceEnabled:true,clockEnabled:true}));
  assert.throws(()=>parseTerminalDevice({siteId,terminal:active,attendanceEnabled:true,clockEnabled:false},{siteId:"99990002",terminalId:id}));
});
test("terminal pages validate tenant, requested identity, ordering and cursors",()=>{
  const q={siteId,cursor:null,terminalId:id};assert.equal(parseTerminalList({siteId,items:[item],nextCursor:null},q).items.length,1);
  for(const v of [{siteId:"99990002",items:[item],nextCursor:null},{siteId,items:[item,item],nextCursor:null},{siteId,items:[item],nextCursor:id}])assert.throws(()=>parseTerminalList(v,q));
});
test("terminal service sends only hashes to SQL and selects safe current metadata",async()=>{
  const calls:{name:string,args:Record<string,unknown>}[]=[];
  const service={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:{siteId,items:[item],nextCursor:null},error:null};}};
  const result=await executeTerminalAdmin({siteId,authUserId:id,cursor:null,terminalId:null,command,allowCreate:true},service);
  assert.equal(result.items[0].id,id);assert.equal((calls[0].args.p_command as {pairHash:string}).pairHash,terminalHash(secret));
  assert(!JSON.stringify(calls).includes(secret));assert(!JSON.stringify(result).includes(terminalHash(secret)));
});
test("terminal service never forwards internal SQL errors or malformed metadata",async()=>{
  const input={siteId,authUserId:id,cursor:null,terminalId:null,command,allowCreate:true};
  for(const data of [{siteId,items:[],nextCursor:null},{siteId,items:[{...item,deviceHash:secret}],nextCursor:null}])
    await assert.rejects(executeTerminalAdmin(input,{rpc:async()=>({data,error:null})}),/attendance_unavailable/);
  await assert.rejects(executeTerminalDevice({siteId,terminalId:id,secret,deviceSecret:null,allowPair:false},{rpc:async()=>({data:null,error:{message:"private database password"}})}),/attendance_unavailable/);
});
