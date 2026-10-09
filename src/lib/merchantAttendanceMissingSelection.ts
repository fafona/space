import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { missingQueryString, parseMissingQuery, type MissingQuery } from "./merchantAttendanceMissing";

/** A backlog row is a navigation hint, never saved approval evidence. */
export type MissingInitialSelection = { requestId: string; submittedAt: string };

export function missingInitialQuery(
  siteId: string, access: MissingQuery["access"], initialSelection: MissingInitialSelection | null = null, now = Date.now(),
): MissingQuery {
  let fromDate: string, throughDate: string, requestId: string | null = null;
  if (initialSelection !== null) {
    if (access !== "owner" || typeof initialSelection !== "object" || Array.isArray(initialSelection)
      || Object.keys(initialSelection).sort().join() !== "requestId,submittedAt"
      || typeof initialSelection.requestId !== "string"
      || attendanceRecordInstant(initialSelection.submittedAt) !== initialSelection.submittedAt) throw Error("attendance_invalid_request");
    // The API filters submission dates in UTC, not proposed work dates or the
    // browser/location civil date. Preserve microseconds while choosing its day.
    fromDate = throughDate = initialSelection.submittedAt.slice(0, 10);
    requestId = initialSelection.requestId;
  } else {
    fromDate = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    throughDate = new Date(now).toISOString().slice(0, 10);
  }
  return parseMissingQuery(`https://local.invalid/?${missingQueryString({
    siteId, access, fromDate, throughDate, requestId, operationId: null, beforeAt: null, beforeId: null,
  })}`);
}

export function confirmMissingPanelLeave(input: {
  dirty: boolean; pending: boolean; confirm: (message: string) => boolean; current: () => boolean; pause: () => void;
}): boolean {
  if (!input.current()) return false;
  if (input.dirty && !input.confirm("尚未提交的漏卡草稿会丢失，继续吗？")) return false;
  if (!input.current()) return false;
  if (input.pending && !input.confirm("操作仍待确认，离开不会撤销。返回时查询原编号，继续吗？")) return false;
  if (!input.current()) return false;
  input.pause(); return true;
}
