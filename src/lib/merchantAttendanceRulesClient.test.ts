import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceRulesClient, type RulesClientOptions } from "./merchantAttendanceRulesClient";
import { emptyAttendanceRuleDraft, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { parseRulesBody, parseRulesHttpQuery, type RulesCommand, type RulesDraft, type RulesItem, type RulesQuery, type RulesReceipt } from "./merchantAttendanceRules";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(99), rules = () => ({ ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value" as const, minutes: 5 } });
function setup(groupId: string | null = null) {
  const memory = new Map<string, string>(), items: Array<RulesItem & { withdrawnByRevision: number | null }> = [], receipts = new Map<string, RulesReceipt>();
  const calls: { url: string; method: string; body: string | null }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const context = { settingsVersion: 1, timeZone: "Europe/Madrid", group: groupId === null ? null : { groupId, name: "Synthetic group", revision: 1, active: true }, moduleEnabled: true };
  let draft: RulesDraft | null = null, serial = 1000, writes = 0, mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const reply = (q: RulesQuery, receipt: RulesReceipt | null = null) => {
    const list = items.filter(item => q.beforeRevision === null || item.revision < q.beforeRevision).slice().reverse();
    return Response.json({ ok: true, moduleEnabled: context.moduleEnabled, protocol: "rules-v1", siteId, actorId: ownerId, group: context.group,
      settingsVersion: context.settingsVersion, timeZone: context.timeZone, revision: items.length, draft, items: list.slice(0, 25),
      nextBeforeRevision: list.length > 25 ? list[24].revision : null, receipt: receipt ?? (q.operationId ? receipts.get(q.operationId) ?? null : null) });
  };
  const commit = (q: RulesQuery, c: RulesCommand) => {
    const old = receipts.get(c.operationId); if (old) return reply(q, old);
    assert.equal(c.expectedRevision, items.length);
    const base = { operationId: c.operationId, actorId: ownerId, revision: items.length + 1, action: c.action, reason: c.reason,
      recordedAt: `2026-10-04T08:00:00.${String(items.length + 1).padStart(6, "0")}Z` };
    let item: RulesItem;
    if (c.action === "save_draft") {
      item = { ...base, settingsVersion: c.expectedSettingsVersion, groupRevision: c.expectedGroupRevision, timeZone: c.timeZone,
        rules: c.rules, effectiveOn: null, effectiveAt: null, publishedRevision: null };
      draft = { revision: item.revision, settingsVersion: c.expectedSettingsVersion, groupRevision: c.expectedGroupRevision, timeZone: c.timeZone, rules: c.rules };
    } else if (c.action === "publish") {
      assert(draft);
      item = { ...base, settingsVersion: c.expectedSettingsVersion, groupRevision: c.expectedGroupRevision, timeZone: c.timeZone, rules: draft.rules,
        effectiveOn: c.effectiveOn, effectiveAt: attendanceDayUtcRange(c.effectiveOn, c.timeZone).startAt, publishedRevision: null }; draft = null;
    } else {
      item = { ...base, settingsVersion: null, groupRevision: null, timeZone: null, rules: null, effectiveOn: null, effectiveAt: null, publishedRevision: c.publishedRevision };
      items.find(row => row.revision === c.publishedRevision)!.withdrawnByRevision = item.revision;
    }
    items.push({ ...item, withdrawnByRevision: null }); writes++;
    const receipt = { operationId: c.operationId, revision: item.revision, command: structuredClone(c), item: structuredClone(item) };
    receipts.set(c.operationId, receipt); return reply(q, receipt);
  };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null; calls.push({ url, method, body });
    assert.equal(init?.cache, "no-store"); assert(url.startsWith("/api/merchant-enterprise/attendance/rules"));
    if (transport) return transport(url, init);
    if (method === "GET") return reply(parseRulesHttpQuery(new URL(url, "https://fixture.invalid").href));
    const parsed = parseRulesBody(JSON.parse(body!)), pending = JSON.parse(memory.get(`faolla:attendance:rules:v1:${siteId}:${ownerId}:${groupId ?? "enterprise"}`)!);
    assert.deepEqual(pending.query, parsed.query); assert.deepEqual(pending.command, parsed.command); assert.equal(pending.ownerId, ownerId); assert.equal(pending.groupId, groupId);
    if (mode === "unsent") throw Error("not delivered"); const response = commit(parsed.query, parsed.command);
    if (mode === "lost") throw Error("committed response lost"); return response;
  };
  const create = (patch: Partial<RulesClientOptions> = {}) => new AttendanceRulesClient({ siteId, ownerId, groupId, apiFetch, storage: () => storage,
    randomId: () => id(++serial), timeoutMs: 1000, ...patch });
  return { client: create(), create, memory, storage, context, items, receipts, calls, reply, commit, writes: () => writes,
    mode: (value: typeof mode) => { mode = value; }, transport: (value: typeof transport) => { transport = value; } };
}

for (const groupId of [null, id(501)]) test(`explicit ${groupId ? "group" : "enterprise"} reads and independent save/publish/withdraw operations`, async () => {
  const f = setup(groupId), client = f.client;
  await client.saveDraft({ rules: rules(), reason: "Before read" }); assert.equal(f.calls.length, 0);
  await client.initialize(); assert.equal(f.writes(), 0); assert.equal(client.getSnapshot().phase, "ready");
  await client.saveDraft({ rules: rules(), reason: "Save candidate" }); assert.equal(client.getSnapshot().result?.draft?.rules.lateGraceMinutes.mode, "value");
  await client.publish("2026-11-01", "Publish candidate"); assert.equal(client.getSnapshot().result?.draft, null);
  await client.withdraw(2, "Withdraw future"); assert.equal(f.writes(), 3);
  assert.equal(client.getSnapshot().result?.items.find(row => row.revision === 2)?.withdrawnByRevision, 3);
  assert.equal(f.memory.has(client.storageKey), false); assert.equal(client.getSnapshot().result?.receipt?.item.actorId, ownerId);
  assert.deepEqual(f.calls.filter(call => call.method === "POST").map(call => JSON.parse(call.body!).command.action), ["save_draft", "publish", "withdraw"]);
});

test("lost committed response survives reload; reload only queries exact receipt, never auto-POSTs", async () => {
  const f = setup(); await f.client.initialize(); f.mode("lost"); await f.client.saveDraft({ rules: rules(), reason: "Save" });
  const pending = f.client.getSnapshot().pending; assert(pending); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  const reloaded = f.create(); await reloaded.initialize();
  assert.equal(f.writes(), 1); assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert(f.calls.at(-1)!.url.includes(pending.command.operationId)); assert.equal(reloaded.getSnapshot().pending, null); assert.equal(reloaded.getSnapshot().phase, "ready");
});

test("unconfirmed unsent operation blocks new writes; explicit retry reads first and preserves exact command", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.saveDraft({ rules: rules(), reason: "Save" });
  const body = f.calls.at(-1)!.body; assert(body);
  await f.client.saveDraft({ rules: emptyAttendanceRuleDraft(), reason: "Must not replace" }); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  await f.client.refresh(); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.calls.at(-1)!.method, "GET");
  f.mode("normal"); await f.client.retry(); assert.deepEqual(f.calls.slice(-2).map(call => call.method), ["GET", "POST"]);
  assert.equal(f.calls.at(-1)!.body, body); assert.equal(f.writes(), 1); assert.equal(f.client.getSnapshot().pending, null);
});

test("paused module still permits receipt lookup; denied access hides results and keeps original pending", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.saveDraft({ rules: rules(), reason: "Save" });
  const raw = f.memory.get(f.client.storageKey); f.context.moduleEnabled = false;
  await f.client.retry(); assert.equal(f.calls.at(-1)!.method, "GET"); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  f.transport(async () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 })); await f.client.refresh();
  assert.equal(f.client.getSnapshot().result, null); assert(f.client.getSnapshot().pending); assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("pending storage must be written and verified before POST; foreign owner/scope and substitution are blocked", async () => {
  const f = setup(id(501)); const bad = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("storage denied"); } }) });
  await bad.initialize(); await bad.saveDraft({ rules: rules(), reason: "Save" }); assert.equal(f.calls.filter(c => c.method === "POST").length, 0); assert.equal(bad.getSnapshot().result, null);
  f.mode("unsent"); await f.client.initialize(); await f.client.saveDraft({ rules: rules(), reason: "Save" });
  const raw = f.memory.get(f.client.storageKey)!; const changed = { ...JSON.parse(raw), ownerId: id(98) }; f.memory.set(f.client.storageKey, JSON.stringify(changed));
  const before = f.calls.length; await f.client.retry(); assert.equal(f.calls.length, before); assert.equal(f.client.getSnapshot().result, null);
  const fresh = f.create(); await fresh.initialize(); assert.equal(f.calls.length, before); assert.equal(fresh.getSnapshot().phase, "blocked");
  f.memory.set(f.client.storageKey, JSON.stringify({ ...JSON.parse(raw), groupId: id(502) })); await fresh.initialize(); assert.equal(f.calls.length, before);
});

test("pause aborts late read/write responses without resurrecting records or clearing an uncertain operation", async () => {
  const f = setup(); await f.client.initialize(); let release!: (response: Response) => void;
  f.transport(() => new Promise(resolve => { release = resolve; }));
  const job = f.client.saveDraft({ rules: rules(), reason: "Save" }); const pending = f.client.getSnapshot().pending; assert(pending);
  f.client.pause(); release(f.commit(pending.query, pending.command)); await job;
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().pending?.command.operationId, pending.command.operationId);
  assert(f.memory.has(f.client.storageKey)); f.transport(null); await f.client.initialize(); assert.equal(f.client.getSnapshot().pending, null);
});

test("only exact known error/status pairs can resolve definitive rejections; conflicts and malformed errors stay pending", async () => {
  for (const [error, status, extra, keep] of [["attendance_version_conflict", 409, false, false], ["attendance_version_conflict", 500, false, true],
    ["attendance_operation_conflict", 409, false, true], ["attendance_invalid_request", 400, true, true]] as const) {
    const f = setup(); await f.client.initialize(); f.transport(async () => Response.json({ ok: false, error, ...(extra ? { private: true } : {}) }, { status }));
    await f.client.saveDraft({ rules: rules(), reason: "Save" }); assert.equal(!!f.client.getSnapshot().pending, keep); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("invalid rules are side-effect-free and clear stale data; saved context drift prevents publishing old draft", async () => {
  const f = setup(); await f.client.initialize(); const bad = { ...rules(), lateGraceMinutes: { mode: "value", minutes: "" } } as unknown as AttendanceRuleDraft;
  await f.client.saveDraft({ rules: bad, reason: "Invalid" }); assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.memory.size, 0);
  await f.client.initialize(); await f.client.saveDraft({ rules: rules(), reason: "Save" }); f.context.settingsVersion++;
  await f.client.refresh(); const before = f.calls.length; await f.client.publish("2026-11-01", "Stale draft");
  assert.equal(f.calls.length, before); assert.equal(f.client.getSnapshot().result, null);
});

test("inactive groups allow existing future withdrawal but not fresh saves or publication", async () => {
  const f = setup(id(501)); await f.client.initialize(); await f.client.saveDraft({ rules: rules(), reason: "Save" }); await f.client.publish("2026-11-01", "Publish");
  f.context.group!.active = false; await f.client.refresh(); await f.client.withdraw(2, "Withdraw from inactive group"); assert.equal(f.writes(), 3);
  await f.client.saveDraft({ rules: rules(), reason: "Do not save" }); assert.equal(f.writes(), 3); assert.equal(f.client.getSnapshot().result, null);
});

test("oversized and timed-out streams cannot expose records; slow error-body reader is cancelled", async () => {
  const f = setup(); f.transport(async () => new Response(" ".repeat(131073), { headers: { "Content-Type": "application/json" } }));
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  f.transport(null); const client = f.create({ timeoutMs: 25 }); await client.initialize(); let cancelled = false;
  f.transport(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":')); }, cancel() { cancelled = true; } }),
    { status: 409, headers: { "Content-Type": "application/json" } }));
  await client.saveDraft({ rules: rules(), reason: "Save" }); assert.equal(cancelled, true); assert(client.getSnapshot().pending); assert.equal(client.getSnapshot().result, null);
});

test("response actor and group bindings are mandatory; wrong bindings never display another owner's records", async () => {
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { group: { groupId: id(502), revision: 1, name: "Other", active: true } }]) {
    const f = setup(id(501));
    f.transport(async () => {
      const correct = await f.reply({ siteId, groupId: id(501), operationId: null, beforeRevision: null }).json();
      return Response.json({ ...correct, ...patch });
    });
    await f.client.initialize(); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  }
});

test("history uses an exclusive revision cursor and replaces one bounded page while retaining the current saved draft", async () => {
  const f = setup(); await f.client.initialize();
  for (let n = 1; n <= 27; n++) await f.client.saveDraft({ rules: rules(), reason: `Save ${n}` });
  assert.equal(f.client.getSnapshot().result?.items.length, 25); assert.equal(f.client.getSnapshot().result?.nextBeforeRevision, 3);
  await f.client.next(); assert(f.calls.at(-1)!.url.includes("beforeRevision=3"));
  assert.deepEqual(f.client.getSnapshot().result?.items.map(row => row.revision), [2, 1]);
  assert.equal(f.client.getSnapshot().result?.draft?.revision, 27); assert.equal(f.client.getSnapshot().result?.nextBeforeRevision, null);
});
