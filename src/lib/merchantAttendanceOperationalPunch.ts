// 242: strict wire evidence. Parsing is not authentication or authorization.
// Credentials/GPS are separate transports and never part of the durable command.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parseAttendanceSelfCommand, parseAttendanceSelfResult, type AttendanceSelfCommand, type AttendanceSelfResult } from "./merchantAttendanceSelf";
import { parseAttendanceLocationClockIntent, parseAttendanceLocationClockResult, type AttendanceLocationClockIntent, type AttendanceLocationClockResult } from "./merchantAttendanceLocationClock";
import { parsePinClockRequest, parsePinClockResult, type PinClockCommand, type PinClockResult } from "./merchantAttendancePinClock";
import { parseOnsiteClockResult, type OnsiteCommand, type OnsiteClockResult } from "./merchantAttendanceOnsiteQr";
import { parseSelfScheduleResult, type SelfScheduleResult, type SelfScheduleAssociation, type SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import type { LocationScheduleAdoption } from "./merchantAttendanceLocationSchedule";
import { OPERATIONAL_RULE_KEYS, OPERATIONAL_RULE_CHANNELS, parseOperationalRules, resolveOperationalRules, type OperationalRules, type OperationalRuleChannel, type OperationalRuleLayer, type OperationalRulesPreview } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerEncode, operationalRuleLedgerEqual as equal, operationalRuleLedgerFreeze as freeze, parseOperationalRuleLedgerSourceFields } from "./merchantAttendanceOperationalRuleLedger";
import { resolveOperationalRuleSource, type OperationalRuleSource, type OperationalRuleSourceIdentity, type OperationalRuleSourceLayer } from "./merchantAttendanceOperationalRuleSource";

export const OPERATIONAL_PUNCH_PROTOCOL = "attendance-operational-punch-v1" as const;
export const OPERATIONAL_PUNCH_BODY_LIMIT = 4096;
export const OPERATIONAL_PUNCH_RESPONSE_LIMIT = 262144;
export const OPERATIONAL_PUNCH_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_operational_punch_invalid: 503, attendance_operational_punch_changed: 409,
  attendance_operational_punch_protocol_required: 409, attendance_operational_punch_disabled: 403,
  attendance_operational_punch_channel_denied: 403, attendance_operational_punch_location_denied: 403,
  attendance_operational_punch_break_type_denied: 409, attendance_operational_punch_too_large: 422,
  attendance_operational_punch_not_found: 404, attendance_operational_punch_unchanged: 409,
});
export type OperationalPunchChannel = OperationalRuleChannel;
export type OperationalPunchQuery = Readonly<{ mode: "prepare" } | { mode: "recover"; operationId: string }>;
export type OperationalPunchChoice = Readonly<
  { kind: "start"; expectedPolicyFingerprint: string; selection: SelfScheduleSelection | null } |
  { kind: "break"; startEventId: string; expectedSessionFingerprint: string; breakType: "paid" | "unpaid" | null } |
  { kind: "legacy_break" | "finish" }>;
type Commands = { self: AttendanceSelfCommand; location: AttendanceLocationClockIntent; pin: PinClockCommand; onsite: OnsiteCommand };
type Clocks = { self: AttendanceSelfResult; location: AttendanceLocationClockResult; pin: PinClockResult; onsite: OnsiteClockResult };
export type OperationalPunchCommand<C extends OperationalPunchChannel = OperationalPunchChannel> = Readonly<{ clock: Commands[C]; choice: OperationalPunchChoice }>;
export type OperationalPunchFields = Pick<OperationalRulesPreview["fields"], "allowedChannels" | "locationScope" | "shiftSource" | "breakTypes">;
export type OperationalPunchOrigin = Readonly<{ layer: OperationalRuleLayer; operationId: string; revision: number; effectiveAt: string; endsAt: string | null; rulesFingerprint: string; referenceFingerprint: string }>;
export type OperationalPunchLegacy = Readonly<{ settingsVersion: number; webBreakPaid: boolean; scheduleEnabled: boolean }>;
export type OperationalPunchPolicy = Readonly<{ checkedAt: string; policyFingerprint: string; sourceFingerprint: string;
  workerIdentity: OperationalRuleSourceIdentity; locationId: string; locationVersion: number; activationRevision: number;
  fields: OperationalPunchFields; origins: readonly OperationalPunchOrigin[]; legacy: OperationalPunchLegacy }>;
export type OperationalPunchSession = Readonly<{ startEventId: string; operationId: string; startSequence: number; occurredAt: string;
  workerId: string; employeeId: string; employeeAuthUserId: string; actorAuthUserId: string | null; channel: OperationalPunchChannel;
  locationId: string; locationVersion: number; activationRevision: number; sourceFingerprint: string; policyFingerprint: string; sessionFingerprint: string;
  fields: OperationalPunchFields; origins: readonly OperationalPunchOrigin[]; legacy: OperationalPunchLegacy; selection: SelfScheduleSelection | null }>;
export type OperationalPunchOperation = Readonly<{ operationId: string; eventId: string; action: AttendanceSelfCommand["action"]; channel: OperationalPunchChannel;
  workerId: string; employeeId: string; employeeAuthUserId: string; actorAuthUserId: string | null; startEventId: string; sequence: number;
  recordedAt: string; commandFingerprint: string; sessionFingerprint: string | null; sourceFingerprint: string | null; breakPaid: boolean | null }>;
export type OperationalPunchAdoption = Omit<LocationScheduleAdoption, "channel"> & { channel: OperationalPunchChannel };
type ResultCommon = { protocol: typeof OPERATIONAL_PUNCH_PROTOCOL; siteId: string; readAt: string; policy: OperationalPunchPolicy | null;
  session: OperationalPunchSession | null; choices: SelfScheduleResult["choices"] | null; association: SelfScheduleAssociation | null;
  adoption: OperationalPunchAdoption | null; operation: OperationalPunchOperation | null; replayed: boolean; canStart: boolean; canBreak: boolean; canFinish: boolean };
export type OperationalPunchResult<C extends OperationalPunchChannel = OperationalPunchChannel> = {
  [K in C]: Readonly<ResultCommon & { channel: K; clock: Clocks[K] }>
}[C];
type InputCommon = { siteId: string; query: OperationalPunchQuery; command: OperationalPunchCommand | null; write: boolean };
export type OperationalPunchParseInput = InputCommon & (
  { channel: "self"; authUserId: string } | { channel: "onsite"; authUserId: string } |
  { channel: "location"; authUserId: string; expectedWorkerId: string } |
  { channel: "pin"; authUserId: null; terminalId: string; workerNo: string; expectedWorkerId: string | null; expectedEmployeeId: string | null });
type Tuple = string | number | boolean | null | readonly Tuple[];
const FOUR = ["allowedChannels", "locationScope", "shiftSource", "breakTypes"] as const;
const LAYERS = ["enterprise", "group", "personal"] as const;
const BASE_CLOCK = ["workerId", "locationId", "state", "receipt", "replayed"];
const EVENT = ["id", "siteId", "workerId", "locationId", "operationId", "action", "breakPaid", "sequence", "occurredAt", "timeZone"];
const VERSIONS = ["settingsVersion", "workerVersion", "locationVersion"];
const LOCATION_CLOCK = [...BASE_CLOCK, "siteId", "employeeId", "channelEnabled", "policy", "locationResult", "noticeGate", "finish", "receiptGate"];
function fail(code = "attendance_operational_punch_invalid"): never { throw new MerchantAttendanceError(code); }
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[a-f0-9]{64}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 1): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= 9007199254740990 ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const channelValue = (v: unknown): OperationalPunchChannel => OPERATIONAL_RULE_CHANNELS.includes(v as OperationalPunchChannel) ? v as OperationalPunchChannel : fail();
function stamp(v: unknown, precision: 3 | 6 = 6): string {
  if (typeof v !== "string" || v.length !== (precision === 6 ? 27 : 24) || !(precision === 6 ? /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/ : /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(v)) fail();
  const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v;
}
function unicode(v: string) { if (v.includes("\0")) fail(); for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i);
  if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (n >= 0xdc00 && n <= 0xdfff) fail(); } }
function tree(raw: unknown, limit = OPERATIONAL_PUNCH_RESPONSE_LIMIT) {
  let nodes = 0; const ancestors = new Set<object>(); const visit = (v: unknown, depth: number): void => {
    if (++nodes > 30000 || depth > 26) fail(); if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > limit) fail(); unicode(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || ancestors.has(v)) fail(); ancestors.add(v);
    const array = Array.isArray(v), keys = Reflect.ownKeys(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype || v.length > 100 || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) fail();
    for (const k of keys) { if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)) fail(); unicode(k);
      if (array && k === "length") continue; if (array && !/^(0|[1-9][0-9]*)$/.test(k)) fail();
      const d = Object.getOwnPropertyDescriptor(v, k)!; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    ancestors.delete(v);
  }; visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail();
}
export function parseOperationalPunchJson(text: string, purpose: "request" | "response" = "response"): unknown {
  try { const limit = purpose === "request" ? OPERATIONAL_PUNCH_BODY_LIMIT : OPERATIONAL_PUNCH_RESPONSE_LIMIT;
    if (!["request", "response"].includes(purpose) || typeof text !== "string" || text.length > limit || new TextEncoder().encode(text).byteLength > limit) fail();
    unicode(text); const raw = parseCaptureBrowserJson(text); tree(raw, limit); return raw;
  } catch { return fail(purpose === "request" ? "attendance_invalid_request" : undefined); }
}
export function parseOperationalPunchQuery(raw: unknown): OperationalPunchQuery {
  try { tree(raw, OPERATIONAL_PUNCH_BODY_LIMIT); const r = exact(raw, (raw as { mode?: unknown })?.mode === "prepare" ? ["mode"] : ["mode", "operationId"]);
    if (r.mode === "prepare") return freeze({ mode: "prepare" }); if (r.mode !== "recover") fail(); return freeze({ mode: "recover", operationId: uuid(r.operationId) });
  } catch { return fail("attendance_invalid_request"); }
}
function selection(raw: unknown): SelfScheduleSelection | null { if (raw === null) return null; const r = exact(raw, ["slotId", "revision"]); return { slotId: uuid(r.slotId), revision: integer(r.revision) }; }
export function parseOperationalPunchCommand<C extends OperationalPunchChannel>(raw: unknown, channel: C, siteId: string): OperationalPunchCommand<C> {
  try { tree(raw, OPERATIONAL_PUNCH_BODY_LIMIT); channelValue(channel); site(siteId); const r = exact(raw, ["clock", "choice"]);
    let clock: Commands[OperationalPunchChannel];
    if (channel === "location") clock = parseAttendanceLocationClockIntent(r.clock, siteId);
    else if (channel === "pin" || channel === "onsite") clock = parsePinClockRequest({ command: r.clock, operationId: null }).command!;
    else { const c = exact(r.clock, ["expectedWorkerId", "operationId", "locationId", "action", "expectedSequence"]); clock = parseAttendanceSelfCommand({ siteId, ...c }).command; }
    uuid(clock.expectedWorkerId); uuid(clock.operationId); uuid(clock.locationId); integer(clock.expectedSequence, 0);
    if ("expectedEmployeeId" in clock) uuid(clock.expectedEmployeeId);
    const k = (r.choice as { kind?: unknown })?.kind; let choice: OperationalPunchChoice;
    if (k === "start") { const c = exact(r.choice, ["kind", "expectedPolicyFingerprint", "selection"]); if (clock.action !== "clock_in") fail(); choice = { kind: k, expectedPolicyFingerprint: hash(c.expectedPolicyFingerprint), selection: selection(c.selection) }; }
    else if (k === "break") { const c = exact(r.choice, ["kind", "startEventId", "expectedSessionFingerprint", "breakType"]); if (clock.action !== "break_start" || ![null, "paid", "unpaid"].includes(c.breakType as null)) fail();
      choice = { kind: k, startEventId: uuid(c.startEventId), expectedSessionFingerprint: hash(c.expectedSessionFingerprint), breakType: c.breakType as "paid" | "unpaid" | null }; }
    else { exact(r.choice, ["kind"]); if (k !== "legacy_break" && k !== "finish" || k === "legacy_break" && clock.action !== "break_start" || k === "finish" && !["break_end", "clock_out"].includes(clock.action)) fail(); choice = { kind: k }; }
    return freeze({ clock, choice }) as OperationalPunchCommand<C>;
  } catch { return fail("attendance_invalid_request"); }
}
function identity(raw: unknown): OperationalRuleSourceIdentity { const r = exact(raw, ["workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion"]);
  return { workerId: uuid(r.workerId), employeeId: uuid(r.employeeId), employeeAuthUserId: uuid(r.employeeAuthUserId), workerVersion: integer(r.workerVersion), employeeVersion: integer(r.employeeVersion) }; }
function legacy(raw: unknown): OperationalPunchLegacy { const r = exact(raw, ["settingsVersion", "webBreakPaid", "scheduleEnabled"]); return { settingsVersion: integer(r.settingsVersion), webBreakPaid: bool(r.webBreakPaid), scheduleEnabled: bool(r.scheduleEnabled) }; }
const inherited = (): OperationalRules => parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, { mode: "inherit" }])));
function fields(raw: unknown): OperationalPunchFields {
  const r = exact(raw, FOUR), documents = new Map<OperationalRuleLayer, Record<string, unknown>>(); let order: string[] | null = null;
  for (const key of FOUR) { const f = exact(r[key], ["state", "value", "sources", "trace"]); if (!Array.isArray(f.trace) || !f.trace.length || f.trace.length > 3) fail();
    const traceOrder: string[] = []; let previous = 3;
    for (const rawTrace of f.trace) { const t = exact(rawTrace, ["layer", "choice"]), index = LAYERS.indexOf(t.layer as OperationalRuleLayer); if (index < 0 || index >= previous) fail(); previous = index;
      const layer = LAYERS[index]; traceOrder.push(layer); const doc = documents.get(layer) ?? { ...inherited() }; doc[key] = t.choice; documents.set(layer, doc); }
    if (previous !== 0 || order !== null && !equal(traceOrder, order)) fail(); order = traceOrder;
  }
  const resolved = resolveOperationalRules({ enterprise: documents.get("enterprise"), group: documents.get("group") ?? null, personal: documents.get("personal") ?? null, baselineCorrectionWindowDays: null });
  const expected = Object.fromEntries(FOUR.map(k => [k, resolved.fields[k]])) as OperationalPunchFields;
  if (!equal(expected, r)) fail(); return expected;
}
function origins(raw: unknown): OperationalPunchOrigin[] { if (!Array.isArray(raw) || raw.length > 3) fail(); let previous = -1; const ids = new Set<string>();
  return raw.map(v => { const r = exact(v, ["layer", "operationId", "revision", "effectiveAt", "endsAt", "rulesFingerprint", "referenceFingerprint"]), index = LAYERS.indexOf(r.layer as OperationalRuleLayer);
    if (index <= previous) fail(); previous = index; const op = uuid(r.operationId); if (ids.has(op)) fail(); ids.add(op);
    const effectiveAt = stamp(r.effectiveAt), endsAt = r.endsAt === null ? null : stamp(r.endsAt);
    if ((r.layer === "personal") !== (endsAt !== null) || endsAt !== null && endsAt <= effectiveAt) fail();
    return { layer: LAYERS[index], operationId: op, revision: integer(r.revision), effectiveAt, endsAt, rulesFingerprint: hash(r.rulesFingerprint), referenceFingerprint: hash(r.referenceFingerprint) }; }); }
function policy(raw: unknown): OperationalPunchPolicy { const r = exact(raw, ["checkedAt", "policyFingerprint", "sourceFingerprint", "workerIdentity", "locationId", "locationVersion", "activationRevision", "fields", "origins", "legacy"]);
  return { checkedAt: stamp(r.checkedAt), policyFingerprint: hash(r.policyFingerprint), sourceFingerprint: hash(r.sourceFingerprint), workerIdentity: identity(r.workerIdentity), locationId: uuid(r.locationId), locationVersion: integer(r.locationVersion), activationRevision: integer(r.activationRevision), fields: fields(r.fields), origins: origins(r.origins), legacy: legacy(r.legacy) }; }
function session(raw: unknown): OperationalPunchSession { const r = exact(raw, ["startEventId", "operationId", "startSequence", "occurredAt", "workerId", "employeeId", "employeeAuthUserId", "actorAuthUserId", "channel", "locationId", "locationVersion", "activationRevision", "sourceFingerprint", "policyFingerprint", "sessionFingerprint", "fields", "origins", "legacy", "selection"]);
  const c = channelValue(r.channel), actor = r.actorAuthUserId === null ? null : uuid(r.actorAuthUserId), auth = uuid(r.employeeAuthUserId); if (c === "pin" ? actor !== null : actor !== auth) fail();
  return { startEventId: uuid(r.startEventId), operationId: uuid(r.operationId), startSequence: integer(r.startSequence), occurredAt: stamp(r.occurredAt), workerId: uuid(r.workerId), employeeId: uuid(r.employeeId), employeeAuthUserId: auth, actorAuthUserId: actor, channel: c,
    locationId: uuid(r.locationId), locationVersion: integer(r.locationVersion), activationRevision: integer(r.activationRevision), sourceFingerprint: hash(r.sourceFingerprint), policyFingerprint: hash(r.policyFingerprint), sessionFingerprint: hash(r.sessionFingerprint), fields: fields(r.fields), origins: origins(r.origins), legacy: legacy(r.legacy), selection: selection(r.selection) }; }
const selectionTuple = (s: SelfScheduleSelection | null): Tuple => s ? [s.slotId, s.revision] : null;
const legacyTuple = (l: OperationalPunchLegacy): Tuple => [l.settingsVersion, l.webBreakPaid, l.scheduleEnabled];
const originTuple = (o: OperationalPunchOrigin): Tuple => [o.layer, o.operationId, o.revision, o.effectiveAt, o.endsAt, o.rulesFingerprint, o.referenceFingerprint];
function fieldsTuple(f: OperationalPunchFields): Tuple { return FOUR.map(k => { const field = f[k]; const value = (v: unknown): Tuple => k === "breakTypes" && v !== null ? [(v as { allowed: readonly string[] }).allowed, (v as { selection: string }).selection] : v as Tuple;
  return [field.state, value(field.value), field.sources, field.trace.map(t => [t.layer, t.choice.mode === "value" ? ["value", value(t.choice.value)] : [t.choice.mode]])]; }); }
async function digest(tuple: Tuple): Promise<string> { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerEncode(tuple))); return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join(""); }
export async function operationalPunchSessionFingerprint(siteId: string, raw: OperationalPunchSession): Promise<string> { tree(raw); const s = session(raw); return digest(["attendance-operational-punch-session-v1", site(siteId), [s.workerId, s.employeeId, s.employeeAuthUserId], s.actorAuthUserId,
  s.startEventId, s.operationId, s.startSequence, s.occurredAt, s.channel, s.locationId, s.locationVersion, s.activationRevision, s.sourceFingerprint, s.policyFingerprint, fieldsTuple(s.fields), s.origins.map(originTuple), legacyTuple(s.legacy), selectionTuple(s.selection)]); }
export async function operationalPunchCommandFingerprint(siteId: string, channel: OperationalPunchChannel, actorAuthUserId: string | null,
  target: Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string }>, raw: OperationalPunchCommand): Promise<string> {
  tree(target); exact(target, ["workerId", "employeeId", "employeeAuthUserId"]); const c = parseOperationalPunchCommand(raw, channel, siteId), x = c.clock;
  const triple = [uuid(target.workerId), uuid(target.employeeId), uuid(target.employeeAuthUserId)]; if (x.expectedWorkerId !== triple[0] || "expectedEmployeeId" in x && x.expectedEmployeeId !== triple[1]) fail();
  const actor = actorAuthUserId === null ? null : uuid(actorAuthUserId); if (channel === "pin" ? actor !== null : actor !== triple[2]) fail();
  let clock: Tuple = [x.expectedWorkerId, x.operationId, x.locationId, x.action, x.expectedSequence];
  if (channel === "pin" || channel === "onsite") clock = [x.expectedWorkerId, (x as PinClockCommand).expectedEmployeeId, x.operationId, x.locationId, x.action, x.expectedSequence];
  if (channel === "location") { const l = x as AttendanceLocationClockIntent; clock = [...clock, l.settingsVersion, l.workerVersion, l.locationVersion, l.noticeRevision, l.safeFinish]; }
  const choice = c.choice; return digest(["attendance-operational-punch-command-v1", siteId, channel, actor, triple, clock,
    choice.kind === "start" ? ["start", choice.expectedPolicyFingerprint, selectionTuple(choice.selection)] : choice.kind === "break" ? ["break", choice.startEventId, choice.expectedSessionFingerprint, choice.breakType] : [choice.kind]]);
}
function sourceLayerTuple(l: OperationalRuleSourceLayer | null): Tuple { if (!l) return null; const f = parseOperationalRuleLedgerSourceFields({ scope: l.scope, context: l.context, rules: l.rules, references: l.references });
  return [f.tuples[0], l.operationId, l.revision, f.tuples[1], l.effectiveAt, l.endsAt, l.rulesFingerprint, l.referenceFingerprint, f.tuples[2], f.tuples[3]]; }
export async function operationalPunchPolicyFingerprint(siteId: string, channel: OperationalPunchChannel, raw: OperationalPunchPolicy, rawSource: OperationalRuleSource): Promise<string> {
  tree(raw); tree(rawSource); const p = policy(raw), snapshot = structuredClone(rawSource);
  const { source: s } = await resolveOperationalRuleSource(snapshot, { siteId: site(siteId), ...Object.fromEntries(["workerId", "employeeId", "employeeAuthUserId"].map(k => [k, p.workerIdentity[k as keyof OperationalRuleSourceIdentity]])) as { workerId: string; employeeId: string; employeeAuthUserId: string }, at: p.checkedAt });
  if (!equal(s.workerIdentity, p.workerIdentity) || p.legacy.settingsVersion !== s.settingsRef.version || p.sourceFingerprint !== s.sourceFingerprint) fail();
  const w = s.workerIdentity, t = s.settingsRef, g = s.groupAssignmentRef, b = s.baselineCorrectionPolicyRef;
  return digest(["attendance-operational-punch-policy-v1", siteId, channelValue(channel), p.locationId, p.locationVersion, p.activationRevision,
    [w.workerId, w.employeeId, w.employeeAuthUserId, w.workerVersion, w.employeeVersion], [t.version, t.timeZone],
    g ? [g.assignmentId, g.revision, g.operationId, g.groupId, g.currentGroupRevision, g.workerId, g.employeeId, g.savedWorkerVersion, g.savedSettingsVersion, g.timeZone, g.startsOn, g.endsOn, g.fromAt, g.toAt] : null,
    LAYERS.map(k => sourceLayerTuple(s.layers[k])), b ? [b.operationId, b.revision, b.recordedAt, b.submissionWindowDays, b.timeZone] : null, legacyTuple(p.legacy)]);
}
function inputData(raw: OperationalPunchParseInput): OperationalPunchParseInput {
  tree(raw, OPERATIONAL_PUNCH_BODY_LIMIT * 2); const c = channelValue((raw as { channel?: unknown })?.channel);
  const r = exact(raw, ["siteId", "channel", "query", "command", "write", "authUserId", ...(c === "location" ? ["expectedWorkerId"] : c === "pin" ? ["terminalId", "workerNo", "expectedWorkerId", "expectedEmployeeId"] : [])]);
  const siteId = site(r.siteId), query = parseOperationalPunchQuery(r.query), command = r.command === null ? null : parseOperationalPunchCommand(r.command, c, siteId), write = bool(r.write);
  if (write && !command || command && (query.mode !== "recover" || query.operationId !== command.clock.operationId)) fail();
  if (c === "pin") { if (r.authUserId !== null || typeof r.workerNo !== "string" || !r.workerNo.length || r.workerNo.length > 64) fail();
    if ((r.expectedWorkerId === null) !== (r.expectedEmployeeId === null) || r.expectedWorkerId === null && (query.mode !== "prepare" || command !== null)) fail();
    return { siteId, channel: c, query, command, write, authUserId: null, terminalId: uuid(r.terminalId), workerNo: r.workerNo,
      expectedWorkerId: r.expectedWorkerId === null ? null : uuid(r.expectedWorkerId), expectedEmployeeId: r.expectedEmployeeId === null ? null : uuid(r.expectedEmployeeId) }; }
  const common = { siteId, channel: c, query, command, write, authUserId: uuid(r.authUserId) };
  return c === "location" ? { ...common, channel: c, expectedWorkerId: uuid(r.expectedWorkerId) } : { ...common, channel: c };
}
function clockData(raw: unknown, input: OperationalPunchParseInput, serverRaw: boolean): Clocks[OperationalPunchChannel] {
  let keys = BASE_CLOCK;
  if (input.channel === "onsite") keys = [...BASE_CLOCK, "employeeId"];
  if (input.channel === "pin") keys = [...BASE_CLOCK, "siteId", "terminalId", "workerNo", "workerName", "employeeId", "canStart", "canFinish", "blockReason"];
  const hasPrivate = input.channel === "location" && serverRaw && !!raw && typeof raw === "object" && (Object.hasOwn(raw, "internalFence") || Object.hasOwn(raw, "internalPolicyFingerprint"));
  if (input.channel === "location") keys = hasPrivate ? [...LOCATION_CLOCK, "internalFence", "internalPolicyFingerprint"] : LOCATION_CLOCK;
  const c = exact(raw, keys), state = exact(c.state, ["sequence", "status", "lastEvent", ...(c.state && typeof c.state === "object" && Object.hasOwn(c.state, "administrativeBoundary") ? ["administrativeBoundary"] : [])]); integer(state.sequence, 0);
  for (const e of [state.lastEvent, c.receipt]) if (e !== null) { const v = exact(e, EVENT); stamp(v.occurredAt, 3); integer(v.sequence); uuid(v.id); uuid(v.workerId); uuid(v.locationId); uuid(v.operationId); }
  const command = input.write ? input.command!.clock : null, operationId = input.write ? null : input.query.mode === "recover" ? input.query.operationId : null;
  const expected = { siteId: input.siteId, command, operationId };
  if (input.channel === "self") return parseAttendanceSelfResult(c, expected);
  if (input.channel === "onsite") return parseOnsiteClockResult(c, { ...expected, command: command as OnsiteCommand | null });
  if (input.channel === "pin") { const clock = parsePinClockResult(c, { ...expected, terminalId: input.terminalId, workerNo: input.workerNo, command: command as PinClockCommand | null });
    if (input.expectedWorkerId !== null && clock.workerId !== input.expectedWorkerId || input.expectedEmployeeId !== null && clock.employeeId !== input.expectedEmployeeId) fail(); return clock; }
  if (c.policy !== null) { const p = exact(c.policy, [...VERSIONS, "mode", "maxAgeMs", "algorithmVersion"]); VERSIONS.forEach(k => integer(p[k])); }
  if (c.locationResult !== null) { const r = exact(c.locationResult, ["eventId", ...VERSIONS, "algorithmVersion", "reason", "needsReview", "capturedAt", "accuracyMeters", "distanceMeters",
    ...(Object.hasOwn(c.locationResult as object, "disposal") ? ["disposal"] : [])]); VERSIONS.forEach(k => integer(r[k])); if (r.capturedAt !== null) stamp(r.capturedAt, 3); }
  exact(c.noticeGate, ["ready", "reason", "revision"]);
  if (c.finish !== null) exact(c.finish, ["locationId", ...VERSIONS]);
  if (hasPrivate) {
    if (c.internalPolicyFingerprint !== null && (typeof c.internalPolicyFingerprint !== "string" || !/^[a-f0-9]{32}$/.test(c.internalPolicyFingerprint))) fail();
    if (c.internalFence !== null) { const f = exact(c.internalFence, ["latitude", "longitude", "radiusMeters", "maxAgeMs"]);
      if (typeof f.latitude !== "number" || Math.abs(f.latitude) > 90 || typeof f.longitude !== "number" || Math.abs(f.longitude) > 180
        || typeof f.radiusMeters !== "number" || f.radiusMeters < 1 || f.radiusMeters > 100000 || f.maxAgeMs !== 60000) fail(); }
  }
  return parseAttendanceLocationClockResult(Object.fromEntries(LOCATION_CLOCK.map(k => [k, c[k]])), { ...expected, expectedWorkerId: input.expectedWorkerId, command: command as AttendanceLocationClockIntent | null });
}
function associationData(raw: unknown, clock: AttendanceSelfResult, input: OperationalPunchParseInput): SelfScheduleAssociation | null {
  if (raw === null) return null;
  // The old receipt grammar validates the same five real clock fields. This
  // bounded validator-only revision is not a candidate list or new authority.
  const r = exact(raw, ["startEventId", "operationId", "selection", "status", "reason", "slot", "observedRevision", "recordedAt", "currentCancelled"]);
  const revision = integer(r.observedRevision, 0); stamp(r.recordedAt);
  const common = { workerId: clock.workerId, locationId: clock.locationId, state: clock.state, receipt: clock.receipt, replayed: false };
  const selected = input.command?.choice.kind === "start" ? input.command.choice.selection : undefined;
  return parseSelfScheduleResult({ protocol: "self-schedule-v1", clock: common,
    choices: { timeZone: null, fromDate: null, throughDate: null, revision, limited: false, entries: [] }, association: raw },
  { siteId: input.siteId, command: null, operationId: clock.receipt?.operationId ?? null, ...(selected === undefined ? {} : { selection: selected }) }).association;
}
function adoptionData(raw: unknown, association: SelfScheduleAssociation | null, operation: OperationalPunchOperation | null): OperationalPunchAdoption | null {
  if (raw === null) return null; const a = exact(raw, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
  if (!association || !operation || operation.action !== "clock_in" || a.startEventId !== operation.eventId || a.operationId !== operation.operationId
    || a.channel !== operation.channel || a.employeeId !== operation.employeeId || a.employeeAuthUserId !== operation.employeeAuthUserId || a.recordedAt !== association.recordedAt || a.policy !== "explicit-plan-approval-at-clock-in-v1") fail();
  let approval: LocationScheduleAdoption["approval"] = null;
  if (a.approval !== null) { const p = exact(a.approval, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]); approval = { operationId: uuid(p.operationId), revision: integer(p.revision), sourceId: uuid(p.sourceId), sourceSha256: hash(p.sourceSha256), recordedAt: stamp(p.recordedAt) }; }
  if (a.status === "adopted") { if (association.status !== "linked" || a.reason !== null || !approval) fail(); }
  else if (a.status === "not_approved") { if (association.status !== "linked" || a.reason !== "approval_missing" || approval) fail(); }
  else if (a.status === "unselected") { if (association.status !== "unselected" || a.reason !== null || approval) fail(); }
  else if (a.status === "unverified") { if (association.status !== "unverified" || a.reason !== association.reason || approval) fail(); }
  else fail();
  return { startEventId: operation.eventId, operationId: operation.operationId, channel: operation.channel, employeeId: operation.employeeId, employeeAuthUserId: operation.employeeAuthUserId,
    status: a.status, reason: a.reason as OperationalPunchAdoption["reason"], approval, recordedAt: stamp(a.recordedAt), policy: "explicit-plan-approval-at-clock-in-v1" };
}
function operationData(raw: unknown, clock: AttendanceSelfResult, input: OperationalPunchParseInput): OperationalPunchOperation | null {
  if (raw === null) return null; const r = exact(raw, ["operationId", "eventId", "action", "channel", "workerId", "employeeId", "employeeAuthUserId", "actorAuthUserId", "startEventId", "sequence", "recordedAt", "commandFingerprint", "sessionFingerprint", "sourceFingerprint", "breakPaid"]);
  const receipt = clock.receipt; if (!receipt || input.query.mode !== "recover" || r.operationId !== input.query.operationId || r.operationId !== receipt.operationId || r.eventId !== receipt.id
    || r.action !== receipt.action || r.channel !== input.channel || r.workerId !== receipt.workerId || r.sequence !== receipt.sequence || r.breakPaid !== receipt.breakPaid) fail();
  const auth = uuid(r.employeeAuthUserId), actor = r.actorAuthUserId === null ? null : uuid(r.actorAuthUserId);
  if (input.channel === "pin" ? actor !== null : actor !== input.authUserId || auth !== input.authUserId) fail();
  if (input.channel !== "self" && r.employeeId !== (clock as OnsiteClockResult).employeeId) fail();
  const sessionHash = r.sessionFingerprint === null ? null : hash(r.sessionFingerprint), sourceHash = r.sourceFingerprint === null ? null : hash(r.sourceFingerprint);
  if ((sessionHash === null) !== (sourceHash === null) || receipt.action === "clock_in" && (r.startEventId !== receipt.id || sessionHash === null)) fail();
  return { operationId: uuid(r.operationId), eventId: uuid(r.eventId), action: receipt.action, channel: input.channel, workerId: uuid(r.workerId), employeeId: uuid(r.employeeId), employeeAuthUserId: auth,
    actorAuthUserId: actor, startEventId: uuid(r.startEventId), sequence: integer(r.sequence), recordedAt: stamp(r.recordedAt), commandFingerprint: hash(r.commandFingerprint), sessionFingerprint: sessionHash, sourceFingerprint: sourceHash,
    breakPaid: r.breakPaid === null ? null : bool(r.breakPaid) };
}
async function resultData(raw: unknown, input: OperationalPunchParseInput, serverRaw: boolean): Promise<OperationalPunchResult> {
  const r = exact(raw, ["protocol", "channel", "siteId", "readAt", "clock", "policy", "session", "choices", "association", "adoption", "operation", "replayed", "canStart", "canBreak", "canFinish"]);
  if (r.protocol !== OPERATIONAL_PUNCH_PROTOCOL || r.channel !== input.channel || r.siteId !== input.siteId) fail();
  const readAt = stamp(r.readAt), clock = clockData(r.clock, input, serverRaw), p = r.policy === null ? null : policy(r.policy), s = r.session === null ? null : session(r.session);
  const boundary = clock.state.administrativeBoundary;
  if (boundary && (boundary.recordedAt > readAt || (input.channel === "pin" ? input.expectedEmployeeId !== null && boundary.employeeId !== input.expectedEmployeeId : boundary.employeeAuthUserId !== input.authUserId)
    || input.channel !== "self" && boundary.employeeId !== (clock as OnsiteClockResult).employeeId)) fail();
  if (input.channel === "location" && (clock as AttendanceLocationClockResult).locationResult?.disposal
    && (clock as AttendanceLocationClockResult).locationResult!.disposal!.disposedAt > readAt) fail();
  const operation = operationData(r.operation, clock, input), replayed = bool(r.replayed), canStart = bool(r.canStart), canBreak = bool(r.canBreak), canFinish = bool(r.canFinish);
  if (replayed !== clock.replayed || !input.write && replayed) fail();
  if (p && (p.workerIdentity.workerId !== clock.workerId || p.locationId !== clock.locationId || p.checkedAt > readAt || clock.state.status !== "off" || s !== null)) fail();
  if (p && (input.channel === "pin" ? input.expectedEmployeeId !== null && p.workerIdentity.employeeId !== input.expectedEmployeeId : p.workerIdentity.employeeAuthUserId !== input.authUserId)) fail();
  if (p && input.channel !== "self" && p.workerIdentity.employeeId !== (clock as OnsiteClockResult).employeeId) fail();
  if (s) {
    if (s.workerId !== clock.workerId || s.startSequence > clock.state.sequence || s.occurredAt > readAt || s.occurredAt.slice(23, 26) !== "000"
      || input.channel !== "pin" && s.employeeAuthUserId !== input.authUserId || input.channel !== "self" && s.employeeId !== (clock as OnsiteClockResult).employeeId) fail();
    if (await operationalPunchSessionFingerprint(input.siteId, s) !== s.sessionFingerprint) fail();
    // A POST replay may describe its original start, although the live clock
    // has since closed or started another session. Only prepare shows it as
    // the CURRENT policy; never conflate a historical receipt with that state.
    if (input.query.mode === "prepare" && (clock.state.status === "off" || !clock.state.lastEvent || clock.state.lastEvent.locationId !== s.locationId
      || clock.state.lastEvent.sequence === s.startSequence && (clock.state.lastEvent.id !== s.startEventId || clock.state.lastEvent.operationId !== s.operationId || clock.state.lastEvent.action !== "clock_in" || stamp(clock.state.lastEvent.occurredAt, 3).slice(0, 23) + "000Z" !== s.occurredAt))) fail();
  }
  if (input.query.mode === "prepare") {
    if (operation || clock.receipt || input.command || r.association !== null || r.adoption !== null) fail();
    if (canStart && (!p || clock.state.status !== "off" || p.fields.allowedChannels.state === "value" && !p.fields.allowedChannels.value!.includes(input.channel)
      || p.fields.locationScope.state === "value" && !p.fields.locationScope.value!.includes(p.locationId))) fail();
    if (canBreak && clock.state.status !== "working" || canFinish && clock.state.status === "off") fail();
  } else {
    if (p || r.choices !== null || canStart || canBreak || canFinish) fail();
    if (!input.write && (s || r.association !== null || r.adoption !== null)) fail();
    if (input.write && !operation) fail();
  }
  if (operation && operation.recordedAt > readAt) fail();
  if (input.command && operation) {
    const commandHash = await operationalPunchCommandFingerprint(input.siteId, input.channel, operation.actorAuthUserId, { workerId: operation.workerId, employeeId: operation.employeeId, employeeAuthUserId: operation.employeeAuthUserId }, input.command);
    const choice = input.command.choice, c = input.command.clock;
    if (operation.commandFingerprint !== commandHash || operation.action !== c.action || clock.receipt!.locationId !== c.locationId || operation.sequence !== c.expectedSequence + 1) fail();
    if (choice.kind === "break" && (operation.startEventId !== choice.startEventId || operation.sessionFingerprint !== choice.expectedSessionFingerprint || choice.breakType !== null && operation.breakPaid !== (choice.breakType === "paid"))) fail();
    if (choice.kind === "legacy_break" && operation.sessionFingerprint !== null) fail();
    if (choice.kind === "start" && input.write && (!s || s.policyFingerprint !== choice.expectedPolicyFingerprint || !equal(s.selection, choice.selection))) fail();
  }
  if (s && operation && (operation.startEventId !== s.startEventId || operation.sessionFingerprint !== s.sessionFingerprint || operation.sourceFingerprint !== s.sourceFingerprint)) fail();
  if (s && operation?.action === "clock_in" && (s.operationId !== operation.operationId || s.startSequence !== operation.sequence || s.channel !== input.channel
    || s.actorAuthUserId !== operation.actorAuthUserId || s.occurredAt.slice(0, 23) + "Z" !== clock.receipt!.occurredAt)) fail();
  let choices: SelfScheduleResult["choices"] | null = null;
  if (r.choices !== null) {
    if (input.query.mode !== "prepare" || !p) fail();
    const common = { workerId: clock.workerId, locationId: clock.locationId, state: clock.state, receipt: clock.receipt, replayed: clock.replayed };
    choices = parseSelfScheduleResult({ protocol: "self-schedule-v1", clock: common, choices: r.choices, association: null }, { siteId: input.siteId, command: null, operationId: null }).choices;
    if (p.fields.shiftSource.state === "disabled" || p.fields.shiftSource.value === "unplanned" || p.fields.shiftSource.state === "unconfigured" && !p.legacy.scheduleEnabled) fail();
  }
  const association = associationData(r.association, clock, input), adoption = adoptionData(r.adoption, association, operation);
  if ((association === null) !== (adoption === null) || association && (!s || operation?.action !== "clock_in" || !equal(association.selection, s.selection))) fail();
  return freeze({ protocol: OPERATIONAL_PUNCH_PROTOCOL, channel: input.channel, siteId: input.siteId, readAt, clock, policy: p, session: s,
    choices, association, adoption, operation, replayed, canStart, canBreak, canFinish }) as OperationalPunchResult;
}
/** Browser shape has no private source/fence; a saved intent is still required
 * before a matching operation receipt may clear the pending slot. */
export async function parseOperationalPunchResult(raw: unknown, expected: OperationalPunchParseInput): Promise<OperationalPunchResult> {
  try { tree(raw); const snapshot = structuredClone(raw), input = inputData(expected); return await resultData(snapshot, input, false); } catch { return fail(); }
}
/** Server-only use, but no credentials are imported by this pure module. Check
 * the saved source at its saved instant, never by calling today's selector. */
export async function parseOperationalPunchRpcResult(raw: unknown, expected: OperationalPunchParseInput): Promise<OperationalPunchResult> {
  try { tree(raw); const snapshot = structuredClone(raw), input = inputData(expected), envelope = exact(snapshot, ["result", "source"]);
    const result = await resultData(envelope.result, input, true), subject = result.policy ?? result.session;
    if (!subject) { if (envelope.source !== null) fail(); return result; }
    if (envelope.source === null) fail();
    const who = result.policy?.workerIdentity ?? result.session!, at = result.policy?.checkedAt ?? result.session!.occurredAt;
    const projection = await resolveOperationalRuleSource(envelope.source, { siteId: input.siteId, workerId: who.workerId, employeeId: who.employeeId, employeeAuthUserId: who.employeeAuthUserId, at });
    const source = projection.source, expectedFields = Object.fromEntries(FOUR.map(k => [k, projection.candidate.fields[k]]));
    const expectedOrigins = LAYERS.flatMap(layer => { const l = source.layers[layer]; return l ? [{ layer, operationId: l.operationId, revision: l.revision, effectiveAt: l.effectiveAt, endsAt: l.endsAt, rulesFingerprint: l.rulesFingerprint, referenceFingerprint: l.referenceFingerprint }] : []; });
    if (!equal(expectedFields, subject.fields) || !equal(expectedOrigins, subject.origins) || source.sourceFingerprint !== subject.sourceFingerprint || source.settingsRef.version !== subject.legacy.settingsVersion) fail();
    const candidate: OperationalPunchPolicy = result.policy ?? { checkedAt: at, policyFingerprint: subject.policyFingerprint, sourceFingerprint: subject.sourceFingerprint,
      workerIdentity: source.workerIdentity, locationId: subject.locationId, locationVersion: subject.locationVersion, activationRevision: subject.activationRevision, fields: subject.fields, origins: subject.origins, legacy: subject.legacy };
    if (await operationalPunchPolicyFingerprint(input.siteId, result.policy ? input.channel : result.session!.channel, candidate, source) !== subject.policyFingerprint) fail();
    return result;
  } catch { return fail(); }
}
export type OperationalPunchResponse = Readonly<{ ok: true; data: OperationalPunchResult } | { ok: false; error: { code: string; message: string } }>;
/** Routes own the exact channel error whitelist. Callers must pass that same
 * whitelist, not trust an arbitrary server string as a known rejection. */
export async function parseOperationalPunchResponse(raw: unknown, input: OperationalPunchParseInput, errors: Readonly<Record<string, number>> = OPERATIONAL_PUNCH_ERRORS): Promise<OperationalPunchResponse> {
  try { tree(raw); const r = exact(raw, (raw as { ok?: unknown })?.ok === true ? ["ok", "data"] : ["ok", "error"]);
    if (r.ok === true) return freeze({ ok: true, data: await parseOperationalPunchResult(r.data, input) });
    if (r.ok !== false) fail(); const e = exact(r.error, ["code", "message"]);
    if (typeof e.code !== "string" || !Object.hasOwn(errors, e.code) || typeof e.message !== "string" || !e.message.length || e.message.length > 400) fail();
    return freeze({ ok: false, error: { code: e.code, message: e.message } });
  } catch { return fail(); }
}
