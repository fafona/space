import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { parseRulesQuery, parseRulesHttpQuery, rulesQueryString, parseRulesCommand, parseRulesBody, parseRulesResult, parseRulesResponse, sameRulesCommand,
  type RulesQuery, type RulesCommand, type RulesResult, type RulesItem } from "./merchantAttendanceRules";
import { executeRules } from "./merchantAttendanceRules.server";
import { handleRules, rulesDependencies } from "../app/api/merchant-enterprise/attendance/rules/route-handler";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(99), query: RulesQuery = { siteId: "99990001", groupId: null, operationId: null, beforeRevision: null };
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/rules";
const save = (n = 1): RulesCommand => ({ action: "save_draft", operationId: id(n), reason: "Draft", expectedRevision: n - 1,
  expectedSettingsVersion: 1, expectedGroupRevision: null, timeZone: "Europe/Madrid", rules: emptyAttendanceRuleDraft() });
function record(command: RulesCommand): RulesItem {
  return { operationId: command.operationId, actorId: owner, revision: command.expectedRevision + 1, action: command.action, reason: command.reason,
    recordedAt: "2026-10-04T10:00:00.000001Z", settingsVersion: command.action === "withdraw" ? null : command.expectedSettingsVersion,
    groupRevision: command.action === "withdraw" ? null : command.expectedGroupRevision, timeZone: command.action === "withdraw" ? null : command.timeZone,
    rules: command.action === "withdraw" ? null : command.action === "save_draft" ? command.rules : emptyAttendanceRuleDraft(),
    effectiveOn: command.action === "publish" ? command.effectiveOn : null,
    effectiveAt: command.action === "publish" ? "2026-10-04T22:00:00.000Z" : null,
    publishedRevision: command.action === "withdraw" ? command.publishedRevision : null };
}
function result(commands: RulesCommand[] = [], selected?: RulesCommand): RulesResult {
  const latestDraftChange = commands.filter(c => c.action !== "withdraw").at(-1);
  const saved = latestDraftChange?.action === "save_draft" ? latestDraftChange : null;
  const items = commands.map(record).reverse().map(item => {
    const withdrawal = item.action === "publish" ? commands.find(c => c.action === "withdraw" && c.publishedRevision === item.revision) : undefined;
    return { ...item, withdrawnByRevision: withdrawal ? withdrawal.expectedRevision + 1 : null };
  });
  return { protocol: "rules-v1", siteId: query.siteId, actorId: owner, group: null, settingsVersion: 1, timeZone: "Europe/Madrid", revision: commands.length,
    draft: saved ? { revision: saved.expectedRevision + 1, settingsVersion: saved.expectedSettingsVersion, groupRevision: saved.expectedGroupRevision, timeZone: saved.timeZone, rules: saved.rules } : null,
    items: items.slice(0, 25), nextBeforeRevision: items.length > 25 ? items[24].revision : null,
    receipt: selected ? { operationId: selected.operationId, revision: selected.expectedRevision + 1, command: selected, item: record(selected) } : null };
}
const publish: RulesCommand = { action: "publish", operationId: id(2), expectedRevision: 1, reason: "Publish candidate", expectedSettingsVersion: 1,
  expectedGroupRevision: null, timeZone: "Europe/Madrid", effectiveOn: "2026-10-05" };
const withdraw: RulesCommand = { action: "withdraw", operationId: id(3), expectedRevision: 2, reason: "Withdraw candidate", publishedRevision: 2 };

test("rules query is explicit, bounded, round-trips over HTTP, and refuses duplicate/extra/ambiguous recovery fields", () => {
  for (const q of [query, { ...query, groupId: id(8) }, { ...query, operationId: id(9) }, { ...query, beforeRevision: 26 }]) {
    assert.deepEqual(parseRulesHttpQuery(url + "?" + rulesQueryString(q)), q);
  }
  for (const q of [{ ...query, operationId: id(2), beforeRevision: 2 }, { ...query, beforeRevision: 0 }, { ...query, groupId: "" }, { ...query, ownerId: owner }]) assert.throws(() => parseRulesQuery(q));
  for (const suffix of ["&siteId=99990001", "&beforeRevision=1e2", "&beforeRevision=01", "&beforeRevision=", "&__proto__=ignored", "&constructor=ignored", "&workerId=" + id(2)]) assert.throws(() => parseRulesHttpQuery(url + "?siteId=99990001" + suffix));
});
test("three exact command variants validate scope, integer thresholds, dates, and no supplied actor/write authority", () => {
  for (const c of [save(), publish, withdraw]) { assert.deepEqual(parseRulesBody({ query, command: c }).command, c); assert(sameRulesCommand(c, structuredClone(c))); }
  for (const c of [{ ...save(), actorId: owner }, { ...save(), expectedRevision: -0 }, { ...publish, effectiveOn: "2026-02-30" },
    { ...publish, timeZone: "Pacific/Apia", effectiveOn: "2011-12-30" }, { ...withdraw, publishedRevision: 3 }, { ...save(), expectedGroupRevision: 1 }]) assert.throws(() => parseRulesBody({ query, command: c }));
  const grouped = { ...save(), expectedGroupRevision: 1 }; assert.doesNotThrow(() => parseRulesBody({ query: { ...query, groupId: id(8) }, command: grouped }));
  assert.throws(() => parseRulesBody({ query: { ...query, beforeRevision: 2 }, command: save() }));
  const bad = save(); if (bad.action === "save_draft") bad.rules.lateGraceMinutes = { mode: "value", minutes: NaN };
  assert.throws(() => parseRulesCommand(bad));
});
test("empty, saved, published and withdrawn version results bind exact receipts and preserve original publication", () => {
  assert.deepEqual(parseRulesResult(result(), query, null, owner), result());
  const states: RulesCommand[][] = [[save()], [save(), publish], [save(), publish, withdraw]];
  for (const commands of states) {
    const c = commands.at(-1)!, raw = result(commands, c);
    assert.deepEqual(parseRulesResponse({ ...raw, ok: true, moduleEnabled: false }, query, c, owner), { ...raw, ok: true, moduleEnabled: false });
    assert.deepEqual(parseRulesResult(raw, { ...query, operationId: c.operationId }, null, owner), raw);
  }
  const replay = result(states[2], publish); assert.deepEqual(parseRulesResult(replay, query, publish, owner).receipt?.item, record(publish));
  assert.equal(replay.items[1].withdrawnByRevision, 3);
});
test("source actor/site/target, exact shapes and receipt command content cannot be mixed or borrowed", () => {
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { extra: true }, { revision: 0 }, { group: { groupId: id(8), revision: 1, name: "Group", active: true } }]) {
    assert.throws(() => parseRulesResult({ ...result([save()], save()), ...patch }, query, save(), owner));
  }
  for (const mutate of [
    (r: RulesResult) => { r.receipt!.item.actorId = id(98); },
    (r: RulesResult) => { r.receipt!.command.reason = "Different"; },
    (r: RulesResult) => { r.receipt!.item.rules!.lateGraceMinutes = { mode: "disabled" }; },
    (r: RulesResult) => { r.items[0].actorId = id(98); },
  ]) { const raw = structuredClone(result([save()], save())); mutate(raw); assert.throws(() => parseRulesResult(raw, query, save(), owner)); }
  assert.throws(() => parseRulesResult(result([save()], save()), query, null, owner));
  assert.throws(() => parseRulesResult(result([save()]), { ...query, operationId: id(1) }, null, owner));
});
test("history is a complete contiguous bounded page, not an incomplete list disguised as no history", () => {
  const commands = Array.from({ length: 28 }, (_, i) => save(i + 1)), raw = result(commands);
  assert.equal(parseRulesResult(raw, query).nextBeforeRevision, 4);
  const older = { ...raw, items: commands.slice(0, 3).map(c => ({ ...record(c), withdrawnByRevision: null })).reverse(), nextBeforeRevision: null };
  assert.equal(parseRulesResult(older, { ...query, beforeRevision: 4 }).items.length, 3);
  for (const patch of [{ items: raw.items.slice(0, 24) }, { items: raw.items.slice().reverse() }, { nextBeforeRevision: null }, { nextBeforeRevision: 3 }]) assert.throws(() => parseRulesResult({ ...raw, ...patch }, query));
});
test("draft head and visible source versions stay linked instead of reverting a published or missing draft", () => {
  const saved = result([save()]); assert.throws(() => parseRulesResult({ ...saved, draft: null }, query));
  const published = result([save(), publish]); assert.throws(() => parseRulesResult({ ...published, draft: saved.draft }, query));
  const corrupt = structuredClone(saved); corrupt.draft!.timeZone = "UTC"; assert.throws(() => parseRulesResult(corrupt, query));
});
test("published UTC boundary, future recorded local date, withdrawal relation, and canonical precision are checked", () => {
  for (const mutate of [
    (r: RulesResult) => { r.items[0].effectiveAt = "2026-10-05T00:00:00.000Z"; },
    (r: RulesResult) => { r.items[0].recordedAt = "2026-10-05T00:00:00.000000Z"; },
    (r: RulesResult) => { r.items[0].withdrawnByRevision = 1; },
    (r: RulesResult) => { r.items[0].recordedAt = "2026-10-04T10:00:00.000Z"; },
  ]) { const raw = result([save(), publish]); mutate(raw); assert.throws(() => parseRulesResult(raw, query)); }
  const raw = result([save(), publish, withdraw]); raw.items[0].rules = emptyAttendanceRuleDraft(); assert.throws(() => parseRulesResult(raw, query));
});

const get = () => new Request(url + "?siteId=99990001");
const post = (body: unknown = { query, command: save() }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(patch: Partial<typeof rulesDependencies> = {}) {
  const calls: Parameters<typeof rulesDependencies.execute>[0][] = [];
  const deps: typeof rulesDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof rulesDependencies.entitlement>>,
    execute: async input => { calls.push(input); return input.command ? result([input.command], input.command) : result(); }, ...patch };
  return { calls, deps };
}
test("new route defaults off and blocks noncanonical origins and methods before authentication", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_RULES_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_RULES_ENABLED; else process.env.FAOLLA_ATTENDANCE_RULES_ENABLED = old; });
  delete process.env.FAOLLA_ATTENDANCE_RULES_ENABLED; assert.equal(rulesDependencies.enabled(), false);
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  assert.equal((await handleRules(get(), { ...f.deps, enabled: rulesDependencies.enabled })).status, 404);
  for (const request of [new Request(url, { method: "DELETE" }), new Request(url.replace("www.", "merchant.")), new Request(url, { method: "POST", headers: { origin: "https://evil.invalid" } })]) assert([403, 405].includes((await handleRules(request, f.deps)).status));
  assert.equal(auth, 0);
});
test("route accepts strong sessions only, rates by authenticated actor and rechecks current entitlement", async () => {
  for (const methods of [[], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleRules(post(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  const limited = setup({ allow: actor => { assert.equal(actor, owner); return false; } });
  assert.equal((await handleRules(get(), limited.deps)).status, 429); assert.equal(limited.calls.length, 0);
  const paused = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof rulesDependencies.entitlement>> });
  const response = await handleRules(get(), paused.deps); await handleRules(post(), paused.deps);
  assert.deepEqual(paused.calls.map(c => c.allowWrite), [false, false]); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).moduleEnabled, false);
});
test("unknown scope or authority, duplicate GET keys, invalid POST envelopes, type and size stop before execution", async () => {
  const f = setup();
  for (const body of [{ query, command: save(), allowWrite: true }, { query, command: { ...save(), actorId: owner } }, { query: { ...query, operationId: id(1) }, command: save() }, { query, command: { ...save(), expectedGroupRevision: 1 } }]) assert.equal((await handleRules(post(body), f.deps)).status, 400);
  assert.equal((await handleRules(new Request(get().url + "&siteId=99990002"), f.deps)).status, 400);
  assert.equal((await handleRules(new Request(url + "?extra=1", post()), f.deps)).status, 400);
  const wrong = post(); wrong.headers.set("content-type", "text/plain"); assert.equal((await handleRules(wrong, f.deps)).status, 415);
  assert.equal((await handleRules(post({ huge: "x".repeat(5000) }), f.deps)).status, 413); assert.equal(f.calls.length, 0);
});
test("typed rule failures preserve recoverable statuses and unexpected errors do not expose database details", async () => {
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_platform_paused", 403], ["attendance_rule_draft_required", 409], ["attendance_rule_future_required", 409], ["attendance_rule_order_conflict", 409], ["attendance_rule_already_withdrawn", 409], ["attendance_rule_invalid", 503]] as const) {
    const f = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }); const response = await handleRules(post(), f.deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  const f = setup({ execute: async () => { throw Error("private SQL details"); } });
  assert.deepEqual(await (await handleRules(get(), f.deps)).json(), { ok: false, error: "attendance_unavailable" });
});
test("service only calls new owner RPC, propagates authenticated authority and rejects corrupt or foreign output", async () => {
  const input = { query, command: null, authUserId: owner, allowWrite: false };
  assert.deepEqual(await executeRules(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_rules_v1"); assert.deepEqual(args, { p_query: query, p_command: null, p_auth_user_id: owner, p_allow_write: false });
    return { data: result(), error: null };
  } }), result());
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { extra: true }, { revision: 1 }]) await assert.rejects(executeRules(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeRules({ ...input, command: save() }, { rpc: async () => ({ data: result(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeRules(input, { rpc: async () => ({ data: null, error: { message: "private SQL detail" } }) }), /attendance_unavailable/);
});
