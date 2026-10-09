// 196: independent subjects are not nullable member DTOs. No PIN, verifier,
// terminal secret or fabricated employee identity belongs in saved commands.
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { attendancePin } from "./merchantAttendancePin";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const INDEPENDENT_ADMIN_PROTOCOL = "attendance-independent-admin-v1" as const;
export const INDEPENDENT_TERMINAL_PROTOCOL = "attendance-independent-terminal-v1" as const;
export const INDEPENDENT_RAW_PROTOCOL = "attendance-independent-raw-v1" as const;
export const INDEPENDENT_BINDING_PROTOCOL = "attendance-independent-binding-boundary-v1" as const;
export const INDEPENDENT_BODY_LIMIT = 8192;
export const INDEPENDENT_RESPONSE_LIMIT = 1048576;
export const INDEPENDENT_MAX_REVISION = 9007199254740990;
export const INDEPENDENT_PAGE_SIZE = 25;
export const INDEPENDENT_MAX_SHIFT_EVENTS = 2002;
export const INDEPENDENT_MAX_PAGE_EVENTS = 4000;
export type IndependentAction = "clock_in" | "break_start" | "break_end" | "clock_out";
export type IndependentQuery = Readonly<
  { siteId: string; mode: "list"; cursor: string | null; search: string; state: "all" | "independent" | "bound" }
  | { siteId: string; mode: "members"; cursor: string | null; search: string }
  | { siteId: string; mode: "locations"; cursor: string | null; search: string }
  | { siteId: string; mode: "detail"; subjectId: string }
  | { siteId: string; mode: "recover"; subjectId: string; operationId: string }
  | { siteId: string; mode: "history"; subjectId: string; fromDate: string; throughDate: string; cursor: string | null }>;
type ChangeBase = { operationId: string; subjectId: string; expectedSubjectRevision: number; expectedGeneration: number;
  expectedWorkerVersion: number; expectedSettingsVersion: number; reason: string };
export type IndependentCommand = Readonly<
  { action: "create"; operationId: string; subjectId: string; workerId: string; expectedSettingsVersion: number;
    workerNo: string; displayName: string; locationId: string; startsOn: string; reason: string }
  | (ChangeBase & { action: "enable" })
  | (ChangeBase & { action: "disable" })
  | (ChangeBase & { action: "issue_pin"; expectedCredentialRevision: number })
  | (ChangeBase & { action: "revoke_pin"; expectedCredentialRevision: number })
  | (ChangeBase & { action: "bind_member"; expectedCredentialRevision: number; targetEmployeeId: string;
      targetAuthUserId: string; expectedLastEventId: string | null; expectedSequence: number })>;
export type IndependentBody = Readonly<{ query: IndependentQuery; command: IndependentCommand }>;
/** Only the short authenticated owner POST may carry this PIN. Nonsecret
 * command pairs use IndependentBody instead, including pending recovery. */
export type IndependentIssuePinBody = Readonly<{ query: IndependentQuery;
  command: Extract<IndependentCommand, { action: "issue_pin" }>; pin: string }>;
export type IndependentOwnerBody = IndependentIssuePinBody | Readonly<{ query: IndependentQuery;
  command: Exclude<IndependentCommand, { action: "issue_pin" }> }>;
export type IndependentSubject = Readonly<{ subjectId: string; workerId: string; workerNo: string; displayName: string;
  startsOn: string; locationId: string; enabled: boolean; generation: number; revision: number; workerVersion: number;
  state: "independent" | "bound"; createdAt: string }>;
export type IndependentCredentialStatus = Readonly<{ credentialId: string | null; revision: number; enabled: boolean;
  generation: number | null; changedAt: string | null }>;
export type IndependentHead = Readonly<{ sequence: number; status: "off" | "working" | "break";
  lastEventId: string | null; lastAction: IndependentAction | null; lastAt: string | null }>;
export type IndependentBinding = Readonly<{ protocol: typeof INDEPENDENT_BINDING_PROTOCOL; siteId: string;
  workerId: string; subjectId: string; bindingOperationId: string; employeeId: string; employeeAuthUserId: string;
  workerVersion: number; generation: number; lastIndependentEventId: string | null; lastSequence: number; boundAt: string }>;
export type IndependentAdminReceipt = Readonly<{ operationId: string; subjectId: string; workerId: string;
  action: IndependentCommand["action"]; actorId: string; subjectRevision: number; generation: number;
  workerVersion: number; credentialRevision: number | null; recordedAt: string; commandFingerprint: string }>;
export type IndependentAdminData = Readonly<
  { kind: "list"; items: readonly IndependentSubject[]; nextCursor: string | null }
  | { kind: "members"; items: readonly Readonly<{ employeeId: string; authUserId: string; displayName: string }>[]; nextCursor: string | null }
  | { kind: "locations"; items: readonly Readonly<{ locationId: string; name: string; timeZone: string }>[]; nextCursor: string | null }
  | { kind: "detail"; subject: IndependentSubject; credential: IndependentCredentialStatus; head: IndependentHead; binding: IndependentBinding | null }
  | { kind: "receipt" }
  | { kind: "history"; report: IndependentRawReport }>;
export type IndependentAdminResult = Readonly<{ protocol: typeof INDEPENDENT_ADMIN_PROTOCOL; siteId: string;
  actorId: string; readAt: string; settingsVersion: number; data: IndependentAdminData; receipt: IndependentAdminReceipt | null }>;
export type IndependentClockCommand = Readonly<{ operationId: string; subjectId: string; workerId: string; generation: number;
  credentialId: string; credentialRevision: number; expectedWorkerVersion: number; expectedSettingsVersion: number;
  locationId: string; expectedLocationVersion: number; expectedSequence: number; action: IndependentAction; breakPaid: boolean | null }>;
export type IndependentTerminalRequest = Readonly<
  { kind: "state" }
  | { kind: "clock"; command: IndependentClockCommand }
  | { kind: "recover"; subjectId: string; workerId: string; operationId: string; commandFingerprint: string }
  | { kind: "personal"; subjectId: string; workerId: string; fromDate: string; throughDate: string; cursor: string | null }>;
/** Transient HTTP body only. Never put this type in storage/pending/logging. */
export type IndependentTerminalBody = Readonly<{ siteId: string; terminalId: string; workerNo: string; pin: string; request: IndependentTerminalRequest }>;
export type IndependentTerminalSubject = Readonly<{ subjectId: string; workerId: string; workerNo: string; displayName: string;
  generation: number; workerVersion: number; credentialId: string; credentialRevision: number; settingsVersion: number;
  locationId: string; locationVersion: number; timeZone: string }>;
export type IndependentEvent = Readonly<{ id: string; operationId: string; sequence: number; action: IndependentAction;
  locationId: string; occurredAt: string; receivedAt: string; timeZone: string; breakPaid: boolean | null;
  source: "kiosk"; actorEmployeeId: null }>;
export type IndependentEventSource = Readonly<{ subjectId: string; generation: number; credentialId: string;
  credentialRevision: number; credentialIssueOperationId: string; terminalId: string; workerVersion: number;
  settingsVersion: number; locationVersion: number; commandFingerprint: string }>;
export type IndependentClockReceipt = Readonly<{ operationId: string; command: IndependentClockCommand;
  commandFingerprint: string; event: IndependentEvent; source: IndependentEventSource }>;
export type IndependentRawShift = Readonly<{ startEventId: string; endEventId: string | null; complete: boolean;
  events: readonly IndependentClockReceipt[] }>;
export type IndependentRawReport = Readonly<{ protocol: typeof INDEPENDENT_RAW_PROTOCOL; siteId: string; subjectId: string;
  workerId: string; workerNo: string; displayName: string; timeZone: string; fromDate: string; throughDate: string;
  fromAt: string; toAt: string; readAt: string; items: readonly IndependentRawShift[]; nextCursor: string | null;
  pageComplete: true; rangeComplete: boolean; rulesAssessment: "unassessed"; fixedPeriodEligible: false }>;
export type IndependentTerminalData = Readonly<
  { kind: "state"; subject: IndependentTerminalSubject; head: IndependentHead }
  | { kind: "clock"; subject: IndependentTerminalSubject; head: IndependentHead; receipt: IndependentClockReceipt }
  | { kind: "receipt"; receipt: IndependentClockReceipt | null }
  | { kind: "personal"; report: IndependentRawReport }>;
export type IndependentTerminalResult = Readonly<{ protocol: typeof INDEPENDENT_TERMINAL_PROTOCOL; siteId: string;
  terminalId: string; readAt: string; data: IndependentTerminalData }>;

const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const exact = captureBrowserExact;
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const tag = (v: unknown, k: string): unknown => v && typeof v === "object" ? Object.getOwnPropertyDescriptor(v, k)?.value : undefined;
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const int = (v: unknown, min = 0, max = INDEPENDENT_MAX_REVISION): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const nullableUuid = (v: unknown) => v === null ? null : uuid(v);
function unicode(v: string) {
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = v.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail(); }
    else if (c >= 0xdc00 && c <= 0xdfff) fail(); }
}
function label(v: unknown, max: number, min = 1): string {
  if (typeof v !== "string" || v !== v.trim() || [...v].length < min || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  unicode(v); return v;
}
function stamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v < "2000-01-01" || v >= "2101-01-01") return fail();
  const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v;
}
function date(v: unknown): string { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(); stamp(v + "T00:00:00.000000Z"); return v; }
function dates(from: unknown, through: unknown) { const fromDate = date(from), throughDate = date(through), days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
  if (days < 1 || days > 31) fail(); return { fromDate, throughDate }; }
function zone(v: unknown): string { const s = label(v, 100); if (s !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(s)) fail(); return s; }
function action(v: unknown): IndependentAction { if (v !== "clock_in" && v !== "break_start" && v !== "break_end" && v !== "clock_out") return fail(); return v; }
function paid(v: unknown, a: IndependentAction) { if (a === "break_start") return bool(v); if (v !== null) fail(); return null; }
/** Descriptor-only traversal: no getter/toJSON execution, sparse arrays, exotic
 * prototypes, cycles or live raw references survive the first await. */
function snapshot(raw: unknown, cap: number): unknown {
  let count = 0; const seen = new Set<object>();
  function walk(v: unknown, depth: number): unknown {
    if (++count > 300000 || depth > 24) fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") { if (v.length > cap) fail(); unicode(v); return v; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return v; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail();
    const keys = Reflect.ownKeys(v), ds = Object.getOwnPropertyDescriptors(v), proto = Object.getPrototypeOf(v); seen.add(v);
    let out: unknown;
    if (Array.isArray(v)) { if (proto !== Array.prototype || v.length > INDEPENDENT_MAX_PAGE_EVENTS || keys.length !== v.length + 1) fail();
      out = Array.from({ length: v.length }, (_, i) => { const d = ds[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); return walk(d.value, depth + 1); });
    } else { if (proto !== Object.prototype && proto !== null) fail(); const o: Record<string, unknown> = Object.create(null);
      for (const k of keys) { if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)) return fail(); const d = ds[k]; if (!("value" in d) || !d.enumerable) fail(); o[k] = walk(d.value, depth + 1); } out = o; }
    seen.delete(v); return out;
  }
  const out = walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(out)).byteLength > cap) fail(); return out;
}
function request<T>(fn: () => T): T { try { return freeze(fn()); } catch { return fail(); } }
export function parseIndependentJson(text: unknown, body = false): unknown {
  return request(() => { const cap = body ? INDEPENDENT_BODY_LIMIT : INDEPENDENT_RESPONSE_LIMIT;
    if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).byteLength > cap) fail();
    return snapshot(parseCaptureBrowserJson(text as string), cap); });
}
export function parseIndependentQuery(raw: unknown): IndependentQuery { return request(() => {
  const m = tag(raw, "mode"), v = exact(raw, m === "list" ? ["siteId", "mode", "cursor", "search", "state"] : m === "members" || m === "locations" ? ["siteId", "mode", "cursor", "search"] : m === "detail" ? ["siteId", "mode", "subjectId"] : m === "recover" ? ["siteId", "mode", "subjectId", "operationId"] : ["siteId", "mode", "subjectId", "fromDate", "throughDate", "cursor"]), siteId = site(v.siteId);
  if (m === "list") { if (!["all", "independent", "bound"].includes(v.state as string)) fail(); return { siteId, mode: m, cursor: nullableUuid(v.cursor), search: label(v.search, 80, 0), state: v.state as "all" | "independent" | "bound" }; }
  if (m === "members" || m === "locations") return { siteId, mode: m, cursor: nullableUuid(v.cursor), search: label(v.search, 80, 0) };
  const subjectId = uuid(v.subjectId); if (m === "detail") return { siteId, mode: m, subjectId };
  if (m === "recover") return { siteId, mode: m, subjectId, operationId: uuid(v.operationId) };
  if (m !== "history") return fail(); return { siteId, mode: m, subjectId, ...dates(v.fromDate, v.throughDate), cursor: nullableUuid(v.cursor) };
}); }
export function independentQueryString(raw: IndependentQuery) { const q = parseIndependentQuery(raw), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) p.set(k, v === null ? "" : String(v)); return p.toString(); }
export function parseIndependentHttpQuery(input: string | URL): IndependentQuery { return request(() => {
  const u = new URL(input), entries = [...u.searchParams.entries()]; if (u.hash || String(input).includes("#") || entries.some(([k], i) => entries.findIndex(([key]) => key === k) !== i)) fail();
  const raw: Record<string, unknown> = Object.fromEntries(entries); if (Object.hasOwn(raw, "cursor") && raw.cursor === "") raw.cursor = null; return parseIndependentQuery(raw);
}); }
export function parseIndependentCommand(raw: unknown): IndependentCommand { return request(() => {
  const a = tag(raw, "action"), common = ["action", "operationId", "subjectId"], keys = a === "create" ? [...common, "workerId", "expectedSettingsVersion", "workerNo", "displayName", "locationId", "startsOn", "reason"] : [...common, "expectedSubjectRevision", "expectedGeneration", "expectedWorkerVersion", "expectedSettingsVersion", "reason", ...(a === "issue_pin" || a === "revoke_pin" || a === "bind_member" ? ["expectedCredentialRevision"] : []), ...(a === "bind_member" ? ["targetEmployeeId", "targetAuthUserId", "expectedLastEventId", "expectedSequence"] : [])];
  const v = exact(raw, keys), b = { operationId: uuid(v.operationId), subjectId: uuid(v.subjectId), expectedSettingsVersion: int(v.expectedSettingsVersion, 1), reason: label(v.reason, 500) };
  if (a === "create") return { ...b, action: a, workerId: uuid(v.workerId), workerNo: label(v.workerNo, 40), displayName: label(v.displayName, 120), locationId: uuid(v.locationId), startsOn: date(v.startsOn) };
  const c = { ...b, expectedSubjectRevision: int(v.expectedSubjectRevision, 1, INDEPENDENT_MAX_REVISION - 1), expectedGeneration: int(v.expectedGeneration, 0, INDEPENDENT_MAX_REVISION - (a === "enable" || a === "issue_pin" ? 0 : 1)), expectedWorkerVersion: int(v.expectedWorkerVersion, 1, INDEPENDENT_MAX_REVISION - 1) };
  if (a === "enable" || a === "disable") return { ...c, action: a };
  const expectedCredentialRevision = int(v.expectedCredentialRevision, 0, INDEPENDENT_MAX_REVISION - 1);
  if (a === "issue_pin" || a === "revoke_pin") return { ...c, action: a, expectedCredentialRevision };
  if (a !== "bind_member") return fail(); const expectedLastEventId = nullableUuid(v.expectedLastEventId), expectedSequence = int(v.expectedSequence);
  if ((expectedLastEventId === null) !== (expectedSequence === 0)) fail();
  return { ...c, action: a, expectedCredentialRevision, targetEmployeeId: uuid(v.targetEmployeeId), targetAuthUserId: uuid(v.targetAuthUserId), expectedLastEventId, expectedSequence };
}); }
export function parseIndependentBody(raw: unknown): IndependentBody { return request(() => { const v = exact(snapshot(raw, INDEPENDENT_BODY_LIMIT), ["query", "command"]), query = parseIndependentQuery(v.query), command = parseIndependentCommand(v.command);
  if (query.mode !== "detail" || query.subjectId !== command.subjectId) fail(); return { query, command }; }); }
export function parseIndependentIssuePinBody(raw: unknown): IndependentIssuePinBody { return request(() => {
  const v = exact(snapshot(raw, INDEPENDENT_BODY_LIMIT), ["query", "command", "pin"]), pair = parseIndependentBody({ query: v.query, command: v.command });
  if (pair.command.action !== "issue_pin") return fail(); return { query: pair.query, command: pair.command, pin: attendancePin(v.pin) };
}); }
export function parseIndependentOwnerBody(raw: unknown): IndependentOwnerBody { return request(() => {
  const detached = snapshot(raw, INDEPENDENT_BODY_LIMIT);
  if (tag(tag(detached, "command"), "action") === "issue_pin") return parseIndependentIssuePinBody(detached);
  const pair = parseIndependentBody(detached); if (pair.command.action === "issue_pin") return fail(); return { query: pair.query, command: pair.command };
}); }
export function parseIndependentClockCommand(raw: unknown): IndependentClockCommand { return request(() => {
  const v = exact(raw, ["operationId", "subjectId", "workerId", "generation", "credentialId", "credentialRevision", "expectedWorkerVersion", "expectedSettingsVersion", "locationId", "expectedLocationVersion", "expectedSequence", "action", "breakPaid"]), a = action(v.action);
  return { operationId: uuid(v.operationId), subjectId: uuid(v.subjectId), workerId: uuid(v.workerId), generation: int(v.generation), credentialId: uuid(v.credentialId), credentialRevision: int(v.credentialRevision, 1), expectedWorkerVersion: int(v.expectedWorkerVersion, 1), expectedSettingsVersion: int(v.expectedSettingsVersion, 1), locationId: uuid(v.locationId), expectedLocationVersion: int(v.expectedLocationVersion, 1), expectedSequence: int(v.expectedSequence, 0, INDEPENDENT_MAX_REVISION - 1), action: a, breakPaid: paid(v.breakPaid, a) };
}); }
export function parseIndependentTerminalRequest(raw: unknown): IndependentTerminalRequest { return request(() => {
  const k = tag(raw, "kind"), v = exact(raw, k === "state" ? ["kind"] : k === "clock" ? ["kind", "command"] : k === "recover" ? ["kind", "subjectId", "workerId", "operationId", "commandFingerprint"] : ["kind", "subjectId", "workerId", "fromDate", "throughDate", "cursor"]);
  if (k === "state") return { kind: k }; if (k === "clock") return { kind: k, command: parseIndependentClockCommand(v.command) };
  const b = { subjectId: uuid(v.subjectId), workerId: uuid(v.workerId) };
  if (k === "recover") return { kind: k, ...b, operationId: uuid(v.operationId), commandFingerprint: hash(v.commandFingerprint) };
  if (k !== "personal") return fail(); return { kind: k, ...b, ...dates(v.fromDate, v.throughDate), cursor: nullableUuid(v.cursor) };
}); }
export function parseIndependentTerminalBody(raw: unknown): IndependentTerminalBody { return request(() => {
  const v = exact(snapshot(raw, INDEPENDENT_BODY_LIMIT), ["siteId", "terminalId", "workerNo", "pin", "request"]);
  return { siteId: site(v.siteId), terminalId: uuid(v.terminalId), workerNo: label(v.workerNo, 40), pin: attendancePin(v.pin), request: parseIndependentTerminalRequest(v.request) };
}); }
type Tuple = null | boolean | number | string | readonly Tuple[];
export function independentAdminCommandText(siteId: string, actorId: string, raw: IndependentCommand) {
  const c = parseIndependentCommand(raw); let values: Tuple[];
  if (c.action === "create") values = [c.workerId, c.expectedSettingsVersion, c.workerNo, c.displayName, c.locationId, c.startsOn, c.reason];
  else { values = [c.expectedSubjectRevision, c.expectedGeneration, c.expectedWorkerVersion, c.expectedSettingsVersion, c.reason];
    if (c.action === "issue_pin" || c.action === "revoke_pin" || c.action === "bind_member") values.push(c.expectedCredentialRevision);
    if (c.action === "bind_member") values.push(c.targetEmployeeId, c.targetAuthUserId, c.expectedLastEventId, c.expectedSequence); }
  return operationalRuleLedgerEncode(["attendance-independent-admin-command-v1", site(siteId), uuid(actorId), c.action, c.operationId, c.subjectId, values]);
}
export function independentClockCommandText(siteId: string, terminalId: string, raw: IndependentClockCommand) {
  const c = parseIndependentClockCommand(raw); return operationalRuleLedgerEncode(["attendance-independent-clock-command-v1", site(siteId), uuid(terminalId), [c.operationId, c.subjectId, c.workerId, c.generation, c.credentialId, c.credentialRevision, c.expectedWorkerVersion, c.expectedSettingsVersion, c.locationId, c.expectedLocationVersion, c.expectedSequence, c.action, c.breakPaid]]);
}
async function digest(text: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); }
export const independentAdminCommandFingerprint = (siteId: string, actorId: string, c: IndependentCommand) => digest(independentAdminCommandText(siteId, actorId, c));
export const independentClockCommandFingerprint = (siteId: string, terminalId: string, c: IndependentClockCommand) => digest(independentClockCommandText(siteId, terminalId, c));
export function independentAdminReceiptMatches(r: IndependentAdminReceipt, c: IndependentCommand, actorId: string, fingerprint: string) {
  return r.actorId === actorId && r.operationId === c.operationId && r.subjectId === c.subjectId && r.action === c.action && r.commandFingerprint === fingerprint
    && (c.action === "create" ? r.workerId === c.workerId && r.subjectRevision === 1 && r.generation === 0 && r.workerVersion === 1 && r.credentialRevision === null
      : r.subjectRevision === c.expectedSubjectRevision + 1 && r.workerVersion === c.expectedWorkerVersion + 1 && r.generation === c.expectedGeneration + (c.action === "disable" || c.action === "revoke_pin" || c.action === "bind_member" ? 1 : 0)
        && (c.action === "issue_pin" ? r.credentialRevision === c.expectedCredentialRevision + 1 : c.action === "revoke_pin" || c.action === "bind_member" ? r.credentialRevision === (c.expectedCredentialRevision === 0 ? 0 : c.expectedCredentialRevision + 1) : c.action === "disable" ? r.credentialRevision !== null : r.credentialRevision === null));
}
function subject(raw: unknown, readAt: string): IndependentSubject {
  const v = exact(raw, ["subjectId", "workerId", "workerNo", "displayName", "startsOn", "locationId", "enabled", "generation", "revision", "workerVersion", "state", "createdAt"]);
  if (v.state !== "independent" && v.state !== "bound") fail(); const createdAt = stamp(v.createdAt), enabled = bool(v.enabled); if (createdAt > readAt || v.state === "bound" && enabled) fail();
  return { subjectId: uuid(v.subjectId), workerId: uuid(v.workerId), workerNo: label(v.workerNo, 40), displayName: label(v.displayName, 120), startsOn: date(v.startsOn), locationId: uuid(v.locationId), enabled, generation: int(v.generation), revision: int(v.revision, 1), workerVersion: int(v.workerVersion, 1), state: v.state as IndependentSubject["state"], createdAt };
}
export function parseIndependentHead(raw: unknown, readAt: string): IndependentHead { return request(() => {
  stamp(readAt);
  const v = exact(raw, ["sequence", "status", "lastEventId", "lastAction", "lastAt"]), sequence = int(v.sequence), lastEventId = nullableUuid(v.lastEventId), lastAction = v.lastAction === null ? null : action(v.lastAction), lastAt = v.lastAt === null ? null : stamp(v.lastAt);
  if (sequence === 0 ? v.status !== "off" || lastEventId !== null || lastAction !== null || lastAt !== null : !lastEventId || !lastAction || !lastAt || lastAt > stamp(readAt) || v.status !== (lastAction === "clock_out" ? "off" : lastAction === "break_start" ? "break" : "working")) fail();
  return { sequence, status: v.status as IndependentHead["status"], lastEventId, lastAction, lastAt };
}); }
function credential(raw: unknown, s: IndependentSubject, readAt: string): IndependentCredentialStatus {
  const v = exact(raw, ["credentialId", "revision", "enabled", "generation", "changedAt"]), credentialId = nullableUuid(v.credentialId), revision = int(v.revision), enabled = bool(v.enabled), generation = v.generation === null ? null : int(v.generation), changedAt = v.changedAt === null ? null : stamp(v.changedAt);
  if (revision === 0 ? credentialId !== null || enabled || generation !== null || changedAt !== null : !credentialId || generation === null || !changedAt || changedAt > readAt || generation > s.generation || enabled && (generation !== s.generation || s.state !== "independent")) fail();
  return { credentialId, revision, enabled, generation, changedAt };
}
export function parseIndependentBinding(raw: unknown): IndependentBinding { return request(() => {
  const v = exact(raw, ["protocol", "siteId", "workerId", "subjectId", "bindingOperationId", "employeeId", "employeeAuthUserId", "workerVersion", "generation", "lastIndependentEventId", "lastSequence", "boundAt"]), lastIndependentEventId = nullableUuid(v.lastIndependentEventId), lastSequence = int(v.lastSequence);
  if (v.protocol !== INDEPENDENT_BINDING_PROTOCOL || (lastIndependentEventId === null) !== (lastSequence === 0)) fail();
  return { protocol: INDEPENDENT_BINDING_PROTOCOL, siteId: site(v.siteId), workerId: uuid(v.workerId), subjectId: uuid(v.subjectId), bindingOperationId: uuid(v.bindingOperationId), employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId), workerVersion: int(v.workerVersion, 2), generation: int(v.generation, 1), lastIndependentEventId, lastSequence, boundAt: stamp(v.boundAt) };
}); }
function adminReceipt(raw: unknown, readAt: string): IndependentAdminReceipt {
  const v = exact(raw, ["operationId", "subjectId", "workerId", "action", "actorId", "subjectRevision", "generation", "workerVersion", "credentialRevision", "recordedAt", "commandFingerprint"]);
  if (!["create", "enable", "disable", "issue_pin", "revoke_pin", "bind_member"].includes(v.action as string)) fail();
  const recordedAt = stamp(v.recordedAt), credentialRevision = v.credentialRevision === null ? null : int(v.credentialRevision), subjectRevision = int(v.subjectRevision, 1), generation = int(v.generation), workerVersion = int(v.workerVersion, 1);
  if (recordedAt > readAt || (v.action === "create" || v.action === "enable" ? credentialRevision !== null : credentialRevision === null || v.action === "issue_pin" && credentialRevision === 0)
    || (v.action === "create" ? subjectRevision !== 1 || workerVersion !== 1 || generation !== 0 : subjectRevision < 2 || workerVersion < 2)
    || (v.action === "disable" || v.action === "revoke_pin" || v.action === "bind_member") && generation === 0) fail();
  return { operationId: uuid(v.operationId), subjectId: uuid(v.subjectId), workerId: uuid(v.workerId), action: v.action as IndependentCommand["action"], actorId: uuid(v.actorId), subjectRevision, generation, workerVersion, credentialRevision, recordedAt, commandFingerprint: hash(v.commandFingerprint) };
}
function terminalSubject(raw: unknown): IndependentTerminalSubject {
  const v = exact(raw, ["subjectId", "workerId", "workerNo", "displayName", "generation", "workerVersion", "credentialId", "credentialRevision", "settingsVersion", "locationId", "locationVersion", "timeZone"]);
  return { subjectId: uuid(v.subjectId), workerId: uuid(v.workerId), workerNo: label(v.workerNo, 40), displayName: label(v.displayName, 120), generation: int(v.generation), workerVersion: int(v.workerVersion, 1), credentialId: uuid(v.credentialId), credentialRevision: int(v.credentialRevision, 1), settingsVersion: int(v.settingsVersion, 1), locationId: uuid(v.locationId), locationVersion: int(v.locationVersion, 1), timeZone: zone(v.timeZone) };
}
function event(raw: unknown, readAt: string): IndependentEvent {
  const v = exact(raw, ["id", "operationId", "sequence", "action", "locationId", "occurredAt", "receivedAt", "timeZone", "breakPaid", "source", "actorEmployeeId"]), a = action(v.action), occurredAt = stamp(v.occurredAt), receivedAt = stamp(v.receivedAt);
  if (v.source !== "kiosk" || v.actorEmployeeId !== null || occurredAt > receivedAt || receivedAt > readAt) fail();
  return { id: uuid(v.id), operationId: uuid(v.operationId), sequence: int(v.sequence, 1), action: a, locationId: uuid(v.locationId), occurredAt, receivedAt, timeZone: zone(v.timeZone), breakPaid: paid(v.breakPaid, a), source: "kiosk", actorEmployeeId: null };
}
async function clockReceipt(raw: unknown, siteId: string, terminalId: string | null, readAt: string): Promise<IndependentClockReceipt> {
  const r = exact(raw, ["operationId", "command", "commandFingerprint", "event", "source"]), c = parseIndependentClockCommand(r.command), e = event(r.event, readAt), v = exact(r.source, ["subjectId", "generation", "credentialId", "credentialRevision", "credentialIssueOperationId", "terminalId", "workerVersion", "settingsVersion", "locationVersion", "commandFingerprint"]);
  const source: IndependentEventSource = { subjectId: uuid(v.subjectId), generation: int(v.generation), credentialId: uuid(v.credentialId), credentialRevision: int(v.credentialRevision, 1), credentialIssueOperationId: uuid(v.credentialIssueOperationId), terminalId: uuid(v.terminalId), workerVersion: int(v.workerVersion, 1), settingsVersion: int(v.settingsVersion, 1), locationVersion: int(v.locationVersion, 1), commandFingerprint: hash(v.commandFingerprint) };
  const operationId = uuid(r.operationId), commandFingerprint = hash(r.commandFingerprint);
  if (operationId !== c.operationId || operationId !== e.operationId || e.sequence !== c.expectedSequence + 1 || e.action !== c.action || e.breakPaid !== c.breakPaid || e.locationId !== c.locationId || source.subjectId !== c.subjectId || source.generation !== c.generation || source.credentialId !== c.credentialId || source.credentialRevision !== c.credentialRevision || source.workerVersion !== c.expectedWorkerVersion || source.settingsVersion !== c.expectedSettingsVersion || source.locationVersion !== c.expectedLocationVersion || source.commandFingerprint !== commandFingerprint || terminalId !== null && source.terminalId !== terminalId || commandFingerprint !== await independentClockCommandFingerprint(siteId, source.terminalId, c)) fail();
  return { operationId, command: c, commandFingerprint, event: e, source };
}
export async function parseIndependentClockReceipt(raw: unknown, siteId: string, terminalId: string | null, readAt: string): Promise<IndependentClockReceipt> {
  try { const detached = snapshot(raw, INDEPENDENT_RESPONSE_LIMIT); return freeze(await clockReceipt(detached, site(siteId), terminalId === null ? null : uuid(terminalId), stamp(readAt))); }
  catch { throw new MerchantAttendanceError("attendance_independent_invalid"); }
}
type ReportScope = { siteId: string; subjectId: string; workerId?: string; fromDate: string; throughDate: string; cursor: string | null };
async function rawReport(raw: unknown, scope: ReportScope, envelopeReadAt: string): Promise<IndependentRawReport> {
  const v = exact(raw, ["protocol", "siteId", "subjectId", "workerId", "workerNo", "displayName", "timeZone", "fromDate", "throughDate", "fromAt", "toAt", "readAt", "items", "nextCursor", "pageComplete", "rangeComplete", "rulesAssessment", "fixedPeriodEligible"]), workerId = uuid(v.workerId), readAt = stamp(v.readAt), fromAt = stamp(v.fromAt), toAt = stamp(v.toAt), timeZone = zone(v.timeZone);
  if (v.protocol !== INDEPENDENT_RAW_PROTOCOL || v.siteId !== scope.siteId || v.subjectId !== scope.subjectId || scope.workerId !== undefined && workerId !== scope.workerId || v.fromDate !== scope.fromDate || v.throughDate !== scope.throughDate || readAt !== envelopeReadAt || fromAt > toAt || Date.parse(toAt) - Date.parse(fromAt) > 33 * 86400000 || v.pageComplete !== true || v.rulesAssessment !== "unassessed" || v.fixedPeriodEligible !== false || !Array.isArray(v.items) || v.items.length > INDEPENDENT_PAGE_SIZE || fromAt === toAt && (v.items.length !== 0 || v.nextCursor !== null)) fail();
  dates(v.fromDate, v.throughDate); const items: IndependentRawShift[] = [], seen = new Set<string>(), operations = new Set<string>(); let total = 0, previousSequence = 0, previousAt = "";
  for (const rawItem of v.items as unknown[]) {
    const i = exact(rawItem, ["startEventId", "endEventId", "complete", "events"]), startEventId = uuid(i.startEventId), endEventId = nullableUuid(i.endEventId), complete = bool(i.complete);
    if (!Array.isArray(i.events) || !i.events.length || i.events.length > INDEPENDENT_MAX_SHIFT_EVENTS || (total += i.events.length) > INDEPENDENT_MAX_PAGE_EVENTS || seen.has(startEventId) || scope.cursor === startEventId) fail();
    const events: IndependentClockReceipt[] = []; let state: IndependentHead["status"] = "off";
    for (const rawEvent of i.events as unknown[]) {
      const r = await clockReceipt(rawEvent, scope.siteId, null, readAt), e = r.event;
      if (r.command.subjectId !== scope.subjectId || r.command.workerId !== workerId || seen.has(e.id) || operations.has(r.operationId) || e.sequence <= previousSequence || e.occurredAt < previousAt || e.timeZone !== timeZone) fail();
      const last = events.at(-1); if (last && e.sequence !== last.event.sequence + 1) fail();
      if (e.action === "clock_in" ? state !== "off" || events.length !== 0 : e.action === "break_start" ? state !== "working" : e.action === "break_end" ? state !== "break" : state !== "working") fail();
      state = e.action === "clock_out" ? "off" : e.action === "break_start" ? "break" : "working";
      seen.add(e.id); operations.add(r.operationId); previousSequence = e.sequence; previousAt = e.occurredAt; events.push(r);
    }
    const first = events[0].event, last = events.at(-1)!.event;
    if (first.id !== startEventId || first.action !== "clock_in" || first.occurredAt >= toAt || (complete ? last.occurredAt : readAt) <= fromAt || complete !== (last.action === "clock_out") || complete !== (endEventId !== null) || endEventId !== null && endEventId !== last.id || !complete && rawItem !== (v.items as unknown[]).at(-1)) fail();
    items.push({ startEventId, endEventId, complete, events });
  }
  const nextCursor = nullableUuid(v.nextCursor), rangeComplete = bool(v.rangeComplete);
  if (nextCursor !== null && (items.length !== INDEPENDENT_PAGE_SIZE || nextCursor !== items.at(-1)!.startEventId || !items.at(-1)!.complete) || rangeComplete !== (scope.cursor === null && nextCursor === null)) fail();
  return { protocol: INDEPENDENT_RAW_PROTOCOL, siteId: scope.siteId, subjectId: scope.subjectId, workerId, workerNo: label(v.workerNo, 40), displayName: label(v.displayName, 120), timeZone, ...dates(v.fromDate, v.throughDate), fromAt, toAt, readAt, items, nextCursor, pageComplete: true, rangeComplete, rulesAssessment: "unassessed", fixedPeriodEligible: false };
}
export async function parseIndependentAdminResult(raw: unknown, input: IndependentQuery, actor: string, expected: IndependentCommand | null = null): Promise<IndependentAdminResult> {
  try {
    const detached = snapshot(raw, INDEPENDENT_RESPONSE_LIMIT), q = parseIndependentQuery(input), actorId = uuid(actor), command = expected === null ? null : parseIndependentCommand(expected), r = exact(detached, ["protocol", "siteId", "actorId", "readAt", "settingsVersion", "data", "receipt"]), readAt = stamp(r.readAt), settingsVersion = int(r.settingsVersion, 1);
    if (r.protocol !== INDEPENDENT_ADMIN_PROTOCOL || r.siteId !== q.siteId || r.actorId !== actorId || command && (q.mode !== "detail" && q.mode !== "recover" || q.subjectId !== command.subjectId || q.mode === "recover" && q.operationId !== command.operationId)) fail();
    const receipt = r.receipt === null ? null : adminReceipt(r.receipt, readAt); let data: IndependentAdminData;
    if (command || q.mode === "recover") {
      if (q.mode !== "detail" && q.mode !== "recover") return fail();
      const d = exact(r.data, ["kind"]); if (d.kind !== "receipt" || q.mode !== "recover" && !receipt || receipt && (receipt.subjectId !== q.subjectId || q.mode === "recover" && receipt.operationId !== q.operationId) || command && receipt && !independentAdminReceiptMatches(receipt, command, actorId, await independentAdminCommandFingerprint(q.siteId, actorId, command))) fail(); data = { kind: "receipt" };
    } else {
      if (receipt !== null) fail();
      if (q.mode === "members" || q.mode === "locations") {
        const d = exact(r.data, ["kind", "items", "nextCursor"]); if (d.kind !== q.mode || !Array.isArray(d.items) || d.items.length > INDEPENDENT_PAGE_SIZE) fail();
        const itemsRaw = d.items as unknown[]; let prev = q.cursor ?? ""; const identities = new Set<string>();
        const members: Extract<IndependentAdminData, { kind: "members" }>["items"][number][] = [];
        const locations: Extract<IndependentAdminData, { kind: "locations" }>["items"][number][] = [];
        for (const rawItem of itemsRaw) {
          if (q.mode === "members") { const i = exact(rawItem, ["employeeId", "authUserId", "displayName"]), employeeId = uuid(i.employeeId), authUserId = uuid(i.authUserId);
            if (employeeId <= prev || identities.has(authUserId)) fail(); prev = employeeId; identities.add(authUserId); members.push({ employeeId, authUserId, displayName: label(i.displayName, 120) }); }
          else { const i = exact(rawItem, ["locationId", "name", "timeZone"]), locationId = uuid(i.locationId); if (locationId <= prev) fail(); prev = locationId; locations.push({ locationId, name: label(i.name, 120), timeZone: zone(i.timeZone) }); }
        }
        const nextCursor = nullableUuid(d.nextCursor); if (nextCursor !== null && (itemsRaw.length !== INDEPENDENT_PAGE_SIZE || nextCursor !== prev)) fail();
        data = q.mode === "members" ? { kind: "members", items: members, nextCursor } : { kind: "locations", items: locations, nextCursor };
      } else if (q.mode === "list") {
        const d = exact(r.data, ["kind", "items", "nextCursor"]); if (d.kind !== "list" || !Array.isArray(d.items) || d.items.length > INDEPENDENT_PAGE_SIZE) fail();
        const items = (d.items as unknown[]).map(i => subject(i, readAt)), workers = new Set<string>(), numbers = new Set<string>(); let prev = q.cursor ?? "";
        for (const s of items) { if (s.subjectId <= prev || workers.has(s.workerId) || numbers.has(s.workerNo) || q.state !== "all" && s.state !== q.state) fail(); workers.add(s.workerId); numbers.add(s.workerNo); prev = s.subjectId; }
        const nextCursor = nullableUuid(d.nextCursor); if (nextCursor !== null && (items.length !== INDEPENDENT_PAGE_SIZE || nextCursor !== prev)) fail(); data = { kind: "list", items, nextCursor };
      } else if (q.mode === "detail") {
        const d = exact(r.data, ["kind", "subject", "credential", "head", "binding"]); if (d.kind !== "detail") fail(); const s = subject(d.subject, readAt), c = credential(d.credential, s, readAt), h = parseIndependentHead(d.head, readAt), b = d.binding === null ? null : parseIndependentBinding(d.binding);
        if (s.subjectId !== q.subjectId || (s.state === "bound") !== (b !== null) || b && (b.siteId !== q.siteId || b.subjectId !== s.subjectId || b.workerId !== s.workerId || b.boundAt > readAt || b.workerVersion > s.workerVersion || b.generation > s.generation || c.enabled)) fail();
        data = { kind: "detail", subject: s, credential: c, head: h, binding: b };
      } else if (q.mode === "history") { const d = exact(r.data, ["kind", "report"]); if (d.kind !== "history") fail(); data = { kind: "history", report: await rawReport(d.report, q, readAt) }; }
      else return fail();
    }
    return freeze({ protocol: INDEPENDENT_ADMIN_PROTOCOL, siteId: q.siteId, actorId, readAt, settingsVersion, data, receipt });
  } catch { throw new MerchantAttendanceError("attendance_independent_invalid"); }
}
export async function parseIndependentTerminalResult(raw: unknown, rawBody: IndependentTerminalBody): Promise<IndependentTerminalResult> {
  try {
    // The validated PIN is discarded immediately; it is never in returned data.
    const { siteId, terminalId, workerNo, request: q } = parseIndependentTerminalBody(rawBody), r = exact(snapshot(raw, INDEPENDENT_RESPONSE_LIMIT), ["protocol", "siteId", "terminalId", "readAt", "data"]), readAt = stamp(r.readAt);
    if (r.protocol !== INDEPENDENT_TERMINAL_PROTOCOL || r.siteId !== siteId || r.terminalId !== terminalId) fail(); let data: IndependentTerminalData;
    if (q.kind === "state" || q.kind === "clock") {
      const d = exact(r.data, q.kind === "state" ? ["kind", "subject", "head"] : ["kind", "subject", "head", "receipt"]), s = terminalSubject(d.subject), h = parseIndependentHead(d.head, readAt);
      if (d.kind !== q.kind || s.workerNo !== workerNo) fail();
      if (q.kind === "state") data = { kind: "state", subject: s, head: h };
      else { const receipt = await clockReceipt(d.receipt, siteId, terminalId, readAt), c = receipt.command;
        if (independentClockCommandText(siteId, terminalId, c) !== independentClockCommandText(siteId, terminalId, q.command) || s.subjectId !== c.subjectId || s.workerId !== c.workerId || h.sequence < receipt.event.sequence || h.sequence === receipt.event.sequence && (h.lastEventId !== receipt.event.id || h.lastAction !== receipt.event.action || h.lastAt !== receipt.event.occurredAt)) fail();
        data = { kind: "clock", subject: s, head: h, receipt }; }
    } else if (q.kind === "recover") {
      const d = exact(r.data, ["kind", "receipt"]); if (d.kind !== "receipt") fail(); const receipt = d.receipt === null ? null : await clockReceipt(d.receipt, siteId, terminalId, readAt);
      if (receipt && (receipt.operationId !== q.operationId || receipt.command.subjectId !== q.subjectId || receipt.command.workerId !== q.workerId || receipt.commandFingerprint !== q.commandFingerprint)) fail(); data = { kind: "receipt", receipt };
    } else { const d = exact(r.data, ["kind", "report"]); if (d.kind !== "personal") fail(); const report = await rawReport(d.report, { siteId, ...q }, readAt); if (report.workerNo !== workerNo) fail(); data = { kind: "personal", report }; }
    return freeze({ protocol: INDEPENDENT_TERMINAL_PROTOCOL, siteId, terminalId, readAt, data });
  } catch { throw new MerchantAttendanceError("attendance_independent_invalid"); }
}
