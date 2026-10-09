import { parseNoticeCommand, parseNoticeQuery, type NoticeAccess, type NoticeCommand, type NoticeQuery, type NoticeReceipt, type NoticeResult } from "../../src/lib/merchantAttendanceLocationNotice";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
export const noticeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const noticeSite = "99990001", noticeOwner = noticeId(1), noticeEmployee = noticeId(2), noticeWorker = noticeId(3), noticePlace = noticeId(4);
export const noticeQuery = (access: NoticeAccess = "owner"): NoticeQuery => ({ siteId: noticeSite, access, locationId: noticePlace, expectedWorkerId: access === "self" ? noticeWorker : null, operationId: null });
export const noticeValues = { purpose: "合成定位用途", notice: "合成告知第 1 版", contact: "合成负责人", alternative: "无法定位时向负责人提交说明", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
// Pure synthetic transport. Permissions and immutable-ledger behavior have SQL tests.
export function createNoticeFixture({employeeId=noticeEmployee,workerId=noticeWorker,locationId:locationIdDefault=noticePlace}: {employeeId?:string;workerId?:string;locationId?:string}={}) {
  let mode = "normal", enabled = true, revision = 0, tick = 0, settingsVersion = 1, locationVersion = 1;
  let current: NoticeResult["current"] = null, draft = { revision: 1, values: { ...noticeValues } }, draftSettings = 1, draftLocation = 1;
  const calls: { url: string; method: string; body?: string }[] = [], acknowledgements = new Map<number, string>();
  const receipts = new Map<string, { command: NoticeCommand; receipt: NoticeReceipt; access: NoticeAccess; locationId: string }>();
  const at = () => `2026-09-30T12:00:00.${String(++tick).padStart(6, "0")}Z`;
  const snapshot = (access: NoticeAccess = "owner", operationId: string | null = null, locationId = locationIdDefault): NoticeResult & { ok: true; moduleEnabled: boolean } => {
    const ackAt = current?.action === "publish" ? acknowledgements.get(current.revision) ?? null : null;
    const noticeCurrent = current?.action === "publish" && settingsVersion === 1 && locationVersion === 1;
    const r = operationId ? receipts.get(operationId) : null;
    return { ok: true, moduleEnabled: enabled, siteId: noticeSite, access, employeeId: access === "self" ? employeeId : null, workerId: access === "self" ? workerId : null, operationalChanged: false,
      location: { id: locationId, name: "合成地点", active: true, version: locationVersion }, settingsVersion, current: current ? structuredClone(current) : null,
      draft: access === "owner" ? structuredClone(draft) : null, noticeCurrent,
      canPublish: access === "owner" && enabled && draftSettings === settingsVersion && draftLocation === locationVersion && !(current?.action === "publish" && current.draftRevision === draft.revision),
      canWithdraw: access === "owner" && current?.action === "publish", canAcknowledge: access === "self" && noticeCurrent && !ackAt,
      acknowledgedAt: access === "self" ? ackAt : null, receipt: r && r.access === access && r.locationId === locationId ? structuredClone(r.receipt) : null };
  };
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => {
    const method = init.method ?? "GET"; calls.push({ url, method, body: init.body as string | undefined });
    const reject = (error: string, status = 409) => Response.json({ ok: false, error }, { status });
    if (mode === "timeout" || mode === "post_timeout" && method === "POST") return new Promise<Response>(() => {});
    if (mode === "offline" || mode === "unsent" && method === "POST") throw Error("network");
    if (mode === "denied") return reject("attendance_access_denied", 403);
    if (mode === "rebound") return reject("attendance_worker_changed");
    let result;
    if (method === "POST") {
      if (mode === "reject") return reject("attendance_access_denied", 403);
      const { query: q, command: c } = parseNoticeCommand(JSON.parse(String(init.body))), previous = receipts.get(c.operationId);
      if (previous && (previous.access !== q.access || previous.locationId !== q.locationId || JSON.stringify(previous.command) !== JSON.stringify(c))) return reject("attendance_operation_conflict");
      if (!previous) {
        const view = snapshot(q.access);
        if (c.action === "acknowledge") {
          if (!view.noticeCurrent) return reject("attendance_notice_unavailable");
          if (c.expectedRevision !== revision) return reject("attendance_version_conflict");
          if (acknowledgements.has(revision)) return reject("attendance_notice_already_acknowledged");
          const recordedAt = at(); acknowledgements.set(revision, recordedAt);
          receipts.set(c.operationId, { command: c, access: q.access, locationId: q.locationId, receipt: { operationId: c.operationId, action: c.action, revision, recordedAt, draftRevision: null, reason: null } });
        } else {
          if (c.expectedRevision !== revision) return reject("attendance_version_conflict");
          if (c.action === "publish" && (!enabled || !view.canPublish)) return reject(enabled ? "attendance_version_conflict" : "attendance_platform_paused");
          if (c.action === "publish" && (c.draftRevision !== draft.revision || c.expectedSettingsVersion !== settingsVersion || c.expectedLocationVersion !== locationVersion)) return reject("attendance_version_conflict");
          if (c.action === "withdraw" && !view.canWithdraw) return reject("attendance_notice_unavailable");
          const { latitude: _lat, longitude: _lon, ...values } = draft.values; void _lat; void _lon;
          current = { revision: ++revision, action: c.action, draftRevision: c.draftRevision, recordedAt: at(), reason: c.reason, templateVersion: 1, values: c.action === "publish" ? values : null };
          receipts.set(c.operationId, { command: c, access: q.access, locationId: q.locationId, receipt: { operationId: c.operationId, action: c.action, revision, draftRevision: c.draftRevision, reason: c.reason, recordedAt: current.recordedAt } });
        }
      }
      if (mode === "lost") throw Error("lost_response");
      result = snapshot(q.access, c.operationId, q.locationId);
    } else { const q = parseNoticeQuery(new URL(url, "https://local.invalid").href); result = snapshot(q.access, q.operationId, q.locationId); }
    if (mode === "wrong_site") result.siteId = "99990002";
    if (mode === "wrong_actor") result.employeeId = noticeId(999);
    return Response.json(result);
  };
  return { apiFetch, calls, snapshot, mode: (v: string) => { mode = v; }, enabled: (v: boolean) => { enabled = v; },
    advanceConfig: () => { settingsVersion++; locationVersion++; },
    editDraft: () => { draft = { revision: draft.revision + 1, values: { ...draft.values, notice: "合成修改后的草稿" } }; draftSettings = settingsVersion; draftLocation = locationVersion; }, writes: () => receipts.size };
}
