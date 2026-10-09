// Server-side archival protocol. It validates stored bytes and saved facts, not
// today's timezone database, current ledgers, or a newly calculated projection.
import { createHash } from "node:crypto";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type RuleCapturesQuery = { siteId: string; workerId: string; operationId: string };
export type RuleCapturesCommand = { operationId: string; fromDate: string; throughDate: string; reason: string; employeeId: string; employeeAuthUserId: string };
export type RuleCapturesReceipt = {
  operationId: string; actorId: string; command: RuleCapturesCommand; observedAt: string; recordedAt: string; sourceId: string;
  sourceReadAt: string; sourceText: string; sourceSha256: string; sourceBytes: number; canonicalFormat: "pg-jsonb-text-utf8-v1";
  applied: false; historicalApplicationProven: false;
};
export type RuleCapturesResult = { protocol: "candidate-rule-captures-v1"; siteId: string; actorId: string; workerId: string;
  operationId: string; receipt: RuleCapturesReceipt | null; readAt: string };
export const RULE_CAPTURES_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404,
  attendance_settings_required: 409, attendance_platform_paused: 403, attendance_version_conflict: 409, attendance_operation_conflict: 409,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_rule_capture_invalid: 503, attendance_rule_capture_identity_changed: 409, attendance_rule_capture_incomplete: 409,
  attendance_rule_capture_limit: 409, attendance_rule_capture_worker_inactive: 409,
  attendance_rule_sources_invalid: 503, attendance_rule_sources_too_large: 422, attendance_group_invalid: 503,
  attendance_rule_invalid: 503, attendance_personal_rule_invalid: 503, attendance_personal_rule_identity_changed: 409,
});

type RecordValue = Record<string, unknown>;
const queryKeys = ["siteId", "workerId", "operationId"];
const commandKeys = ["operationId", "fromDate", "throughDate", "reason", "employeeId", "employeeAuthUserId"];
const MAX_BYTES = 1048576;
const fail = (code = "attendance_rule_capture_invalid"): never => { throw new MerchantAttendanceError(code); };
function exact(raw: unknown, keys: readonly string[]): RecordValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const prototype = Object.getPrototypeOf(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if (prototype !== null && prototype !== Object.prototype || Reflect.ownKeys(raw).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)) fail();
  return raw as RecordValue;
}
function wellFormed(value: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail();
  }
}
function tree(raw: unknown) {
  let nodes = 0; const seen = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 24) fail();
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") { if (value.length > MAX_BYTES) fail(); wellFormed(value); return; }
    if (typeof value === "number") { if (!Number.isFinite(value) || Object.is(value, -0)) fail(); return; }
    if (!value || typeof value !== "object" || seen.has(value)) return fail();
    seen.add(value);
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > 4000 || keys.length !== value.length + 1) fail();
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail();
        visit(descriptor.value, depth + 1);
      }
    } else {
      if (prototype !== Object.prototype && prototype !== null) fail();
      for (const key of keys) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const descriptor = descriptors[key]; if (!("value" in descriptor) || !descriptor.enumerable) fail();
        visit(descriptor.value, depth + 1);
      }
    }
    seen.delete(value);
  };
  visit(raw, 0);
}
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 1, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
function label(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || !empty && !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  wellFormed(v); return v;
}
function date(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  const ms = Date.parse(v + "T00:00:00.000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) fail(); return v;
}
function instant(v: unknown, digits: 3 | 6): string {
  if (typeof v !== "string" || !(digits === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v)) return fail();
  const msText = v.slice(0, 23) + "Z", ms = Date.parse(msText);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== msText) fail(); return v;
}
const micros = (v: string) => v.length === 24 ? v.slice(0, -1) + "000Z" : v;
function range(from: unknown, through: unknown, max: number) {
  const fromDate = date(from), throughDate = date(through), days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > max) fail(); return { fromDate, throughDate };
}
export function parseRuleCapturesQuery(raw: unknown): RuleCapturesQuery {
  try { const q = exact(raw, queryKeys); return { siteId: site(q.siteId), workerId: uuid(q.workerId), operationId: uuid(q.operationId) }; }
  catch { return fail("attendance_invalid_request"); }
}
export function parseRuleCapturesHttpQuery(url: string): RuleCapturesQuery {
  try {
    const params = new URL(url).searchParams, query = Object.create(null) as Record<string, string>;
    for (const [key, value] of params) { if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail(); query[key] = value; }
    return parseRuleCapturesQuery(query);
  } catch { return fail("attendance_invalid_request"); }
}
export function parseRuleCapturesCommand(raw: unknown): RuleCapturesCommand {
  try {
    const c = exact(raw, commandKeys), dates = range(c.fromDate, c.throughDate, 7);
    return { operationId: uuid(c.operationId), ...dates, reason: label(c.reason, 200), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId) };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseRuleCapturesBody(raw: unknown) {
  try {
    const body = exact(raw, ["query", "command"]), query = parseRuleCapturesQuery(body.query), command = parseRuleCapturesCommand(body.command);
    if (query.operationId !== command.operationId) fail(); return { query, command };
  } catch { return fail("attendance_invalid_request"); }
}

// Frozen archival-v1 shape/limits, deliberately independent of live validators
// which rederive local-date boundaries using the currently installed tzdata.
const ruleKeys = ["lateGraceMinutes", "earlyGraceMinutes", "openSpanWarningMinutes", "completedBreakMinimumMinutes"];
function rules(raw: unknown) {
  const v = exact(raw, ruleKeys);
  ruleKeys.forEach((key, index) => {
    const mode = exact(v[key], Object.getOwnPropertyDescriptor(v[key] as object, "mode")?.value === "value" ? ["mode", "minutes"] : ["mode"]);
    if (mode.mode === "value") integer(mode.minutes, index < 2 ? 0 : 1, index === 2 ? 44640 : 1440);
    else if (mode.mode !== "inherit" && mode.mode !== "disabled") fail();
  });
}
const assignmentKeys = ["assignmentId", "groupId", "groupName", "workerId", "workerName", "workerNo", "employeeId", "timeZone", "startsOn", "endsOn", "createdAt", "updatedAt", "revision", "status"];
function assignmentItem(raw: unknown) {
  const v = exact(raw, assignmentKeys);
  for (const key of ["assignmentId", "groupId", "workerId"]) uuid(v[key]); if (v.employeeId !== null) uuid(v.employeeId);
  label(v.groupName, 80); label(v.workerName, 120); label(v.workerNo, 40); label(v.timeZone, 100);
  date(v.startsOn); if (v.endsOn !== null && date(v.endsOn) < (v.startsOn as string)) fail();
  const created = instant(v.createdAt, 6), updated = instant(v.updatedAt, 6); integer(v.revision, 1, 3);
  if (created > updated || !["assigned", "ended", "cancelled"].includes(v.status as string)
    || v.status === "assigned" && (v.revision !== 1 || created !== updated)
    || v.status === "ended" && (v.revision !== 2 || v.endsOn === null)
    || v.status === "cancelled" && v.revision === 1) fail();
  return v;
}
function assignment(raw: unknown, source: RecordValue, worker: RecordValue) {
  const a = exact(raw, ["detail", "currentGroup"]), d = exact(a.detail, [...assignmentKeys, "history", "canEnd", "canCancel"]);
  const item = assignmentItem(Object.fromEntries(assignmentKeys.map(key => [key, d[key]])));
  const g = exact(a.currentGroup, ["groupId", "revision", "name", "description", "active", "createdAt", "updatedAt"]);
  uuid(g.groupId); integer(g.revision); label(g.name, 80); label(g.description, 200, true); bool(g.active);
  if (instant(g.createdAt, 6) > instant(g.updatedAt, 6) || (g.updatedAt as string) > (source.readAt as string)
    || item.workerId !== worker.workerId || item.groupId !== g.groupId || (item.updatedAt as string) > (source.readAt as string)) fail();
  if (!Array.isArray(d.history) || d.history.length !== item.revision) return fail();
  const operationIds = new Set<string>(); let previous: RecordValue | null = null;
  d.history.forEach((rawHistory, index) => {
    const h = exact(rawHistory, ["command", "item"]), c0 = h.command as RecordValue;
    const c = exact(c0, c0?.action === "assign" ? ["operationId", "action", "reason", "groupId", "workerId", "expectedGroupRevision", "expectedWorkerVersion", "expectedSettingsVersion", "timeZone", "startsOn", "endsOn"]
      : c0?.action === "end" ? ["operationId", "action", "reason", "assignmentId", "expectedRevision", "endsOn"] : ["operationId", "action", "reason", "assignmentId", "expectedRevision"]);
    const row = assignmentItem(h.item), operationId = uuid(c.operationId); label(c.reason, 200);
    if (operationIds.has(operationId) || row.revision !== index + 1) fail(); operationIds.add(operationId);
    if (index === 0) {
      if (c.action !== "assign" || row.assignmentId !== operationId || row.status !== "assigned") fail();
      if (uuid(c.groupId) !== row.groupId || uuid(c.workerId) !== row.workerId || c.timeZone !== row.timeZone || c.startsOn !== row.startsOn || c.endsOn !== row.endsOn) fail();
      if (integer(c.expectedGroupRevision) > (g.revision as number) || integer(c.expectedWorkerVersion) > (worker.version as number)
        || integer(c.expectedSettingsVersion) > (source.settingsVersion as number) || (g.createdAt as string) > (row.createdAt as string)) fail();
    } else {
      if (uuid(c.assignmentId) !== row.assignmentId || integer(c.expectedRevision, 1, 2) !== index
        || !["end", "cancel"].includes(c.action as string) || row.status !== (c.action === "end" ? "ended" : "cancelled") || previous!.status === "cancelled"
        || (row.updatedAt as string) < (previous!.updatedAt as string)
        || assignmentKeys.filter(key => !["endsOn", "updatedAt", "revision", "status"].includes(key)).some(key => row[key] !== previous![key])
        || c.action === "end" && (c.endsOn !== row.endsOn || previous!.endsOn !== null || previous!.status !== "assigned")
        || c.action === "cancel" && row.endsOn !== previous!.endsOn) fail();
    }
    previous = row;
  });
  if (assignmentKeys.some(key => previous![key] !== item[key]) || bool(d.canEnd) && (item.status !== "assigned" || item.endsOn !== null)
    || bool(d.canCancel) && item.status === "cancelled") fail();
  return { item, group: g };
}
const publicationKeys = ["revision", "operationId", "actorId", "action", "reason", "recordedAt", "settingsVersion", "groupRevision", "timeZone", "rules", "effectiveOn", "effectiveAt", "publishedRevision"];
const personalKeys = ["revision", "operationId", "actorId", "action", "reason", "recordedAt", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules", "approvedRevision"];
const personalContext = ["employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules"];
function personalItem(raw: unknown, source: RecordValue, worker: RecordValue, revision: number) {
  const p = exact(raw, personalKeys); integer(p.revision, 1, revision); uuid(p.operationId); uuid(p.actorId); label(p.reason, 200); label(p.timeZone, 100);
  if (uuid(p.employeeId) !== worker.employeeId || uuid(p.employeeAuthUserId) !== worker.employeeAuthUserId
    || integer(p.workerVersion) > (worker.version as number) || integer(p.settingsVersion) > (source.settingsVersion as number)) fail();
  range(p.startsOn, p.endsOn, 31); rules(p.rules);
  const from = instant(p.fromAt, 3), to = instant(p.toAt, 3), recorded = instant(p.recordedAt, 6);
  if (from >= to || recorded >= micros(from) || recorded > (source.readAt as string)
    || from >= (source.toAt as string) || to <= (source.fromAt as string)) fail();
  if (p.action === "approve") { if (p.approvedRevision !== null) fail(); }
  else if (p.action !== "withdraw" || integer(p.approvedRevision) >= (p.revision as number)) fail();
  if (Object.values(p.rules as RecordValue).every(choice => (choice as RecordValue).mode === "inherit")) fail();
  return p;
}
function section(raw: unknown, personal = false) {
  const s = exact(raw, personal ? ["revision", "limited", "items"] : ["limited", "items"]);
  if (s.limited !== false || !Array.isArray(s.items) || s.items.length > 100) return fail(); return s.items;
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as RecordValue, bb = b as RecordValue, keys = Object.keys(aa);
  return keys.length === Object.keys(bb).length && keys.every(key => Object.hasOwn(bb, key) && sameJson(aa[key], bb[key]));
}
function parseStoredJson(text: string): unknown {
  // JSON.parse alone silently accepts duplicate object keys, which PG JSONB
  // cannot emit. Check decoded key names while preserving the original bytes.
  const parsed: unknown = JSON.parse(text), stack: Array<Set<string> | null> = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "{") stack.push(new Set()); else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') { if (text[index] === "\\") index++; index++; }
      let after = index + 1; while (/\s/.test(text[after] ?? "") && after < text.length) after++;
      if (text[after] === ":") {
        const key: string = JSON.parse(text.slice(start, index + 1)), keys = stack.at(-1);
        if (!keys || keys.has(key)) return fail(); keys.add(key);
      }
    }
  }
  tree(parsed); return parsed;
}
function sourceArchive(text: string, q: RuleCapturesQuery, c: RuleCapturesCommand, actor: string, sourceReadAt: string) {
  const s = exact(parseStoredJson(text), ["protocol", "siteId", "actorId", "fromDate", "throughDate", "worker", "settingsVersion", "timeZone", "fromAt", "toAt", "readAt", "assignments", "rules", "personal"]);
  const w = exact(s.worker, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
  if (s.protocol !== "rule-sources-v1" || s.siteId !== q.siteId || s.actorId !== actor || w.workerId !== q.workerId
    || w.employeeId !== c.employeeId || w.employeeAuthUserId !== c.employeeAuthUserId || s.fromDate !== c.fromDate || s.throughDate !== c.throughDate
    || instant(s.readAt, 6) !== sourceReadAt || instant(s.fromAt, 3) >= instant(s.toAt, 3)) fail();
  label(w.workerName, 120); label(w.workerNo, 40); integer(w.version); integer(s.settingsVersion); label(s.timeZone, 100);
  if (!bool(w.active) || !bool(w.employeeActive)) fail();
  const groups = new Map<string, RecordValue>(); let previousAssignment = "";
  for (const raw of section(s.assignments)) {
    const a = assignment(raw, s, w), id = a.item.assignmentId as string, gid = a.group.groupId as string;
    if (id <= previousAssignment || groups.has(gid) && !sameJson(groups.get(gid), a.group)) fail();
    previousAssignment = id; groups.set(gid, a.group);
  }
  let publicationCount = 0, previousGroup = ""; const publicationIds = new Set<string>(), streams = section(s.rules);
  if (streams.length !== groups.size + 1) fail();
  streams.forEach((raw, index) => {
    const stream = exact(raw, ["groupId", "revision", "publications"]), gid = stream.groupId === null ? null : uuid(stream.groupId), revision = integer(stream.revision, 0);
    if (index === 0 ? gid !== null : gid === null || gid <= previousGroup || !groups.has(gid)) fail(); previousGroup = gid ?? "";
    if (!Array.isArray(stream.publications) || (publicationCount += stream.publications.length) > 100) return fail();
    let previous: RecordValue | null = null, carry = 0;
    for (const rawPublication of stream.publications) {
      const p = exact(rawPublication, publicationKeys), op = uuid(p.operationId); uuid(p.actorId); label(p.reason, 200); label(p.timeZone, 100); date(p.effectiveOn); rules(p.rules);
      const effectiveAt = instant(p.effectiveAt, 3), recordedAt = instant(p.recordedAt, 6); integer(p.revision, 1, revision);
      if (p.action !== "publish" || p.publishedRevision !== null || publicationIds.has(op) || integer(p.settingsVersion) > (s.settingsVersion as number)
        || (gid === null ? p.groupRevision !== null : integer(p.groupRevision) > (groups.get(gid)!.revision as number))
        || effectiveAt >= (s.toAt as string) || recordedAt > sourceReadAt || recordedAt >= micros(effectiveAt)
        || previous && ((p.revision as number) <= (previous.revision as number) || effectiveAt <= (previous.effectiveAt as string) || recordedAt < (previous.recordedAt as string))) fail();
      if (effectiveAt <= (s.fromAt as string) && ++carry > 1) fail(); publicationIds.add(op); previous = p;
    }
  });
  const personal = exact(s.personal, ["revision", "limited", "items"]), revision = integer(personal.revision, 0), operations: RecordValue[] = [];
  let previousRevision = 0;
  for (const raw of section(personal, true)) {
    const pair = exact(raw, ["approval", "withdrawal"]), p = personalItem(pair.approval, s, w, revision);
    if (p.action !== "approve" || (p.revision as number) <= previousRevision) fail(); previousRevision = p.revision as number; operations.push(p);
    if (pair.withdrawal !== null) {
      const d = personalItem(pair.withdrawal, s, w, revision);
      if (d.action !== "withdraw" || d.approvedRevision !== p.revision || (d.recordedAt as string) < (p.recordedAt as string)
        || personalContext.some(key => !sameJson(d[key], p[key]))) fail(); operations.push(d);
    }
  }
  if (new Set(operations.map(p => p.operationId)).size !== operations.length || new Set(operations.map(p => p.revision)).size !== operations.length) fail();
  operations.sort((a, b) => (a.revision as number) - (b.revision as number));
  for (let index = 1; index < operations.length; index++) if ((operations[index].recordedAt as string) < (operations[index - 1].recordedAt as string)) fail();
  // Preserve complete but candidate-blocked observations (including overlapping
  // assignments/personal intervals or inactive groups). This is not a resolver.
}

export function parseRuleCapturesResult(raw: unknown, input: RuleCapturesQuery, command: RuleCapturesCommand | null = null, expectedActorId?: string): RuleCapturesResult {
  const query = parseRuleCapturesQuery(input), requested = command === null ? null : parseRuleCapturesBody({ query, command }).command;
  try {
    tree(raw); const v = exact(raw, ["protocol", "siteId", "actorId", "workerId", "operationId", "receipt", "readAt"]), actorId = uuid(v.actorId), readAt = instant(v.readAt, 6);
    if (v.protocol !== "candidate-rule-captures-v1" || v.siteId !== query.siteId || v.workerId !== query.workerId || v.operationId !== query.operationId
      || expectedActorId !== undefined && actorId !== uuid(expectedActorId)) fail();
    let receipt: RuleCapturesReceipt | null = null;
    if (v.receipt !== null) {
      const r = exact(v.receipt, ["operationId", "actorId", "command", "observedAt", "recordedAt", "sourceId", "sourceReadAt", "sourceText", "sourceSha256", "sourceBytes", "canonicalFormat", "applied", "historicalApplicationProven"]);
      const saved = parseRuleCapturesCommand(r.command), sourceReadAt = instant(r.sourceReadAt, 6), observedAt = instant(r.observedAt, 6), recordedAt = instant(r.recordedAt, 6);
      if (r.operationId !== query.operationId || r.actorId !== actorId || saved.operationId !== query.operationId || requested && !sameJson(saved, requested)
        || sourceReadAt > observedAt || observedAt > recordedAt || recordedAt > readAt || r.canonicalFormat !== "pg-jsonb-text-utf8-v1"
        || r.applied !== false || r.historicalApplicationProven !== false || typeof r.sourceText !== "string"
        || typeof r.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.sourceSha256)) fail();
      const sourceText = r.sourceText as string, bytes = new TextEncoder().encode(sourceText), sourceBytes = integer(r.sourceBytes, 1, MAX_BYTES);
      if (bytes.byteLength !== sourceBytes || createHash("sha256").update(bytes).digest("hex") !== r.sourceSha256) fail();
      sourceArchive(sourceText, query, saved, actorId, sourceReadAt);
      receipt = { operationId: query.operationId, actorId, command: saved, observedAt, recordedAt, sourceId: uuid(r.sourceId), sourceReadAt,
        sourceText, sourceSha256: r.sourceSha256 as string, sourceBytes, canonicalFormat: "pg-jsonb-text-utf8-v1", applied: false, historicalApplicationProven: false };
    } else if (requested) fail();
    return { protocol: "candidate-rule-captures-v1", ...query, actorId, receipt, readAt };
  } catch { return fail(); }
}
