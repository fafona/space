//204 scoped executor. Public commands are the existing124 commands; authority
//comes only from the SQL-owned grant, not a browser worker/owner claim.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze } from "./merchantAttendanceOperationalRuleLedger";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { parseManagementDelegationScope, type ManagementDelegationScope } from "./merchantAttendanceManagementDelegation";
import { GROUPS_ERRORS, parseGroupsBody, parseGroupsCommand, parseGroupsResult, type GroupsCommand, type GroupsQuery, type GroupsResult } from "./merchantAttendanceGroups";

export const DELEGATED_GROUPS_PROTOCOL = "attendance-delegated-groups-v1" as const;
export const DELEGATED_GROUPS_API = "/api/merchant-enterprise/attendance/delegated-groups";
export const DELEGATED_GROUPS_REQUEST_BYTES = 8192;
export const DELEGATED_GROUPS_RESULT_BYTES = 131072;
export const DELEGATED_GROUPS_ACTIONS = ["group_save", "group_assign", "group_end", "group_cancel"] as const;
export type DelegatedGroupsAction = typeof DELEGATED_GROUPS_ACTIONS[number];
export type DelegatedGroupsScope = Extract<ManagementDelegationScope, { kind: "group" | "group_worker" }>;
export type DelegatedGroupsQuery = Readonly<{ siteId: string; grantId: string } & (
  { mode: "context"; operationId: null } | { mode: "recover"; operationId: string })>;
export type DelegatedGroupsReceipt = Readonly<{ operationId: string; actorId: string; grantId: string; action: DelegatedGroupsAction;
  referenceId: string; revision: number; commandFingerprint: string; businessFingerprint: string; recordedAt: string }>;
type Base = Readonly<{ protocol: typeof DELEGATED_GROUPS_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
export type DelegatedGroupsResult = Base & Readonly<
  { kind: "receipt"; receipt: DelegatedGroupsReceipt | null }
  | { kind: "context"; grantId: string; action: DelegatedGroupsAction; scope: DelegatedGroupsScope; context: GroupsResult }>;
export const DELEGATED_GROUPS_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...GROUPS_ERRORS,
  attendance_delegated_groups_disabled: 403, attendance_delegated_groups_invalid: 503 });
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
const freeze = operationalRuleLedgerFreeze;
const exact = captureBrowserExact;
function action(v: unknown): DelegatedGroupsAction { return v === "group_save" || v === "group_assign" || v === "group_end" || v === "group_cancel" ? v : fail(); }
export function delegatedGroupsAction(c: GroupsCommand): DelegatedGroupsAction {
  return c.action === "save_group" ? "group_save" : c.action === "assign" ? "group_assign" : c.action === "end" ? "group_end" : "group_cancel";
}
export function parseDelegatedGroupsQuery(raw: unknown): DelegatedGroupsQuery {
  assertDelegatedAuditTree(raw, 4096); const q = exact(raw, ["siteId", "grantId", "mode", "operationId"]);
  const siteId = attendanceSelfSite(q.siteId), grantId = attendanceSelfUuid(q.grantId);
  if (q.mode === "context" && q.operationId === null) return freeze({ siteId, grantId, mode: "context", operationId: null });
  if (q.mode === "recover") return freeze({ siteId, grantId, mode: "recover", operationId: attendanceSelfUuid(q.operationId) });
  return fail();
}
export function delegatedGroupsQueryString(raw: DelegatedGroupsQuery): string {
  const q = parseDelegatedGroupsQuery(raw);
  return new URLSearchParams({ siteId: q.siteId, grantId: q.grantId, mode: q.mode, operationId: q.operationId ?? "" }).toString();
}
export function parseDelegatedGroupsCommand(raw: unknown): GroupsCommand {
  assertDelegatedAuditTree(raw, DELEGATED_GROUPS_REQUEST_BYTES); return freeze(parseGroupsCommand(raw));
}
export function parseDelegatedGroupsBody(raw: unknown) {
  assertDelegatedAuditTree(raw, DELEGATED_GROUPS_REQUEST_BYTES); const b = exact(raw, ["query", "command"]), query = parseDelegatedGroupsQuery(b.query);
  if (query.mode !== "context") return fail(); return freeze({ query, command: parseDelegatedGroupsCommand(b.command) });
}
export function parseDelegatedGroupsJson(raw: string, request = true): unknown {
  const limit = request ? DELEGATED_GROUPS_REQUEST_BYTES : DELEGATED_GROUPS_RESULT_BYTES;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) return fail();
  const parsed = parseCaptureBrowserJson(raw); assertDelegatedAuditTree(parsed, limit); return parsed;
}
export function delegatedGroupsLegacyQuery(siteId: string, rawScope: DelegatedGroupsScope, a: DelegatedGroupsAction): GroupsQuery {
  const scope = parseManagementDelegationScope(rawScope, a);
  if (scope.kind !== "group" && scope.kind !== "group_worker") return fail();
  return freeze({ siteId: attendanceSelfSite(siteId), view: "context", groupId: scope.kind === "group" && scope.create ? null : scope.groupId,
    workerId: scope.kind === "group_worker" ? scope.workerId : null, assignmentId: scope.kind === "group_worker" ? scope.assignmentId : null,
    onDate: null, operationId: null, cursorId: null });
}
export function delegatedGroupsFingerprintText(rawQuery: DelegatedGroupsQuery, actualActor: string, rawCommand: GroupsCommand): string {
  const q = parseDelegatedGroupsQuery(rawQuery), c = parseDelegatedGroupsCommand(rawCommand);
  if (q.mode === "recover" && q.operationId !== c.operationId) return fail();
  const t = c.action === "save_group" ? [c.action, c.operationId, c.reason, c.groupId, c.expectedRevision, c.name, c.description, c.active]
    : c.action === "assign" ? [c.action, c.operationId, c.reason, c.groupId, c.workerId, c.expectedGroupRevision, c.expectedWorkerVersion, c.expectedSettingsVersion, c.timeZone, c.startsOn, c.endsOn]
      : c.action === "end" ? [c.action, c.operationId, c.reason, c.assignmentId, c.expectedRevision, c.endsOn]
        : [c.action, c.operationId, c.reason, c.assignmentId, c.expectedRevision];
  return operationalRuleLedgerEncode(["attendance-delegated-groups-command-v1", q.siteId, attendanceSelfUuid(actualActor), q.grantId, t]);
}
export async function delegatedGroupsCommandFingerprint(q: DelegatedGroupsQuery, actorId: string, c: GroupsCommand): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(delegatedGroupsFingerprintText(q, actorId, c)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function receipt(raw: unknown): DelegatedGroupsReceipt {
  const r = exact(raw, ["operationId", "actorId", "grantId", "action", "referenceId", "revision", "commandFingerprint", "businessFingerprint", "recordedAt"]);
  if (typeof r.revision !== "number" || !Number.isSafeInteger(r.revision) || r.revision < 1 || r.revision > 9007199254740990
    || typeof r.commandFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(r.commandFingerprint)
    || typeof r.businessFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(r.businessFingerprint)) return fail();
  return { operationId: attendanceSelfUuid(r.operationId), actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), action: action(r.action),
    referenceId: attendanceSelfUuid(r.referenceId), revision: r.revision, commandFingerprint: r.commandFingerprint, businessFingerprint: r.businessFingerprint, recordedAt: delegatedAuditStamp(r.recordedAt) };
}
export async function parseDelegatedGroupsResult(raw: unknown, rawQuery: DelegatedGroupsQuery, actualActor: string, expectedCommand: GroupsCommand | null = null): Promise<DelegatedGroupsResult> {
  try {
    assertDelegatedAuditTree(raw, DELEGATED_GROUPS_RESULT_BYTES); const q = parseDelegatedGroupsQuery(rawQuery), actorId = attendanceSelfUuid(actualActor);
    const c = expectedCommand === null ? null : parseDelegatedGroupsCommand(expectedCommand);
    if (c && q.mode === "recover" && c.operationId !== q.operationId) return fail();
    const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
    const v = exact(raw, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", "context"])]);
    if (v.protocol !== DELEGATED_GROUPS_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) return fail();
    const base = { protocol: DELEGATED_GROUPS_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      const r = v.receipt === null ? null : receipt(v.receipt);
      if (q.mode !== "recover" && c === null || r && (r.actorId !== actorId || r.grantId !== q.grantId || r.recordedAt > base.readAt
        || r.operationId !== (c?.operationId ?? (q.mode === "recover" ? q.operationId : null)))) return fail();
      if (r && c) {
        const referenceId = c.action === "save_group" ? c.groupId : c.action === "assign" ? c.operationId : c.assignmentId;
        const revision = c.action === "assign" ? 1 : c.expectedRevision + 1;
        if (r.action !== delegatedGroupsAction(c) || r.referenceId !== referenceId || r.revision !== revision
          || r.commandFingerprint !== await delegatedGroupsCommandFingerprint(q, actorId, c)) return fail();
      }
      if (q.mode === "context" && r === null) return fail(); return freeze({ ...base, kind: "receipt", receipt: r });
    }
    if (kind !== "context" || q.mode !== "context" || c !== null || v.grantId !== q.grantId) return fail();
    const a = action(v.action), scope = parseManagementDelegationScope(v.scope, a);
    if (scope.kind !== "group" && scope.kind !== "group_worker") return fail();
    const legacyQuery = delegatedGroupsLegacyQuery(q.siteId, scope, a), context = parseGroupsResult(v.context, legacyQuery, null, actorId);
    if (context.receipt !== null || context.items.length || context.nextCursor !== null) return fail();
    if (scope.kind === "group_worker" && context.worker?.employeeId !== scope.employeeId) return fail();
    return freeze({ ...base, kind: "context", grantId: q.grantId, action: a, scope, context });
  } catch { return fail("attendance_delegated_groups_invalid"); }
}
export function delegatedGroupsCommandForContext(result: Extract<DelegatedGroupsResult, { kind: "context" }>, raw: unknown): GroupsCommand {
  const c = parseDelegatedGroupsCommand(raw);
  if (delegatedGroupsAction(c) !== result.action) return fail();
  if (c.action === "save_group" && (result.scope.kind !== "group" || c.groupId !== result.scope.groupId || (c.expectedRevision === 0) !== result.scope.create)) return fail();
  return freeze(parseGroupsBody({ query: delegatedGroupsLegacyQuery(result.siteId, result.scope, result.action), command: c }).command);
}
