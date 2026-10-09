import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { periodAdministrativeHoursUnassessed } from "./merchantAttendancePeriodAdministrativeContext";
import { parsePeriodClosureArtifact, periodClosureFail, periodClosureObject, periodClosureSame, periodClosureMessage, PERIOD_CLOSURE_ERRORS,
  type PeriodClosureArtifact, type PeriodClosureCommand, type PeriodClosureEntry, type PeriodClosureIdentity,
  type PeriodClosureSummary } from "./merchantAttendancePeriodClosure";

export const PERIOD_CLOSURE_V2_MAX = 2147483647;
export const PERIOD_CLOSURE_V2_ERRORS: Readonly<Record<string, number>> = { ...PERIOD_CLOSURE_ERRORS, attendance_period_protocol_required: 409, attendance_period_storage_limit: 422 };
export function periodClosureV2Message(code: string) {
  return code === "attendance_period_protocol_required" ? "此周期须使用长期续办协议核对；原操作编号保留，不表示操作失败。"
    : code === "attendance_period_storage_limit" ? "保存正文已达现有64 MiB预算；未删除旧档或自动提额，仍可按权限核对原号和已保存版本。"
    : code === "attendance_period_limit" ? "周期序号已达可表示上限，不能新增操作；原记录保留。" : periodClosureMessage(code);
}
type Scope = { siteId: string; access: "owner" | "self"; workerId: string; fromDate: string; throughDate: string; periodId: string | null };
type CursorScope = Scope & { kind: "list" | "history" | "versions" };
export type PeriodClosureV2Cursor =
  | CursorScope & { kind: "list"; periodId: null; atOpenedAt: string; atPeriodId: string; beforeOpenedAt: string; beforePeriodId: string }
  | CursorScope & { kind: "history"; periodId: string; atRevision: number; beforeRevision: number }
  | CursorScope & { kind: "versions"; periodId: string; atVersion: number; beforeVersion: number };
export type PeriodClosureV2Query = Scope & { mode: "list" | "preview" | "detail" | "recover" | "export" | "history" | "versions";
  operationId: string | null; version: number | null; cursor: PeriodClosureV2Cursor | null };
export type PeriodClosureV2Command = PeriodClosureCommand;
export type PeriodClosureV2Summary = PeriodClosureSummary;
export type PeriodClosureV2Entry = PeriodClosureEntry;
export type PeriodClosureV2ListItem = PeriodClosureV2Summary & { openedAt: string };
export type PeriodClosureV2Version = { version: number; operationId: string; recordedAt: string; artifactId: string;
  sourceFingerprint: string; artifactBytes: number; artifactSha256: string };
type Common = { protocol: "period-closure-v2"; siteId: string; workerId: string; actorId: string; access: "owner" | "self"; readAt: string };
export type PeriodClosureV2Result = Common & (
  | { kind: "list"; items: PeriodClosureV2ListItem[]; nextCursor: PeriodClosureV2Cursor | null }
  | { kind: "preview"; preview: { artifact: PeriodClosureArtifact; blockers: string[]; period: PeriodClosureV2Summary | null } }
  | { kind: "detail"; period: PeriodClosureV2Summary; artifact: PeriodClosureArtifact | null; artifactVersion: number | null;
    sourceChanged: boolean | null; operation: PeriodClosureV2Entry | null; replayed: boolean }
  | { kind: "history"; period: PeriodClosureV2Summary; items: PeriodClosureV2Entry[]; nextCursor: PeriodClosureV2Cursor | null }
  | { kind: "versions"; period: PeriodClosureV2Summary; items: PeriodClosureV2Version[]; nextCursor: PeriodClosureV2Cursor | null });
export type PeriodClosureV2Response = { ok: true; moduleEnabled: boolean; data: PeriodClosureV2Result };

function fail(code?: string): never { return periodClosureFail(code); }
const obj = periodClosureObject;
const exact = (raw: unknown, keys: readonly string[]) => { const v = obj(raw); if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(); return v; };
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const text = (v: unknown, max: number, empty = false): string => typeof v === "string" && v === v.trim() && v.length <= max && (empty || v.length > 0) && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail();
const integer = (v: unknown, min = 0, max = PERIOD_CLOSURE_V2_MAX): number => Number.isSafeInteger(v) && !Object.is(v, -0) && Number(v) >= min && Number(v) <= max ? Number(v) : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const date = (v: unknown): string => typeof v === "string" && /^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v ? v : fail();
const instant = (v: unknown, six = false): string => typeof v === "string" && /^(?:20\d{2}|2100|2101)-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(v)
  && (!six || v.length === 27) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 23) === v.slice(0, 23) ? v : fail();
const timeKey = (s: string) => s.length === 24 ? s.slice(0, -1) + "000Z" : s;
const scopeKeys = ["siteId", "access", "workerId", "fromDate", "throughDate", "periodId"] as const;
const queryKeys = [...scopeKeys, "mode", "operationId", "version", "cursor"];
function bounded(raw: unknown) {
  let count = 0;
  function walk(v: unknown, depth: number) {
    if (++count > 160000 || depth > 32) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) fail(); return; }
    if (typeof v === "string") { if (v.length > 2097152) fail(); return; }
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || v.length > 5000 || Object.keys(v).length !== v.length
        || Object.entries(Object.getOwnPropertyDescriptors(v)).some(([k, d]) => k !== "length" && (!/^(0|[1-9]\d*)$/.test(k) || !Object.hasOwn(d, "value") || !d.enumerable))) fail();
      for (const x of v) walk(x, depth + 1); return;
    }
    for (const x of Object.values(obj(v))) walk(x, depth + 1);
  }
  walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).length > 4194304) fail();
}
const cursorScope = (q: PeriodClosureV2Query) => ({ kind: q.mode, ...Object.fromEntries(scopeKeys.map(k => [k, q[k]])) });
const tupleCompare = (a: { openedAt: string; periodId: string }, b: { openedAt: string; periodId: string }) =>
  a.openedAt === b.openedAt ? a.periodId === b.periodId ? 0 : a.periodId < b.periodId ? -1 : 1 : a.openedAt < b.openedAt ? -1 : 1;
function cursor(raw: unknown, q: PeriodClosureV2Query): PeriodClosureV2Cursor {
  const v = obj(raw), keys = ["kind", ...scopeKeys];
  for (const k of keys) if (v[k] !== (k === "kind" ? q.mode : q[k as keyof Scope])) fail();
  if (q.mode === "list") {
    exact(v, [...keys, "atOpenedAt", "atPeriodId", "beforeOpenedAt", "beforePeriodId"]);
    const atOpenedAt = instant(v.atOpenedAt, true), atPeriodId = uuid(v.atPeriodId), beforeOpenedAt = instant(v.beforeOpenedAt, true), beforePeriodId = uuid(v.beforePeriodId);
    if (q.periodId !== null || tupleCompare({ openedAt: beforeOpenedAt, periodId: beforePeriodId }, { openedAt: atOpenedAt, periodId: atPeriodId }) > 0) fail();
    return { ...cursorScope(q), kind: "list", periodId: null, atOpenedAt, atPeriodId, beforeOpenedAt, beforePeriodId } as PeriodClosureV2Cursor;
  }
  if (q.mode === "history") {
    exact(v, [...keys, "atRevision", "beforeRevision"]); const atRevision = integer(v.atRevision, 1), beforeRevision = integer(v.beforeRevision, 1, atRevision);
    return { ...cursorScope(q), kind: "history", periodId: uuid(q.periodId), atRevision, beforeRevision } as PeriodClosureV2Cursor;
  }
  if (q.mode === "versions") {
    exact(v, [...keys, "atVersion", "beforeVersion"]); const atVersion = integer(v.atVersion, 1), beforeVersion = integer(v.beforeVersion, 1, atVersion);
    return { ...cursorScope(q), kind: "versions", periodId: uuid(q.periodId), atVersion, beforeVersion } as PeriodClosureV2Cursor;
  }
  return fail();
}
export function parsePeriodClosureV2Query(raw: unknown): PeriodClosureV2Query {
  try {
    const v = exact(raw, queryKeys), siteId = text(v.siteId, 8), access = v.access, mode = v.mode;
    if (!/^\d{8}$/.test(siteId) || access !== "owner" && access !== "self" || !["list", "preview", "detail", "recover", "export", "history", "versions"].includes(String(mode))) fail();
    const fromDate = date(v.fromDate), throughDate = date(v.throughDate), days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000;
    if (days < 0 || days > 30) fail();
    const periodId = v.periodId === null ? null : uuid(v.periodId), operationId = v.operationId === null ? null : uuid(v.operationId), version = v.version === null ? null : integer(v.version, 1);
    if (mode === "list" && (periodId !== null || operationId !== null || version !== null)
      || mode === "preview" && (operationId !== null || version !== null)
      || !["list", "preview"].includes(String(mode)) && periodId === null
      || (mode === "recover") !== (operationId !== null) || mode === "export" && version === null
      || ["history", "versions", "recover"].includes(String(mode)) && version !== null) fail();
    const q: PeriodClosureV2Query = { siteId, access: access as Scope["access"], workerId: uuid(v.workerId), fromDate, throughDate,
      mode: mode as PeriodClosureV2Query["mode"], periodId, operationId, version, cursor: null };
    if (v.cursor !== null) q.cursor = cursor(v.cursor, q); return q;
  } catch { return fail("attendance_invalid_request"); }
}
export function periodClosureV2QueryString(raw: PeriodClosureV2Query) {
  const q = parsePeriodClosureV2Query(raw), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, k === "cursor" ? JSON.stringify(v) : String(v)); return p.toString();
}
export function parsePeriodClosureV2HttpQuery(url: string): PeriodClosureV2Query {
  try {
    if (typeof url !== "string" || url.length > 8192 || /[\u0000-\u0020\u007f]/.test(url) || /%(?![0-9a-f]{2})/i.test(url)) fail();
    const u = new URL(url); if (url.includes("#") || u.username || u.password || !["https:", "http:"].includes(u.protocol)) fail();
    const p = u.searchParams; for (const k of p.keys()) if (!queryKeys.includes(k) || p.getAll(k).length !== 1) fail();
    const raw: Record<string, unknown> = Object.fromEntries(queryKeys.map(k => [k, p.get(k)]));
    if (raw.version !== null) { if (typeof raw.version !== "string" || !/^[1-9]\d{0,9}$/.test(raw.version)) fail(); raw.version = Number(raw.version); }
    if (raw.cursor !== null) { if (typeof raw.cursor !== "string" || raw.cursor.length > 2048) fail(); raw.cursor = parseCaptureBrowserJson(raw.cursor); }
    return parsePeriodClosureV2Query(raw);
  } catch { return fail("attendance_invalid_request"); }
}
function command(raw: unknown): PeriodClosureV2Command {
  const v = exact(raw, ["action", "operationId", "periodId", "expectedRevision", "expectedVersion", "expectedFingerprint", "reason"]);
  if (!["send", "confirm", "dispute", "respond", "seal", "reopen"].includes(String(v.action))) fail();
  const action = v.action as PeriodClosureV2Command["action"], expectedRevision = integer(v.expectedRevision, 0, PERIOD_CLOSURE_V2_MAX - 1), expectedVersion = integer(v.expectedVersion, 0, expectedRevision);
  const expectedFingerprint = v.expectedFingerprint === null ? null : hash(v.expectedFingerprint), reason = text(v.reason, 500, ["send", "confirm"].includes(action));
  if (action !== "send" && (expectedRevision === 0 || expectedVersion === 0) || ["send", "confirm", "seal"].includes(action) && expectedFingerprint === null) fail();
  return { action, operationId: uuid(v.operationId), periodId: uuid(v.periodId), expectedRevision, expectedVersion, expectedFingerprint, reason };
}
export function parsePeriodClosureV2Command(q: PeriodClosureV2Query, raw: unknown): PeriodClosureV2Command {
  try { const query = parsePeriodClosureV2Query(q), c = command(raw);
    if (query.mode !== "detail" || query.periodId !== c.periodId || query.version !== null || query.cursor !== null
      || query.access === "owner" && ["confirm", "dispute"].includes(c.action) || query.access === "self" && !["confirm", "dispute"].includes(c.action)) fail(); return c;
  } catch { return fail("attendance_invalid_request"); }
}
export function parsePeriodClosureV2Body(raw: unknown) { try { const v = exact(raw, ["query", "command"]), query = parsePeriodClosureV2Query(v.query); return { query, command: parsePeriodClosureV2Command(query, v.command) }; } catch { return fail("attendance_invalid_request"); } }
const summaryKeys = ["workerId", "employeeId", "employeeAuthUserId", "workerName", "workerNo", "fromDate", "throughDate", "timeZone", "startAt", "endAt", "periodId", "revision", "currentVersion", "state", "sealed", "confirmedVersion", "unresolvedDispute"];
function summary(raw: unknown, q: PeriodClosureV2Query, who: PeriodClosureIdentity): PeriodClosureV2Summary {
  const v = exact(raw, summaryKeys), revision = integer(v.revision, 1), currentVersion = integer(v.currentVersion, 1, revision), confirmedVersion = v.confirmedVersion === null ? null : integer(v.confirmedVersion, 1, currentVersion);
  const workerId = uuid(v.workerId), employeeId = uuid(v.employeeId), employeeAuthUserId = uuid(v.employeeAuthUserId), fromDate = date(v.fromDate), throughDate = date(v.throughDate), startAt = instant(v.startAt), endAt = instant(v.endAt);
  const sealed = bool(v.sealed), unresolvedDispute = bool(v.unresolvedDispute), state = v.state as PeriodClosureV2Summary["state"];
  if (workerId !== q.workerId || (q.mode === "list" ? fromDate > q.throughDate || throughDate < q.fromDate : fromDate !== q.fromDate || throughDate !== q.throughDate)
    || fromDate > throughDate || (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 > 30 || timeKey(startAt) >= timeKey(endAt)
    || q.access === "self" && (who.employeeId && who.employeeId !== employeeId || who.authUserId && who.authUserId !== employeeAuthUserId)
    || !["open", "review", "confirmed", "disputed", "sealed"].includes(state) || sealed !== (state === "sealed") || sealed && (confirmedVersion !== currentVersion || revision === PERIOD_CLOSURE_V2_MAX)) fail();
  return { workerId, employeeId, employeeAuthUserId, workerName: text(v.workerName, 120), workerNo: text(v.workerNo, 40), fromDate, throughDate, timeZone: text(v.timeZone, 100), startAt, endAt,
    periodId: uuid(v.periodId), revision, currentVersion, state, sealed, confirmedVersion, unresolvedDispute };
}
function entry(raw: unknown, q: PeriodClosureV2Query, readAt: string): PeriodClosureV2Entry {
  const v = exact(raw, ["operationId", "revision", "action", "version", "actorId", "reason", "recordedAt", "command"]), c = command(v.command);
  const revision = integer(v.revision, 1), version = integer(v.version, 1, revision), recordedAt = instant(v.recordedAt);
  if (c.periodId !== q.periodId || v.action !== c.action || v.operationId !== c.operationId || v.reason !== c.reason || revision !== c.expectedRevision + 1
    || version !== c.expectedVersion && (c.action !== "send" || version !== c.expectedVersion + 1) || timeKey(recordedAt) > timeKey(readAt)) fail();
  return { operationId: c.operationId, revision, action: c.action, version, actorId: uuid(v.actorId), reason: c.reason, recordedAt, command: c };
}
function bindArtifact(a: PeriodClosureArtifact, p: PeriodClosureV2Summary | null, q: PeriodClosureV2Query, who: PeriodClosureIdentity) {
  if (a.protocol === "attendance-period-artifact-v2" && (a.authority.siteId !== q.siteId || a.authority.periodId !== (p?.periodId ?? q.periodId))) fail();
  if (a.worker.workerId !== q.workerId || a.period.fromDate !== q.fromDate || a.period.throughDate !== q.throughDate
    || q.access === "self" && (who.employeeId && a.worker.employeeId !== who.employeeId || who.authUserId && a.worker.employeeAuthUserId !== who.authUserId)
    || p && (a.worker.employeeId !== p.employeeId || a.worker.employeeAuthUserId !== p.employeeAuthUserId || a.period.timeZone !== p.timeZone || a.period.startAt !== p.startAt || a.period.endAt !== p.endAt)) fail();
}
export function parsePeriodClosureV2Result(raw: unknown, query: PeriodClosureV2Query, identity: PeriodClosureIdentity = {}, cmd: PeriodClosureV2Command | null = null): PeriodClosureV2Result {
  bounded(raw); const q = parsePeriodClosureV2Query(query), v = obj(raw), kind = v.kind;
  const fields = kind === "list" ? ["items", "nextCursor"] : kind === "preview" ? ["preview"] : kind === "history" || kind === "versions" ? ["period", "items", "nextCursor"] : ["period", "artifact", "artifactVersion", "sourceChanged", "operation", "replayed"];
  exact(v, ["protocol", "siteId", "workerId", "actorId", "access", "readAt", "kind", ...fields]);
  if (v.protocol !== "period-closure-v2" || v.siteId !== q.siteId || v.workerId !== q.workerId || v.access !== q.access) fail();
  const actorId = uuid(v.actorId), readAt = instant(v.readAt);
  if (identity.authUserId && identity.authUserId !== actorId || q.access === "owner" && identity.ownerId && identity.ownerId !== actorId) fail();
  const who = q.access === "self" ? { ...identity, authUserId: actorId } : identity;
  const common: Common = { protocol: "period-closure-v2", siteId: q.siteId, workerId: q.workerId, actorId, access: q.access, readAt };
  if (kind === "list" && q.mode === "list" && cmd === null) {
    if (!Array.isArray(v.items) || v.items.length > 25) fail();
    const items = v.items.map(raw => { const x = exact(raw, [...summaryKeys, "openedAt"]), openedAt = instant(x.openedAt, true); if (timeKey(openedAt) > timeKey(readAt)) fail();
      return { ...summary(Object.fromEntries(summaryKeys.map(k => [k, x[k]])), q, who), openedAt }; });
    const bound = q.cursor?.kind === "list" ? q.cursor : null;
    if (new Set(items.map(x => x.periodId)).size !== items.length || items.some((x, i) => i > 0 && tupleCompare(items[i - 1], x) <= 0
      || bound && (tupleCompare(x, { openedAt: bound.atOpenedAt, periodId: bound.atPeriodId }) > 0 || tupleCompare(x, { openedAt: bound.beforeOpenedAt, periodId: bound.beforePeriodId }) >= 0))) fail();
    const nextCursor = v.nextCursor === null ? null : cursor(v.nextCursor, q);
    if (nextCursor !== null) { if (nextCursor.kind !== "list" || items.length !== 25) fail(); const last = items.at(-1)!, first = items[0];
      if (nextCursor.beforeOpenedAt !== last.openedAt || nextCursor.beforePeriodId !== last.periodId || nextCursor.atOpenedAt !== (bound?.atOpenedAt ?? first.openedAt) || nextCursor.atPeriodId !== (bound?.atPeriodId ?? first.periodId)) fail(); }
    return { ...common, kind: "list", items, nextCursor };
  }
  if (kind === "preview" && q.mode === "preview" && cmd === null) {
    const x = exact(v.preview, ["artifact", "blockers", "period"]), artifact = parsePeriodClosureArtifact(x.artifact), p = x.period === null ? null : summary(x.period, q, who);
    if (q.periodId !== (p?.periodId ?? null) || !Array.isArray(x.blockers) || x.blockers.length > 30) fail();
    const blockers = x.blockers.map(b => text(b, 100)); if (new Set(blockers).size !== blockers.length || periodAdministrativeHoursUnassessed(artifact.source) !== blockers.includes("administrative_hours_unassessed")) fail(); bindArtifact(artifact, p, q, who);
    return { ...common, kind: "preview", preview: { artifact, blockers, period: p } };
  }
  if (kind === "history" && q.mode === "history" && cmd === null || kind === "versions" && q.mode === "versions" && cmd === null) {
    const p = summary(v.period, q, who); if (p.periodId !== q.periodId || !Array.isArray(v.items)) fail();
    const nextCursor = v.nextCursor === null ? null : cursor(v.nextCursor, q);
    if (kind === "history") {
      const bound = q.cursor?.kind === "history" ? q.cursor : null, at = bound?.atRevision ?? p.revision, top = bound ? bound.beforeRevision - 1 : at;
      if (at > p.revision || v.items.length !== Math.min(50, top)) fail();
      const items = v.items.map(x => entry(x, q, readAt));
      if (items.some((x, i) => x.revision !== top - i || x.version > p.currentVersion) || new Set(items.map(x => x.operationId)).size !== items.length) fail();
      const remaining = top - items.length;
      if (remaining > 0 ? nextCursor?.kind !== "history" || nextCursor.atRevision !== at || nextCursor.beforeRevision !== items.at(-1)!.revision : nextCursor !== null) fail();
      return { ...common, kind: "history", period: p, items, nextCursor };
    }
    const bound = q.cursor?.kind === "versions" ? q.cursor : null, at = bound?.atVersion ?? p.currentVersion, top = bound ? bound.beforeVersion - 1 : at;
    if (at > p.currentVersion || v.items.length !== Math.min(20, top)) fail();
    const items = v.items.map(raw => { const x = exact(raw, ["version", "operationId", "recordedAt", "artifactId", "sourceFingerprint", "artifactBytes", "artifactSha256"]), recordedAt = instant(x.recordedAt);
      if (timeKey(recordedAt) > timeKey(readAt)) fail(); return { version: integer(x.version, 1), operationId: uuid(x.operationId), recordedAt, artifactId: uuid(x.artifactId),
        sourceFingerprint: hash(x.sourceFingerprint), artifactBytes: integer(x.artifactBytes, 1, 2097152), artifactSha256: hash(x.artifactSha256) }; });
    if (items.some((x, i) => x.version !== top - i) || new Set(items.map(x => x.operationId)).size !== items.length) fail();
    const remaining = top - items.length;
    if (remaining > 0 ? nextCursor?.kind !== "versions" || nextCursor.atVersion !== at || nextCursor.beforeVersion !== items.at(-1)!.version : nextCursor !== null) fail();
    return { ...common, kind: "versions", period: p, items, nextCursor };
  }
  if (kind !== "detail" || !["detail", "recover", "export"].includes(q.mode)) fail();
  const p = summary(v.period, q, who); if (p.periodId !== q.periodId) fail();
  const artifact = v.artifact === null ? null : parsePeriodClosureArtifact(v.artifact), artifactVersion = v.artifactVersion === null ? null : integer(v.artifactVersion, 1, p.currentVersion);
  if ((artifact === null) !== (artifactVersion === null) || q.version !== null && q.version !== artifactVersion) fail(); if (artifact) bindArtifact(artifact, p, q, who);
  const operation = v.operation === null ? null : entry(v.operation, q, readAt), replayed = bool(v.replayed), sourceChanged = v.sourceChanged === null ? null : bool(v.sourceChanged);
  if (operation && (operation.actorId !== actorId || operation.revision > p.revision || operation.version !== artifactVersion)
    || replayed && !operation || cmd && (!operation || !periodClosureSame(operation.command, cmd))
    || q.mode === "recover" && (!operation || operation.operationId !== q.operationId || !replayed)
    || (q.mode === "recover" || q.mode === "export" || q.version !== null) && sourceChanged !== null
    || cmd === null && q.mode !== "recover" && (operation !== null || replayed)
    || q.mode === "detail" && q.version === null && cmd === null && artifactVersion !== p.currentVersion) fail();
  return { ...common, kind: "detail", period: p, artifact, artifactVersion, sourceChanged, operation, replayed };
}
export function parsePeriodClosureV2Response(raw: unknown, q: PeriodClosureV2Query, who: PeriodClosureIdentity = {}, cmd: PeriodClosureV2Command | null = null): PeriodClosureV2Response {
  const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail(); return { ok: true, moduleEnabled: bool(v.moduleEnabled), data: parsePeriodClosureV2Result(v.data, q, who, cmd) };
}
