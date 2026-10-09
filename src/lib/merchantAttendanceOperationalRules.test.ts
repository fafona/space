import assert from "node:assert/strict";
import test from "node:test";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { OPERATIONAL_RULES_PROTOCOL, OPERATIONAL_RULES_BYTE_LIMIT, OPERATIONAL_RULE_KEYS, OPERATIONAL_RULE_CHANNELS,
  OPERATIONAL_RULE_REVIEW_CATEGORIES, OPERATIONAL_RULE_REMINDER_KINDS, parseOperationalRules, parseOperationalRulesJson,
  resolveOperationalRules, type OperationalRuleKey } from "./merchantAttendanceOperationalRules";

// Synthetic input only: these IDs are not merchant locations or authorized people.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = (): Record<OperationalRuleKey, unknown> => Object.fromEntries(OPERATIONAL_RULE_KEYS.map(key => [key, { mode: "inherit" }])) as Record<OperationalRuleKey, unknown>;
const values = () => ({
  allowedChannels: ["self", "location", "pin", "onsite"], locationScope: [id(1), id(2)], shiftSource: "published_selection",
  breakTypes: { allowed: ["paid", "unpaid"], selection: "explicit" }, correctionWindow: { days: 7 },
  reviewRouting: { correction: "owner", missing: { delegateEmployeeId: id(30), delegateAuthUserId: id(31) }, leave: "owner", work_arrangement: "owner" },
  timesheetCycle: { kind: "weekly", weekStartsOn: 1 },
  reminders: { open_session: { mode: "disabled" }, pending_review: { mode: "enabled", afterMinutes: 120, repeatMinutes: 60, maxOccurrences: 3 }, period_due: { mode: "disabled" } },
});
const full = (): Record<OperationalRuleKey, unknown> => Object.fromEntries(Object.entries(values()).map(([key, value]) => [key, { mode: "value", value }])) as Record<OperationalRuleKey, unknown>;
const one = (key: OperationalRuleKey, value: unknown) => ({ ...draft(), [key]: { mode: "value", value } });
const input = (enterprise: unknown = draft(), group: unknown = null, personal: unknown = null, baselineCorrectionWindowDays: unknown = 30) =>
  ({ enterprise, group, personal, baselineCorrectionWindowDays });
const invalid = (error: unknown) => error instanceof MerchantAttendanceError && error.code === "attendance_operational_rules_invalid";
const rejects = (raw: unknown) => assert.throws(() => parseOperationalRules(raw), invalid);
const rejectsResolution = (raw: unknown) => assert.throws(() => resolveOperationalRules(raw), invalid);
const omit = (raw: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(raw).filter(([name]) => name !== key));
function frozenTree(raw: unknown): void {
  if (raw && typeof raw === "object") { assert(Object.isFrozen(raw)); Object.values(raw).forEach(frozenTree); }
}

test("239 exact eight-key contract is separate from the old threshold catalog, without configured defaults", () => {
  assert.equal(OPERATIONAL_RULES_PROTOCOL, "attendance-operational-rules-v1");
  assert.deepEqual(OPERATIONAL_RULE_KEYS, ["allowedChannels", "locationScope", "shiftSource", "breakTypes", "correctionWindow", "reviewRouting", "timesheetCycle", "reminders"]);
  assert.deepEqual(parseOperationalRules(draft()), draft());
  assert(Object.isFrozen(OPERATIONAL_RULE_KEYS)); assert(Object.isFrozen(OPERATIONAL_RULE_CHANNELS));
  assert(Object.isFrozen(OPERATIONAL_RULE_REVIEW_CATEGORIES)); assert(Object.isFrozen(OPERATIONAL_RULE_REMINDER_KINDS));
  rejects({ ...draft(), lateGraceMinutes: { mode: "value", minutes: 5 } });
});

test("all eight concrete values survive strict object and JSON parsing without semantic defaults", () => {
  const raw = full(); assert.deepEqual(parseOperationalRules(raw), raw);
  assert.deepEqual(parseOperationalRulesJson(JSON.stringify(raw)), raw);
  assert.deepEqual(parseOperationalRulesJson(` \n${JSON.stringify(raw)}\t `), raw);
});

test("all fields require exact discriminated choice shapes; null is never inherit or zero", () => {
  for (const key of OPERATIONAL_RULE_KEYS) {
    for (const mode of ["inherit", "disabled"]) {
      const raw = { ...draft(), [key]: { mode } }; assert.deepEqual(parseOperationalRules(raw), raw);
      rejects({ ...draft(), [key]: { mode, value: null } });
    }
    for (const value of [null, undefined, false, 0, "inherit", {}, { mode: "value" }, { mode: "other" }, { mode: "inherit", extra: true },
      { mode: "value", value: values()[key], extra: 1 }]) rejects({ ...draft(), [key]: value });
    rejects(omit(draft(), key));
  }
  for (const raw of [null, [], true, { ...draft(), protocol: OPERATIONAL_RULES_PROTOCOL }, { ...draft(), extra: null }]) rejects(raw);
});

test("allowed channels accept only a nonempty unique canonical self/location/pin/onsite subset", () => {
  for (const channels of [["self"], ["onsite"], ["location", "onsite"], [...OPERATIONAL_RULE_CHANNELS]])
    assert.deepEqual(parseOperationalRules(one("allowedChannels", channels)).allowedChannels, { mode: "value", value: channels });
  for (const channels of [[], ["pin", "location"], ["self", "self"], ["web"], ["kiosk"], ["self", "unknown"], [null], [1], "self"])
    rejects(one("allowedChannels", channels));
});

test("location scope validates 1..25 canonical UUIDs without claiming same-merchant authorization", () => {
  const ids = Array.from({ length: 25 }, (_, n) => id(n + 1));
  assert.deepEqual(parseOperationalRules(one("locationScope", ids)).locationScope, { mode: "value", value: ids });
  for (const ids of [[], [id(2), id(1)], [id(1), id(1)], Array.from({ length: 26 }, (_, n) => id(n + 1)), [id(1).replace("4000", "0000")], ["uuid"], [null]])
    rejects(one("locationScope", ids));
  rejects(one("locationScope", ["abcdefab-0000-4000-8000-000000000001".toUpperCase()]));
});

test("UUIDs require exactly 36 characters in location and both routing identities, including before trailing line breaks", () => {
  for (const suffix of ["\n", "\r\n", "\u2028", "\u2029"]) {
    const location = one("locationScope", [id(1) + suffix]); rejects(location);
    assert.throws(() => parseOperationalRulesJson(JSON.stringify(location)), invalid);
    for (const key of ["delegateEmployeeId", "delegateAuthUserId"]) {
      const target = { delegateEmployeeId: id(30), delegateAuthUserId: id(31), [key]: id(30) + suffix };
      const routing = one("reviewRouting", { ...values().reviewRouting, missing: target }); rejects(routing);
      assert.throws(() => parseOperationalRulesJson(JSON.stringify(routing)), invalid);
    }
  }
});

test("break types preserve paid/unpaid facts and require a single fixed type or explicit choice", () => {
  for (const allowed of [["paid"], ["unpaid"], ["paid", "unpaid"]]) for (const selection of ["fixed", "explicit"]) {
    const value = { allowed, selection };
    if (selection === "fixed" && allowed.length !== 1) rejects(one("breakTypes", value));
    else assert.deepEqual(parseOperationalRules(one("breakTypes", value)).breakTypes, { mode: "value", value });
  }
  for (const value of [{ allowed: [], selection: "explicit" }, { allowed: ["unpaid", "paid"], selection: "explicit" },
    { allowed: ["paid", "paid"], selection: "explicit" }, { allowed: ["meal"], selection: "fixed" }, { allowed: ["paid"] },
    { allowed: ["paid"], selection: "auto" }, { allowed: ["paid"], selection: "fixed", breakPaid: true }]) rejects(one("breakTypes", value));
});

test("correction-window technical endpoints preserve zero and reject coercion or extra keys", () => {
  for (const days of [0, 1, 365]) assert.deepEqual(parseOperationalRules(one("correctionWindow", { days })).correctionWindow, { mode: "value", value: { days } });
  for (const days of [-0, -1, 366, 1.5, NaN, Infinity, "7", null, undefined, true]) rejects(one("correctionWindow", { days }));
  rejects(one("correctionWindow", { days: 7, timeZone: "UTC" })); rejects(one("correctionWindow", {}));
});

test("review routing has four fixed categories and exact owner or double-identity target, not a grant", () => {
  const routes = values().reviewRouting;
  assert.deepEqual(parseOperationalRules(one("reviewRouting", routes)).reviewRouting, { mode: "value", value: routes });
  for (const category of OPERATIONAL_RULE_REVIEW_CATEGORIES) {
    rejects(one("reviewRouting", omit(routes, category)));
    for (const target of [null, "admin", { kind: "owner" }, { delegateEmployeeId: id(1) }, { delegateAuthUserId: id(2) },
      { delegateEmployeeId: id(1), delegateAuthUserId: id(2), grantId: id(3) }]) rejects(one("reviewRouting", { ...routes, [category]: target }));
  }
  rejects(one("reviewRouting", { ...routes, revision: "owner" }));
});

test("timesheet cycle exact alternatives accept real four-digit civil dates from 0001 through 9999 and leap days", () => {
  for (const cycle of [{ kind: "weekly", weekStartsOn: 1 }, { kind: "weekly", weekStartsOn: 7 }, { kind: "monthly" }, { kind: "manual" },
    ...["0001-01-01", "0400-02-29", "1999-12-31", "2000-01-01", "2000-02-29", "2024-02-29", "2100-12-31", "2101-01-01", "9999-12-31"].map(anchorDate => ({ kind: "fortnightly", anchorDate }))])
    assert.deepEqual(parseOperationalRules(one("timesheetCycle", cycle)).timesheetCycle, { mode: "value", value: cycle });
});

test("timesheet cycle rejects normalized impossible dates, implicit weeks and unrelated timezone keys", () => {
  for (const anchorDate of ["0000-01-01", "0001-02-29", "1900-02-29", "2023-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "10000-01-01", "2026-01-01\n", "2026-01-01T00:00:00Z"])
    rejects(one("timesheetCycle", { kind: "fortnightly", anchorDate }));
  for (const weekStartsOn of [0, 8, "1", 1.5, -0]) rejects(one("timesheetCycle", { kind: "weekly", weekStartsOn }));
  for (const cycle of [{ kind: "weekly" }, { kind: "fortnightly" }, { kind: "monthly", anchorDate: "2026-01-01" }, { kind: "manual", timeZone: "UTC" }, { kind: "daily" }])
    rejects(one("timesheetCycle", cycle));
});

test("three reminder categories require explicit disabled or enabled settings with no default expiry", () => {
  const reminders = values().reminders;
  assert.deepEqual(parseOperationalRules(one("reminders", reminders)).reminders, { mode: "value", value: reminders });
  for (const kind of OPERATIONAL_RULE_REMINDER_KINDS) {
    rejects(one("reminders", omit(reminders, kind)));
    for (const value of [true, false, null, { mode: "inherit" }, { mode: "disabled", afterMinutes: 1 }, { mode: "enabled" },
      { mode: "enabled", afterMinutes: 1, repeatMinutes: 60 }, { mode: "enabled", afterMinutes: 1, repeatMinutes: 60, maxOccurrences: 1, email: true }])
      rejects(one("reminders", { ...reminders, [kind]: value }));
  }
  rejects(one("reminders", { ...reminders, leave_due: { mode: "disabled" } }));
});

test("enabled reminder values have explicit finite inclusive bounds and reject numeric coercion", () => {
  for (const settings of [{ afterMinutes: 1, repeatMinutes: 60, maxOccurrences: 1 }, { afterMinutes: 44640, repeatMinutes: 44640, maxOccurrences: 10 }]) {
    const value = { ...values().reminders, open_session: { mode: "enabled", ...settings } };
    assert.deepEqual(parseOperationalRules(one("reminders", value)).reminders, { mode: "value", value });
  }
  for (const [key, bad] of Object.entries({ afterMinutes: [0, -0, 44641, "1", null, 1.5], repeatMinutes: [0, 59, 44641, Infinity], maxOccurrences: [0, 11, NaN, "3"] }))
    for (const value of bad) rejects(one("reminders", { ...values().reminders, open_session: { mode: "enabled", afterMinutes: 1, repeatMinutes: 60, maxOccurrences: 1, [key]: value } }));
});

test("input validation does not execute accessors or toJSON and rejects custom record prototypes", () => {
  let called = 0; const raw = draft();
  Object.defineProperty(raw, "allowedChannels", { enumerable: true, get() { called++; return { mode: "inherit" }; } }); rejects(raw);
  const nested = { mode: "value" }; Object.defineProperty(nested, "value", { enumerable: true, get() { called++; return ["self"]; } });
  rejects({ ...draft(), allowedChannels: nested });
  rejects({ ...draft(), toJSON() { called++; return draft(); } });
  const polluted = Object.assign(Object.create({ inherited: true }), draft()); rejects(polluted);
  assert.equal(called, 0);
  assert.deepEqual(parseOperationalRules(Object.assign(Object.create(null), draft())), draft());
});

test("unsafe trees reject cycles, symbols, hidden members, sparse and custom arrays", () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; rejects({ ...draft(), reminders: cycle });
  const symbol = draft(); Object.defineProperty(symbol, Symbol("hidden"), { value: 1, enumerable: true }); rejects(symbol);
  const hidden = draft(); Object.defineProperty(hidden, "extra", { value: 1 }); rejects(hidden);
  const sparse = [id(1), , id(3)]; rejects(one("locationScope", sparse));
  const array = ["self"]; Object.defineProperty(array, "extra", { value: 1 }); rejects(one("allowedChannels", array));
  const subclass = new (class extends Array<string> {})("self"); rejects(one("allowedChannels", subclass));
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const raw = draft(); Object.defineProperty(raw, key, { enumerable: true, value: {} }); rejects(raw);
  }
});

test("oversized property names are rejected before value access and serialization without invoking getters", () => {
  let calls = 0; const key = "x".repeat(OPERATIONAL_RULES_BYTE_LIMIT + 1), raw = draft();
  Object.defineProperty(raw, key, { enumerable: true, get() { calls++; return { mode: "inherit" }; } });
  rejects(raw); assert.equal(calls, 0);
  const nested = { mode: "value", value: { days: 7 } };
  Object.defineProperty(nested.value, key, { enumerable: true, get() { calls++; return 1; } });
  rejects({ ...draft(), correctionWindow: nested }); assert.equal(calls, 0);
});

test("JSON decoder rejects duplicate keys including escaped aliases at document and nested levels", () => {
  const text = JSON.stringify(draft());
  for (const duplicated of [text.replace('{"allowedChannels":', '{"allowedChannels":{"mode":"inherit"},"allowedChannels":'),
    text.replace('"mode":"inherit"', '"mode":"inherit","m\\u006fde":"disabled"'),
    JSON.stringify(full()).replace('"days":7', '"days":7,"days":0')]) assert.throws(() => parseOperationalRulesJson(duplicated), invalid);
  for (const text of ["", "{}{}", "NaN", "{", "[]", '{"__proto__":{}}', '{"constructor":{}}']) assert.throws(() => parseOperationalRulesJson(text), invalid);
});

test("UTF-8 bounds reject oversized wire and malformed Unicode without replacement-character normalization", () => {
  for (const text of [" ".repeat(OPERATIONAL_RULES_BYTE_LIMIT + 1), `{"extra":"${"汉".repeat(12000)}"}`, "\ud800", '"\\ud800"', '"\\udc00"'])
    assert.throws(() => parseOperationalRulesJson(text), invalid);
  rejects(one("shiftSource", "\ud800")); rejects(one("shiftSource", "\udc00"));
  const raw = draft(); Object.defineProperty(raw, "\ud800", { value: 1, enumerable: true }); rejects(raw);
});

test("tree work is bounded by depth, node count and array size before shape parsing", () => {
  let nested: unknown = {}; for (let n = 0; n < 14; n++) nested = { nested }; rejects({ ...draft(), reminders: nested });
  rejects(one("locationScope", Array.from({ length: 26 }, (_, n) => id(n))));
  const leaves = Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => Array.from({ length: 7 }, () => 0)));
  rejects({ ...draft(), reminders: leaves });
});

test("parsed documents are detached and deeply frozen; caller-owned objects are untouched", () => {
  const raw = full(), before = JSON.stringify(raw), parsed = parseOperationalRules(raw); frozenTree(parsed);
  assert.equal(JSON.stringify(raw), before); assert(!Object.isFrozen(raw)); assert.notEqual(parsed, raw);
  const original = (raw.allowedChannels as { value: string[] }).value; original.push("not-a-channel");
  assert.deepEqual(parsed.allowedChannels, { mode: "value", value: [...OPERATIONAL_RULE_CHANNELS] });
});

test("preview only traces supplied layers, with no invented publication, grant or configured default", () => {
  const result = resolveOperationalRules(input());
  assert.equal(result.protocol, "attendance-operational-rules-preview-v1"); assert.equal(result.candidateOnly, true);
  assert.equal(result.applied, false); assert.equal(result.authorityChecked, false); assert.deepEqual(result.providedLayers, ["enterprise"]);
  for (const field of Object.values(result.fields)) {
    assert.equal(field.state, "unconfigured"); assert.equal(field.value, null); assert.deepEqual(field.sources, []);
    assert.deepEqual(field.trace, [{ layer: "enterprise", choice: { mode: "inherit" } }]);
  }
  assert.equal(result.fields.correctionWindow.constrainedDays, 30); assert.equal(result.fields.correctionWindow.baselineMissing, false);
  assert(!("effectiveAt" in result)); assert(!("approved" in result)); frozenTree(result);
});

test("fieldwise personal then group then enterprise priority treats disabled as explicit, not inherit", () => {
  const enterprise = full(), group = draft(), personal = draft();
  group.allowedChannels = { mode: "value", value: ["pin"] }; personal.shiftSource = { mode: "value", value: "unplanned" };
  personal.breakTypes = { mode: "disabled" }; group.timesheetCycle = { mode: "disabled" };
  const fields = resolveOperationalRules(input(enterprise, group, personal)).fields;
  assert.deepEqual(fields.allowedChannels.sources, ["group"]); assert.deepEqual(fields.allowedChannels.value, ["pin"]);
  assert.deepEqual(fields.shiftSource.sources, ["personal"]); assert.equal(fields.shiftSource.value, "unplanned");
  assert.equal(fields.breakTypes.state, "disabled"); assert.equal(fields.breakTypes.value, null); assert.deepEqual(fields.breakTypes.sources, ["personal"]);
  assert.equal(fields.timesheetCycle.state, "disabled"); assert.deepEqual(fields.timesheetCycle.sources, ["group"]);
  assert.deepEqual(fields.reviewRouting.sources, ["enterprise"]);
  assert.deepEqual(fields.breakTypes.trace.map(t => [t.layer, t.choice.mode]), [["personal", "disabled"], ["group", "inherit"], ["enterprise", "value"]]);
});

test("each of the eight fields can be supplied independently by each layer", () => {
  for (const layer of ["enterprise", "group", "personal"] as const) for (const key of OPERATIONAL_RULE_KEYS) {
    const docs = { enterprise: draft(), group: draft(), personal: draft() }; docs[layer][key] = { mode: "value", value: values()[key] };
    const field = resolveOperationalRules({ ...docs, baselineCorrectionWindowDays: 30 }).fields[key];
    assert.equal(field.state, "value"); assert.deepEqual(field.value, values()[key]); assert.deepEqual(field.sources, [layer]);
  }
});

test("location intersection retains every restricting layer; personal disabled cannot erase group restrictions", () => {
  const enterprise = one("locationScope", [id(1), id(2), id(3)]), group = one("locationScope", [id(2), id(3), id(4)]), personal = one("locationScope", [id(3), id(4)]);
  const field = resolveOperationalRules(input(enterprise, group, personal)).fields.locationScope;
  assert.equal(field.state, "value"); assert.deepEqual(field.value, [id(3)]); assert.deepEqual(field.sources, ["personal", "group", "enterprise"]);
  personal.locationScope = { mode: "disabled" };
  const disabled = resolveOperationalRules(input(enterprise, group, personal)).fields.locationScope;
  assert.deepEqual(disabled.value, [id(2), id(3)]); assert.deepEqual(disabled.sources, ["group", "enterprise"]);
  assert.equal(disabled.trace[0].choice.mode, "disabled");
});

test("an empty location intersection is an explicit restriction, never an unconfigured or disabled fallback", () => {
  const fields = resolveOperationalRules(input(one("locationScope", [id(1)]), null, one("locationScope", [id(2)]))).fields;
  assert.equal(fields.locationScope.state, "value"); assert.deepEqual(fields.locationScope.value, []);
  assert.deepEqual(fields.locationScope.sources, ["personal", "enterprise"]);
  const personal = draft(); personal.locationScope = { mode: "disabled" };
  const disabled = resolveOperationalRules(input(draft(), null, personal)).fields.locationScope;
  assert.equal(disabled.state, "disabled"); assert.equal(disabled.value, null); assert.deepEqual(disabled.sources, ["personal"]);
});

test("selected correction days can only narrow the independent baseline, including explicit zero", () => {
  for (const [baseline, selected, expected] of [[30, 7, 7], [7, 30, 7], [0, 30, 0], [30, 0, 0], [365, 365, 365]]) {
    const field = resolveOperationalRules(input(draft(), null, one("correctionWindow", { days: selected }), baseline)).fields.correctionWindow;
    assert.deepEqual(field.value, { days: selected }); assert.equal(field.baselineDays, baseline); assert.equal(field.constrainedDays, expected);
    assert.equal(field.baselineMissing, false); assert.deepEqual(field.sources, ["personal"]);
  }
  const enterprise = one("correctionWindow", { days: 3 }), personal = one("correctionWindow", { days: 20 });
  assert.equal(resolveOperationalRules(input(enterprise, null, personal, 10)).fields.correctionWindow.constrainedDays, 10);
  personal.correctionWindow = { mode: "disabled" };
  const disabled = resolveOperationalRules(input(enterprise, null, personal, 10)).fields.correctionWindow;
  assert.equal(disabled.state, "disabled"); assert.equal(disabled.value, null); assert.equal(disabled.constrainedDays, 10);
});

test("missing independent correction policy cannot be replaced by an inherited or personal policy", () => {
  for (const enterprise of [draft(), one("correctionWindow", { days: 0 }), one("correctionWindow", { days: 365 })]) {
    const field = resolveOperationalRules(input(enterprise, null, null, null)).fields.correctionWindow;
    assert.equal(field.baselineMissing, true); assert.equal(field.baselineDays, null); assert.equal(field.constrainedDays, null);
  }
});

test("resolver input is exact; null optional layers mean only not provided, not proven nonexistent", () => {
  for (const key of Object.keys(input())) rejectsResolution(omit(input(), key));
  for (const raw of [{ ...input(), extra: true }, input(null), input(draft(), false), { ...input(), personal: undefined }, input(draft(), null, null, "30"),
    input(draft(), null, null, -0), input(draft(), null, null, 366)]) rejectsResolution(raw);
  assert.deepEqual(resolveOperationalRules(input(draft(), draft(), null)).providedLayers, ["group", "enterprise"]);
  assert.deepEqual(resolveOperationalRules(input(draft(), null, draft())).providedLayers, ["personal", "enterprise"]);
});

test("resolver is deterministic, detached and read-only even for full layered inputs", () => {
  const raw = input(full(), draft(), full(), 14), before = JSON.stringify(raw);
  const first = resolveOperationalRules(raw), second = resolveOperationalRules(raw);
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.equal(JSON.stringify(raw), before); assert(!Object.isFrozen(raw));
  frozenTree(first); (raw.personal as Record<string, unknown>).reviewRouting = { mode: "disabled" };
  assert.equal(first.fields.reviewRouting.state, "value"); assert.equal(first.authorityChecked, false); assert.equal(first.applied, false);
  assert.deepEqual(first.fields.reviewRouting.value, values().reviewRouting);
});
