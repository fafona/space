// Synthetic wire bytes only, not a PostgreSQL canonical-format/runtime proof.
import { createHash } from "node:crypto";
import { ruleSourcesId, ruleSourcesOwner, ruleSourcesPopulated, ruleSourcesQuery } from "./attendance-rule-sources-model";
import type { RuleCapturesCommand, RuleCapturesQuery, RuleCapturesResult } from "../../src/lib/merchantAttendanceRuleCaptures";

export const ruleCapturesQuery: RuleCapturesQuery = { siteId: ruleSourcesQuery.siteId, workerId: ruleSourcesQuery.workerId, operationId: ruleSourcesId(5001) };
export const ruleCapturesCommand: RuleCapturesCommand = { operationId: ruleCapturesQuery.operationId, fromDate: ruleSourcesQuery.fromDate,
  throughDate: ruleSourcesQuery.throughDate, reason: "保存当前候选来源", employeeId: ruleSourcesId(101), employeeAuthUserId: ruleSourcesId(102) };
export function ruleCapturesResult(): RuleCapturesResult {
  const source = ruleSourcesPopulated(), sourceText = JSON.stringify(source), sourceBytes = Buffer.byteLength(sourceText, "utf8");
  return { protocol: "candidate-rule-captures-v1", ...ruleCapturesQuery, actorId: ruleSourcesOwner, readAt: "2026-10-04T12:00:00.000004Z",
    receipt: { operationId: ruleCapturesQuery.operationId, actorId: ruleSourcesOwner, command: { ...ruleCapturesCommand }, sourceId: ruleSourcesId(5002),
      observedAt: "2026-10-04T12:00:00.000002Z", recordedAt: "2026-10-04T12:00:00.000003Z", sourceReadAt: source.readAt, sourceText,
      sourceSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"), sourceBytes,
      canonicalFormat: "pg-jsonb-text-utf8-v1", applied: false, historicalApplicationProven: false } };
}
