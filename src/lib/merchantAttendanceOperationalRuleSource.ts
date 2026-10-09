// 241: strict private-source projection, not a public API or business authority.
// A valid SHA proves wire consistency, NOT authenticated DB origin, complete DB
// selection, grant/role/pause eligibility or adoption by an attendance writer.
import { MerchantAttendanceError, attendanceDayUtcRange, attendanceTimeZone } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules, resolveOperationalRules, type OperationalRules, type OperationalRulesPreview } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerEncode, operationalRuleLedgerEqual, operationalRuleLedgerFreeze as freeze,
  operationalRuleLedgerRulesFingerprint, operationalRuleLedgerReferenceFingerprint, parseOperationalRuleLedgerSourceFields,
  type OperationalRuleLedgerScope, type OperationalRuleLedgerContext, type OperationalRuleLedgerReferences } from "./merchantAttendanceOperationalRuleLedger";

export const OPERATIONAL_RULE_SOURCE_PROTOCOL = "attendance-operational-rule-source-v1" as const;
export const OPERATIONAL_RULE_SOURCE_BYTE_LIMIT = 262144;
const MAX = 9007199254740990;
export type OperationalRuleSourceExpected = Readonly<{ siteId: string; workerId: string; employeeId: string; employeeAuthUserId: string; at: string }>;
export type OperationalRuleSourceIdentity = Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string; workerVersion: number; employeeVersion: number }>;
export type OperationalRuleSourceAssignment = Readonly<{
  assignmentId: string; revision: 1 | 2; operationId: string; groupId: string; currentGroupRevision: number; workerId: string; employeeId: string;
  savedWorkerVersion: number; savedSettingsVersion: number; timeZone: string; startsOn: string; endsOn: string | null; fromAt: string; toAt: string | null;
}>;
export type OperationalRuleSourceLayer = Readonly<{
  scope: OperationalRuleLedgerScope; operationId: string; revision: number; context: OperationalRuleLedgerContext; effectiveAt: string; endsAt: string | null;
  rulesFingerprint: string; referenceFingerprint: string; rules: OperationalRules; references: OperationalRuleLedgerReferences;
}>;
export type OperationalRuleSourceBaseline = Readonly<{ operationId: string; revision: number; recordedAt: string; submissionWindowDays: number; timeZone: string }>;
export type OperationalRuleSource = Readonly<{
  protocol: typeof OPERATIONAL_RULE_SOURCE_PROTOCOL; siteId: string; workerIdentity: OperationalRuleSourceIdentity; at: string;
  settingsRef: Readonly<{ version: number; timeZone: string }>; groupAssignmentRef: OperationalRuleSourceAssignment | null;
  layers: Readonly<{ enterprise: OperationalRuleSourceLayer | null; group: OperationalRuleSourceLayer | null; personal: OperationalRuleSourceLayer | null }>;
  baselineCorrectionPolicyRef: OperationalRuleSourceBaseline | null; sourceFingerprint: string;
}>;
export type OperationalRuleSourceProjection = Readonly<{ source: OperationalRuleSource; candidate: OperationalRulesPreview }>;
type Tuple = null | boolean | number | string | readonly Tuple[];
/** Canonical tuple only; callers must first use parseOperationalRuleSource.
 * This does not authenticate a source, publish rules or authorize a consumer. */
export function operationalRuleSourceTuple(source: OperationalRuleSource): readonly Tuple[] {
  tree(source);
  const w = source.workerIdentity, g = source.groupAssignmentRef, b = source.baselineCorrectionPolicyRef;
  const layerTuple = (value: OperationalRuleSourceLayer | null): Tuple => {
    if (value === null) return null;
    const fields = parseOperationalRuleLedgerSourceFields({ scope: value.scope, context: value.context, rules: value.rules, references: value.references });
    const [s, c, rules, refs] = fields.tuples;
    return [s, value.operationId, value.revision, c, value.effectiveAt, value.endsAt, value.rulesFingerprint, value.referenceFingerprint, rules, refs];
  };
  return freeze([source.protocol, source.siteId, [w.workerId, w.employeeId, w.employeeAuthUserId, w.workerVersion, w.employeeVersion], source.at,
    [source.settingsRef.version, source.settingsRef.timeZone], g === null ? null : [g.assignmentId, g.revision, g.operationId, g.groupId, g.currentGroupRevision, g.workerId, g.employeeId, g.savedWorkerVersion, g.savedSettingsVersion, g.timeZone, g.startsOn, g.endsOn, g.fromAt, g.toAt],
    [layerTuple(source.layers.enterprise), layerTuple(source.layers.group), layerTuple(source.layers.personal)], b === null ? null : [b.operationId, b.revision, b.recordedAt, b.submissionWindowDays, b.timeZone]]);
}
function invalid(): never { throw new MerchantAttendanceError("attendance_operational_source_invalid"); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return invalid(); } }
function unicode(value: string) { if (value.includes("\0")) invalid(); for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i);
  if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(); } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid(); } }
function tree(raw: unknown) { let nodes = 0; const seen = new Set<object>(); const walk = (v: unknown, depth: number): void => {
  if (++nodes > 30000 || depth > 24) invalid(); if (v === null || typeof v === "boolean") return;
  if (typeof v === "string") { if (v.length > OPERATIONAL_RULE_SOURCE_BYTE_LIMIT) invalid(); unicode(v); return; }
  if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) invalid(); return; }
  if (typeof v !== "object" || seen.has(v)) invalid(); seen.add(v); const array = Array.isArray(v);
  if (array ? v.length > 25 || Object.getPrototypeOf(v) !== Array.prototype : Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) invalid();
  const keys = Reflect.ownKeys(v); if (array && keys.length !== v.length + 1) invalid(); for (const key of keys) {
    if (typeof key !== "string" || key.length > OPERATIONAL_RULE_SOURCE_BYTE_LIMIT) invalid(); unicode(key); if (array && key === "length") continue;
    if (["__proto__", "constructor", "prototype"].includes(key) || array && !/^(0|[1-9][0-9]*)$/.test(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(v, key)!; if (!("value" in descriptor) || !descriptor.enumerable) invalid(); walk(descriptor.value, depth + 1); }
  seen.delete(v);
  }; walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > OPERATIONAL_RULE_SOURCE_BYTE_LIMIT) invalid(); }
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : invalid();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : invalid();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : invalid();
const integer = (v: unknown, min = 1, max = MAX): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : invalid();
function instant(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) invalid();
  const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) invalid(); return v; }
function atInstant(v: unknown) { const at = instant(v); if (at < "2000-01-01T00:00:00.000000Z" || at >= "2101-01-01T00:00:00.000000Z") invalid(); return at; }
function day(v: unknown): string { if (typeof v !== "string" || v.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") invalid();
  const ms = Date.parse(v + "T00:00:00.000Z"); if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) invalid(); return v; }
const micro = (utc3: string) => utc3.slice(0, -1) + "000Z";
function expectedContext(raw: unknown): OperationalRuleSourceExpected { tree(raw); const r = exact(raw, ["siteId", "workerId", "employeeId", "employeeAuthUserId", "at"]);
  return { siteId: site(r.siteId), workerId: uuid(r.workerId), employeeId: uuid(r.employeeId), employeeAuthUserId: uuid(r.employeeAuthUserId), at: atInstant(r.at) }; }
function assignment(raw: unknown, identity: OperationalRuleSourceIdentity, settingsVersion: number, at: string): OperationalRuleSourceAssignment {
  const r = exact(raw, ["assignmentId", "revision", "operationId", "groupId", "currentGroupRevision", "workerId", "employeeId", "savedWorkerVersion", "savedSettingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt"]);
  const value: OperationalRuleSourceAssignment = { assignmentId: uuid(r.assignmentId), revision: integer(r.revision, 1, 2) as 1 | 2, operationId: uuid(r.operationId), groupId: uuid(r.groupId), currentGroupRevision: integer(r.currentGroupRevision), workerId: uuid(r.workerId), employeeId: uuid(r.employeeId),
    savedWorkerVersion: integer(r.savedWorkerVersion), savedSettingsVersion: integer(r.savedSettingsVersion), timeZone: attendanceTimeZone(r.timeZone as string), startsOn: day(r.startsOn), endsOn: r.endsOn === null ? null : day(r.endsOn), fromAt: instant(r.fromAt), toAt: r.toAt === null ? null : instant(r.toAt) };
  if (value.workerId !== identity.workerId || value.employeeId !== identity.employeeId || value.savedWorkerVersion > identity.workerVersion || value.savedSettingsVersion > settingsVersion
    || (value.revision === 1) !== (value.operationId === value.assignmentId) || value.revision === 2 && value.endsOn === null || (value.endsOn === null) !== (value.toAt === null)
    || value.endsOn !== null && value.endsOn < value.startsOn || value.fromAt > at || value.toAt !== null && value.toAt <= at) invalid();
  if (value.fromAt !== micro(attendanceDayUtcRange(value.startsOn, value.timeZone).startAt)
    || value.endsOn !== null && value.toAt !== micro(attendanceDayUtcRange(value.endsOn, value.timeZone).endAt)) invalid(); return value;
}
function active(refs: OperationalRuleLedgerReferences) { return refs.locations.every(x => x.active) && refs.routes.every(x => x.active)
  && (refs.subject === null || ("groupActive" in refs.subject ? refs.subject.groupActive : refs.subject.workerActive && refs.subject.employeeActive)); }
async function layer(raw: unknown, expectedScope: OperationalRuleLedgerScope, identity: OperationalRuleSourceIdentity, settingsVersion: number, currentGroupRevision: number | null, siteId: string, at: string) {
  const r = exact(raw, ["scope", "operationId", "revision", "context", "effectiveAt", "endsAt", "rulesFingerprint", "referenceFingerprint", "rules", "references"]);
  const fields = parseOperationalRuleLedgerSourceFields({ scope: r.scope, context: r.context, rules: r.rules, references: r.references });
  if (!operationalRuleLedgerEqual(fields.scope, expectedScope) || fields.context.settingsVersion > settingsVersion || !active(fields.references)) invalid();
  const subject = fields.context.subject;
  if (expectedScope.kind === "group" && (!subject || !("groupRevision" in subject) || currentGroupRevision === null || subject.groupRevision > currentGroupRevision)
    || expectedScope.kind === "personal" && (!subject || !("workerVersion" in subject) || subject.workerVersion > identity.workerVersion || subject.employeeVersion > identity.employeeVersion)) invalid();
  const effectiveAt = instant(r.effectiveAt), endsAt = r.endsAt === null ? null : instant(r.endsAt);
  if (effectiveAt > at || endsAt !== null && endsAt <= at || (expectedScope.kind === "personal") !== (endsAt !== null)) invalid();
  const rulesFingerprint = hash(r.rulesFingerprint), referenceFingerprint = hash(r.referenceFingerprint);
  if (rulesFingerprint !== await operationalRuleLedgerRulesFingerprint(fields.rules)
    || referenceFingerprint !== await operationalRuleLedgerReferenceFingerprint(siteId, fields.scope, fields.context, fields.references)) invalid();
  const value: OperationalRuleSourceLayer = { scope: fields.scope, operationId: uuid(r.operationId), revision: integer(r.revision), context: fields.context, effectiveAt, endsAt, rulesFingerprint, referenceFingerprint, rules: fields.rules, references: fields.references };
  return { value };
}
/** Strict result parsing is intentionally not an authorization check. The real
 * private caller must supply its actual locked site/worker/triple/UTC6 instant. */
export async function parseOperationalRuleSource(raw: unknown, expected: OperationalRuleSourceExpected): Promise<OperationalRuleSource> {
  try {
    tree(raw);
    // Own the validated input before any digest yields; later caller mutations
    // must not mix saved fields or fingerprints across different snapshots.
    const snapshot = structuredClone(raw), want = expectedContext(expected), r = exact(snapshot, ["protocol", "siteId", "workerIdentity", "at", "settingsRef", "groupAssignmentRef", "layers", "baselineCorrectionPolicyRef", "sourceFingerprint"]);
    if (r.protocol !== OPERATIONAL_RULE_SOURCE_PROTOCOL || site(r.siteId) !== want.siteId || atInstant(r.at) !== want.at) invalid();
    const w = exact(r.workerIdentity, ["workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion"]);
    const identity: OperationalRuleSourceIdentity = { workerId: uuid(w.workerId), employeeId: uuid(w.employeeId), employeeAuthUserId: uuid(w.employeeAuthUserId), workerVersion: integer(w.workerVersion), employeeVersion: integer(w.employeeVersion) };
    if (identity.workerId !== want.workerId || identity.employeeId !== want.employeeId || identity.employeeAuthUserId !== want.employeeAuthUserId) invalid();
    const s = exact(r.settingsRef, ["version", "timeZone"]), settingsRef = { version: integer(s.version), timeZone: attendanceTimeZone(s.timeZone as string) };
    const group = r.groupAssignmentRef === null ? null : assignment(r.groupAssignmentRef, identity, settingsRef.version, want.at), layers = exact(r.layers, ["enterprise", "group", "personal"]);
    if (layers.group !== null && !group) invalid();
    const enterprise = layers.enterprise === null ? null : await layer(layers.enterprise, { kind: "enterprise" }, identity, settingsRef.version, null, want.siteId, want.at);
    const groupLayer = layers.group === null ? null : await layer(layers.group, { kind: "group", groupId: group!.groupId }, identity, settingsRef.version, group!.currentGroupRevision, want.siteId, want.at);
    const personal = layers.personal === null ? null : await layer(layers.personal, { kind: "personal", workerId: identity.workerId, employeeId: identity.employeeId, employeeAuthUserId: identity.employeeAuthUserId }, identity, settingsRef.version, null, want.siteId, want.at);
    const operations = [enterprise, groupLayer, personal].flatMap(x => x ? [x.value.operationId] : []); if (new Set(operations).size !== operations.length) invalid();
    let baseline: OperationalRuleSourceBaseline | null = null;
    if (r.baselineCorrectionPolicyRef !== null) { const b = exact(r.baselineCorrectionPolicyRef, ["operationId", "revision", "recordedAt", "submissionWindowDays", "timeZone"]);
      baseline = { operationId: uuid(b.operationId), revision: integer(b.revision), recordedAt: instant(b.recordedAt), submissionWindowDays: integer(b.submissionWindowDays, 0, 365), timeZone: attendanceTimeZone(b.timeZone as string) }; if (baseline.recordedAt > want.at) invalid(); }
    const value: OperationalRuleSource = { protocol: OPERATIONAL_RULE_SOURCE_PROTOCOL, siteId: want.siteId, workerIdentity: identity, at: want.at, settingsRef, groupAssignmentRef: group,
      layers: { enterprise: enterprise?.value ?? null, group: groupLayer?.value ?? null, personal: personal?.value ?? null }, baselineCorrectionPolicyRef: baseline, sourceFingerprint: hash(r.sourceFingerprint) };
    const tuple = operationalRuleSourceTuple(value);
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerEncode(tuple))), fingerprint = [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
    if (hash(r.sourceFingerprint) !== fingerprint) invalid();
    return freeze(value);
  } catch { return invalid(); }
}
export async function parseOperationalRuleSourceJson(text: string, expected: OperationalRuleSourceExpected): Promise<OperationalRuleSource> {
  try { if (typeof text !== "string" || text.length > OPERATIONAL_RULE_SOURCE_BYTE_LIMIT || new TextEncoder().encode(text).byteLength > OPERATIONAL_RULE_SOURCE_BYTE_LIMIT) invalid(); unicode(text);
    return await parseOperationalRuleSource(parseCaptureBrowserJson(text), expected); } catch { return invalid(); }
}
/** The null enterprise adapter is input to the PURE resolver only. Its
 * providedLayers/trace describe these supplied inputs, not verified publication
 * completeness. The returned source preserves every actual null and saved ref.
 * Deadline timezone/anchor and real grants remain future consumer obligations. */
export async function resolveOperationalRuleSource(raw: unknown, expected: OperationalRuleSourceExpected): Promise<OperationalRuleSourceProjection> {
  const source = await parseOperationalRuleSource(raw, expected);
  const enterprise = source.layers.enterprise?.rules ?? parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, { mode: "inherit" }])));
  const candidate = resolveOperationalRules({ enterprise, group: source.layers.group?.rules ?? null, personal: source.layers.personal?.rules ?? null,
    baselineCorrectionWindowDays: source.baselineCorrectionPolicyRef?.submissionWindowDays ?? null });
  return freeze({ source, candidate });
}
