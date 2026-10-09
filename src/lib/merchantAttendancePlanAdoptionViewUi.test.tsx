import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ShiftCheck, { AttendanceShiftCheckDetail } from "../components/enterprise/MerchantAttendanceShiftCheck";
import PlanCoverage, { AttendancePlanCoverageDetail } from "../components/enterprise/MerchantAttendancePlanCoverage";
import Receipt from "../components/enterprise/MerchantAttendancePlanAdoptionReceipt";
import { parseShiftCheckAdoptionResponse, parsePlanCoverageAdoptionsResponse, type PlanAdoption } from "./merchantAttendancePlanAdoptionView";
import { parseShiftCheckResponse } from "./merchantAttendanceShiftCheck";
import { parsePlanCoverageResponse } from "./merchantAttendancePlanCoverage";
import { planAdoptionViewActor as actor, shiftCheckAdoptionQuery as shiftQuery, shiftCheckAdoptionHttp, planCoverageAdoptionsQuery as planQuery, planCoverageAdoptionsHttp } from "../../scripts/fixtures/attendance-plan-adoption-view-model";
import { scheduleEvidenceWire, parseScheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";

const source = () => ({ ...parseScheduleEvidenceWire(scheduleEvidenceWire()), moduleEnabled: true });
const reference = () => shiftCheckAdoptionHttp().data.adoption!;
const markup = (adoption: PlanAdoption | null = reference()) => renderToStaticMarkup(<Receipt startEventId={shiftQuery.startEventId} adoption={adoption}/>);

test("existing page flags retain default-off; enabling only reference flag cannot enable an old page", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  for (const Page of [ShiftCheck, PlanCoverage]) {
    assert.equal(renderToStaticMarkup(<Page source={source()} ownerId={actor} apiFetch={apiFetch} enabled={false} adoptionEnabled/>), "");
    assert.equal(renderToStaticMarkup(<Page source={source()} ownerId={actor} apiFetch={apiFetch} enabled={false} adoptionEnabled={false}/>), "");
  }
  assert.equal(calls, 0);
});
test("new feature renders only the existing explicit selector and never fetches during render", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  for (const adoptionEnabled of [false, true]) {
    const a = renderToStaticMarkup(<ShiftCheck source={source()} ownerId={actor} apiFetch={apiFetch} enabled adoptionEnabled={adoptionEnabled}/>);
    const b = renderToStaticMarkup(<PlanCoverage source={source()} ownerId={actor} apiFetch={apiFetch} enabled adoptionEnabled={adoptionEnabled}/>);
    assert.match(a, /选择核查原始班次/); assert.match(a, /读取班次核查/); assert.match(b, /核对排班选择/); assert.match(b, /读取计划关联核对/);
    assert.ok(!a.includes('data-plan-adoption-reference')); assert.ok(!b.includes('data-plan-adoption-reference'));
  }
  assert.equal(calls, 0);
});
test("null historical reference is not presented as saved not-approved", () => {
  const missing = markup(null), saved = markup({ ...reference(), status: "not_approved", reason: "approval_missing", approval: null });
  assert.match(missing, /data-plan-adoption-status="missing"/); assert.match(missing, /不等于当时没有核准/); assert.ok(!missing.includes('当时没有可采用的核准'));
  assert.match(saved, /data-plan-adoption-status="not_approved"/); assert.match(saved, /开班时没有可采用的已核准版本/);
});
test("all saved states and four original channels are shown without recomputing a current approval", () => {
  for (const [channel, label] of [["self", "普通网页"], ["location", "定位"], ["onsite", "现场扫码"], ["pin", "工号 PIN"]] as const) assert.ok(markup({ ...reference(), channel }).includes(label));
  for (const [status, reason, text] of [["unselected", null, "明确不关联"], ["unverified", "cancelled", "原选择待核验"]] as const) {
    const result = markup({ ...reference(), status, reason, approval: null }); assert.ok(result.includes(text)); assert.ok(!result.includes("SHA-256"));
  }
  assert.match(markup(), /没有新增迟到、早退、缺勤或工资判断/);
});
test("fixed operation/source/hash/timestamps and original identity are selectable escaped text", () => {
  const value = reference(), result = markup(value);
  for (const text of [value.startEventId, value.operationId, value.employeeId!, value.employeeAuthUserId!, value.recordedAt,
    value.approval!.operationId, value.approval!.sourceId, value.approval!.sourceSha256, value.approval!.recordedAt]) assert.ok(result.includes(text));
  const escaped = renderToStaticMarkup(<Receipt startEventId={'<img src=x onerror="boom">'} adoption={null}/>);
  assert.ok(!escaped.includes('<img')); assert.match(escaped, /&lt;img/); assert.match(result, /min-w-0/); assert.match(result, /break-all/);
});
test("new envelope renders exactly the old single-shift algorithm result, then a separate fixed reference", () => {
  const wire = shiftCheckAdoptionHttp(false), parsed = parseShiftCheckAdoptionResponse(wire, shiftQuery, actor);
  const old = parseShiftCheckResponse({ ok: true, moduleEnabled: false, data: wire.data.check }, shiftQuery, actor);
  const view = { ...parsed.check, moduleEnabled: parsed.moduleEnabled };
  assert.deepEqual(view, old);
  assert.equal(renderToStaticMarkup(<AttendanceShiftCheckDetail result={view}/>), renderToStaticMarkup(<AttendanceShiftCheckDetail result={old}/>));
});
test("new collection keeps original and selected interval algorithms and ordered fixed references distinct", () => {
  const wire = planCoverageAdoptionsHttp(), parsed = parsePlanCoverageAdoptionsResponse(wire, planQuery, actor);
  const old = parsePlanCoverageResponse({ ok: true, moduleEnabled: true, data: wire.data.coverage }, planQuery, actor);
  const view = { ...parsed.coverage, moduleEnabled: parsed.moduleEnabled };
  assert.deepEqual(view, old); assert.equal(renderToStaticMarkup(<AttendancePlanCoverageDetail result={view}/>), renderToStaticMarkup(<AttendancePlanCoverageDetail result={old}/>));
  const references = renderToStaticMarkup(<>{parsed.adoptions.map(entry => <Receipt key={entry.startEventId} {...entry}/>)}</>);
  assert.equal((references.match(/data-plan-adoption-reference=/g) ?? []).length, parsed.coverage.sessions.length);
});
test("two existing pages instantiate exactly one transport, fence flag changes and preserve original details", () => {
  for (const [file, old, current] of [["MerchantAttendanceShiftCheck.tsx", "AttendanceShiftCheckClient", "AttendanceShiftCheckAdoptionClient"],
    ["MerchantAttendancePlanCoverage.tsx", "AttendancePlanCoverageClient", "AttendancePlanCoverageAdoptionsClient"]]) {
    const text = readFileSync(new URL(`../components/enterprise/${file}`, import.meta.url), "utf8");
    assert.ok(text.includes(`adoptionEnabled ? new ${current}`)); assert.ok(text.includes(`: new ${old}`));
    assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED === "1"/);
    assert.match(text, /identity.adoptionEnabled !== props.adoptionEnabled/); assert.match(text, /"fixedReference" in state/);
    assert.match(text, /pagehide/); assert.match(text, /client.pause\(\)/); assert.ok(!text.includes('localStorage')); assert.ok(!text.includes('setInterval'));
  }
});
