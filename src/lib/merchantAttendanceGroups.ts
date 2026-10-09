import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceInstant, attendanceTimeZone, attendanceDayUtcRange, MerchantAttendanceError } from "./merchantAttendanceTime";

export type GroupsQuery = { siteId: string; view: "groups" | "members" | "context"; groupId: string | null; workerId: string | null; onDate: string | null; assignmentId: string | null; operationId: string | null; cursorId: string | null };
export type GroupsCommand = { operationId: string; reason: string } & (
  { action: "save_group"; groupId: string; expectedRevision: number; name: string; description: string; active: boolean } |
  { action: "assign"; groupId: string; workerId: string; expectedGroupRevision: number; expectedWorkerVersion: number; expectedSettingsVersion: number; timeZone: string; startsOn: string; endsOn: string | null } |
  { action: "end"; assignmentId: string; expectedRevision: 1; endsOn: string } |
  { action: "cancel"; assignmentId: string; expectedRevision: 1 | 2 });
export type GroupItem = { groupId: string; revision: number; name: string; description: string; active: boolean; createdAt: string; updatedAt: string };
export type GroupWorker = { workerId: string; workerName: string; workerNo: string; employeeId: string | null; version: number; active: boolean };
export type GroupAssignmentItem = { assignmentId: string; groupId: string; groupName: string; workerId: string; workerName: string; workerNo: string; employeeId: string | null;
  timeZone: string; startsOn: string; endsOn: string | null; createdAt: string; updatedAt: string; revision: 1 | 2 | 3; status: "assigned" | "ended" | "cancelled" };
export type GroupAssignmentDetail = GroupAssignmentItem & { history: { command: Exclude<GroupsCommand, { action: "save_group" }>; item: GroupAssignmentItem }[]; canEnd: boolean; canCancel: boolean };
export type GroupsResult = { protocol: "groups-v1"; siteId: string; actorId: string; settingsVersion: number; timeZone: string; view: GroupsQuery["view"];
  group: GroupItem | null; worker: GroupWorker | null; items: (GroupItem | GroupAssignmentItem)[]; nextCursor: string | null;
  detail: GroupAssignmentDetail | null; receipt: { command: GroupsCommand; item: GroupItem | GroupAssignmentItem } | null };
export type GroupsResponse = GroupsResult & { moduleEnabled: boolean };
export const GROUPS_ERRORS: Readonly<Record<string, number>> = {
  attendance_group_not_found: 404, attendance_group_inactive: 409, attendance_group_worker_inactive: 409, attendance_group_overlap: 409, attendance_group_closed: 409, attendance_group_invalid: 503,
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409, attendance_platform_paused: 403, attendance_version_conflict: 409,
  attendance_operation_conflict: 409, attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function exact(raw: unknown, keys: readonly string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  return v;
}
const integer = (v: unknown, min = 1, max = 9007199254740990) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
const uuidOrNull = (v: unknown) => v === null ? null : attendanceSelfUuid(v);
const instant = (v: unknown) => { try { const t = attendanceRecordInstant(v); return t === v ? t : fail(); } catch { return fail(); } };
const zone = (v: unknown) => { try { return typeof v === "string" ? attendanceTimeZone(v) : fail(); } catch { return fail(); } };
function label(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || !empty && !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  return v;
}
export function groupDate(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  try { attendanceInstant(v + "T00:00:00.000Z"); } catch { return fail(); } return v;
}
export function groupRange(startsOn: unknown, endsOn: unknown, timeZone?: unknown) {
  const start = groupDate(startsOn), end = endsOn === null ? null : groupDate(endsOn);
  if (end !== null && end < start) fail();
  if (timeZone !== undefined) {
    const z = zone(timeZone);
    try { attendanceDayUtcRange(start, z); if (end !== null) attendanceDayUtcRange(end, z); } catch { return fail(); }
  }
  return { startsOn: start, endsOn: end };
}
export function parseGroupsQuery(raw: unknown): GroupsQuery {
  const q = exact(raw, ["siteId", "view", "groupId", "workerId", "onDate", "assignmentId", "operationId", "cursorId"]);
  if (typeof q.view !== "string" || !["groups", "members", "context"].includes(q.view)) fail();
  if (q.view === "groups" && [q.groupId, q.workerId, q.onDate, q.assignmentId, q.operationId].some(v => v !== null)
    || q.view === "members" && (q.groupId === null && q.workerId === null || q.assignmentId !== null || q.operationId !== null)
    || q.view === "context" && (q.onDate !== null || q.cursorId !== null || q.assignmentId !== null && (q.groupId === null || q.workerId === null))) fail();
  return { siteId: attendanceSelfSite(q.siteId), view: q.view as GroupsQuery["view"], groupId: uuidOrNull(q.groupId), workerId: uuidOrNull(q.workerId),
    onDate: q.onDate === null ? null : groupDate(q.onDate), assignmentId: uuidOrNull(q.assignmentId), operationId: uuidOrNull(q.operationId), cursorId: uuidOrNull(q.cursorId) };
}
export function parseGroupsHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { groupId: null, workerId: null, onDate: null, assignmentId: null, operationId: null, cursorId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); q[key] = value; }
  return parseGroupsQuery(q);
}
export const groupsQueryString = (q: GroupsQuery) => new URLSearchParams(Object.entries(parseGroupsQuery(q)).filter((e): e is [string, string] => e[1] !== null)).toString();
export function parseGroupsCommand(raw: unknown): GroupsCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const action = (raw as Record<string, unknown>).action;
  const c = exact(raw, action === "save_group" ? ["operationId", "action", "reason", "groupId", "expectedRevision", "name", "description", "active"]
    : action === "assign" ? ["operationId", "action", "reason", "groupId", "workerId", "expectedGroupRevision", "expectedWorkerVersion", "expectedSettingsVersion", "timeZone", "startsOn", "endsOn"]
      : action === "end" ? ["operationId", "action", "reason", "assignmentId", "expectedRevision", "endsOn"]
        : ["operationId", "action", "reason", "assignmentId", "expectedRevision"]);
  const base = { operationId: attendanceSelfUuid(c.operationId), reason: label(c.reason, 200) };
  if (action === "save_group") {
    const groupId = attendanceSelfUuid(c.groupId), expectedRevision = integer(c.expectedRevision, 0, 9007199254740989);
    if (expectedRevision === 0 && groupId !== base.operationId) fail();
    return { ...base, action, groupId, expectedRevision, name: label(c.name, 80), description: label(c.description, 200, true), active: bool(c.active) };
  }
  if (action === "assign") {
    const timeZone = zone(c.timeZone), range = groupRange(c.startsOn, c.endsOn, timeZone);
    return { ...base, action, groupId: attendanceSelfUuid(c.groupId), workerId: attendanceSelfUuid(c.workerId), expectedGroupRevision: integer(c.expectedGroupRevision),
      expectedWorkerVersion: integer(c.expectedWorkerVersion), expectedSettingsVersion: integer(c.expectedSettingsVersion), timeZone, ...range };
  }
  if (action === "end") {
    if (c.expectedRevision !== 1) return fail();
    return { ...base, action, assignmentId: attendanceSelfUuid(c.assignmentId), expectedRevision: 1, endsOn: groupDate(c.endsOn) };
  }
  if (action !== "cancel" || c.expectedRevision !== 1 && c.expectedRevision !== 2) return fail();
  return { ...base, action, assignmentId: attendanceSelfUuid(c.assignmentId), expectedRevision: c.expectedRevision };
}
export function parseGroupsBody(raw: unknown) {
  const v = exact(raw, ["query", "command"]), query = parseGroupsQuery(v.query), command = parseGroupsCommand(v.command);
  if (query.view !== "context" || query.operationId !== null) fail();
  if (command.action === "save_group") {
    if (query.groupId !== (command.expectedRevision === 0 ? null : command.groupId) || query.workerId !== null || query.assignmentId !== null) fail();
  } else if (command.action === "assign") {
    if (query.groupId !== command.groupId || query.workerId !== command.workerId || query.assignmentId !== null) fail();
  } else if (query.assignmentId !== command.assignmentId || query.groupId === null || query.workerId === null) fail();
  return { query, command };
}
const groupKeys = ["groupId", "revision", "name", "description", "active", "createdAt", "updatedAt"];
export function parseGroupItem(raw: unknown): GroupItem {
  const v = exact(raw, groupKeys), createdAt = instant(v.createdAt), updatedAt = instant(v.updatedAt);
  if (updatedAt < createdAt) fail();
  return { groupId: attendanceSelfUuid(v.groupId), revision: integer(v.revision), name: label(v.name, 80), description: label(v.description, 200, true), active: bool(v.active), createdAt, updatedAt };
}
export function parseGroupWorker(raw: unknown): GroupWorker {
  const v = exact(raw, ["workerId", "workerName", "workerNo", "employeeId", "version", "active"]);
  return { workerId: attendanceSelfUuid(v.workerId), workerName: label(v.workerName, 120), workerNo: label(v.workerNo, 40),
    employeeId: uuidOrNull(v.employeeId), version: integer(v.version), active: bool(v.active) };
}
const assignmentKeys = ["assignmentId", "groupId", "groupName", "workerId", "workerName", "workerNo", "employeeId", "timeZone", "startsOn", "endsOn", "createdAt", "updatedAt", "revision", "status"];
export function parseGroupAssignmentItem(raw: unknown): GroupAssignmentItem {
  const v = exact(raw, assignmentKeys), timeZone = zone(v.timeZone), range = groupRange(v.startsOn, v.endsOn, timeZone), createdAt = instant(v.createdAt), updatedAt = instant(v.updatedAt);
  if (updatedAt < createdAt || v.status !== "assigned" && v.status !== "ended" && v.status !== "cancelled"
    || v.status === "assigned" && (v.revision !== 1 || updatedAt !== createdAt)
    || v.status === "ended" && (v.revision !== 2 || range.endsOn === null) || v.status === "cancelled" && v.revision !== 2 && v.revision !== 3) return fail();
  return { assignmentId: attendanceSelfUuid(v.assignmentId), groupId: attendanceSelfUuid(v.groupId), groupName: label(v.groupName, 80),
    workerId: attendanceSelfUuid(v.workerId), workerName: label(v.workerName, 120), workerNo: label(v.workerNo, 40), employeeId: uuidOrNull(v.employeeId),
    timeZone, ...range, createdAt, updatedAt, revision: v.revision as 1 | 2 | 3, status: v.status };
}
export function sameGroupsCommand(a: GroupsCommand, b: GroupsCommand) { return JSON.stringify(parseGroupsCommand(a)) === JSON.stringify(parseGroupsCommand(b)); }
const sameItem = (a: GroupItem | GroupAssignmentItem, b: GroupItem | GroupAssignmentItem) => JSON.stringify(a) === JSON.stringify(b);
function assignmentCommandMatches(c: Exclude<GroupsCommand, { action: "save_group" }>, item: GroupAssignmentItem) {
  if (c.action === "assign") {
    if (item.assignmentId !== c.operationId || item.groupId !== c.groupId || item.workerId !== c.workerId || item.timeZone !== c.timeZone
      || item.startsOn !== c.startsOn || item.endsOn !== c.endsOn || item.status !== "assigned" || item.revision !== 1) fail();
  } else if (item.assignmentId !== c.assignmentId || item.revision !== c.expectedRevision + 1
    || item.status !== (c.action === "end" ? "ended" : "cancelled") || c.action === "end" && item.endsOn !== c.endsOn) fail();
}
export function parseGroupAssignmentDetail(raw: unknown): GroupAssignmentDetail {
  const v = exact(raw, [...assignmentKeys, "history", "canEnd", "canCancel"]), item = parseGroupAssignmentItem(Object.fromEntries(assignmentKeys.map(k => [k, v[k]])));
  if (!Array.isArray(v.history) || v.history.length !== item.revision || !v.history.length || v.history.length > 3) return fail();
  let previous: GroupAssignmentItem | null = null;
  const operations = new Set<string>();
  const history = v.history.map((rawEntry, index) => {
    const h = exact(rawEntry, ["command", "item"]), command = parseGroupsCommand(h.command), current = parseGroupAssignmentItem(h.item);
    if (command.action === "save_group" || operations.has(command.operationId) || current.revision !== index + 1) return fail();
    operations.add(command.operationId); assignmentCommandMatches(command, current);
    if (index === 0 && command.action !== "assign" || index !== 0 && command.action === "assign") fail();
    if (previous) {
      if (previous.status === "cancelled" || current.updatedAt < previous.updatedAt
        || assignmentKeys.filter(k => !["endsOn", "updatedAt", "revision", "status"].includes(k)).some(k => previous![k as keyof GroupAssignmentItem] !== current[k as keyof GroupAssignmentItem])
        || command.action === "end" && (previous.endsOn !== null || previous.status !== "assigned")
        || command.action === "cancel" && current.endsOn !== previous.endsOn) fail();
    }
    previous = current; return { command, item: current };
  });
  if (!sameItem(history.at(-1)!.item, item)) fail();
  const canEnd = bool(v.canEnd), canCancel = bool(v.canCancel);
  if (canEnd && (item.status !== "assigned" || item.endsOn !== null) || canCancel && item.status === "cancelled") fail();
  return { ...item, history, canEnd, canCancel };
}
const resultKeys = ["protocol", "siteId", "actorId", "settingsVersion", "timeZone", "view", "group", "worker", "items", "nextCursor", "detail", "receipt"];
export function parseGroupsResult(raw: unknown, input: GroupsQuery, command: GroupsCommand | null = null, expectedActorId?: string): GroupsResult {
  const q = parseGroupsQuery(input), v = exact(raw, resultKeys), actorId = attendanceSelfUuid(v.actorId);
  if (command) parseGroupsBody({ query: q, command });
  if (v.protocol !== "groups-v1" || v.siteId !== q.siteId || v.view !== q.view || expectedActorId !== undefined && actorId !== expectedActorId
    || !Array.isArray(v.items) || v.items.length > 25 || (q.view === "context" || command) && (v.items.length || v.nextCursor !== null)) return fail();
  const group = v.group === null ? null : parseGroupItem(v.group), worker = v.worker === null ? null : parseGroupWorker(v.worker);
  if (q.groupId !== null && group?.groupId !== q.groupId || (q.workerId === null ? worker !== null : worker?.workerId !== q.workerId)) fail();
  let previousId = q.cursorId;
  const ids = new Set<string>();
  const items = v.items.map(rawItem => {
    const item = q.view === "groups" ? parseGroupItem(rawItem) : parseGroupAssignmentItem(rawItem), id = "assignmentId" in item ? item.assignmentId : item.groupId;
    if (ids.has(id) || previousId && id >= previousId) fail();
    if ("assignmentId" in item && (q.groupId !== null && item.groupId !== q.groupId || q.workerId !== null && item.workerId !== q.workerId
      || q.onDate !== null && (item.startsOn > q.onDate || item.endsOn !== null && item.endsOn < q.onDate))) fail();
    ids.add(id); previousId = id; return item;
  });
  const nextCursor = uuidOrNull(v.nextCursor);
  if (nextCursor && (items.length !== 25 || nextCursor !== previousId)) fail();
  const detail = v.detail === null ? null : parseGroupAssignmentDetail(v.detail);
  if (detail && (detail.groupId !== q.groupId || detail.workerId !== q.workerId || q.assignmentId !== null && detail.assignmentId !== q.assignmentId) || q.assignmentId && !detail) fail();
  let receipt: GroupsResult["receipt"] = null;
  if (v.receipt !== null) {
    const r = exact(v.receipt, ["command", "item"]), c = parseGroupsCommand(r.command);
    if (q.view !== "context" || c.operationId !== (command?.operationId ?? q.operationId) || command && !sameGroupsCommand(c, command)) fail();
    if (c.action === "save_group") {
      const snapshot = parseGroupItem(r.item);
      if (snapshot.groupId !== c.groupId || snapshot.revision !== c.expectedRevision + 1 || snapshot.name !== c.name || snapshot.description !== c.description || snapshot.active !== c.active
        || !group || group.groupId !== c.groupId || group.revision < snapshot.revision || group.createdAt !== snapshot.createdAt || group.updatedAt < snapshot.updatedAt
        || group.revision === snapshot.revision && !sameItem(group, snapshot) || worker !== null || detail !== null
        || q.groupId !== null && q.groupId !== c.groupId || q.groupId === null && c.expectedRevision !== 0) fail();
      receipt = { command: c, item: snapshot };
    } else {
      const snapshot = parseGroupAssignmentItem(r.item); assignmentCommandMatches(c, snapshot);
      const entry = detail?.history.find(h => h.item.revision === snapshot.revision);
      if (!entry || !sameItem(entry.item, snapshot) || !sameGroupsCommand(entry.command, c)) fail();
      receipt = { command: c, item: snapshot };
    }
  }
  if (command && !receipt || q.groupId === null && group !== null && !(receipt?.command.action === "save_group" && receipt.command.expectedRevision === 0)
    || detail && !q.assignmentId && !(receipt && receipt.command.action !== "save_group")
    || q.view !== "context" && (detail !== null || receipt !== null)) fail();
  return { protocol: "groups-v1", siteId: q.siteId, actorId, settingsVersion: integer(v.settingsVersion), timeZone: zone(v.timeZone), view: q.view, group, worker, items, nextCursor, detail, receipt };
}
export function parseGroupsResponse(raw: unknown, q: GroupsQuery, command: GroupsCommand | null = null, expectedActorId?: string): GroupsResponse {
  const v = exact(raw, ["ok", "moduleEnabled", ...resultKeys]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
  const { ok, moduleEnabled, ...rest } = v; void ok;
  return { ...parseGroupsResult(rest, q, command, expectedActorId), moduleEnabled };
}
