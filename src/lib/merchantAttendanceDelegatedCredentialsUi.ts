//207 browser intent helpers, not authority, KDF or a real device verification.
//Secret-bearing return values are transient dispatch inputs, never pending.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import { parseManagementDelegationCommand, type ManagementDelegationGrantCommand } from "./merchantAttendanceManagementDelegation";
import { managementConfigurationUtcInput } from "./merchantAttendanceDelegatedConfigurationUi";
import { newTerminalPairSecret } from "./merchantAttendanceTerminalClient";
import { terminalSecret, terminalPairToken } from "./merchantAttendanceTerminal";
import * as c from "./merchantAttendanceDelegatedCredentials";

export const MANAGEMENT_CREDENTIAL_SECRET_MS = 15000;
export const delegatedCredentialActionLabels: Readonly<Record<c.DelegatedCredentialsAction, string>> = {
  terminal_prepare: "准备指定终端配对", terminal_revoke: "撤销指定终端", pin_issue: "签发指定人员 PIN", pin_revoke: "撤销指定人员 PIN",
};
export type ManagementCredentialDraft = Readonly<{ label: string; reason: string; acknowledged: boolean }>;
export type ManagementPairDisplay = Readonly<{ operationId: string; token: string; expiresAt: number }>;
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
export function managementCredentialsQuery(siteId: string, grantId: string): c.DelegatedCredentialsContextQuery {
  const q = c.parseDelegatedCredentialsQuery({ siteId, grantId, mode: "context", operationId: null }); return q.mode === "context" ? q : invalid();
}
export function buildManagementCredentialsGrant(raw: unknown, operationId: string): ManagementDelegationGrantCommand {
  assertDelegatedAuditTree(raw, 8192);
  const d = captureBrowserExact(raw, ["delegateEmployeeId", "delegateAuthUserId", "delegatedAction", "scope", "validFrom", "validUntil", "reason", "acknowledged"]);
  if (d.acknowledged !== true || !c.DELEGATED_CREDENTIALS_ACTIONS.includes(d.delegatedAction as c.DelegatedCredentialsAction) || typeof d.reason !== "string") return invalid();
  const command = parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: d.delegateEmployeeId, delegateAuthUserId: d.delegateAuthUserId,
    delegatedAction: d.delegatedAction, scope: d.scope, validFrom: managementConfigurationUtcInput(d.validFrom), validUntil: managementConfigurationUtcInput(d.validUntil), reason: d.reason.trim() });
  return command.action === "grant" ? command : invalid();
}
function draft(raw: unknown): ManagementCredentialDraft {
  assertDelegatedAuditTree(raw, 4096); const d = captureBrowserExact(raw, ["label", "reason", "acknowledged"]);
  if (typeof d.label !== "string" || typeof d.reason !== "string" || d.acknowledged !== true) return invalid();
  return { label: d.label.trim(), reason: d.reason.trim(), acknowledged: true };
}
export const newManagementPairSecret = newTerminalPairSecret;
export async function managementPairHash(rawSecret: string): Promise<string> {
  const secret = terminalSecret(rawSecret), bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function buildManagementTerminalBody(rawContext: unknown, query: c.DelegatedCredentialsContextQuery, actualActor: string,
  rawDraft: unknown, operationId: string, pairSecret?: string): Promise<c.DelegatedTerminalBody | c.DelegatedTerminalPrepareEphemeralBody> {
  const d = draft(rawDraft), context = await c.parseDelegatedTerminalResult(rawContext, query, actualActor);
  if (context.kind !== "context") return invalid();
  const common = { action: context.action, operationId, terminalId: context.scope.terminalId, locationId: context.scope.locationId, reason: d.reason };
  if (context.action === "terminal_prepare") {
    if (pairSecret === undefined) return invalid();
    const command = c.delegatedTerminalCommandForContext(context, { ...common, action: "terminal_prepare", label: d.label, pairHash: await managementPairHash(pairSecret) });
    return c.parseDelegatedTerminalPrepareEphemeralBody({ query, command, pairSecret });
  }
  if (pairSecret !== undefined) return invalid();
  return c.parseDelegatedTerminalBody({ query, command: c.delegatedTerminalCommandForContext(context, common) });
}
export async function buildManagementPinBody(rawContext: unknown, query: c.DelegatedCredentialsContextQuery, actualActor: string,
  rawDraft: unknown, operationId: string, pin?: string): Promise<c.DelegatedPinBody | c.DelegatedPinIssueEphemeralBody> {
  const d = draft(rawDraft), context = await c.parseDelegatedPinResult(rawContext, query, actualActor);
  if (context.kind !== "context") return invalid();
  const common = { action: context.action, operationId, workerId: context.scope.workerId, reason: d.reason };
  let command: c.DelegatedPinCommand;
  if (context.scope.kind === "member_pin" && "status" in context.context) command = c.delegatedPinCommandForContext(context, { ...common, kind: "member_pin",
    employeeId: context.scope.employeeId, employeeAuthUserId: context.scope.employeeAuthUserId, workerNo: context.context.status.workerNo, expectedRevision: context.context.status.revision });
  else if (context.scope.kind === "independent_pin" && "detail" in context.context) {
    const { subject, credential } = context.context.detail;
    command = c.delegatedPinCommandForContext(context, { ...common, kind: "independent_pin", subjectId: context.scope.subjectId,
      expectedSubjectRevision: subject.revision, expectedGeneration: context.scope.generation, expectedWorkerVersion: subject.workerVersion,
      expectedSettingsVersion: context.context.settingsVersion, expectedCredentialRevision: credential.revision });
  } else return invalid();
  if (context.action === "pin_issue") { if (pin === undefined) return invalid(); return c.parseDelegatedPinIssueEphemeralBody({ query, command, pin }); }
  if (pin !== undefined) return invalid(); return c.parseDelegatedPinBody({ query, command });
}
export function managementPairDisplay(siteId: string, terminalId: string, operationId: string, pairSecret: string, generatedAt: number): ManagementPairDisplay {
  c.parseDelegatedCredentialsQuery({ siteId, grantId: terminalId, mode: "recover", operationId });
  if (!Number.isFinite(generatedAt) || generatedAt < 0) return invalid();
  return { operationId, token: terminalPairToken(siteId, terminalId, pairSecret), expiresAt: generatedAt + MANAGEMENT_CREDENTIAL_SECRET_MS };
}
export function managementPairDisplayCurrent(display: ManagementPairDisplay | null, operationId: string, now: number): boolean {
  return display !== null && display.operationId === operationId && Number.isFinite(now) && now >= display.expiresAt - MANAGEMENT_CREDENTIAL_SECRET_MS && now < display.expiresAt;
}
