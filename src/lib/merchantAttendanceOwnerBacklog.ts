import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

// Rank is part of the wire contract; never rely on database/default collation.
export const OWNER_BACKLOG_KINDS = ["correction", "revision", "missing"] as const;
export type OwnerBacklogKind = typeof OWNER_BACKLOG_KINDS[number];
export type OwnerBacklogCursor = { recordedAt: string; kind: OwnerBacklogKind; requestId: string };
export type OwnerBacklogQuery = { siteId: string; kind: "all" | OwnerBacklogKind; asOf: string | null;
  cursorAt: string | null; cursorKind: OwnerBacklogKind | null; cursorId: string | null };
export type OwnerBacklogItem = { kind: OwnerBacklogKind; requestId: string; workerId: string; workerName: string;
  workerNo: string; submittedAt: string; proposedStartAt: string; proposedEndAt: string; status: "submitted" };
export type OwnerBacklogResult = { protocol: "owner-backlog-v1"; readOnly: true; siteId: string; ownerId: string;
  asOf: string; items: OwnerBacklogItem[]; scanned: number; nextCursor: OwnerBacklogCursor | null };
export const OWNER_BACKLOG_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_invalid_instant: 400, attendance_access_denied: 403,
  attendance_settings_required: 409, attendance_rate_limited: 429, attendance_not_available: 404,
  attendance_owner_backlog_invalid: 503, attendance_owner_backlog_too_large: 422, attendance_unavailable: 503,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) fail();
  return record;
}
function kind(value: unknown): OwnerBacklogKind {
  return OWNER_BACKLOG_KINDS.includes(value as OwnerBacklogKind) ? value as OwnerBacklogKind : fail();
}
function instant(value: unknown) { const result = attendanceRecordInstant(value); return result === value ? result : fail(); }
function label(value: unknown, max: number) {
  return typeof value === "string" && value.trim() && [...value].length <= max
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value : fail();
}
function compare(a: OwnerBacklogCursor, b: OwnerBacklogCursor): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  const rank = OWNER_BACKLOG_KINDS.indexOf(a.kind) - OWNER_BACKLOG_KINDS.indexOf(b.kind);
  if (rank) return rank;
  return a.requestId === b.requestId ? 0 : a.requestId < b.requestId ? -1 : 1;
}
export function parseOwnerBacklogQuery(raw: unknown): OwnerBacklogQuery {
  const value = object(raw, ["siteId", "kind", "asOf", "cursorAt", "cursorKind", "cursorId"]);
  const filter = value.kind === "all" ? "all" : kind(value.kind);
  const asOf = value.asOf === null ? null : instant(value.asOf), cursorAt = value.cursorAt === null ? null : instant(value.cursorAt);
  const cursorKind = value.cursorKind === null ? null : kind(value.cursorKind), cursorId = value.cursorId === null ? null : attendanceSelfUuid(value.cursorId);
  if ((cursorAt === null) !== (cursorKind === null) || (cursorAt === null) !== (cursorId === null)
    || cursorAt && (!asOf || cursorAt > asOf || filter !== "all" && cursorKind !== filter)) fail();
  return { siteId: attendanceSelfSite(value.siteId), kind: filter, asOf, cursorAt, cursorKind, cursorId };
}
export function parseOwnerBacklogHttpQuery(url: string) {
  const params = new URL(url).searchParams, value: Record<string, unknown> = { asOf: null, cursorAt: null, cursorKind: null, cursorId: null };
  for (const [key, entry] of params) { if (params.getAll(key).length !== 1) fail(); value[key] = entry; }
  return parseOwnerBacklogQuery(value);
}
export const ownerBacklogQueryString = (query: OwnerBacklogQuery) =>
  new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== null)).toString();

export function parseOwnerBacklogResult(raw: unknown, input: OwnerBacklogQuery): OwnerBacklogResult {
  const query = parseOwnerBacklogQuery(input);
  const value = object(raw, ["protocol", "readOnly", "siteId", "ownerId", "asOf", "items", "scanned", "nextCursor"]);
  const ownerId = attendanceSelfUuid(value.ownerId), asOf = instant(value.asOf);
  if (value.protocol !== "owner-backlog-v1" || value.readOnly !== true || value.siteId !== query.siteId
    || query.asOf !== null && asOf !== query.asOf || query.cursorAt && query.cursorAt > asOf
    || !Number.isInteger(value.scanned) || Number(value.scanned) < 0 || Number(value.scanned) > 50
    || !Array.isArray(value.items) || value.items.length > Number(value.scanned)) fail();
  const initial: OwnerBacklogCursor | null = query.cursorAt ? { recordedAt: query.cursorAt, kind: query.cursorKind!, requestId: query.cursorId! } : null;
  let previous = initial;
  const identities = new Set<string>();
  const items = (value.items as unknown[]).map(rawItem => {
    const row = object(rawItem, ["kind", "requestId", "workerId", "workerName", "workerNo", "submittedAt", "proposedStartAt", "proposedEndAt", "status"]);
    const source = kind(row.kind), requestId = attendanceSelfUuid(row.requestId), workerId = attendanceSelfUuid(row.workerId);
    const submittedAt = instant(row.submittedAt), proposedStartAt = instant(row.proposedStartAt), proposedEndAt = instant(row.proposedEndAt);
    const position = { recordedAt: submittedAt, kind: source, requestId }, identity = `${source}:${requestId}`;
    if (row.status !== "submitted" || query.kind !== "all" && source !== query.kind || submittedAt > asOf
      || proposedStartAt >= proposedEndAt || proposedEndAt > submittedAt || identities.has(identity)
      || previous && compare(position, previous) <= 0) fail();
    identities.add(identity); previous = position;
    return { kind: source, requestId, workerId, workerName: label(row.workerName, 120), workerNo: label(row.workerNo, 40),
      submittedAt, proposedStartAt, proposedEndAt, status: "submitted" as const };
  });
  let nextCursor: OwnerBacklogCursor | null = null;
  if (value.nextCursor !== null) {
    const cursor = object(value.nextCursor, ["recordedAt", "kind", "requestId"]);
    nextCursor = { recordedAt: instant(cursor.recordedAt), kind: kind(cursor.kind), requestId: attendanceSelfUuid(cursor.requestId) };
    // Last scanned candidate, not last pending result. Empty intermediate pages
    // are intentional; closed requests must not induce an unbounded query.
    if (value.scanned !== 50 || nextCursor.recordedAt > asOf || query.kind !== "all" && nextCursor.kind !== query.kind
      || initial && compare(nextCursor, initial) <= 0 || previous && compare(nextCursor, previous) < 0) fail();
  }
  return { protocol: "owner-backlog-v1", readOnly: true, siteId: query.siteId, ownerId, asOf, items, scanned: Number(value.scanned), nextCursor };
}
export function parseOwnerBacklogResponse(raw: unknown, query: OwnerBacklogQuery) {
  const value = object(raw, ["ok", "moduleEnabled", "protocol", "readOnly", "siteId", "ownerId", "asOf", "items", "scanned", "nextCursor"]);
  if (value.ok !== true || typeof value.moduleEnabled !== "boolean") fail();
  const { ok, moduleEnabled, ...body } = value; void ok;
  return { ...parseOwnerBacklogResult(body, query), moduleEnabled: moduleEnabled as boolean };
}
