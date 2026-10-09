import { accountStatusCommandFingerprint, accountSuspensionCommandFingerprint, type AccountSuspensionCommand, type AccountStatusCommand,
  type AccountSuspensionDetail, type AccountSuspensionItem, type AccountSuspensionQuery, type AccountSuspensionResult } from "../../src/lib/merchantAttendanceAccountSuspension";
export const accountSuspensionId = (n: number) => `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const accountSuspensionSite = "99990001", accountSuspensionOwner = accountSuspensionId(1), accountSuspensionEmployee = accountSuspensionId(2), accountSuspensionAuth = accountSuspensionId(3);
export function accountSuspensionQuery(mode: AccountSuspensionQuery["mode"] = "list"): AccountSuspensionQuery {
  return { siteId: accountSuspensionSite, mode, afterId: null, suspensionId: mode === "detail" ? accountSuspensionId(10) : null, operationId: mode === "recover" || mode === "recover-status" ? accountSuspensionId(20) : null };
}
export function accountSuspensionItem(): AccountSuspensionItem { return { suspensionId: accountSuspensionId(10), generation: 1, employeeId: accountSuspensionEmployee,
  employeeAuthUserId: accountSuspensionAuth, employeeName: "合成员工 <img>", workerId: accountSuspensionId(4), workerName: "合成考勤人员", wasActive: true, recordedAt: "2026-10-06T10:00:00.000000Z" }; }
export function accountSuspensionDetail(): AccountSuspensionDetail { return { suspension: accountSuspensionItem(), employeeStatus: "active", employeeVersion: 3, workerVersion: 2, workerActive: false,
  originalAction: "break_start", currentAction: "break_start", canRestore: true, blockers: [], pinInvalidated: true, delegationsInvalidated: true,
  pendingReview: { leave: "not_checked", workArrangement: "not_checked", missing: "not_checked", unknownOperations: "not_observable" } }; }
export function accountSuspensionCommand(): AccountSuspensionCommand { return { action: "restore", operationId: accountSuspensionId(20), suspensionId: accountSuspensionId(10), expectedGeneration: 1,
  workerId: accountSuspensionId(4), expectedWorkerVersion: 2, expectedEmployeeVersion: 3, employeeId: accountSuspensionEmployee, employeeAuthUserId: accountSuspensionAuth, reason: "明确核验同一身份" }; }
export function accountStatusCommand(): AccountStatusCommand { return { operationId: accountSuspensionId(20), employeeId: accountSuspensionEmployee, version: 1, status: "disabled", offboardingMode: "unassign" }; }
export function accountSuspensionResult(mode: AccountSuspensionQuery["mode"] = "list"): AccountSuspensionResult { return { siteId: accountSuspensionSite, mode,
  items: mode === "list" ? [accountSuspensionItem()] : [], nextAfterId: null, detail: mode === "detail" ? accountSuspensionDetail() : null, receipt: null, statusReceipt: null }; }
export const accountSuspensionHttp = (mode: AccountSuspensionQuery["mode"] = "list") => ({ ok: true, ...accountSuspensionResult(mode) });
export async function accountSuspensionReceiptHttp(command = accountSuspensionCommand()) { const r = accountSuspensionResult("recover"); r.receipt = { operationId: command.operationId, actorId: accountSuspensionOwner,
  suspensionId: command.suspensionId, generation: command.expectedGeneration, employeeId: command.employeeId, workerId: command.workerId, workerActive: command.workerId ? true : null,
  recordedAt: "2026-10-06T11:00:00.000000Z", commandFingerprint: await accountSuspensionCommandFingerprint(accountSuspensionSite, command) }; return { ok: true, ...r }; }
export async function accountStatusReceiptHttp(command = accountStatusCommand()) { const r = accountSuspensionResult("recover-status"); r.statusReceipt = { operationId: command.operationId, actorId: accountSuspensionOwner,
  employeeId: command.employeeId, expectedVersion: command.version, version: command.version + 1, status: command.status, suspensionId: accountSuspensionId(10),
  recordedAt: "2026-10-06T10:00:00.000000Z", commandFingerprint: await accountStatusCommandFingerprint(accountSuspensionSite, command) }; return { ok: true, ...r }; }
