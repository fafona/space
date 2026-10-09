import assert from "node:assert/strict";
import test from "node:test";
import { readOperationalRulesDirectory } from "./merchantAttendanceOperationalRulesDirectory";
import { operationalRuleLedgerActor as actorId, operationalRuleLedgerSite as siteId, operationalRuleLedgerId as id } from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const group = (n: number) => ({ groupId: id(n), revision: 1, name: `合成组${n}`, description: "", active: true, createdAt: "2026-10-08T10:00:00.000000Z", updatedAt: "2026-10-08T10:00:00.000000Z" });
const groupBody = (items = [group(2)]) => ({ ok: true, moduleEnabled: true, protocol: "groups-v1", siteId, actorId, settingsVersion: 1, timeZone: "UTC", view: "groups", group: null, worker: null, items, nextCursor: null, detail: null, receipt: null });
const options = () => ({ siteId, actorId, kind: "groups" as const, cursor: null, signal: new AbortController().signal, current: () => true });
test("existing group directory is one exact authorized GET, never automatically follows pages", async () => {
  let calls = 0; const items = Array.from({ length: 25 }, (_, n) => group(26 - n)), nextCursor = items.at(-1)!.groupId;
  const page = await readOperationalRulesDirectory({ ...options(), apiFetch: async (path, init) => { calls++; const u = new URL(path, "https://synthetic.invalid"); assert.equal(u.pathname, "/api/merchant-enterprise/attendance/groups"); assert.equal(u.searchParams.get("view"), "groups"); assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); return Response.json({ ...groupBody(items), nextCursor }); } });
  assert.equal(calls, 1); assert.equal(page.kind, "groups"); assert.equal(page.items.length, 25); assert.equal(page.nextCursor, nextCursor);
});
test("existing locations parser supplies real same-site id/name without identity fabrication", async () => {
  const result = await readOperationalRulesDirectory({ ...options(), kind: "locations", apiFetch: async (path, init) => { const u = new URL(path, "https://synthetic.invalid"); assert.equal(u.searchParams.get("view"), "locations"); assert.equal(init?.method, "GET"); return Response.json({ ok: true, moduleEnabled: true, siteId, version: 1, settings: { timeZone: "UTC", enabled: true, webClockEnabled: true, webBreakPaid: false }, view: "locations", items: [{ id: id(4), name: "合成地点", timeZone: "UTC", active: true }], nextCursor: null, receipt: null }); } });
  assert.equal(result.kind, "locations"); assert.deepEqual(result.items[0], { id: id(4), name: "合成地点", timeZone: "UTC", active: true }); assert.doesNotMatch(JSON.stringify(result), /Auth|employee/);
});
test("wrong actor, excessive page, duplicate key and redirect fail closed", async () => {
  for (const variant of ["actor", "size", "duplicate", "redirect"]) await assert.rejects(readOperationalRulesDirectory({ ...options(), apiFetch: async () => {
    if (variant === "duplicate") return new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } });
    if (variant === "redirect") return new Response(null, { status: 302 });
    return Response.json(variant === "actor" ? { ...groupBody(), actorId: id(99) } : groupBody(Array.from({ length: 26 }, (_, n) => group(n + 2))));
  } }));
});
test("abort interrupts hung body and changed Auth discards a late directory", async () => {
  const controller = new AbortController(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const work = readOperationalRulesDirectory({ ...options(), signal: controller.signal, apiFetch: async () => { started(); return new Response(new ReadableStream({ start() {}, cancel() {} }), { headers: { "content-type": "application/json" } }); } });
  await ready; controller.abort(); await assert.rejects(work, /directory_unavailable/);
  let current = true; await assert.rejects(readOperationalRulesDirectory({ ...options(), current: () => current, apiFetch: async () => { current = false; return Response.json(groupBody()); } }), /directory_unavailable/);
});
