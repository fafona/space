import { applyAttendanceEvent, initialAttendanceState, type AttendanceEvent } from "../../src/lib/merchantAttendance";
import { parseAttendanceLocationClockCommand, parseAttendanceLocationClockQuery } from "../../src/lib/merchantAttendanceLocationClock";
import { parseAttendanceSelfContextQuery } from "../../src/lib/merchantAttendanceSelfContext";
import { parseNoticeCommand, parseNoticeQuery } from "../../src/lib/merchantAttendanceLocationNotice";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
import type { AttendanceLocationEnvironment } from "../../src/lib/merchantAttendanceLocationCheckClient";
import { createNoticeFixture, noticeQuery, noticeSite as siteId, noticeEmployee as defaultEmployeeId, noticeWorker as defaultWorkerId, noticePlace as defaultLocationId, noticeId } from "./attendance-location-notice-model";
export { noticeSite as siteId, noticeEmployee as employeeId, noticeWorker as workerId, noticePlace as locationId } from "./attendance-location-notice-model";
// One synthetic notice ledger feeds both actual notice and clock clients. Never uses real device/network/DB.
export function createEmployeeLocationFixture({employeeId=defaultEmployeeId,workerId=defaultWorkerId,locationId=defaultLocationId}: {employeeId?:string;workerId?:string;locationId?:string}={}) {
  const notice = createNoticeFixture({employeeId,workerId,locationId});
  let state = initialAttendanceState(siteId, workerId), last: AttendanceEvent | null = null, enabled = true, mode = "normal", gets = 0, posts = 0, deviceCalls = 0, next = 1000;
  const records = new Map<string, { event: AttendanceEvent; summary: Record<string, unknown>; gate: Record<string, unknown> }>();
  const policy = { settingsVersion: 1, workerVersion: 1, locationVersion: 1, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 };
  const environment: AttendanceLocationEnvironment = { isSecureContext: () => true, isVisible: () => true,
    geolocation: () => ({ getCurrentPosition(success, error) { deviceCalls++; queueMicrotask(() => mode === "device_denied" ? error?.({ code: 1 } as GeolocationPositionError)
      : success({ timestamp: Date.now(), coords: { latitude: 37.3, longitude: -5.9, accuracy: 10 } } as GeolocationPosition)); } }) };
  const response = (op: string | null, replayed = false) => {
    const n = notice.snapshot("self"), r = records.get(op ?? ""), ready = n.noticeCurrent && !!n.acknowledgedAt;
    return { ok: true, siteId, employeeId, workerId, locationId, moduleEnabled: enabled, channelEnabled: enabled && ready, policy,
      state: { sequence: state.sequence, status: state.status, lastEvent: last }, receipt: r?.event ?? null, locationResult: r?.summary ?? null, receiptGate: r?.gate ?? null, replayed,
      noticeGate: { ready, reason: ready ? "ready" : !n.current ? "unpublished" : n.current.action === "withdraw" ? "withdrawn" : !n.noticeCurrent ? "configuration_changed" : "acknowledgement_required", revision: n.current?.revision ?? null },
      finish: last && last.action !== "clock_out" ? { locationId, settingsVersion: 1, workerVersion: 1, locationVersion: 1 } : null };
  };
  const reject = (error: string, status = 409) => Response.json({ ok: false, error }, { status });
  const apiFetch: AttendanceApiFetch = async (path, init = {}) => {
    const url = new URL(path, "https://local.invalid"), post = init.method === "POST";
    if (post) posts++; else gets++;
    if (mode === "offline") throw Error("synthetic_offline");
    if (mode === "denied") return reject("attendance_access_denied", 403);
    if (mode === "unsent" && post) throw Error("synthetic_not_delivered");
    if (url.pathname === "/api/merchant-enterprise/attendance/self-context") {
      if (post || parseAttendanceSelfContextQuery(url.href).siteId !== siteId) throw Error("synthetic_scope_only");
      return Response.json({ ok: true, siteId, employeeId, workerId, locationId, moduleEnabled: enabled });
    }
    if (url.pathname === "/api/merchant-enterprise/attendance/location-notice") {
      const q = post ? parseNoticeCommand(JSON.parse(String(init.body))).query : parseNoticeQuery(url.href);
      if (q.siteId !== siteId || q.access !== "self" || q.expectedWorkerId !== workerId || q.locationId !== locationId) throw Error("synthetic_self_only");
      notice.mode(mode === "lost" ? "lost" : "normal"); return notice.apiFetch(path, init);
    }
    if (url.pathname !== "/api/merchant-enterprise/attendance/location-clock") throw Error("synthetic_route_only");
    if (!post) {
      const q = parseAttendanceLocationClockQuery(url.href); if (q.siteId !== siteId || q.expectedWorkerId !== workerId) throw Error("synthetic_scope_only");
      return Response.json(response(q.operationId));
    }
    const parsed = parseAttendanceLocationClockCommand(JSON.parse(String(init.body))), c = parsed.command;
    if (parsed.siteId !== siteId || c.expectedWorkerId !== workerId || c.locationId !== locationId) throw Error("synthetic_scope_only");
    const sqlCommand = Object.fromEntries(Object.entries(c).filter(([k]) => !["expectedWorkerId", "position", "positionFailure"].includes(k))), prior = records.get(c.operationId);
    if (prior) return JSON.stringify(prior.gate.command) === JSON.stringify(sqlCommand) ? Response.json(response(c.operationId, true)) : reject("attendance_operation_conflict");
    if (c.expectedSequence !== state.sequence) return reject("attendance_sequence_conflict");
    const current = response(null);
    if (c.safeFinish ? !current.finish : !current.noticeGate.ready || c.noticeRevision !== current.noticeGate.revision) return reject("attendance_notice_required");
    if (!c.safeFinish && !enabled) return reject("attendance_location_clock_disabled", 403);
    const event: AttendanceEvent = { id: noticeId(++next), siteId, workerId, locationId, operationId: c.operationId, action: c.action, breakPaid: c.action === "break_start" ? false : null,
      occurredAt: new Date().toISOString(), timeZone: "Europe/Madrid", sequence: state.sequence + 1 };
    state = applyAttendanceEvent(state, event).state; last = event;
    records.set(c.operationId, { event, gate: { safeFinish: c.safeFinish, noticeRevision: c.noticeRevision, command: sqlCommand }, summary: { eventId: event.id,
      settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1, reason: c.position ? "inside" : c.positionFailure,
      needsReview: c.position === null, capturedAt: c.position?.capturedAt ?? null, accuracyMeters: c.position?.accuracyMeters ?? null, distanceMeters: c.position ? 0 : null } });
    if (mode === "lost") throw Error("synthetic_committed_response_lost");
    return Response.json(response(c.operationId));
  };
  return { apiFetch, environment, snapshot:()=>structuredClone(response(null)), metrics: () => ({ gets, posts, deviceCalls, punches: records.size, noticeWrites: notice.writes() }),
    mode: (v: string) => { mode = v; }, enabled: (v: boolean) => { enabled = v; notice.enabled(v); },
    publish: async () => {
      notice.mode("normal"); const n = notice.snapshot("owner"), q = {...noticeQuery("owner"),locationId};
      return notice.apiFetch("/synthetic-owner-publish", { method: "POST", body: JSON.stringify({ siteId, access: q.access, locationId, expectedWorkerId: null, action: "publish",
        operationId: noticeId(++next), expectedRevision: n.current?.revision ?? 0, draftRevision: n.draft!.revision, expectedSettingsVersion: n.settingsVersion, expectedLocationVersion: n.location.version, reason: "合成负责人明确发布" }) });
    },
  };
}
