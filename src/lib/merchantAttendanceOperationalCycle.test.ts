import assert from "node:assert/strict";
import test from "node:test";
import { suggestOperationalCycle, suggestOperationalCycleChoice, OPERATIONAL_CYCLE_PROTOCOL } from "./merchantAttendanceOperationalCycle";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules, resolveOperationalRules, type OperationalTimesheetCycle } from "./merchantAttendanceOperationalRules";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { parsePeriodClosureV2Query } from "./merchantAttendancePeriodClosureV2";

const input = (cycle: OperationalTimesheetCycle, date = "2026-10-08", timeZone = "UTC") => ({ date, timeZone, cycle });
test("cycle weekly supports all explicit ISO week starts and contains the target without host timezone", t => {
  for (const name of ["getDay", "getDate", "getMonth", "getFullYear"] as const) t.mock.method(Date.prototype, name, () => { throw Error("implicit host timezone forbidden"); });
  const starts = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-02", "2026-10-03", "2026-10-04"];
  for (let weekStartsOn = 1; weekStartsOn <= 7; weekStartsOn++) {
    const result = suggestOperationalCycle(input({ kind: "weekly", weekStartsOn }));
    assert.equal(result.range?.fromDate, starts[weekStartsOn - 1]); assert.equal(result.range?.civilDays, 7);
    assert.ok(result.range!.fromDate <= result.date && result.date <= result.range!.throughDate);
    assert.deepEqual(result.range, suggestOperationalCycle(input({ kind: "weekly", weekStartsOn }, "2026-10-08", "Pacific/Auckland")).range);
  }
});
test("cycle fortnight uses floor before anchor, with both containing boundaries inclusive", () => {
  const cycle = { kind: "fortnightly", anchorDate: "2026-10-05" } as const;
  assert.deepEqual(suggestOperationalCycle(input(cycle, "2026-10-04")).range, { fromDate: "2026-09-21", throughDate: "2026-10-04", civilDays: 14 });
  for (const date of ["2026-10-05", "2026-10-18"]) assert.deepEqual(suggestOperationalCycle(input(cycle, date)).range, { fromDate: "2026-10-05", throughDate: "2026-10-18", civilDays: 14 });
  assert.deepEqual(suggestOperationalCycle(input(cycle, "2026-10-19")).range, { fromDate: "2026-10-19", throughDate: "2026-11-01", civilDays: 14 });
});
test("cycle preserves full 0001..9999 anchor domain without Date.UTC's year-0..99 remapping", () => {
  for (const anchorDate of ["0001-01-01", "0099-12-31", "0400-02-29", "1999-01-01", "9999-12-31"]) {
    const value = suggestOperationalCycle(input({ kind: "fortnightly", anchorDate }));
    assert.equal(value.range!.civilDays, 14); assert.equal(value.choice.mode, "value");
    assert.ok(value.range!.fromDate <= value.date && value.date <= value.range!.throughDate);
    const delta = (Date.parse(value.range!.fromDate + "T00:00:00Z") - Date.parse(anchorDate + "T00:00:00Z")) / 86_400_000;
    assert.equal(delta % 14 === 0, true);
  }
  for (const anchorDate of ["0000-01-01", "1900-02-29", "2100-02-29", "10000-01-01", "2026-1-01"]) assert.throws(() => suggestOperationalCycle(input({ kind: "fortnightly", anchorDate })));
});
test("cycle monthly generates exact leap/non-leap civil months and never exceeds 31 days", () => {
  for (const [date, throughDate, civilDays] of [["2000-02-29", "2000-02-29", 29], ["2100-02-28", "2100-02-28", 28], ["2026-04-15", "2026-04-30", 30], ["2026-12-12", "2026-12-31", 31]] as const)
    assert.deepEqual(suggestOperationalCycle(input({ kind: "monthly" }, date)).range, { fromDate: date.slice(0, 7) + "-01", throughDate, civilDays });
});
test("cycle manual, disabled and inherit each explicitly return no suggestion and no default policy", () => {
  const manual = suggestOperationalCycle(input({ kind: "manual" })); assert.equal(manual.reason, "manual"); assert.equal(manual.range, null); assert.equal(manual.source, "provided_value");
  for (const [mode, reason] of [["disabled", "disabled"], ["inherit", "unconfigured"]] as const) {
    const result = suggestOperationalCycleChoice({ date: "2026-10-08", timeZone: "UTC", choice: { mode } }); assert.equal(result.reason, reason); assert.equal(result.range, null); assert.equal(result.source, "provided_choice"); assert.deepEqual(result.choice, { mode });
  }
});
test("cycle output is exact, detached and immutable; supplied choice is not publication evidence", () => {
  const cycle = { kind: "weekly", weekStartsOn: 1 }, value = suggestOperationalCycle(input(cycle as OperationalTimesheetCycle)); cycle.weekStartsOn = 7;
  assert.deepEqual(Object.keys(value).sort(), ["protocol", "candidateOnly", "applied", "date", "timeZone", "source", "choice", "reason", "range"].sort());
  assert.equal(value.protocol, OPERATIONAL_CYCLE_PROTOCOL); assert.equal(value.candidateOnly, true); assert.equal(value.applied, false);
  assert.deepEqual(value.choice, { mode: "value", value: { kind: "weekly", weekStartsOn: 1 } });
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.choice) && Object.isFrozen(value.range));
  assert.throws(() => { (value.range as { fromDate: string }).fromDate = "2026-01-01"; });
  assert.deepEqual(Object.keys(value.range!).sort(), ["fromDate", "throughDate", "civilDays"].sort());
});
test("cycle maps new Rules choice without promoting supplied-layer trace to checked publication", () => {
  const enterprise = parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, k === "timesheetCycle" ? { mode: "value", value: { kind: "monthly" } } : { mode: "inherit" }])));
  const preview = resolveOperationalRules({ enterprise, group: null, personal: null, baselineCorrectionWindowDays: null });
  const result = suggestOperationalCycleChoice({ date: "2026-10-08", timeZone: "UTC", choice: enterprise.timesheetCycle });
  assert.equal(preview.authorityChecked, false); assert.equal(result.source, "provided_choice"); assert.equal(result.applied, false); assert.equal(result.range?.civilDays, 31);
  assert.equal(Object.hasOwn(result, "revision"), false); assert.equal(Object.hasOwn(result, "authorized"), false);
});
test("cycle uses civil days over DST and leaves UTC period boundaries to existing V2", () => {
  for (const date of ["2026-03-29", "2026-10-25"]) {
    const value = suggestOperationalCycle(input({ kind: "weekly", weekStartsOn: 1 }, date, "Europe/Madrid")); assert.equal(value.range?.civilDays, 7);
    const start = attendanceDayUtcRange(value.range!.fromDate, value.timeZone).startAt, end = attendanceDayUtcRange(value.range!.throughDate, value.timeZone).endAt;
    assert.equal((Date.parse(end) - Date.parse(start)) / 3_600_000, date.includes("03-") ? 167 : 169);
    assert.equal(Object.hasOwn(value.range!, "startAt"), false); assert.equal(Object.hasOwn(value.range!, "endAt"), false);
  }
});
test("cycle rejects a nonexistent target date but preserves valid cycles with skipped interior dates", () => {
  for (const cycle of [{ kind: "monthly" }, { kind: "manual" }] as const) assert.throws(() => suggestOperationalCycle(input(cycle, "2011-12-30", "Pacific/Apia")), /attendance_local_date_does_not_exist/);
  assert.deepEqual(suggestOperationalCycle(input({ kind: "monthly" }, "2011-12-29", "Pacific/Apia")).range, { fromDate: "2011-12-01", throughDate: "2011-12-31", civilDays: 31 });
  assert.deepEqual(suggestOperationalCycle(input({ kind: "weekly", weekStartsOn: 1 }, "2011-12-31", "Pacific/Apia")).range, { fromDate: "2011-12-26", throughDate: "2012-01-01", civilDays: 7 });
});
test("cycle rejects invalid input and complete out-of-horizon ranges without truncation", () => {
  for (const date of ["1999-12-31", "2101-01-01", "2026-02-29", "2026-10-08\n", "2026-1-01"]) assert.throws(() => suggestOperationalCycle(input({ kind: "monthly" }, date)));
  assert.throws(() => suggestOperationalCycle(input({ kind: "weekly", weekStartsOn: 1 }, "2000-01-01")), /attendance_operational_cycle_out_of_range/);
  assert.throws(() => suggestOperationalCycle(input({ kind: "weekly", weekStartsOn: 1 }, "2100-12-31")), /attendance_operational_cycle_out_of_range/);
  assert.throws(() => suggestOperationalCycle(input({ kind: "fortnightly", anchorDate: "2000-01-02" }, "2000-01-01")), /attendance_operational_cycle_out_of_range/);
  assert.equal(suggestOperationalCycle(input({ kind: "monthly" }, "2000-01-01")).range?.fromDate, "2000-01-01");
  assert.equal(suggestOperationalCycle(input({ kind: "monthly" }, "2100-12-31")).range?.throughDate, "2100-12-31");
});
test("cycle exact parser rejects extra keys, malformed choices, getters and non-IANA zones", () => {
  for (const value of [null, { ...input({ kind: "monthly" }), authorized: true }, input({ kind: "weekly", weekStartsOn: 0 }), input({ kind: "weekly", weekStartsOn: 8 }),
    { ...input({ kind: "monthly" }), cycle: { kind: "monthly", days: 31 } }, input({ kind: "monthly" }, "2026-10-08", "+02:00"), input({ kind: "monthly" }, "2026-10-08", "Mars/Olympus")]) assert.throws(() => suggestOperationalCycle(value));
  assert.throws(() => suggestOperationalCycleChoice({ date: "2026-10-08", timeZone: "UTC", choice: { mode: "inherit", value: { kind: "monthly" } } }));
  let reads = 0; assert.throws(() => suggestOperationalCycle({ ...input({ kind: "monthly" }), get extra() { reads++; return true; } }));
  assert.throws(() => suggestOperationalCycle({ ...input({ kind: "monthly" }), cycle: { get kind() { reads++; return "monthly"; } } })); assert.equal(reads, 0);
});
test("cycle suggested date ranges are directly accepted by existing V2 query parser without actions", () => {
  for (const cycle of [{ kind: "weekly", weekStartsOn: 7 }, { kind: "fortnightly", anchorDate: "0001-01-01" }, { kind: "monthly" }] as const) {
    const r = suggestOperationalCycle(input(cycle)).range!;
    const q = parsePeriodClosureV2Query({ siteId: "99990001", access: "owner", workerId: "24100000-0000-4000-8000-000000000001", fromDate: r.fromDate, throughDate: r.throughDate, periodId: null, mode: "preview", operationId: null, version: null, cursor: null });
    assert.equal(q.fromDate, r.fromDate); assert.equal(q.throughDate, r.throughDate);
  }
});
