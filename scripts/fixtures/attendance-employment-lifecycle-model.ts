// Detached pure protocol shapes. These are not historical SQL evidence.
import { employmentLifecycleCommandFingerprint, type EmploymentLifecycleCommand, type EmploymentLifecycleDetail,
  type EmploymentLifecycleItem, type EmploymentLifecycleQuery, type EmploymentLifecycleReceipt, type EmploymentLifecycleResult } from "../../src/lib/merchantAttendanceEmploymentLifecycle";
export const employmentLifecycleId = (n: number) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const employmentLifecycleSite = "99990001", employmentLifecycleOwner = employmentLifecycleId(1);
export const employmentLifecycleEmployee = employmentLifecycleId(2), employmentLifecycleAuth = employmentLifecycleId(3), employmentLifecycleWorker = employmentLifecycleId(4);
export function employmentLifecycleQuery(mode: EmploymentLifecycleQuery["mode"] = "detail", patch: Partial<EmploymentLifecycleQuery> = {}): EmploymentLifecycleQuery {
  return { siteId: employmentLifecycleSite, mode, workerId: mode === "detail" || mode === "history" ? employmentLifecycleWorker : null,
    afterId: null, afterRevision: null, operationId: mode === "recover" ? employmentLifecycleId(30) : null, ...patch };
}
export function employmentLifecycleDetail(action: "close" | "rejoin" = "close"): EmploymentLifecycleDetail {
  return { worker: { id: employmentLifecycleWorker, employeeId: employmentLifecycleEmployee, employeeAuthUserId: employmentLifecycleAuth,
    workerNo: "EMP-196", displayName: "合成人员 <img>", employeeName: "合成员工", active: false, version: 4, employeeVersion: 3 },
    settingsVersion: 7, timeZone: "Europe/Madrid", today: "2026-10-06", readAt: "2026-10-06T08:00:00.000000Z",
    revision: action === "close" ? 0 : 1, state: action === "close" ? "untracked" : "closed",
    periods: [{ id: employmentLifecycleId(20), startsOn: "2026-01-01", endsOn: action === "close" ? null : "2026-10-05" }],
    suspension: { id: employmentLifecycleId(10), generation: 2, wasActive: true, paused: true }, originalAction: "clock_out", currentAction: "clock_out",
    canClose: action === "close", canRejoin: action === "rejoin", closeBlockers: action === "close" ? [] : ["employment_closed"],
    rejoinBlockers: action === "rejoin" ? [] : ["employment_open"], pending: { items: [], limited: false, historicalPending: "not_checked" } };
}
export function employmentLifecycleItem(action: "close" | "rejoin" = "close"): EmploymentLifecycleItem {
  const d = employmentLifecycleDetail(action); return { worker: d.worker, revision: d.revision, state: d.state, period: d.periods[0] };
}
export function employmentLifecycleCommand(action: "close" | "rejoin" = "close"): EmploymentLifecycleCommand {
  const d = employmentLifecycleDetail(action);
  return { action, operationId: employmentLifecycleId(30), workerId: employmentLifecycleWorker, employeeId: employmentLifecycleEmployee, employeeAuthUserId: employmentLifecycleAuth,
    expectedWorkerVersion: d.worker.version, expectedEmployeeVersion: d.worker.employeeVersion!, expectedSettingsVersion: d.settingsVersion,
    expectedRevision: d.revision, expectedPeriodId: d.periods[0].id, suspensionId: d.suspension!.id, expectedGeneration: d.suspension!.generation,
    expectedDate: d.today, reason: "合成任职核验理由" };
}
export function employmentLifecycleReceipt(command = employmentLifecycleCommand(), commandFingerprint = "1".repeat(64)): EmploymentLifecycleReceipt {
  return { operationId: command.operationId, actorId: employmentLifecycleOwner, workerId: command.workerId, employeeId: command.employeeId,
    employeeAuthUserId: command.employeeAuthUserId, action: command.action, revision: command.expectedRevision + 1,
    periodId: command.action === "close" ? command.expectedPeriodId : employmentLifecycleId(31), startsOn: command.action === "close" ? "2026-01-01" : command.expectedDate,
    endsOn: command.action === "close" ? command.expectedDate : null, recordedAt: "2026-10-06T08:00:01.000000Z", commandFingerprint };
}
export function employmentLifecycleResult(mode: EmploymentLifecycleQuery["mode"] = "detail", action: "close" | "rejoin" = "close"): EmploymentLifecycleResult {
  return { siteId: employmentLifecycleSite, mode, items: mode === "list" ? [employmentLifecycleItem(action)] : [], nextAfterId: null,
    detail: mode === "detail" ? employmentLifecycleDetail(action) : null, history: mode === "history" ? [employmentLifecycleReceipt()] : [], nextAfterRevision: null, receipt: null };
}
export function employmentLifecycleHttp(mode: EmploymentLifecycleQuery["mode"] = "detail", action: "close" | "rejoin" = "close") {
  return { ok: true as const, ...employmentLifecycleResult(mode, action) };
}
export async function employmentLifecycleReceiptHttp(command = employmentLifecycleCommand(), mode: "detail" | "recover" = "recover") {
  const base = employmentLifecycleResult("recover");
  return { ok: true as const, ...base, mode, receipt: employmentLifecycleReceipt(command, await employmentLifecycleCommandFingerprint(employmentLifecycleSite, command)) };
}
