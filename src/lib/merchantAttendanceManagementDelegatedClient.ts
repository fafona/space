// Explicit 202–208 browser operations. The shared actor slot contains original
// commands only, never exported rows. Only original GET + full SHA + CAS clears.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import * as m from "./merchantAttendanceManagementDelegation";
import * as a from "./merchantAttendanceDelegatedAudit";
import * as g from "./merchantAttendanceDelegatedGroups";
import * as cfg from "./merchantAttendanceDelegatedConfiguration";
import * as rules from "./merchantAttendanceDelegatedRules";
import * as cr from "./merchantAttendanceDelegatedCredentials";
import * as revisions from "./merchantAttendanceDelegatedRevisions";
import type { GroupsCommand } from "./merchantAttendanceGroups";

export type ManagementStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PendingBase = Readonly<{ protocol: "attendance-management-pending-v1"; version: 1; actorId: string; commandFingerprint: string }>;
export type AttendanceManagementPending = PendingBase & Readonly<
  { domain: "management"; query: Extract<m.ManagementDelegationQuery, { mode: "write" }>; command: m.ManagementDelegationCommand }
  | { domain: "audit"; query: a.DelegatedAuditExportQuery; command: a.DelegatedAuditCommand }
  | { domain: "groups"; query: Extract<g.DelegatedGroupsQuery, { mode: "context" }>; command: GroupsCommand }
  | { domain: "configuration"; query: Extract<cfg.DelegatedConfigurationQuery, { mode: "context" }>; command: cfg.DelegatedConfigurationCommand }
  | { domain: "rules"; query: Extract<rules.DelegatedRulesQuery, { mode: "context" }>; command: rules.DelegatedRulesCommand }
  | { domain: "terminals"; query: cr.DelegatedCredentialsContextQuery; command: cr.DelegatedTerminalCommand }
  | { domain: "pin"; query: cr.DelegatedCredentialsContextQuery; command: cr.DelegatedPinCommand }
  | { domain: "revisions"; query: revisions.DelegatedRevisionsContextQuery; command: revisions.DelegatedRevisionsCommand }
>;
export type AttendanceManagementClientResult = m.ManagementDelegationResult | a.DelegatedAuditResult | g.DelegatedGroupsResult | cfg.DelegatedConfigurationResult | rules.DelegatedRulesResult | cr.DelegatedTerminalResult | cr.DelegatedPinResult | revisions.DelegatedRevisionsResult;
export type AttendanceManagementClientState = Readonly<{ phase: "idle" | "loading" | "saving" | "ready" | "unconfirmed" | "blocked";
  pending: AttendanceManagementPending | null; result: AttendanceManagementClientResult | null; message: string }>;
export type AttendanceManagementClientOptions = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch; storage: () => ManagementStorage;
  isCurrentAuth: () => boolean; canWrite: () => boolean; onState?: (state: AttendanceManagementClientState) => void; timeoutMs?: number }>;
type Lease = Readonly<{ generation: number; controller: AbortController; deadline: number }>;
type Domain = "management" | "audit" | "groups" | "configuration" | "rules" | "terminals" | "pin" | "revisions";
type Query = m.ManagementDelegationQuery | a.DelegatedAuditQuery | g.DelegatedGroupsQuery | cfg.DelegatedConfigurationQuery | rules.DelegatedRulesQuery | cr.DelegatedCredentialsQuery | revisions.DelegatedRevisionsQuery;
type Command = m.ManagementDelegationCommand | a.DelegatedAuditCommand | GroupsCommand | cfg.DelegatedConfigurationCommand | rules.DelegatedRulesCommand | cr.DelegatedCredentialsCommand | revisions.DelegatedRevisionsCommand;
//Local dispatch parameter only. Never a class field, pending, snapshot or log.
type EphemeralSecret = { pairSecret: string } | { pin: string };
function fail(): never { throw Error("attendance_management_unconfirmed"); }
function pendingJson(raw: string): unknown {
  // Only206 owns the larger envelope. Earlier domains retain their exact16KiB
  // request parser; this does not widen any older API or saved-command limit.
  if (new TextEncoder().encode(raw).byteLength > rules.DELEGATED_RULES_REQUEST_BYTES + 1024) fail();
  const parsed = rules.parseDelegatedRulesJson(raw, false);
  return Object.getOwnPropertyDescriptor(parsed, "domain")?.value === "rules" ? parsed : m.parseManagementDelegationJson(raw);
}
function operationId(pending: AttendanceManagementPending): string {
  return pending.domain === "rules" ? pending.command.decision.operationId : pending.command.operationId;
}
// Read-only UI projection of the same existing shared-domain accessor. All
// internal parsing, dispatch and recovery calls retain their unchanged path.
export { operationId as attendanceManagementPendingOperationId };
const hidden = () => typeof document !== "undefined" && document.hidden;
const yes = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
export function attendanceManagementPendingKey(siteId: string, actorId: string) {
  m.parseManagementDelegationQuery({ siteId, mode: "recover", operationId: actorId });
  return `faolla:attendance:management:v1:${siteId}:${actorId}`;
}
export class AttendanceManagementClient {
  readonly storageKey: string; private readonly options: AttendanceManagementClientOptions;
  private generation = 0; private controller: AbortController | null = null; private disposed = false; private publishing = false;
  private state: AttendanceManagementClientState = freeze({ phase: "idle", pending: null, result: null, message: "请明确读取；初始化不会联网。" });
  constructor(options: AttendanceManagementClientOptions) {
    this.storageKey = attendanceManagementPendingKey(options.siteId, options.actorId);
    if ([options.apiFetch, options.storage, options.isCurrentAuth, options.canWrite].some(value => typeof value !== "function")
      || options.onState !== undefined && typeof options.onState !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) fail();
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  private publish(state: AttendanceManagementClientState) {
    this.state = freeze(state); if (this.disposed || this.publishing) return;
    this.publishing = true; try { this.options.onState?.(this.state); } catch { /* Observers never authorize transport. */ } finally { this.publishing = false; }
  }
  pause = () => { this.generation++; const prior = this.controller; this.controller = null; prior?.abort();
    this.publish({ phase: "idle", pending: null, result: null, message: "正文已清除；本地原编号保留，返回后请明确核验。" }); };
  dispose = () => { this.disposed = true; this.pause(); };
  hasLeaveRisk = () => { if (this.controller) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private guard(lease: Lease, fresh = false) {
    if (this.disposed || lease.generation !== this.generation || lease.controller !== this.controller || lease.controller.signal.aborted) fail();
    if (hidden() || !yes(this.options.isCurrentAuth)) { this.pause(); fail(); }
    if (performance.now() >= lease.deadline) { lease.controller.abort(); fail(); }
    if (fresh && !yes(this.options.canWrite)) fail();
  }
  private stored(lease: Lease, expected?: string | null) {
    this.guard(lease); const storage = this.options.storage(); this.guard(lease); const raw = storage.getItem(this.storageKey); this.guard(lease);
    if (expected !== undefined && raw !== expected) fail(); return { storage, raw };
  }
  private async operation<T>(run: (lease: Lease) => Promise<T>): Promise<T> {
    if (this.controller || this.disposed) fail(); const controller = new AbortController();
    const lease = { generation: ++this.generation, controller, deadline: performance.now() + (this.options.timeoutMs ?? 12000) }; this.controller = controller;
    let reject!: (error: Error) => void; const interrupted = new Promise<never>((_, no) => { reject = no; }), abort = () => reject(Error("cancelled_or_timed_out"));
    controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), Math.max(0, lease.deadline - performance.now()));
    try { return await Promise.race([Promise.resolve().then(() => { this.guard(lease); return run(lease); }), interrupted]); }
    catch { if (!this.disposed && lease.generation === this.generation) {
      if (hidden() || !yes(this.options.isCurrentAuth)) this.pause();
      else this.publish({ phase: "blocked", pending: this.state.pending, result: null, message: "结果尚未核实；保留原编号，只读核验，不要重发。" });
    } return fail(); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
  private async decode(raw: string, lease: Lease): Promise<AttendanceManagementPending> {
    const v = exact(pendingJson(raw), ["protocol", "version", "actorId", "domain", "query", "command", "commandFingerprint"]);
    if (v.protocol !== "attendance-management-pending-v1" || v.version !== 1 || v.actorId !== this.options.actorId) fail();
    const base: PendingBase = { protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, commandFingerprint: "" };
    let pending: AttendanceManagementPending;
    if (v.domain === "management") {
      const pair = m.parseManagementDelegationBody({ query: v.query, command: v.command }); if (pair.query.mode !== "write") fail();
      pending = { ...base, domain: "management", query: pair.query, command: pair.command,
        commandFingerprint: await m.managementDelegationCommandFingerprint(this.options.siteId, this.options.actorId, pair.command) };
    } else if (v.domain === "audit") {
      const pair = a.parseDelegatedAuditBody({ query: v.query, command: v.command }); pending = { ...base, domain: "audit", ...pair,
        commandFingerprint: await a.delegatedAuditCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else if (v.domain === "groups") {
      const pair = g.parseDelegatedGroupsBody({ query: v.query, command: v.command });
      if (pair.query.mode !== "context") fail();
      pending = { ...base, domain: "groups", query: pair.query, command: pair.command,
        commandFingerprint: await g.delegatedGroupsCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else if (v.domain === "configuration") {
      const pair = cfg.parseDelegatedConfigurationBody({ query: v.query, command: v.command });
      if (pair.query.mode !== "context") fail();
      pending = { ...base, domain: "configuration", query: pair.query, command: pair.command,
        commandFingerprint: await cfg.delegatedConfigurationCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else if (v.domain === "rules") {
      const pair = rules.parseDelegatedRulesBody({ query: v.query, command: v.command });
      if (pair.query.mode !== "context") fail();
      pending = { ...base, domain: "rules", query: pair.query, command: pair.command,
        commandFingerprint: await rules.delegatedRulesCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else if (v.domain === "terminals") {
      const pair = cr.parseDelegatedTerminalBody({ query: v.query, command: v.command });
      pending = { ...base, domain: "terminals", ...pair,
        commandFingerprint: await cr.delegatedTerminalCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else if (v.domain === "pin") {
      const pair = cr.parseDelegatedPinBody({ query: v.query, command: v.command });
      pending = { ...base, domain: "pin", ...pair,
        commandFingerprint: await cr.delegatedPinCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else if (v.domain === "revisions") {
      const pair = revisions.parseDelegatedRevisionsBody({ query: v.query, command: v.command });
      pending = { ...base, domain: "revisions", ...pair,
        commandFingerprint: await revisions.delegatedRevisionsCommandFingerprint(pair.query, this.options.actorId, pair.command) };
    } else fail();
    this.guard(lease); if (pending.query.siteId !== this.options.siteId || pending.commandFingerprint !== v.commandFingerprint) fail(); return freeze(pending);
  }
  initialize = () => this.operation(async lease => {
    const { raw } = this.stored(lease), pending = raw === null ? null : await this.decode(raw, lease); this.stored(lease, raw);
    this.publish({ phase: pending ? "unconfirmed" : "idle", pending, result: null, message: pending ? "发现原编号，请明确 GET 核验。" : "原编号槽为空；尚未联网。" }); this.stored(lease, raw); return pending;
  });
  private async transport(lease: Lease, domain: Domain, query: Query, command: Command | null, secret: EphemeralSecret | null = null) {
    const path = domain === "management" ? m.MANAGEMENT_DELEGATION_API : domain === "audit" ? a.DELEGATED_AUDIT_API
      : domain === "groups" ? g.DELEGATED_GROUPS_API : domain === "configuration" ? cfg.DELEGATED_CONFIGURATION_API : domain === "rules" ? rules.DELEGATED_RULES_API
        : domain === "terminals" ? cr.DELEGATED_TERMINALS_API : domain === "pin" ? cr.DELEGATED_PIN_API : revisions.DELEGATED_REVISIONS_API;
    const search = domain === "management" ? m.managementDelegationQueryString(query as m.ManagementDelegationQuery)
      : domain === "audit" ? a.delegatedAuditQueryString(query as a.DelegatedAuditQuery)
        : domain === "groups" ? g.delegatedGroupsQueryString(query as g.DelegatedGroupsQuery)
          : domain === "configuration" ? cfg.delegatedConfigurationQueryString(query as cfg.DelegatedConfigurationQuery) : domain === "rules" ? rules.delegatedRulesQueryString(query as rules.DelegatedRulesQuery)
            : domain === "revisions" ? revisions.delegatedRevisionsQueryString(revisions.parseDelegatedRevisionsQuery(query))
              : cr.delegatedCredentialsQueryString(query as cr.DelegatedCredentialsQuery);
    let body: unknown = command ? { query, command } : null;
    if (command && "action" in command && command.action === "terminal_prepare" && domain === "terminals") {
      if (secret === null || !("pairSecret" in secret)) fail(); body = cr.parseDelegatedTerminalPrepareEphemeralBody({ query, command, pairSecret: secret.pairSecret });
    } else if (command && "action" in command && command.action === "pin_issue" && domain === "pin") {
      if (secret === null || !("pin" in secret)) fail(); body = cr.parseDelegatedPinIssueEphemeralBody({ query, command, pin: secret.pin });
    } else if (secret !== null) fail();
    this.guard(lease); const responsePromise = this.options.apiFetch(path + (command ? "" : "?" + search), { method: command ? "POST" : "GET", cache: "no-store", redirect: "error",
      signal: lease.controller.signal, headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify(body) } : {}) });
    body = null; secret = null; const response = await responsePromise;
    try { this.guard(lease); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); fail();
    }
    const maximum = response.status === 200 ? domain === "management" ? m.MANAGEMENT_DELEGATION_RESULT_BYTES
      : domain === "audit" ? a.DELEGATED_AUDIT_RESULT_BYTES : domain === "groups" ? g.DELEGATED_GROUPS_RESULT_BYTES
        : domain === "configuration" ? cfg.DELEGATED_CONFIGURATION_RESULT_BYTES : domain === "rules" ? rules.DELEGATED_RULES_RESULT_BYTES
          : domain === "revisions" ? revisions.DELEGATED_REVISIONS_RESULT_BYTES : cr.DELEGATED_CREDENTIALS_RESULT_BYTES : 4096;
    const reader = response.body?.getReader(); if (!reader) fail(); let text = "", bytes = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); }, decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    lease.controller.signal.addEventListener("abort", cancel, { once: true });
    try { while (true) { const part = await reader.read(); this.guard(lease); if (part.done) break; bytes += part.value.byteLength; if (bytes > maximum) fail(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); lease.controller.signal.removeEventListener("abort", cancel); try { reader.releaseLock(); } catch { /* Do not mask timeout. */ } }
    const raw = domain === "management" ? m.parseManagementDelegationJson(text, false)
      : domain === "audit" ? a.parseDelegatedAuditJson(text, maximum) : domain === "groups" ? g.parseDelegatedGroupsJson(text, false)
        : domain === "configuration" ? cfg.parseDelegatedConfigurationJson(text, false) : domain === "rules" ? rules.parseDelegatedRulesJson(text, false)
          : domain === "revisions" ? revisions.parseDelegatedRevisionsJson(text, false) : cr.parseDelegatedCredentialsJson(text, false);
    if (response.status !== 200) {
      const e = exact(raw, ["ok", "error"]), error = exact(e.error, ["code", "message"]), errors: Readonly<Record<string, number>> = {
        ...(domain === "management" ? m.MANAGEMENT_DELEGATION_ERRORS : domain === "audit" ? a.DELEGATED_AUDIT_ERRORS
          : domain === "groups" ? g.DELEGATED_GROUPS_ERRORS : domain === "configuration" ? cfg.DELEGATED_CONFIGURATION_ERRORS : domain === "rules" ? rules.DELEGATED_RULES_ERRORS
            : domain === "terminals" ? cr.DELEGATED_TERMINALS_ERRORS : domain === "pin" ? cr.DELEGATED_PIN_ERRORS : revisions.DELEGATED_REVISIONS_ERRORS), attendance_rate_limited: 429 };
      if (e.ok !== false || typeof error.code !== "string" || errors[error.code] !== response.status || typeof error.message !== "string" || error.message.length > 512) fail(); return fail();
    }
    const v = exact(raw, ["ok", "data"]); if (v.ok !== true) fail();
    const result = domain === "management" ? await m.parseManagementDelegationResult(v.data, query as m.ManagementDelegationQuery, this.options.actorId, command as m.ManagementDelegationCommand | null)
      : domain === "audit" ? await a.parseDelegatedAuditResult(v.data, query as a.DelegatedAuditQuery, this.options.actorId, command as a.DelegatedAuditCommand | null)
        : domain === "groups" ? await g.parseDelegatedGroupsResult(v.data, query as g.DelegatedGroupsQuery, this.options.actorId, command as GroupsCommand | null)
          : domain === "configuration" ? await cfg.parseDelegatedConfigurationResult(v.data, query as cfg.DelegatedConfigurationQuery, this.options.actorId, command as cfg.DelegatedConfigurationCommand | null)
            : domain === "rules" ? await rules.parseDelegatedRulesResult(v.data, query as rules.DelegatedRulesQuery, this.options.actorId, command as rules.DelegatedRulesCommand | null)
              : domain === "terminals" ? await cr.parseDelegatedTerminalResult(v.data, query as cr.DelegatedCredentialsQuery, this.options.actorId, command as cr.DelegatedTerminalCommand | null)
                : domain === "pin" ? await cr.parseDelegatedPinResult(v.data, query as cr.DelegatedCredentialsQuery, this.options.actorId, command as cr.DelegatedPinCommand | null)
                  : await revisions.parseDelegatedRevisionsResult(v.data, revisions.parseDelegatedRevisionsQuery(query), this.options.actorId,
                    command === null ? null : revisions.parseDelegatedRevisionsCommand(command));
    this.guard(lease); return result;
  }
  private matches(result: AttendanceManagementClientResult, pending: AttendanceManagementPending) {
    if (result.kind !== "receipt" && result.kind !== "export" || !result.receipt) return false;
    if (pending.domain === "management") return result.protocol === m.MANAGEMENT_DELEGATION_PROTOCOL
      && m.managementDelegationReceiptMatches(result.receipt as m.ManagementDelegationReceipt, pending.command, this.options.actorId, pending.commandFingerprint);
    return result.protocol === (pending.domain === "audit" ? a.DELEGATED_AUDIT_PROTOCOL : pending.domain === "groups" ? g.DELEGATED_GROUPS_PROTOCOL
      : pending.domain === "configuration" ? cfg.DELEGATED_CONFIGURATION_PROTOCOL : pending.domain === "rules" ? rules.DELEGATED_RULES_PROTOCOL
        : pending.domain === "terminals" ? cr.DELEGATED_TERMINALS_PROTOCOL : pending.domain === "pin" ? cr.DELEGATED_PIN_PROTOCOL : revisions.DELEGATED_REVISIONS_PROTOCOL) && result.receipt.actorId === this.options.actorId
      && result.receipt.operationId === operationId(pending) && result.receipt.grantId === pending.query.grantId
      && result.receipt.commandFingerprint === pending.commandFingerprint;
  }
  readManagement = (raw: m.ManagementDelegationQuery) => {
    const query = m.parseManagementDelegationQuery(raw); if (query.siteId !== this.options.siteId || query.mode === "write" || query.mode === "recover") fail(); return this.read("management", query);
  };
  readAudit = (raw: a.DelegatedAuditQuery) => {
    const query = a.parseDelegatedAuditQuery(raw); if (query.siteId !== this.options.siteId || query.mode === "export" || query.mode === "recover") fail(); return this.read("audit", query);
  };
  readGroups = (raw: g.DelegatedGroupsQuery) => {
    const query = g.parseDelegatedGroupsQuery(raw); if (query.siteId !== this.options.siteId || query.mode !== "context") fail(); return this.read("groups", query);
  };
  readConfiguration = (raw: cfg.DelegatedConfigurationQuery) => {
    const query = cfg.parseDelegatedConfigurationQuery(raw); if (query.siteId !== this.options.siteId || query.mode !== "context") fail(); return this.read("configuration", query);
  };
  readRules = (raw: rules.DelegatedRulesQuery) => {
    const query = rules.parseDelegatedRulesQuery(raw); if (query.siteId !== this.options.siteId || query.mode === "recover") fail(); return this.read("rules", query);
  };
  readTerminals = (raw: cr.DelegatedCredentialsQuery) => {
    const query = cr.parseDelegatedCredentialsQuery(raw); if (query.siteId !== this.options.siteId || query.mode !== "context") fail(); return this.read("terminals", query);
  };
  readPin = (raw: cr.DelegatedCredentialsQuery) => {
    const query = cr.parseDelegatedCredentialsQuery(raw); if (query.siteId !== this.options.siteId || query.mode !== "context") fail(); return this.read("pin", query);
  };
  readRevisions = (raw: revisions.DelegatedRevisionsQuery) => {
    const query = revisions.parseDelegatedRevisionsQuery(raw); if (query.siteId !== this.options.siteId || query.mode !== "context") fail(); return this.read("revisions", query);
  };
  private read(domain: Domain, query: Query) { return this.operation(async lease => {
    this.stored(lease, null); this.publish({ phase: "loading", pending: null, result: null, message: "正在明确读取当前授权资料。" }); this.stored(lease, null);
    const result = await this.transport(lease, domain, query, null); this.stored(lease, null);
    this.publish({ phase: "ready", pending: null, result, message: "当前资料已读取；执行时仍会重新校验权限。" }); this.stored(lease, null); return result;
  }); }
  submitManagement = (raw: m.ManagementDelegationCommand) => {
    const pair = m.parseManagementDelegationBody({ query: { siteId: this.options.siteId, mode: "write" }, command: raw }); if (pair.query.mode !== "write") fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "management", query: pair.query, command: pair.command, commandFingerprint: "" });
  };
  submitAudit = (rawQuery: a.DelegatedAuditExportQuery, rawCommand: a.DelegatedAuditCommand) => {
    const pair = a.parseDelegatedAuditBody({ query: rawQuery, command: rawCommand }); if (pair.query.siteId !== this.options.siteId) fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "audit", ...pair, commandFingerprint: "" });
  };
  submitGroups = (rawQuery: g.DelegatedGroupsQuery, rawCommand: GroupsCommand) => {
    const pair = g.parseDelegatedGroupsBody({ query: rawQuery, command: rawCommand });
    if (pair.query.siteId !== this.options.siteId || pair.query.mode !== "context") fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "groups", query: pair.query, command: pair.command, commandFingerprint: "" });
  };
  submitConfiguration = (rawQuery: cfg.DelegatedConfigurationQuery, rawCommand: cfg.DelegatedConfigurationCommand) => {
    const pair = cfg.parseDelegatedConfigurationBody({ query: rawQuery, command: rawCommand });
    if (pair.query.siteId !== this.options.siteId || pair.query.mode !== "context") fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "configuration", query: pair.query, command: pair.command, commandFingerprint: "" });
  };
  submitRules = (rawQuery: rules.DelegatedRulesQuery, rawCommand: rules.DelegatedRulesCommand) => {
    const pair = rules.parseDelegatedRulesBody({ query: rawQuery, command: rawCommand });
    if (pair.query.siteId !== this.options.siteId || pair.query.mode !== "context") fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "rules", query: pair.query, command: pair.command, commandFingerprint: "" });
  };
  submitTerminalPrepare = (raw: cr.DelegatedTerminalPrepareEphemeralBody) => {
    const pair = cr.parseDelegatedTerminalPrepareEphemeralBody(raw); if (pair.query.siteId !== this.options.siteId) fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "terminals", query: pair.query, command: pair.command, commandFingerprint: "" }, { pairSecret: pair.pairSecret });
  };
  submitTerminalRevoke = (raw: cr.DelegatedTerminalBody) => {
    const pair = cr.parseDelegatedTerminalBody(raw); if (pair.query.siteId !== this.options.siteId || pair.command.action !== "terminal_revoke") fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "terminals", ...pair, commandFingerprint: "" });
  };
  submitPinIssue = (raw: cr.DelegatedPinIssueEphemeralBody) => {
    const pair = cr.parseDelegatedPinIssueEphemeralBody(raw); if (pair.query.siteId !== this.options.siteId) fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "pin", query: pair.query, command: pair.command, commandFingerprint: "" }, { pin: pair.pin });
  };
  submitPinRevoke = (raw: cr.DelegatedPinBody) => {
    const pair = cr.parseDelegatedPinBody(raw); if (pair.query.siteId !== this.options.siteId || pair.command.action !== "pin_revoke") fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "pin", ...pair, commandFingerprint: "" });
  };
  submitRevisions = (rawQuery: revisions.DelegatedRevisionsQuery, rawCommand: revisions.DelegatedRevisionsCommand) => {
    const pair = revisions.parseDelegatedRevisionsBody({ query: rawQuery, command: rawCommand }); if (pair.query.siteId !== this.options.siteId) fail();
    return this.submit({ protocol: "attendance-management-pending-v1", version: 1, actorId: this.options.actorId, domain: "revisions", ...pair, commandFingerprint: "" });
  };
  private submit(owned: AttendanceManagementPending, secret: EphemeralSecret | null = null) { return this.operation(async lease => {
    const fresh = !(owned.domain === "management" && owned.command.action === "revoke"); this.guard(lease, fresh); this.stored(lease, null);
    const commandFingerprint = owned.domain === "management" ? await m.managementDelegationCommandFingerprint(this.options.siteId, this.options.actorId, owned.command)
      : owned.domain === "audit" ? await a.delegatedAuditCommandFingerprint(owned.query, this.options.actorId, owned.command)
        : owned.domain === "groups" ? await g.delegatedGroupsCommandFingerprint(owned.query, this.options.actorId, owned.command)
          : owned.domain === "configuration" ? await cfg.delegatedConfigurationCommandFingerprint(owned.query, this.options.actorId, owned.command)
            : owned.domain === "rules" ? await rules.delegatedRulesCommandFingerprint(owned.query, this.options.actorId, owned.command)
              : owned.domain === "terminals" ? await cr.delegatedTerminalCommandFingerprint(owned.query, this.options.actorId, owned.command)
                : owned.domain === "pin" ? await cr.delegatedPinCommandFingerprint(owned.query, this.options.actorId, owned.command)
                  : await revisions.delegatedRevisionsCommandFingerprint(owned.query, this.options.actorId, owned.command); this.guard(lease, fresh);
    const pending = freeze({ ...owned, commandFingerprint }), raw = JSON.stringify(pending); pendingJson(raw);
    const { storage } = this.stored(lease, null); this.guard(lease, fresh); storage.setItem(this.storageKey, raw); this.guard(lease); this.stored(lease, raw);
    this.publish({ phase: "saving", pending, result: null, message: "完整原意图已保存；本次只提交一次。" }); this.guard(lease, fresh); this.stored(lease, raw);
    const request = this.transport(lease, pending.domain, pending.query, pending.command, secret); secret = null;
    const result = await request; this.stored(lease, raw); if (!this.matches(result, pending)) fail();
    this.publish({ phase: "unconfirmed", pending, result, message: "已收到结果，原编号仍保留；请明确 GET 核验后再离开。" }); this.stored(lease, raw); return result;
  }); }
  recover = () => this.operation(async lease => {
    const { raw } = this.stored(lease); if (raw === null) fail(); const pending = await this.decode(raw, lease); this.stored(lease, raw);
    const query = { siteId: this.options.siteId, mode: "recover" as const, operationId: operationId(pending),
      ...(pending.domain === "groups" || pending.domain === "configuration" || pending.domain === "rules" || pending.domain === "terminals" || pending.domain === "pin" || pending.domain === "revisions" ? { grantId: pending.query.grantId } : {}) };
    this.publish({ phase: "loading", pending, result: null, message: "只读核验原编号；不会重发原命令。" }); this.stored(lease, raw);
    const result = await this.transport(lease, pending.domain, query, null); const { storage } = this.stored(lease, raw);
    if (result.kind !== "receipt") fail();
    if (result.receipt === null) { this.publish({ phase: "unconfirmed", pending, result, message: "查无回执不代表未写入；原编号继续保留。" }); this.stored(lease, raw); return result; }
    if (!this.matches(result, pending)) fail();
    if (pending.domain === "groups") { await g.parseDelegatedGroupsResult(result, query as g.DelegatedGroupsQuery, this.options.actorId, pending.command); this.stored(lease, raw); }
    if (pending.domain === "configuration") { await cfg.parseDelegatedConfigurationResult(result, query as cfg.DelegatedConfigurationQuery, this.options.actorId, pending.command); this.stored(lease, raw); }
    if (pending.domain === "rules") { await rules.parseDelegatedRulesResult(result, query as rules.DelegatedRulesQuery, this.options.actorId, pending.command); this.stored(lease, raw); }
    if (pending.domain === "terminals") { await cr.parseDelegatedTerminalResult(result, query as cr.DelegatedCredentialsQuery, this.options.actorId, pending.command); this.stored(lease, raw); }
    if (pending.domain === "pin") { await cr.parseDelegatedPinResult(result, query as cr.DelegatedCredentialsQuery, this.options.actorId, pending.command); this.stored(lease, raw); }
    if (pending.domain === "revisions") { await revisions.parseDelegatedRevisionsResult(result, revisions.parseDelegatedRevisionsQuery(query), this.options.actorId, pending.command); this.stored(lease, raw); }
    this.guard(lease); storage.removeItem(this.storageKey); this.guard(lease); this.stored(lease, null);
    this.publish({ phase: "ready", pending: null, result, message: "原号与完整意图已核实；如需当前正文请重新明确读取。" }); this.stored(lease, null); return result;
  });
}

