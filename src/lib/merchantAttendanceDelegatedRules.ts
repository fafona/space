//206: the eight existing rule actions, under an exact SQL-owned grant.
//Parsing is not authorization. In particular a capability name is not an executor.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { MANAGEMENT_DELEGATION_ERRORS, parseManagementDelegationScope, type ManagementDelegationScope } from "./merchantAttendanceManagementDelegation";
import { RULE_KEYS, parseAttendanceRuleDraft, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { RULES_ERRORS, parseRulesCommand, parseRulesItem, parseRulesResult, type RulesCommand, type RulesDraft, type RulesItem, type RulesResult } from "./merchantAttendanceRules";
import { PERSONAL_RULES_ERRORS, parsePersonalRulesCommand, parsePersonalRulesItem, parsePersonalRulesResult, type PersonalRulesCommand, type PersonalRulesItem, type PersonalRulesWorker } from "./merchantAttendancePersonalRules";
import { parseOperationalRules, type OperationalRules } from "./merchantAttendanceOperationalRules";
import { OPERATIONAL_RULE_LEDGER_ERRORS, OPERATIONAL_RULE_LEDGER_PROTOCOL, operationalRuleLedgerCommandFingerprintText,
  operationalRuleLedgerEncode, operationalRuleLedgerEqual, operationalRuleLedgerFreeze, parseOperationalRuleLedgerCommand,
  parseOperationalRuleLedgerQuery, parseOperationalRuleLedgerResult, type OperationalRuleLedgerCommand, type OperationalRuleLedgerData,
  type OperationalRuleLedgerItem, type OperationalRuleLedgerScope } from "./merchantAttendanceOperationalRuleLedger";

export const DELEGATED_RULES_PROTOCOL = "attendance-delegated-rules-v1" as const;
export const DELEGATED_RULES_API = "/api/merchant-enterprise/attendance/delegated-rules";
export const DELEGATED_RULES_REQUEST_BYTES = 49152;
export const DELEGATED_RULES_RESULT_BYTES = 262144;
export const DELEGATED_RULES_ACTIONS = ["rule_draft", "rule_publish", "rule_withdraw", "personal_rule_approve", "personal_rule_withdraw",
  "operational_rule_draft", "operational_rule_publish", "operational_rule_withdraw"] as const;
export type DelegatedRulesAction = typeof DELEGATED_RULES_ACTIONS[number];
export type DelegatedRulesFamily = "base" | "personal" | "operational";
export type DelegatedRulesScope = Extract<ManagementDelegationScope, { kind: "rules" }>;
export type DelegatedRulesCommand = Readonly<{ family: "base"; decision: RulesCommand } | { family: "personal"; decision: PersonalRulesCommand }
  | { family: "operational"; decision: OperationalRuleLedgerCommand }>;
export type DelegatedRulesCursor = Readonly<{ siteId: string; grantId: string; atRevision: number; beforeRevision: number }>;
export type DelegatedRulesQuery = Readonly<{ siteId: string; grantId: string } & (
  { mode: "context"; operationId: null } | { mode: "recover"; operationId: string } | { mode: "history"; cursor: DelegatedRulesCursor | null }
  | { mode: "preview"; sourceDraftRevision: number; effectiveOn: string; endsOn: string | null })>;
export type DelegatedRulesReceipt = Readonly<{ operationId: string; actorId: string; grantId: string; family: DelegatedRulesFamily;
  action: DelegatedRulesAction; referenceId: string; revision: number; commandFingerprint: string; businessFingerprint: string; recordedAt: string }>;
type Baseline<R> = Readonly<{ baselineRules: R; baselineRevision: number | null; baselineKind: "draft" | "publication" | "default" }>;
type OperationalDetail = Extract<OperationalRuleLedgerData, { kind: "detail" }>;
type OperationalPreview = Extract<OperationalRuleLedgerData, { kind: "preview" }>;
export type DelegatedRulesContext = Readonly<
  ({ family: "base"; revision: number; settingsVersion: number; timeZone: string; group: RulesResult["group"]; draft: RulesDraft | null } & Baseline<AttendanceRuleDraft>)
  | { family: "personal"; revision: number; settingsVersion: number; timeZone: string; worker: PersonalRulesWorker }
  | ({ family: "operational"; detail: OperationalDetail } & Baseline<OperationalRules>)>;
export type DelegatedRulesHistoryRow = Readonly<{ item: RulesItem | PersonalRulesItem | OperationalRuleLedgerItem; withdrawnByRevision: number | null }>;
type Base = Readonly<{ protocol: typeof DELEGATED_RULES_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
type Grant = Readonly<{ grantId: string; action: DelegatedRulesAction; scope: DelegatedRulesScope }>;
export type DelegatedRulesResult = Base & Readonly<
  { kind: "receipt"; receipt: DelegatedRulesReceipt | null }
  | (Grant & { kind: "context"; context: DelegatedRulesContext })
  | (Grant & { kind: "preview"; preview: OperationalPreview })
  | (Grant & { kind: "history"; atRevision: number; items: readonly DelegatedRulesHistoryRow[]; nextCursor: DelegatedRulesCursor | null })>;
export const DELEGATED_RULES_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...RULES_ERRORS, ...PERSONAL_RULES_ERRORS,
  ...OPERATIONAL_RULE_LEDGER_ERRORS, ...MANAGEMENT_DELEGATION_ERRORS, attendance_delegated_rules_disabled: 403,
  attendance_delegated_rules_invalid: 503, attendance_delegated_rules_key_denied: 403,
  attendance_delegated_rules_reference_denied: 403, attendance_delegated_rules_too_large: 422 });
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
const exact = captureBrowserExact, freeze = operationalRuleLedgerFreeze, equal = operationalRuleLedgerEqual;
const MAX = 9007199254740990, dummy = "00000000-0000-4000-8000-000000000001";
function int(v: unknown, min = 0, max = MAX): number {
  return typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
}
function hash(v: unknown): string { return typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(); }
function family(v: unknown): DelegatedRulesFamily { return v === "base" || v === "personal" || v === "operational" ? v : fail(); }
function action(v: unknown): DelegatedRulesAction { return DELEGATED_RULES_ACTIONS.includes(v as DelegatedRulesAction) ? v as DelegatedRulesAction : fail(); }
function actionFamily(a: DelegatedRulesAction): DelegatedRulesFamily { return a.startsWith("operational_") ? "operational" : a.startsWith("personal_") ? "personal" : "base"; }
function snapshot(raw: unknown, maximum: number): unknown {
  assertDelegatedAuditTree(raw, maximum); return parseCaptureBrowserJson(JSON.stringify(raw));
}
function cursor(raw: unknown, siteId: string, grantId: string): DelegatedRulesCursor {
  const c = exact(raw, ["siteId", "grantId", "atRevision", "beforeRevision"]);
  const parsed = { siteId: attendanceSelfSite(c.siteId), grantId: attendanceSelfUuid(c.grantId), atRevision: int(c.atRevision, 1), beforeRevision: int(c.beforeRevision, 2) };
  if (parsed.siteId !== siteId || parsed.grantId !== grantId || parsed.beforeRevision > parsed.atRevision) return fail(); return parsed;
}
export function parseDelegatedRulesQuery(raw: unknown): DelegatedRulesQuery {
  assertDelegatedAuditTree(raw, 4096); const mode = Object.getOwnPropertyDescriptor(raw, "mode")?.value;
  const q = exact(raw, ["siteId", "grantId", "mode", ...(mode === "history" ? ["cursor"] : mode === "preview" ? ["sourceDraftRevision", "effectiveOn", "endsOn"] : ["operationId"])]);
  const siteId = attendanceSelfSite(q.siteId), grantId = attendanceSelfUuid(q.grantId);
  if (mode === "context" && q.operationId === null) return freeze({ siteId, grantId, mode, operationId: null });
  if (mode === "recover") return freeze({ siteId, grantId, mode, operationId: attendanceSelfUuid(q.operationId) });
  if (mode === "history") return freeze({ siteId, grantId, mode, cursor: q.cursor === null ? null : cursor(q.cursor, siteId, grantId) });
  if (mode !== "preview") return fail();
  //The old parser supplies the precise date/horizon semantics. The real scope
  //is subsequently bound to the immutable grant, never this validation scope.
  const scope = q.endsOn === null ? { kind: "enterprise" as const } : { kind: "personal" as const, workerId: dummy, employeeId: dummy, employeeAuthUserId: dummy };
  const old = parseOperationalRuleLedgerQuery({ siteId, mode, scope, sourceDraftRevision: q.sourceDraftRevision, effectiveOn: q.effectiveOn, endsOn: q.endsOn });
  if (old.mode !== "preview") return fail();
  return freeze({ siteId, grantId, mode, sourceDraftRevision: old.sourceDraftRevision, effectiveOn: old.effectiveOn, endsOn: old.endsOn });
}
export function delegatedRulesQueryString(raw: DelegatedRulesQuery): string {
  const q = parseDelegatedRulesQuery(raw), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) p.set(k, v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)); return p.toString();
}
export function parseDelegatedRulesCommand(raw: unknown): DelegatedRulesCommand {
  const v = exact(snapshot(raw, DELEGATED_RULES_REQUEST_BYTES), ["family", "decision"]);
  if (v.family === "base") return freeze({ family: v.family, decision: parseRulesCommand(v.decision) });
  if (v.family === "personal") return freeze({ family: v.family, decision: parsePersonalRulesCommand(v.decision) });
  if (v.family === "operational") return freeze({ family: v.family, decision: parseOperationalRuleLedgerCommand(v.decision) }); return fail();
}
export function delegatedRulesAction(c: DelegatedRulesCommand): DelegatedRulesAction {
  const v = parseDelegatedRulesCommand(c), a = v.decision.action;
  return v.family === "personal" ? a === "approve" ? "personal_rule_approve" : "personal_rule_withdraw"
    : v.family === "operational" ? a === "save_draft" ? "operational_rule_draft" : a === "publish" ? "operational_rule_publish" : "operational_rule_withdraw"
      : a === "save_draft" ? "rule_draft" : a === "publish" ? "rule_publish" : "rule_withdraw";
}
export function parseDelegatedRulesBody(raw: unknown) {
  const b = exact(snapshot(raw, DELEGATED_RULES_REQUEST_BYTES), ["query", "command"]), query = parseDelegatedRulesQuery(b.query), command = parseDelegatedRulesCommand(b.command);
  if (query.mode !== "context" || command.family === "operational" && command.decision.siteId !== query.siteId) return fail(); return freeze({ query, command });
}
export function parseDelegatedRulesJson(text: string, request = true): unknown {
  const maximum = request ? DELEGATED_RULES_REQUEST_BYTES : DELEGATED_RULES_RESULT_BYTES;
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > maximum) return fail();
  const v = parseCaptureBrowserJson(text); assertDelegatedAuditTree(v, maximum); return v;
}
type Tuple = string | number | boolean | null | readonly Tuple[];
const rulesTuple = (r: AttendanceRuleDraft): Tuple[] => RULE_KEYS.map(k => { const c = r[k]; return c.mode === "value" ? [c.mode, c.minutes] : [c.mode]; });
export function delegatedRulesFingerprintText(rawQuery: DelegatedRulesQuery, actor: string, rawCommand: DelegatedRulesCommand): string {
  const q = parseDelegatedRulesQuery(rawQuery), c = parseDelegatedRulesCommand(rawCommand), actorId = attendanceSelfUuid(actor), d = c.decision;
  if (q.mode !== "context" && q.mode !== "recover" || q.mode === "recover" && q.operationId !== d.operationId) return fail();
  let tuple: Tuple[];
  if (c.family === "operational") {
    if (c.decision.siteId !== q.siteId) return fail();
    //This is an already validated, locally generated tuple, not untrusted JSON
    //or a new canonicalizer for the established191 command format.
    tuple = (parseCaptureBrowserJson(operationalRuleLedgerCommandFingerprintText(c.decision, actorId)) as [string, string, Tuple[]])[2];
  } else if (c.family === "base") {
    const v = c.decision; tuple = [v.action, v.operationId, v.expectedRevision, v.reason];
    if (v.action === "save_draft") tuple.push(v.expectedSettingsVersion, v.expectedGroupRevision, v.timeZone, rulesTuple(v.rules));
    else if (v.action === "publish") tuple.push(v.expectedSettingsVersion, v.expectedGroupRevision, v.timeZone, v.effectiveOn); else tuple.push(v.publishedRevision);
  } else {
    const v = c.decision; tuple = [v.action, v.operationId, v.expectedRevision, v.reason];
    if (v.action === "approve") tuple.push(v.expectedWorkerVersion, v.expectedSettingsVersion, v.employeeId, v.employeeAuthUserId, v.timeZone, v.startsOn, v.endsOn, rulesTuple(v.rules));
    else tuple.push(v.approvedRevision);
  }
  return operationalRuleLedgerEncode(["attendance-delegated-rules-command-v1", q.siteId, actorId, q.grantId, [c.family, tuple]]);
}
export async function delegatedRulesCommandFingerprint(q: DelegatedRulesQuery, actor: string, c: DelegatedRulesCommand): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(delegatedRulesFingerprintText(q, actor, c)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function receipt(raw: unknown): DelegatedRulesReceipt {
  const r = exact(raw, ["operationId", "actorId", "grantId", "family", "action", "referenceId", "revision", "commandFingerprint", "businessFingerprint", "recordedAt"]), a = action(r.action), f = family(r.family);
  const operationId = attendanceSelfUuid(r.operationId), referenceId = attendanceSelfUuid(r.referenceId);
  if (actionFamily(a) !== f || referenceId !== operationId) return fail();
  return { operationId, actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), family: f, action: a, referenceId,
    revision: int(r.revision, 1), commandFingerprint: hash(r.commandFingerprint), businessFingerprint: hash(r.businessFingerprint), recordedAt: delegatedAuditStamp(r.recordedAt) };
}
function oldScope(s: DelegatedRulesScope): OperationalRuleLedgerScope { return s.subject; }
async function oldOperational(data: unknown, q: DelegatedRulesQuery, scope: DelegatedRulesScope, base: Base, mode: "detail" | "preview" | "history") {
  const oldQuery = mode === "detail" ? { siteId: q.siteId, mode, scope: oldScope(scope) }
    : mode === "preview" && q.mode === "preview" ? { siteId: q.siteId, mode, scope: oldScope(scope), sourceDraftRevision: q.sourceDraftRevision, effectiveOn: q.effectiveOn, endsOn: q.endsOn }
      : mode === "history" && q.mode === "history" ? { siteId: q.siteId, mode, scope: oldScope(scope), cursor: q.cursor === null ? null : { siteId: q.siteId, scope: oldScope(scope), atRevision: q.cursor.atRevision, beforeRevision: q.cursor.beforeRevision } } : fail();
  const r = await parseOperationalRuleLedgerResult({ protocol: OPERATIONAL_RULE_LEDGER_PROTOCOL, siteId: q.siteId, actorId: base.actorId, readAt: base.readAt,
    canWrite: false, data, receipt: null }, parseOperationalRuleLedgerQuery(oldQuery), base.actorId);
  return r.data;
}
function baseline<R extends AttendanceRuleDraft | OperationalRules>(v: Record<string, unknown>, revision: number, rules: R, draft: { revision: number; rules: R } | null,
  publication: { revision: number; rules: R } | null | undefined): Baseline<R> {
  const kind = v.baselineKind, r = v.baselineRevision === null ? null : int(v.baselineRevision, 1);
  if (kind !== "draft" && kind !== "publication" && kind !== "default" || r !== null && r > revision) return fail();
  if (kind === "default") { if (r !== null || draft !== null || publication || Object.values(rules).some(c => c.mode !== "inherit")) return fail(); }
  else if (kind === "draft") { if (draft === null || r !== draft.revision || !equal(rules, draft.rules)) return fail(); }
  else if (r === null || draft !== null || publication !== undefined && (!publication || r !== publication.revision || !equal(rules, publication.rules))) return fail();
  return { baselineRules: rules, baselineRevision: r, baselineKind: kind };
}
async function context(raw: unknown, scope: DelegatedRulesScope, q: DelegatedRulesQuery, base: Base): Promise<DelegatedRulesContext> {
  if (scope.family === "base") {
    const v = exact(raw, ["family", "revision", "settingsVersion", "timeZone", "group", "draft", "baselineRules", "baselineRevision", "baselineKind"]);
    if (v.family !== "base" || scope.subject.kind === "personal") return fail(); const revision = int(v.revision), groupId = scope.subject.kind === "group" ? scope.subject.groupId : null;
    //Reuse the old exact group/settings/timezone parser without inventing old
    //history rows. This is a pure field projection, not an owner RPC or record.
    const validated = parseRulesResult({ protocol: "rules-v1", siteId: q.siteId, actorId: base.actorId, group: v.group, settingsVersion: v.settingsVersion,
      timeZone: v.timeZone, revision: 0, draft: null, items: [], nextBeforeRevision: null, receipt: null }, { siteId: q.siteId, groupId, operationId: null, beforeRevision: null }, null, base.actorId);
    let draft: RulesDraft | null = null;
    if (v.draft !== null) {
      const d = exact(v.draft, ["revision", "settingsVersion", "groupRevision", "timeZone", "rules"]);
      const parsed = parseRulesItem({ revision: d.revision, operationId: dummy, actorId: dummy, action: "save_draft", reason: "validate draft", recordedAt: base.readAt,
        settingsVersion: d.settingsVersion, groupRevision: d.groupRevision, timeZone: d.timeZone, rules: d.rules, effectiveOn: null, effectiveAt: null, publishedRevision: null }, groupId);
      if (parsed.revision > revision || parsed.settingsVersion === null || parsed.timeZone === null || parsed.rules === null) return fail();
      draft = { revision: parsed.revision, settingsVersion: parsed.settingsVersion, groupRevision: parsed.groupRevision, timeZone: parsed.timeZone, rules: parsed.rules };
    }
    return { family: "base", revision, settingsVersion: validated.settingsVersion, timeZone: validated.timeZone, group: validated.group, draft,
      ...baseline(v, revision, parseAttendanceRuleDraft(v.baselineRules), draft, undefined) };
  }
  if (scope.family === "personal") {
    const v = exact(raw, ["family", "revision", "settingsVersion", "timeZone", "worker"]); if (v.family !== "personal" || scope.subject.kind !== "personal") return fail();
    const old = parsePersonalRulesResult({ protocol: "personal-rules-v1", siteId: q.siteId, actorId: base.actorId, worker: v.worker, settingsVersion: v.settingsVersion,
      timeZone: v.timeZone, revision: 0, items: [], nextBeforeRevision: null, receipt: null, readAt: base.readAt },
    { siteId: q.siteId, workerId: scope.subject.workerId, operationId: null, beforeRevision: null }, null, base.actorId);
    if (old.worker.employeeId !== scope.subject.employeeId || old.worker.employeeAuthUserId !== scope.subject.employeeAuthUserId) return fail();
    return { family: "personal", revision: int(v.revision), settingsVersion: old.settingsVersion, timeZone: old.timeZone, worker: old.worker };
  }
  const v = exact(raw, ["family", "detail", "baselineRules", "baselineRevision", "baselineKind"]); if (v.family !== "operational") return fail();
  const detail = await oldOperational(v.detail, q, scope, base, "detail"); if (detail.kind !== "detail") return fail();
  return { family: "operational", detail, ...baseline(v, detail.revision, parseOperationalRules(v.baselineRules), detail.draft, detail.currentPublication) };
}
export async function parseDelegatedRulesResult(raw: unknown, rawQuery: DelegatedRulesQuery, actualActor: string, expectedCommand: DelegatedRulesCommand | null = null): Promise<DelegatedRulesResult> {
  try {
    const input = snapshot(raw, DELEGATED_RULES_RESULT_BYTES), q = parseDelegatedRulesQuery(rawQuery), actorId = attendanceSelfUuid(actualActor), c = expectedCommand === null ? null : parseDelegatedRulesCommand(expectedCommand);
    if (c && (q.mode !== "context" && q.mode !== "recover" || q.mode === "recover" && q.operationId !== c.decision.operationId)) return fail();
    const kind = Object.getOwnPropertyDescriptor(input, "kind")?.value;
    const v = exact(input, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", ...(kind === "context" ? ["context"] : kind === "preview" ? ["preview"] : ["atRevision", "items", "nextCursor"])])]);
    if (v.protocol !== DELEGATED_RULES_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) return fail();
    const base: Base = { protocol: DELEGATED_RULES_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      const r = v.receipt === null ? null : receipt(v.receipt);
      if (q.mode !== "recover" && (q.mode !== "context" || c === null || r === null) || r && (r.actorId !== actorId || r.grantId !== q.grantId
        || r.recordedAt > base.readAt || r.operationId !== (c?.decision.operationId ?? (q.mode === "recover" ? q.operationId : null)))) return fail();
      if (r && c && (r.family !== c.family || r.action !== delegatedRulesAction(c) || r.revision !== c.decision.expectedRevision + 1
        || r.commandFingerprint !== await delegatedRulesCommandFingerprint(q, actorId, c))) return fail();
      return freeze({ ...base, kind, receipt: r });
    }
    if (c !== null || q.mode === "recover" || v.grantId !== q.grantId) return fail();
    const a = action(v.action), s = parseManagementDelegationScope(v.scope, a);
    if (s.kind !== "rules" || s.family !== actionFamily(a) || s.subject.kind === "personal" && s.subject.employeeAuthUserId === actorId) return fail();
    const grant: Grant = { grantId: q.grantId, action: a, scope: s };
    if (kind === "context" && q.mode === "context") return freeze({ ...base, ...grant, kind, context: await context(v.context, s, q, base) });
    if (kind === "preview" && q.mode === "preview" && s.family === "operational") {
      const preview = await oldOperational(v.preview, q, s, base, "preview"); if (preview.kind !== "preview") return fail();
      return freeze({ ...base, ...grant, kind, preview });
    }
    if (kind !== "history" || q.mode !== "history") return fail();
    const atRevision = int(v.atRevision), nextCursor = v.nextCursor === null ? null : cursor(v.nextCursor, q.siteId, q.grantId);
    if (q.cursor && q.cursor.atRevision !== atRevision || !Array.isArray(v.items) || v.items.length > 25) return fail();
    const available = Math.min(atRevision, q.cursor ? q.cursor.beforeRevision - 1 : atRevision), items: DelegatedRulesHistoryRow[] = [];
    if (s.family === "operational") {
      const parsed = await oldOperational({ kind: "history", scope: oldScope(s), atRevision, items: v.items,
        nextCursor: nextCursor === null ? null : { siteId: q.siteId, scope: oldScope(s), atRevision, beforeRevision: nextCursor.beforeRevision } }, q, s, base, "history");
      if (parsed.kind !== "history") return fail(); items.push(...parsed.items);
    } else {
      const seen = new Set<string>();
      for (const [i, row] of v.items.entries()) {
        const x = exact(row, ["item", "withdrawnByRevision"]), item = s.family === "base" ? parseRulesItem(x.item, s.subject.kind === "group" ? s.subject.groupId : null) : parsePersonalRulesItem(x.item);
        const w = x.withdrawnByRevision === null ? null : int(x.withdrawnByRevision, 1);
        if (item.revision !== available - i || item.recordedAt > base.readAt || seen.has(item.operationId) || i > 0 && item.recordedAt > items[i - 1].item.recordedAt
          || w !== null && (item.action !== (s.family === "base" ? "publish" : "approve") || w <= item.revision || w > atRevision)) return fail();
        if (s.family === "personal" && (s.subject.kind !== "personal" || !("employeeId" in item) || item.employeeId !== s.subject.employeeId || item.employeeAuthUserId !== s.subject.employeeAuthUserId)) return fail();
        seen.add(item.operationId); items.push({ item, withdrawnByRevision: w });
      }
      if (items.length !== Math.min(available, 25)) return fail();
      const withdrawn = new Set<number>();
      for (const row of items) if (row.item.action === "withdraw") {
        const targetRevision = "approvedRevision" in row.item ? row.item.approvedRevision : row.item.publishedRevision;
        if (targetRevision === null || withdrawn.has(targetRevision)) return fail(); withdrawn.add(targetRevision);
        const original = items.find(x => x.item.revision === targetRevision);
        if (original && (original.item.action !== (s.family === "base" ? "publish" : "approve") || original.withdrawnByRevision !== row.item.revision)) return fail();
        if (original && "approvedRevision" in row.item) {
          if (!("approvedRevision" in original.item)) return fail();
          const keys = ["employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules"] as const;
          const before = original.item, after = row.item;
          if (keys.some(key => !equal(before[key], after[key]))) return fail();
        }
      }
      for (const row of items) if (row.withdrawnByRevision !== null) {
        const withdrawal = items.find(x => x.item.revision === row.withdrawnByRevision);
        if (withdrawal && (withdrawal.item.action !== "withdraw" || ("approvedRevision" in withdrawal.item ? withdrawal.item.approvedRevision : withdrawal.item.publishedRevision) !== row.item.revision)) return fail();
      }
      if (s.family === "personal") {
        const approvals = items.flatMap(row => "approvedRevision" in row.item && row.item.action === "approve" && row.withdrawnByRevision === null ? [row.item] : []).sort((a, b) => a.fromAt.localeCompare(b.fromAt));
        for (let n = 1; n < approvals.length; n++) if (approvals[n].fromAt < approvals[n - 1].toAt) return fail();
      }
    }
    if (available > 25 ? nextCursor === null || nextCursor.atRevision !== atRevision || nextCursor.beforeRevision !== items.at(-1)?.item.revision : nextCursor !== null) return fail();
    return freeze({ ...base, ...grant, kind, atRevision, items, nextCursor });
  } catch { return fail("attendance_delegated_rules_invalid"); }
}
