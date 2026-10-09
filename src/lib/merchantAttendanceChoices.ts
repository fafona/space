import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type AttendanceChoiceKind = "managers" | "workers" | "locations";
export type AttendanceChoice = { id: string; label: string; detail: string; eligible: boolean };
export type AttendanceChoicesQuery = { siteId: string; kind: AttendanceChoiceKind; search: string; cursor: string | null; ids?: string[] };
export type AttendanceChoicesResult = { siteId: string; kind: AttendanceChoiceKind; items: AttendanceChoice[]; nextCursor: string | null };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
export function parseAttendanceChoicesQuery(url: string): AttendanceChoicesQuery {
  const q = new URL(url).searchParams;
  for (const k of q.keys()) if (!["siteId", "kind", "search", "cursor", "ids"].includes(k) || q.getAll(k).length !== 1) fail();
  const kind = q.get("kind"), search = (q.get("search") ?? "").trim();
  if (!["managers", "workers", "locations"].includes(kind ?? "") || search.length > 80 || /[\u0000-\u001f\u007f]/.test(search)) fail();
  if (q.has("ids")) {
    if (q.has("search") || q.has("cursor")) fail();
    const raw = q.get("ids")!;
    if (raw.length > 25 * 37 - 1) fail();
    const ids = raw.split(",").map(attendanceSelfUuid);
    if (!ids.length || ids.length > 25 || new Set(ids).size !== ids.length) fail();
    return { siteId: attendanceSelfSite(q.get("siteId")), kind: kind as AttendanceChoiceKind, search: "", cursor: null, ids: ids.sort() };
  }
  return { siteId: attendanceSelfSite(q.get("siteId")), kind: kind as AttendanceChoiceKind, search,
    cursor: q.has("cursor") ? attendanceSelfUuid(q.get("cursor")) : null };
}
export function parseAttendanceChoicesResult(value: unknown, expected: AttendanceChoicesQuery): AttendanceChoicesResult {
  if (!value || typeof value !== "object") return fail();
  const o = value as Record<string, unknown>;
  if (o.siteId !== expected.siteId || o.kind !== expected.kind || !Array.isArray(o.items) || o.items.length > 25) return fail();
  let previous = expected.cursor;
  const items = Array.from(o.items, (raw): AttendanceChoice => {
    if (!raw || typeof raw !== "object") return fail();
    const r = raw as Record<string, unknown>, id = attendanceSelfUuid(r.id);
    if ((previous && id <= previous) || (expected.ids && !expected.ids.includes(id)) || typeof r.label !== "string" || !r.label.trim() || r.label.length > 120
      || typeof r.detail !== "string" || r.detail.length > 120 || /[\u0000-\u001f\u007f]/.test(r.label + r.detail)
      || typeof r.eligible !== "boolean") return fail();
    previous = id;
    return { id, label: r.label, detail: r.detail, eligible: r.eligible };
  });
  const nextCursor = o.nextCursor === null ? null : attendanceSelfUuid(o.nextCursor);
  if (expected.ids && nextCursor !== null) return fail();
  if (nextCursor && (items.length !== 25 || nextCursor !== items.at(-1)?.id)) return fail();
  return { siteId: expected.siteId, kind: expected.kind, items, nextCursor };
}
