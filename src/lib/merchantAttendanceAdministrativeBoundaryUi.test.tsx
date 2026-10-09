import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { parseEmploymentLifecycleResult, employmentLifecycleOperatingOff } from "./merchantAttendanceEmploymentLifecycle";
import { EmploymentLifecycleDetailView, employmentLifecycleReady } from "../components/enterprise/MerchantAttendanceEmploymentLifecyclePanel";
import { employmentLifecycleResult as result, employmentLifecycleQuery as query, employmentLifecycleOwner as owner, employmentLifecycleId as id } from "../../scripts/fixtures/attendance-employment-lifecycle-model";
import type { AdministrativeClosureBoundary } from "./merchantAttendanceAdministrativeClosure";
function fixture(action: "close" | "rejoin" = "close") {
  const r = result("detail", action), d = r.detail!;
  const b: AdministrativeClosureBoundary = { protocol: "attendance-administrative-boundary-v1", siteId: r.siteId, operationId: id(80), revision: 1,
    workerId: d.worker.id, employeeId: d.worker.employeeId!, employeeAuthUserId: d.worker.employeeAuthUserId!, employmentPeriodId: d.periods[0].id,
    suspensionId: d.suspension!.id, generation: d.suspension!.generation, timeZone: "Europe/Madrid", startEventId: id(81), startSequence: 1,
    startAt: "2026-10-05T08:00:00.000000Z", tailEventId: id(81), tailSequence: 1, tailAction: "clock_in", tailOccurredAt: "2026-10-05T08:00:00.000000Z",
    verifiedEndAt: "2026-10-05T09:00:00.000000Z", recordedAt: "2026-10-05T10:00:00.000000Z", sourceFingerprint: "a".repeat(64) };
  d.currentAction = "clock_in"; d.originalAction = "clock_in"; d.administrativeBoundary = b;
  return r;
}
test("proved administrative close allows old employment eligibility with original action retained and explicit unknown-hours label", () => {
  for (const action of ["close", "rejoin"] as const) {
    const r = parseEmploymentLifecycleResult(fixture(action), query(), owner), d = r.detail!;
    assert.equal(d.currentAction, "clock_in"); assert(employmentLifecycleOperatingOff(d)); assert(employmentLifecycleReady(d, action, "已核查原身份与日期", true));
    const html = render(<EmploymentLifecycleDetailView detail={d}/>);
    for (const text of ["已行政关闭", "未补造下班", "工时仍待核定", "不作为工时终点", "当前原始状态", "在班"]) assert(html.includes(text), text);
    assert(!employmentLifecycleReady(d, action, "已核查原身份与日期", false));
    assert(!employmentLifecycleReady({ ...d, pending: { ...d.pending, limited: true } }, action, "已核查", true));
  }
});
test("employment accepts no null proof, foreign identity, nonexistent period, future receipt or changed raw action", () => {
  const base = fixture(), boundary = base.detail!.administrativeBoundary!;
  for (const patch of [{ siteId: "99990002" }, { workerId: id(99) }, { employeeId: id(99) }, { employeeAuthUserId: id(99) },
    { employmentPeriodId: id(99) }, { recordedAt: "2026-10-07T00:00:00.000000Z" }]) {
    const r = fixture(); r.detail!.administrativeBoundary = { ...boundary, ...patch };
    assert.throws(() => parseEmploymentLifecycleResult(r, query(), owner));
  }
  for (const administrativeBoundary of [null, undefined]) assert.throws(() => parseEmploymentLifecycleResult({ ...base, detail: { ...base.detail, administrativeBoundary } }, query(), owner));
  assert.throws(() => parseEmploymentLifecycleResult({ ...base, detail: { ...base.detail, currentAction: "clock_out" } }, query(), owner));
  const old = result(); assert(!Object.hasOwn(parseEmploymentLifecycleResult(old, query(), owner).detail!, "administrativeBoundary"));
});
