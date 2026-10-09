import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { parseShiftRuleViewQuery, parseShiftRuleViewHttpQuery, shiftRuleViewQueryString, parseShiftRuleViewResult, parseShiftRuleViewResponse, SHIFT_RULE_VIEW_KEYS } from "./merchantAttendanceShiftRuleView";
import { executeShiftRuleView, projectShiftRuleView } from "./merchantAttendanceShiftRuleView.server";
import { shiftRuleViewWire as wire, shiftRuleViewHttp as http, shiftRuleViewQuery as query, shiftRuleViewActor as actor, shiftRuleViewId as id } from "../../scripts/fixtures/attendance-shift-rule-view-model";
import { shiftRuleBindingWire, shiftRulePoint, rehashShiftRuleBinding, refreshShiftRulePointFields } from "../../scripts/fixtures/attendance-shift-rule-binding-model";
const parse = (raw: unknown) => parseShiftRuleViewResult(raw, query, actor);

test("exact readonly query rejects actor, source, write, offset and duplicate inputs", () => {
  assert.deepEqual(parseShiftRuleViewQuery(query), query); assert.deepEqual(parseShiftRuleViewHttpQuery(`https://fixture.invalid/?${shiftRuleViewQueryString(query)}`), query);
  for (const patch of [{ actorId: actor }, { source: {} }, { operationId: id(8) }, { startEventId: null }, { siteId: "wrong" }]) assert.throws(() => parseShiftRuleViewQuery({ ...query, ...patch }), /attendance_invalid_request/);
  for (const suffix of ["&siteId=99990009", "&command={}", "&offset=1", "&__proto__=x"]) assert.throws(() => parseShiftRuleViewHttpQuery(`https://fixture.invalid/?${shiftRuleViewQueryString(query)}${suffix}`), /attendance_invalid_request/);
});

test("real155 verified bytes project exact compact keys without raw graph, text, history or reasons", () => {
  const original = shiftRuleBindingWire("verified", true), saved = structuredClone(original), result = projectShiftRuleView(original, query, actor);
  assert.deepEqual(original, saved); assert.equal(result.protocol, "shift-rule-binding-view-v1"); assert.equal(result.readOnly, true); assert.equal(result.formalReady, false);
  assert.equal(Object.keys(result).length, 12); assert.equal(Object.keys(result.binding!).length, 9); assert.equal(Object.keys(result.evidence!).length, 9);
  assert.equal(result.evidence!.sourceSha256, original.binding!.source!.sourceSha256); assert.equal(result.evidence!.sourceBytes, original.binding!.source!.sourceBytes);
  for (const forbidden of ["sourceText", '"history"', '"approval"', '"publication"', "Historical owner publication", "Saved personal choice"]) assert.equal(JSON.stringify(result).includes(forbidden), false);
  assert.ok(new TextEncoder().encode(JSON.stringify({ ok: true, moduleEnabled: true, data: result })).byteLength < 32768);
});

test("missing and unverified projections cannot synthesize evidence or erase their distinct states", () => {
  const missing = wire("missing"), unverified = wire("unverified"); assert.equal(parse(missing).binding, null); assert.equal(parse(missing).evidence, null);
  assert.equal(parse(unverified).binding!.channel, "self"); assert.equal(parse(unverified).reason, "source_quota"); assert.equal(parse(unverified).evidence, null);
  missing.evidence = wire().evidence; assert.throws(() => parse(missing)); unverified.evidence = wire().evidence; assert.throws(() => parse(unverified));
  const verified = wire(); verified.evidence = null; assert.throws(() => parse(verified));
});

test("current actor/worker/event and historical binding dual identity remain bound", () => {
  const mutations = [(r: ReturnType<typeof wire>) => { r.actorId = id(900); }, (r: ReturnType<typeof wire>) => { r.worker.workerId = id(900); },
    (r: ReturnType<typeof wire>) => { r.event.startEventId = id(900); }, (r: ReturnType<typeof wire>) => { r.event.employeeId = id(900); },
    (r: ReturnType<typeof wire>) => { r.worker.employeeAuthUserId = id(900); }, (r: ReturnType<typeof wire>) => { r.binding!.employeeId = id(900); }];
  for (const mutate of mutations) { const raw = wire(); mutate(raw); assert.throws(() => parse(raw)); }
});

test("same155 feature supports paused, inactive current identities and historical author/version/dedup differences", () => {
  const raw = shiftRuleBindingWire("verified", true); raw.worker.active = false; raw.worker.employeeActive = false; raw.worker.version = 100; raw.actorId = id(99);
  const result = projectShiftRuleView(raw, query, id(99)); assert.equal(result.binding!.workerVersion, 2); assert.equal(result.worker.version, 100);
  assert.notEqual(result.evidence!.sourceId, result.event.startEventId); assert.notEqual(result.evidence!.timeZone, result.event.timeZone);
  assert.notEqual(result.evidence!.fields.lateGraceMinutes.source!.actorId, result.actorId);
  assert.equal(parseShiftRuleViewResponse({ ok: true, moduleEnabled: false, data: result }, query, id(99)).moduleEnabled, false);
});

test("browser projection has exact6us UTC but opaque saved timezone labels", () => {
  const raw = wire("verified", true); raw.event.timeZone = "Archived/Event_Zone"; raw.evidence!.timeZone = "Archived/Enterprise_Zone";
  assert.equal(parse(raw).evidence!.timeZone, "Archived/Enterprise_Zone");
  for (const at of ["2026-09-02T08:00:00.000Z", "2026-02-30T08:00:00.000000Z", "0000-01-01T00:00:00.000000Z", "2026-09-02T08:00:00.000000+00:00"]) {
    const bad = wire(); bad.event.occurredAt = at; assert.throws(() => parse(bad));
  }
});

test("group definition revision and rule ledger head are distinct and nullable group head stays null", () => {
  const p = shiftRulePoint(true); p.group!.group.revision = 7; p.group!.revision = 4; refreshShiftRulePointFields(p);
  const result = projectShiftRuleView(rehashShiftRuleBinding(shiftRuleBindingWire(), p), query, actor);
  assert.equal(result.evidence!.group!.revision, 7); assert.equal(result.evidence!.groupRevision, 4); assert.equal(result.evidence!.fields.openSpanWarningMinutes.trace[1].ledgerRevision, 4);
  const plain = wire(); assert.equal(plain.evidence!.group, null); assert.equal(plain.evidence!.groupRevision, null);
  plain.evidence!.groupRevision = 0; assert.throws(() => parse(plain));
});

test("zero heads and existing heads without effective publication/approval remain legitimate unconfigured", () => {
  for (const withGroup of [false, true]) {
    const p = shiftRulePoint(withGroup); p.enterprise = { revision: 0, publication: null }; p.personal = { revision: 0, approval: null };
    if (p.group) { p.group.revision = 0; p.group.publication = null; } refreshShiftRulePointFields(p);
    const result = projectShiftRuleView(rehashShiftRuleBinding(shiftRuleBindingWire(), p), query, actor);
    assert.ok(SHIFT_RULE_VIEW_KEYS.every(k => result.evidence!.fields[k].state === "unconfigured"));
    assert.equal(result.evidence!.groupRevision, withGroup ? 0 : null);
    p.enterprise.revision = 9; p.personal.revision = 8; if (p.group) p.group.revision = 7; refreshShiftRulePointFields(p);
    assert.equal(projectShiftRuleView(rehashShiftRuleBinding(shiftRuleBindingWire(), p), query, actor).evidence!.enterpriseRevision, 9);
  }
});

test("personal > group > enterprise fulltrace validates explicit zero, disabled and inherited sources", () => {
  const result = parse(wire("verified", true)), f = result.evidence!.fields;
  assert.equal(f.lateGraceMinutes.minutes, 5); assert.equal(f.lateGraceMinutes.source!.layer, "personal");
  assert.equal(f.earlyGraceMinutes.state, "disabled"); assert.equal(f.earlyGraceMinutes.minutes, null); assert.equal(f.earlyGraceMinutes.source!.layer, "enterprise");
  assert.equal(f.openSpanWarningMinutes.source!.layer, "group"); assert.ok(SHIFT_RULE_VIEW_KEYS.every(k => f[k].trace.length === 3));
  assert.equal(parse(wire()).evidence!.fields.lateGraceMinutes.minutes, 0);
});

test("selected state/minutes/provenance must equal first stopping trace, not a later layer", () => {
  const mutations = [(r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.minutes = 0; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.source = r.evidence!.fields.lateGraceMinutes.trace[2].source; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.earlyGraceMinutes.state = "unconfigured"; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.completedBreakMinimumMinutes.source = null; }];
  for (const mutate of mutations) { const raw = wire("verified", true); mutate(raw); assert.throws(() => parse(raw)); }
});

test("all four fields must describe one consistent provenance record for each present layer", () => {
  for (const key of ["operationId", "actorId"] as const) {
    const raw = wire("verified", true), trace = raw.evidence!.fields.earlyGraceMinutes.trace[0]; trace.source![key] = id(99); assert.throws(() => parse(raw));
  }
  const missing = wire("verified", true), trace = missing.evidence!.fields.earlyGraceMinutes.trace[0]; trace.mode = "missing_approval"; trace.source = null; assert.throws(() => parse(missing));
  const order = wire("verified", true); order.evidence!.fields.lateGraceMinutes.trace.reverse(); assert.throws(() => parse(order));
});

test("layer-specific missing modes and exact head/group binding prohibit fake publications", () => {
  const mutations = [(r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.trace[0].mode = "missing_publication"; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.trace[1].ledgerRevision = 0; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.trace[2].source!.revision = 1; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.trace[2].source!.ledgerRevision = 1; },
    (r: ReturnType<typeof wire>) => { r.evidence!.fields.lateGraceMinutes.trace[2].groupId = id(77); }];
  for (const mutate of mutations) { const raw = wire(); mutate(raw); assert.throws(() => parse(raw)); }
});

test("technical minute bounds reject negative, fractional, unsafe and zero for positive-only rules", () => {
  for (const amount of [-1, -0, 1.5, 1441, Infinity, Number.MAX_SAFE_INTEGER]) {
    const raw = wire(); raw.evidence!.fields.lateGraceMinutes.trace[2].minutes = amount; raw.evidence!.fields.lateGraceMinutes.minutes = amount; assert.throws(() => parse(raw));
  }
  const zeroBreak = wire(); zeroBreak.evidence!.fields.completedBreakMinimumMinutes.minutes = 0; zeroBreak.evidence!.fields.completedBreakMinimumMinutes.trace[2].minutes = 0; assert.throws(() => parse(zeroBreak));
  const disabled = wire(); disabled.evidence!.fields.earlyGraceMinutes.trace[2].minutes = 0; assert.throws(() => parse(disabled));
});

test("server refuses corrupt original bytes before projecting; browser validates fingerprint shape, not hash contents", () => {
  const raw = shiftRuleBindingWire(); raw.binding!.source!.sourceSha256 = "0".repeat(64); assert.throws(() => projectShiftRuleView(raw, query, actor), /attendance_shift_rule_binding_invalid/);
  const compact = wire(); compact.evidence!.sourceSha256 = "0".repeat(64); assert.equal(parse(compact).evidence!.sourceSha256, "0".repeat(64));
  compact.evidence!.sourceSha256 = "invalid"; assert.throws(() => parse(compact));
  compact.evidence!.sourceSha256 = "0".repeat(64); compact.evidence!.sourceBytes = 65537; assert.throws(() => parse(compact));
});

test("strict compact whitelist rejects raw155 body leakage at any projection level", () => {
  for (const mutate of [(r: ReturnType<typeof wire>) => Object.assign(r, { sourceText: "private" }), (r: ReturnType<typeof wire>) => Object.assign(r.binding!, { source: {} }),
    (r: ReturnType<typeof wire>) => Object.assign(r.evidence!, { assignment: {} }), (r: ReturnType<typeof wire>) => Object.assign(r.evidence!.fields.lateGraceMinutes, { rules: {} }),
    (r: ReturnType<typeof wire>) => Object.assign(r.evidence!.group!, { history: [] })]) { const raw = wire("verified", true); mutate(raw); assert.throws(() => parse(raw)); }
});

test("HTTP envelope is bounded to32KiB, exact and requires boolean moduleEnabled", () => {
  for (const body of [{ ...http(), moduleEnabled: 1 }, { ...http(), ok: false }, { ...http(), sourceText: "x".repeat(32769) }, { ...http(), command: {} }]) assert.throws(() => parseShiftRuleViewResponse(body, query, actor));
  assert.equal(parseShiftRuleViewResponse(http("missing", false, false), query, actor).moduleEnabled, false);
});

test("plain-tree defense rejects getters, prototypes, sparse/long traces, symbols and invalid Unicode", () => {
  let invoked = 0; const getter = wire(); Object.defineProperty(getter.worker, "workerName", { enumerable: true, get() { invoked++; return "x"; } }); assert.throws(() => parse(getter)); assert.equal(invoked, 0);
  const prototype = wire(); Object.setPrototypeOf(prototype.worker, { inherited: 1 }); assert.throws(() => parse(prototype));
  const sparse = wire(); delete sparse.evidence!.fields.lateGraceMinutes.trace[1]; assert.throws(() => parse(sparse));
  const tooMany = wire(); tooMany.evidence!.fields.lateGraceMinutes.trace.push(tooMany.evidence!.fields.lateGraceMinutes.trace[0]); assert.throws(() => parse(tooMany));
  const symbol = wire(); Object.assign(symbol.worker, { [Symbol("extra")]: 1 }); assert.throws(() => parse(symbol));
  const invalidText = wire(); invalidText.worker.workerName = "\ud800"; assert.throws(() => parse(invalidText));
  const unicode = wire(); unicode.worker.workerName = "😀".repeat(120); assert.equal(parse(unicode).worker.workerName, unicode.worker.workerName);
});

test("compact parsed tree is fully detached and deeply frozen without mutating caller state", () => {
  const raw = http("verified", true), before = structuredClone(raw), result = parseShiftRuleViewResponse(raw, query, actor), owned = new Set<object>();
  const visit = (v: unknown, action: (v: object) => void) => { if (v && typeof v === "object") { action(v); Object.values(v).forEach(child => visit(child, action)); } };
  visit(raw, value => owned.add(value)); visit(result, value => { assert.equal(Object.isFrozen(value), true); assert.equal(owned.has(value), false); }); assert.deepEqual(raw, before);
  const saved = JSON.stringify(result); raw.data.evidence!.fields.lateGraceMinutes.trace[0].source!.actorId = id(99); raw.data.worker.workerName = "Changed"; assert.equal(JSON.stringify(result), saved);
});

test("compact browser entry bundles without any Node crypto,155 archival parser or server runtime", async () => {
  const result = await build({ entryPoints: ["src/lib/merchantAttendanceShiftRuleView.ts"], bundle: true, write: false, platform: "browser", format: "esm", metafile: true, logLevel: "silent" });
  const files = Object.keys(result.metafile!.inputs); assert.ok(files.some(file => file.endsWith("merchantAttendanceShiftRuleView.ts")));
  assert.ok(files.every(file => !file.endsWith("merchantAttendanceShiftRuleBinding.ts") && !file.endsWith(".server.ts") && !file.includes("node:crypto")));
  assert.doesNotMatch(result.outputFiles[0].text, /createHash|node:crypto|Buffer\.from/);
});

test("execute compact reader issues only old135 exact readonly call and validates returned bytes", async () => {
  const calls: unknown[] = [], raw = shiftRuleBindingWire("verified", true);
  const result = await executeShiftRuleView({ query, authUserId: actor }, { rpc: async (name, args) => { calls.push({ name, args }); return { data: raw, error: null }; } });
  assert.deepEqual(calls, [{ name: "faolla_attendance_shift_rule_binding_v1", args: { p_query: query, p_auth_user_id: actor } }]); assert.deepEqual(result, wire("verified", true));
  await assert.rejects(executeShiftRuleView({ query, authUserId: actor }, null), /attendance_unavailable/);
  await assert.rejects(executeShiftRuleView({ query, authUserId: actor }, { rpc: async () => ({ data: null, error: { message: "private SQL" } }) }), /attendance_unavailable/);
  raw.binding!.source!.sourceBytes++; await assert.rejects(executeShiftRuleView({ query, authUserId: actor }, { rpc: async () => ({ data: raw, error: null }) }), /attendance_shift_rule_binding_invalid/);
});
