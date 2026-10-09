import assert from "node:assert/strict";
import test from "node:test";
import { RULE_KEYS, RULE_DEFINITIONS, emptyAttendanceRuleDraft, previewAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

const keys = ["lateGraceMinutes", "earlyGraceMinutes", "openSpanWarningMinutes", "completedBreakMinimumMinutes"] as const;
const tiers = ["enterprise", "group", "personal"] as const;
type Key = typeof keys[number];
type Choice = { mode: "inherit" } | { mode: "disabled" } | { mode: "value"; minutes: number };
type Tier = Record<Key, Choice>;
const value = (minutes: number): Choice => ({ mode: "value", minutes });
const inherit = (): Choice => ({ mode: "inherit" });
const disabled = (): Choice => ({ mode: "disabled" });
const draft = (): Tier => ({ lateGraceMinutes: inherit(), earlyGraceMinutes: inherit(), openSpanWarningMinutes: inherit(), completedBreakMinimumMinutes: inherit() });
const input = () => ({ timeZone: "Europe/Madrid", now: "2026-10-04T12:00:00.000Z", effectiveOn: "2026-10-05", enterprise: draft(), group: draft(), personal: draft() });
const rejects = (candidate: unknown) => assert.throws(() => previewAttendanceRuleDraft(candidate), MerchantAttendanceError);
const omit = (record: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

test("draft catalog is exactly four bounded minute rules, with no configured defaults", () => {
  assert.deepEqual([...RULE_KEYS], [...keys]);
  assert.deepEqual(Object.keys(RULE_DEFINITIONS).sort(), [...keys].sort());
  const limits = [[0, 1440], [0, 1440], [1, 44640], [1, 1440]];
  keys.forEach((key, n) => {
    assert.equal(typeof RULE_DEFINITIONS[key].label, "string");
    assert(RULE_DEFINITIONS[key].label.trim());
    assert.equal(RULE_DEFINITIONS[key].min, limits[n][0]);
    assert.equal(RULE_DEFINITIONS[key].max, limits[n][1]);
  });
  assert.deepEqual(emptyAttendanceRuleDraft(), draft());
  assert.notEqual(emptyAttendanceRuleDraft(), emptyAttendanceRuleDraft());
  const first = emptyAttendanceRuleDraft(), second = emptyAttendanceRuleDraft();
  assert.equal(new Set(keys.map(key => first[key])).size, 4);
  for (const key of keys) assert.notEqual(first[key], second[key]);
  assert(Object.isFrozen(RULE_KEYS)); assert(Object.isFrozen(RULE_DEFINITIONS));
});

test("all-inherited hypothetical tiers remain unconfigured instead of inventing enterprise defaults", () => {
  const result = previewAttendanceRuleDraft(input());
  assert.equal(result.protocol, "rule-draft-preview-v1");
  assert.equal(result.checkedAt, input().now);
  assert.equal(result.timeZone, "Europe/Madrid");
  assert.equal(result.effectiveOn, "2026-10-05");
  assert.equal(result.effectiveAt, "2026-10-04T22:00:00.000Z");
  for (const key of keys) {
    const field = result.fields[key];
    assert.equal(field.state, "unconfigured"); assert.equal(field.minutes, null); assert.equal(field.source, null);
    assert.deepEqual(field.trace.map(item => item.source), ["personal", "group", "enterprise"]);
    assert(field.trace.every(item => item.mode === "inherit"));
  }
});

test("enterprise explicit values are inherited independently by all four fields", () => {
  const candidate = input();
  keys.forEach((key, n) => { candidate.enterprise[key] = value(n + 1); });
  const result = previewAttendanceRuleDraft(candidate);
  keys.forEach((key, n) => {
    assert.equal(result.fields[key].state, "value"); assert.equal(result.fields[key].source, "enterprise");
    assert.equal(result.fields[key].minutes, n + 1);
  });
});

test("group overrides fieldwise rather than replacing an entire enterprise rule object", () => {
  const candidate = input();
  candidate.enterprise = { lateGraceMinutes: value(10), earlyGraceMinutes: value(20), openSpanWarningMinutes: value(600), completedBreakMinimumMinutes: value(15) };
  candidate.group.lateGraceMinutes = value(5); candidate.group.openSpanWarningMinutes = disabled();
  const fields = previewAttendanceRuleDraft(candidate).fields;
  assert.deepEqual(keys.map(key => [fields[key].state, fields[key].minutes, fields[key].source]), [
    ["value", 5, "group"], ["value", 20, "enterprise"], ["disabled", null, "group"], ["value", 15, "enterprise"],
  ]);
});

test("personal hypothetical values outrank group and enterprise only on their own fields", () => {
  const candidate = input();
  candidate.enterprise.lateGraceMinutes = value(30); candidate.group.lateGraceMinutes = disabled(); candidate.personal.lateGraceMinutes = value(3);
  candidate.enterprise.earlyGraceMinutes = value(25); candidate.group.earlyGraceMinutes = value(10); candidate.personal.earlyGraceMinutes = disabled();
  candidate.group.openSpanWarningMinutes = value(700); candidate.enterprise.completedBreakMinimumMinutes = value(20);
  const fields = previewAttendanceRuleDraft(candidate).fields;
  assert.deepEqual(keys.map(key => [fields[key].state, fields[key].minutes, fields[key].source]), [
    ["value", 3, "personal"], ["disabled", null, "personal"], ["value", 700, "group"], ["value", 20, "enterprise"],
  ]);
});

test("explicit zero grace is a configured value, not disabled, empty, or fallback", () => {
  const candidate = input();
  candidate.enterprise.lateGraceMinutes = value(20); candidate.enterprise.earlyGraceMinutes = value(20);
  candidate.personal.lateGraceMinutes = value(0); candidate.personal.earlyGraceMinutes = disabled();
  const fields = previewAttendanceRuleDraft(candidate).fields;
  assert.equal(fields.lateGraceMinutes.state, "value"); assert.equal(fields.lateGraceMinutes.minutes, 0); assert.equal(fields.lateGraceMinutes.source, "personal");
  assert.equal(fields.earlyGraceMinutes.state, "disabled"); assert.equal(fields.earlyGraceMinutes.minutes, null); assert.equal(fields.earlyGraceMinutes.source, "personal");
  assert.deepEqual(fields.lateGraceMinutes.trace, [{ source: "personal", mode: "value" }]);
  assert.deepEqual(fields.earlyGraceMinutes.trace, [{ source: "personal", mode: "disabled" }]);
});

test("each rule accepts its inclusive numeric endpoints at every hypothetical tier", () => {
  for (const tier of tiers) for (const key of keys) for (const minutes of [RULE_DEFINITIONS[key].min, RULE_DEFINITIONS[key].max]) {
    const candidate = input(); candidate[tier][key] = value(minutes);
    const field = previewAttendanceRuleDraft(candidate).fields[key];
    assert.equal(field.state, "value"); assert.equal(field.minutes, minutes); assert.equal(field.source, tier);
  }
});

test("minute values reject fractions, strings, non-finite numbers and out-of-range integers", () => {
  for (const key of keys) for (const minutes of [RULE_DEFINITIONS[key].min - 1, RULE_DEFINITIONS[key].max + 1, -0, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, "5", null, true]) {
    const candidate = input();
    rejects({ ...candidate, enterprise: { ...candidate.enterprise, [key]: { mode: "value", minutes } } });
  }
});

test("top-level input requires exactly the six explicit fields and rejects non-records", () => {
  for (const candidate of [null, undefined, [], "draft", 1, true, new Date(), { ...input(), siteId: "99990009" }, { ...input(), approved: true }, { ...input(), extra: undefined }]) rejects(candidate);
  for (const key of Object.keys(input())) rejects(omit(input(), key));
});

test("all tiers require all four exact rule keys, even when their choices would lose precedence", () => {
  for (const tier of tiers) {
    for (const raw of [null, undefined, [], "inherit", 0, new Date(), { ...draft(), extra: inherit() }]) rejects({ ...input(), [tier]: raw });
    for (const key of keys) rejects({ ...input(), [tier]: omit(draft(), key) });
  }
  const candidate = input(); candidate.personal.lateGraceMinutes = value(5);
  rejects({ ...candidate, enterprise: { ...candidate.enterprise, lateGraceMinutes: { mode: "value", minutes: "bad" } } });
});

test("choices are discriminated exact objects; disabled and inherit never carry minutes", () => {
  const malformed = [null, undefined, [], "inherit", false, {}, { mode: "unknown" }, { mode: "inherit", minutes: 0 }, { mode: "disabled", minutes: null },
    { mode: "value" }, { mode: "value", minutes: 5, extra: true }, { mode: ["value"], minutes: 5 }, { mode: "inherit", extra: undefined }];
  for (const choice of malformed) rejects({ ...input(), group: { ...draft(), lateGraceMinutes: choice } });
});

test("prototype and pollution-shaped records cannot provide hidden tiers, rules or choice modes", () => {
  rejects(Object.assign(Object.create({ hidden: true }), input()));
  rejects({ ...input(), group: Object.assign(Object.create({ hidden: true }), draft()) });
  rejects({ ...input(), group: { ...draft(), lateGraceMinutes: Object.create({ mode: "inherit" }) } });
  rejects(JSON.parse(JSON.stringify(input()).replace('"timeZone":', '"__proto__":{"polluted":true},"timeZone":')));
  rejects({ ...input(), group: { ...draft(), lateGraceMinutes: JSON.parse('{"mode":"inherit","__proto__":{"polluted":true}}') } });
  rejects({ ...input(), [Symbol("extra")]: true });
  rejects({ ...input(), group: { ...draft(), [Symbol("extra")]: true } });
  rejects({ ...input(), group: { ...draft(), lateGraceMinutes: { mode: "inherit", [Symbol("extra")]: true } } });
  let getterCalls = 0;
  const getter = () => { getterCalls++; return "inherit"; };
  rejects(Object.defineProperty(input(), "timeZone", { get: getter }));
  rejects({ ...input(), group: Object.defineProperty(draft(), "lateGraceMinutes", { get: getter }) });
  rejects({ ...input(), group: { ...draft(), lateGraceMinutes: Object.defineProperty({}, "mode", { get: getter, enumerable: true }) } });
  assert.equal(getterCalls, 0);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("preview neither mutates input nor returns aliases into it, and repeated calls are deterministic", () => {
  const candidate = input(); candidate.personal.lateGraceMinutes = value(5);
  const before = structuredClone(candidate), result = previewAttendanceRuleDraft(candidate), snapshot = structuredClone(result);
  assert.deepEqual(candidate, before); assert.deepEqual(previewAttendanceRuleDraft(candidate), result);
  candidate.personal.lateGraceMinutes = disabled(); candidate.group.earlyGraceMinutes = value(2);
  assert.deepEqual(result, snapshot);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.fields));
  const other = previewAttendanceRuleDraft(before);
  assert.notEqual(result, other); assert.notEqual(result.fields, other.fields);
  for (const key of keys) {
    assert.notEqual(result.fields[key], other.fields[key]); assert.notEqual(result.fields[key].trace, other.fields[key].trace);
    assert(Object.isFrozen(result.fields[key])); assert(Object.isFrozen(result.fields[key].trace));
    assert(result.fields[key].trace.every(Object.isFrozen));
  }
});

test("now must be a real canonical millisecond UTC instant within the supported range", () => {
  for (const now of [null, 1, "2026-10-04", "2026-10-04T12:00:00Z", "2026-10-04T12:00:00.000000Z", "2026-10-04T12:00:00.000+00:00",
    "2026-02-30T12:00:00.000Z", "2026-10-04T24:00:00.000Z", "1999-12-31T12:00:00.000Z", "2101-01-01T00:00:00.000Z", "2026-10-04T12:00:60.000Z"]) rejects({ ...input(), now });
  rejects({ ...input(), now: "2000-01-01T00:00:00.000Z", timeZone: "America/Los_Angeles", effectiveOn: "2000-01-02" });
  assert.equal(previewAttendanceRuleDraft({ ...input(), now: "1999-12-31T23:00:00.000Z", effectiveOn: "2000-01-02" }).checkedAt, "1999-12-31T23:00:00.000Z");
});

test("time zone is explicit and validated, never a numeric offset or browser default", () => {
  for (const timeZone of [null, undefined, 1, "", " Europe/Madrid", "Europe/Madrid ", "Bad/Zone", "+02:00", "GMT+0200", "x".repeat(101)]) rejects({ ...input(), timeZone });
  assert.equal(previewAttendanceRuleDraft({ ...input(), timeZone: "UTC" }).effectiveAt, "2026-10-05T00:00:00.000Z");
});

test("effective date must be a real exact calendar date in 2000 through 2100", () => {
  for (const effectiveOn of [null, undefined, 20261005, "2026-1-05", "2026-10-05T00:00:00.000Z", "2026-02-30", "2026-13-01", "1999-12-31", "2101-01-01", "2026-10-05 "]) rejects({ ...input(), effectiveOn });
  assert.equal(previewAttendanceRuleDraft({ ...input(), timeZone: "UTC", now: "2100-12-30T00:00:00.000Z", effectiveOn: "2100-12-31" }).effectiveAt, "2100-12-31T00:00:00.000Z");
});

test("today and earlier local dates are forbidden, even when today's midnight or work start is future in another zone", () => {
  for (const now of ["2026-10-03T22:00:00.000Z", "2026-10-04T00:00:00.000Z", "2026-10-04T21:59:59.999Z"])
    for (const effectiveOn of ["2026-10-03", "2026-10-04"]) rejects({ ...input(), now, effectiveOn });
});

test("enterprise local date ahead of UTC controls the earliest allowed proposed day", () => {
  const candidate = { ...input(), now: "2026-10-04T23:00:00.000Z" };
  rejects({ ...candidate, effectiveOn: "2026-10-05" });
  assert.equal(previewAttendanceRuleDraft({ ...candidate, effectiveOn: "2026-10-06" }).effectiveAt, "2026-10-05T22:00:00.000Z");
});

test("enterprise local date behind UTC permits the next local day despite an equal UTC date", () => {
  const candidate = { ...input(), timeZone: "America/Los_Angeles", now: "2026-10-05T00:00:00.000Z", effectiveOn: "2026-10-05" };
  assert.equal(previewAttendanceRuleDraft(candidate).effectiveAt, "2026-10-05T07:00:00.000Z");
  rejects({ ...candidate, effectiveOn: "2026-10-04" });
});

test("Madrid DST spring and autumn boundaries use actual local-day starts rather than fixed 24-hour arithmetic", () => {
  const cases = [
    { now: "2026-03-28T12:00:00.000Z", dates: ["2026-03-29", "2026-03-30"], starts: ["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"], hours: 23 },
    { now: "2026-10-24T12:00:00.000Z", dates: ["2026-10-25", "2026-10-26"], starts: ["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"], hours: 25 },
  ];
  for (const c of cases) {
    const results = c.dates.map(effectiveOn => previewAttendanceRuleDraft({ ...input(), now: c.now, effectiveOn }));
    assert.deepEqual(results.map(result => result.effectiveAt), c.starts);
    assert.equal(Date.parse(results[1].effectiveAt) - Date.parse(results[0].effectiveAt), c.hours * 3600000);
  }
});

test("Apia's skipped calendar day is rejected while the next actual local day is allowed", () => {
  const candidate = { ...input(), timeZone: "Pacific/Apia", now: "2011-12-29T22:00:00.000Z" };
  rejects({ ...candidate, effectiveOn: "2011-12-30" });
  rejects({ ...candidate, effectiveOn: "2011-12-29" });
  const result = previewAttendanceRuleDraft({ ...candidate, effectiveOn: "2011-12-31" });
  assert.equal(result.effectiveAt, "2011-12-30T10:00:00.000Z");
  assert.equal(result.effectiveOn, "2011-12-31");
});
