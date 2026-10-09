// Detached196 owner protocol fixtures; no real Auth, SQL, membership or KDF.
import { independentAdminCommandFingerprint, type IndependentAdminData, type IndependentAdminResult,
  type IndependentCommand, type IndependentQuery, type IndependentSubject } from "../../src/lib/merchantAttendanceIndependent";
export const independentUiId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const independentUiSite = "99990198", independentUiOwner = independentUiId(1), independentUiSubjectId = independentUiId(2),
  independentUiWorkerId = independentUiId(3), independentUiLocationId = independentUiId(4);
export const independentUiReadAt = "2026-10-08T16:00:00.000001Z";
export function independentUiDetailQuery(): IndependentQuery { return { siteId: independentUiSite, mode: "detail", subjectId: independentUiSubjectId }; }
export function independentUiSubject(): IndependentSubject {
  return { subjectId: independentUiSubjectId, workerId: independentUiWorkerId, workerNo: "LOCAL-01", displayName: "本地合成员工", startsOn: "2026-10-08",
    locationId: independentUiLocationId, enabled: false, generation: 0, revision: 1, workerVersion: 1, state: "independent", createdAt: "2026-10-08T08:00:00.000001Z" };
}
export function independentUiCommand(action: IndependentCommand["action"] = "create"): IndependentCommand {
  const base = { operationId: independentUiId(20), subjectId: independentUiSubjectId, expectedSettingsVersion: 1, reason: "本地有限验收" };
  if (action === "create") return { ...base, action, workerId: independentUiWorkerId, workerNo: "LOCAL-01", displayName: "本地合成员工", startsOn: "2026-10-08", locationId: independentUiLocationId };
  const change = { ...base, expectedSubjectRevision: 1, expectedGeneration: 0, expectedWorkerVersion: 1 };
  if (action === "enable" || action === "disable") return { ...change, action };
  if (action === "issue_pin" || action === "revoke_pin") return { ...change, action, expectedCredentialRevision: 0 };
  return { ...change, action, expectedCredentialRevision: 0, targetEmployeeId: independentUiId(11), targetAuthUserId: independentUiId(12), expectedLastEventId: null, expectedSequence: 0 };
}
export function independentUiAdmin(data: IndependentAdminData): IndependentAdminResult {
  return { protocol: "attendance-independent-admin-v1", siteId: independentUiSite, actorId: independentUiOwner, readAt: independentUiReadAt,
    settingsVersion: 1, data, receipt: null };
}
export async function independentUiReceipt(c = independentUiCommand()): Promise<IndependentAdminResult> {
  return { ...independentUiAdmin({ kind: "receipt" }), receipt: { operationId: c.operationId, subjectId: c.subjectId, workerId: independentUiWorkerId,
    action: c.action, actorId: independentUiOwner, subjectRevision: c.action === "create" ? 1 : c.expectedSubjectRevision + 1,
    generation: c.action === "create" ? 0 : c.expectedGeneration + (["disable", "revoke_pin", "bind_member"].includes(c.action) ? 1 : 0),
    workerVersion: c.action === "create" ? 1 : c.expectedWorkerVersion + 1,
    credentialRevision: c.action === "issue_pin" ? c.expectedCredentialRevision + 1 : c.action === "revoke_pin" || c.action === "bind_member" ? c.expectedCredentialRevision === 0 ? 0 : c.expectedCredentialRevision + 1 : c.action === "disable" ? 0 : null,
    recordedAt: "2026-10-08T09:00:00.000001Z", commandFingerprint: await independentAdminCommandFingerprint(independentUiSite, independentUiOwner, c) } };
}
