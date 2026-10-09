import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceChoicesQuery, parseAttendanceChoicesResult } from "./merchantAttendanceChoices";
import { executeAttendanceChoices } from "./merchantAttendanceManagement.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/?siteId=99990001&kind=managers";
const q = parseAttendanceChoicesQuery(url);
const items = Array.from({ length: 25 }, (_, n) => ({ id: id(n + 1), label: `合成员工 ${n + 1}`, detail: "active", eligible: true }));
test("selectors are strict bounded tenant queries without client owner or all flags", () => {
  assert.equal(parseAttendanceChoicesQuery(`${url}&search=%20hello%20`).search, "hello");
  for (const suffix of ["&kind=workers", "&isOwner=true", "&pageSize=500", "&cursor=*", "&search=" + "a".repeat(81)]) assert.throws(() => parseAttendanceChoicesQuery(url + suffix));
  assert.throws(() => parseAttendanceChoicesQuery(url.replace("managers", "all")));
});
test("selectors whitelist result metadata and verify ordering and cursor", () => {
  const good = { ...q, items: items.map(x => ({ ...x, email: "secret" })), nextCursor: id(25) };
  assert.equal(parseAttendanceChoicesResult(good, q).items.length, 25);
  assert.ok(!("email" in parseAttendanceChoicesResult(good, q).items[0]));
  for (const patch of [{ items: [...items, items[0]] }, { items: [...items].reverse() }, { items: [items[0], items[0]] },
    { nextCursor: id(24) }, { siteId: "99990002" }, { kind: "workers" }, { items: [{ ...items[0], eligible: 1 }] }])
    assert.throws(() => parseAttendanceChoicesResult({ ...good, ...patch }, q));
  assert.throws(() => parseAttendanceChoicesResult(good, { ...q, cursor: id(1) }));
});
test("selector service uses verified auth and safely rejects malformed RPC output", async () => {
  let called = false;
  const input = { ...q, authUserId: id(88) };
  assert.equal((await executeAttendanceChoices(input, { rpc: async (name, args) => {
    called = true; assert.equal(name, "faolla_attendance_choices_v1"); assert.equal(args.p_auth_user_id, id(88));
    return { data: { ...q, items, nextCursor: null }, error: null };
  } })).items.length, 25); assert.ok(called);
  await assert.rejects(executeAttendanceChoices(input, { rpc: async () => ({ data: { ...q, items, nextCursor: id(99) }, error: null }) }), /attendance_unavailable/);
});
test("exact lookups accept at most 25 distinct UUIDs and cannot mix with discovery filters", () => {
  const parsed = parseAttendanceChoicesQuery(`${url}&ids=${id(2)},${id(1)}`);
  assert.deepEqual(parsed.ids, [id(1), id(2)]); assert.equal(parsed.cursor, null); assert.equal(parsed.search, "");
  for (const suffix of ["&ids=", "&ids=*", `&ids=${id(1)},`, `&ids=${id(1)},${id(1)}`, `&ids=${id(1)}&ids=${id(2)}`,
    `&ids=${id(1)}&search=`, `&ids=${id(1)}&cursor=${id(2)}`, `&ids=${Array.from({length:26},(_,n)=>id(n+1)).join(",")}`])
    assert.throws(() => parseAttendanceChoicesQuery(url + suffix));
  assert.equal(parseAttendanceChoicesQuery(`${url}&ids=${items.map(x=>x.id).join(",")}`).ids?.length, 25);
});
test("exact lookup output can omit missing IDs but never returns an unrequested ID or cursor", () => {
  const expected = parseAttendanceChoicesQuery(`${url}&ids=${id(1)},${id(3)}`);
  const result = { siteId:q.siteId, kind:q.kind, items:[items[0]], nextCursor:null };
  assert.equal(parseAttendanceChoicesResult(result, expected).items.length, 1);
  assert.equal(parseAttendanceChoicesResult({...result,items:[]}, expected).items.length, 0);
  for (const patch of [{items:[items[1]]},{items:[items[0],items[0]]},{nextCursor:id(1)},{siteId:"99990002"},{kind:"locations"}])
    assert.throws(()=>parseAttendanceChoicesResult({...result,...patch},expected));
});
test("service sends exact IDs as a separate RPC mode without broad search defaults", async () => {
  const expected = parseAttendanceChoicesQuery(`${url}&ids=${id(1)}`);
  await executeAttendanceChoices({...expected,authUserId:id(88)}, {rpc:async(name,args)=>{
    assert.equal(name,"faolla_attendance_choices_v1"); assert.deepEqual(args.p_query,{kind:"managers",ids:[id(1)]});
    return {data:{siteId:q.siteId,kind:q.kind,items:[items[0]],nextCursor:null},error:null};
  }});
});
