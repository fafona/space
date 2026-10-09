// In-memory wire model only: no DB/Auth/network/production authority.
import { cycleSendCommandFingerprint, type CycleSendFrame, type CycleSendCommand } from "../../src/lib/merchantAttendanceCycleSend";
export const cycleSendModelId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function cycleSendModel() {
  const frame: CycleSendFrame = { siteId: "99990200", access: "owner", grantId: null, workerId: cycleSendModelId(1), fromDate: "2026-10-05", throughDate: "2026-10-11",
    periodId: cycleSendModelId(2), intentId: cycleSendModelId(3), expectedIntentFingerprint: "a".repeat(64) };
  const command: CycleSendCommand = { action: "send", operationId: cycleSendModelId(4), periodId: frame.periodId, expectedRevision: 0, expectedVersion: 0,
    expectedFingerprint: "b".repeat(64), reason: "明确首次送审" };
  const actor = cycleSendModelId(9), fingerprint = await cycleSendCommandFingerprint(frame, command, actor), recordedAt = "2026-10-12T10:00:00.123456Z";
  const common = { protocol: "attendance-operational-cycle-v1", siteId: frame.siteId, actorId: actor, readAt: "2026-10-12T10:00:01.000000Z" };
  const linked = () => ({ ...common, data: { kind: "linked", periodOperation: { operationId: command.operationId, revision: 1, action: "send", version: 1,
    actorId: actor, reason: command.reason, recordedAt, command: { ...command } } }, receipt: { operationId: command.operationId, intentId: frame.intentId, action: "link", actorId: actor,
      revision: 2, recordedAt, commandFingerprint: fingerprint, periodId: frame.periodId, sendOperationId: command.operationId } });
  const unknown = () => ({ ...common, data: { kind: "receipt" }, receipt: null });
  return { frame, command, actor, fingerprint, recordedAt, linked, unknown };
}
