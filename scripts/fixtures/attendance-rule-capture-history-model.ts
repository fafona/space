// Synthetic metadata only: not a SQL receipt, real identity or historical seal.
import type { RuleCaptureHistoryQuery, RuleCaptureHistoryResult } from "../../src/lib/merchantAttendanceRuleCaptureHistory";
import { ruleSourcesId, ruleSourcesOwner } from "./attendance-rule-sources-model";

export const ruleCaptureHistoryQuery: RuleCaptureHistoryQuery = { siteId: "99990001", workerId: ruleSourcesId(201), asOf: null,
  beforeAt: null, beforeId: null, expectedEmployeeId: null, expectedEmployeeAuthUserId: null };
export function ruleCaptureHistoryResult(count = 2, hasNext = false): RuleCaptureHistoryResult {
  const result: RuleCaptureHistoryResult = { protocol: "rule-capture-history-v1", readOnly: true, siteId: ruleCaptureHistoryQuery.siteId,
    actorId: ruleSourcesOwner, workerId: ruleCaptureHistoryQuery.workerId, employeeId: ruleSourcesId(101), employeeAuthUserId: ruleSourcesId(102),
    workerName: "Synthetic archive worker", workerNo: "QA-201", workerActive: true, employeeActive: true,
    asOf: "2026-10-04T12:00:00.000100Z", readAt: "2026-10-04T12:00:00.000101Z", items: [], nextCursor: null };
  result.items = Array.from({ length: count }, (_, index) => {
    const operationId = ruleSourcesId(6000 - index), recordedAt = `2026-10-04T12:00:00.${String(90 - index).padStart(6, "0")}Z`;
    return { operationId, sourceId: ruleSourcesId(5001), actorId: ruleSourcesOwner,
      command: { operationId, fromDate: "2026-09-29", throughDate: "2026-10-01", reason: "Synthetic archive metadata", employeeId: result.employeeId, employeeAuthUserId: result.employeeAuthUserId },
      observedAt: recordedAt, recordedAt, sourceReadAt: "2026-10-04T12:00:00.000001Z", sourceSha256: "a".repeat(64), sourceBytes: 8192,
      applied: false, historicalApplicationProven: false };
  });
  if (hasNext && count) result.nextCursor = { asOf: result.asOf, beforeAt: result.items.at(-1)!.recordedAt, beforeId: result.items.at(-1)!.operationId,
    expectedEmployeeId: result.employeeId, expectedEmployeeAuthUserId: result.employeeAuthUserId };
  return result;
}
