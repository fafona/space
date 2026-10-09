import { createLocationSetupModel, setupQuery } from "./attendance-location-setup-model";
import { parseAttendanceLocationPolicyCommand, parseAttendanceLocationPolicyQuery, type AttendanceLocationPolicyRevision } from "../../src/lib/merchantAttendanceLocationPolicy";
import { parseNoticeCommand, parseNoticeQuery, type NoticeCommand, type NoticeReceipt, type NoticeRevision } from "../../src/lib/merchantAttendanceLocationNotice";
// In-memory composition only; no credentials, fetch, geolocation or database access.
export function createLocationWorkspaceModel() {
  const setup = createLocationSetupModel(), drafts = new Map<number, AttendanceLocationPolicyRevision>();
  const policyReceipts = new Map<string, { command: unknown; receipt: { operationId: string; revision: number; recordedAt: string } }>();
  const noticeReceipts = new Map<string, { command: NoticeCommand; receipt: NoticeReceipt }>();
  let notice: NoticeRevision | null = null, mode = "normal", gets = 0, posts = 0;
  const date = (revision: number) => new Date(Date.UTC(2026, 8, 30, 10, 0, revision)).toISOString();
  const sync = () => { const s = setup.current(), d = s.draft!; if (!drafts.has(d.revision)) drafts.set(d.revision, { ...structuredClone(d), recordedAt: date(d.revision) }); return s; };
  const fail = (error: string, status = 409) => Response.json({ ok: false, error }, { status });
  const apiFetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, "https://local.invalid"), write = init.method === "POST";
    if (write) posts++; else gets++;
    if (mode === "offline") throw Error("synthetic_offline");
    if (mode === "denied") return fail("attendance_access_denied", 403);
    if (mode === "unsent" && write) throw Error("synthetic_unsent");
    const endpoint = u.pathname.split("/").at(-1);
    if (!u.pathname.startsWith("/api/merchant-enterprise/attendance/")) throw Error("synthetic_route_only");
    if (endpoint === "location-setup") {
      const response = await setup.apiFetch(url, init); sync();
      if (mode === "lost" && write && response.ok) throw Error("synthetic_lost"); return response;
    }
    let s = sync();
    if (endpoint === "location-policy") {
      const parsed = write ? parseAttendanceLocationPolicyCommand(JSON.parse(String(init.body))) : null;
      const q = parsed ?? parseAttendanceLocationPolicyQuery(u.href), op = parsed?.command.operationId ?? ("operationId" in q ? q.operationId : null);
      if (q.siteId !== setupQuery.siteId || q.locationId !== setupQuery.locationId) return fail("attendance_access_denied", 403);
      if (parsed) {
        const c = parsed.command, previous = policyReceipts.get(c.operationId);
        if (previous && JSON.stringify(previous.command) !== JSON.stringify(c)) return fail("attendance_operation_conflict");
        if (!previous) {
          if (!s.moduleEnabled) return fail("attendance_platform_paused", 403);
          if (c.expectedRevision !== s.draft!.revision || c.expectedSettingsVersion !== s.settingsVersion || c.expectedLocationVersion !== s.location.version) return fail("attendance_version_conflict");
          setup.saveDraft(c.values); s = sync();
          policyReceipts.set(c.operationId, { command: c, receipt: { operationId: c.operationId, revision: s.draft!.revision, recordedAt: date(s.draft!.revision) } });
        }
        if (mode === "lost") throw Error("synthetic_lost");
      }
      return Response.json({ ok: true, moduleEnabled: s.moduleEnabled, siteId: q.siteId, locationId: q.locationId, draftOnly: true, settingsVersion: s.settingsVersion,
        location: { name: s.location.name, active: s.location.active, version: s.location.version }, current: drafts.get(s.draft!.revision), previous: drafts.get(s.draft!.revision - 1) ?? null,
        receipt: op ? policyReceipts.get(op)?.receipt ?? null : null });
    }
    if (endpoint !== "location-notice") throw Error("synthetic_route_only");
    const parsed = write ? parseNoticeCommand(JSON.parse(String(init.body))) : null, q = parsed?.query ?? parseNoticeQuery(u.href);
    if (q.siteId !== setupQuery.siteId || q.locationId !== setupQuery.locationId || q.access !== "owner") return fail("attendance_access_denied", 403);
    const canPublish = () => s.moduleEnabled && s.location.active && s.draft!.settingsVersion === s.settingsVersion && s.draft!.locationVersion === s.location.version
      && !(notice?.action === "publish" && notice.draftRevision === s.draft!.revision);
    if (parsed) {
      const c = parsed.command; if (c.action === "acknowledge") return fail("attendance_access_denied", 403);
      const old = noticeReceipts.get(c.operationId);
      if (old && JSON.stringify(old.command) !== JSON.stringify(c)) return fail("attendance_operation_conflict");
      if (!old) {
        if (c.expectedRevision !== (notice?.revision ?? 0) || c.expectedSettingsVersion !== s.settingsVersion || c.expectedLocationVersion !== s.location.version) return fail("attendance_version_conflict");
        if (c.action === "publish" && (!canPublish() || c.draftRevision !== s.draft!.revision)) return fail("attendance_notice_required");
        if (c.action === "withdraw" && notice?.action !== "publish") return fail("attendance_version_conflict");
        if (c.action === "publish") setup.publish(); else setup.withdraw();
        const { latitude: _latitude, longitude: _longitude, ...values } = s.draft!.values; void _latitude; void _longitude;
        notice = { revision: (notice?.revision ?? 0) + 1, action: c.action, draftRevision: c.draftRevision, templateVersion: 1, reason: c.reason,
          values: c.action === "publish" ? values : null, recordedAt: date(30 + (notice?.revision ?? 0)).replace("Z", "000Z") };
        noticeReceipts.set(c.operationId, { command: c, receipt: { operationId: c.operationId, action: c.action, revision: notice.revision, draftRevision: c.draftRevision, reason: c.reason, recordedAt: notice.recordedAt } });
      }
      s = sync(); if (mode === "lost") throw Error("synthetic_lost");
    }
    const op = parsed?.command.operationId ?? q.operationId;
    return Response.json({ ok: true, moduleEnabled: s.moduleEnabled, siteId: q.siteId, access: "owner", employeeId: null, workerId: null, operationalChanged: false,
      location: { id: q.locationId, name: s.location.name, active: s.location.active, version: s.location.version }, settingsVersion: s.settingsVersion,
      current: notice, draft: { revision: s.draft!.revision, values: s.draft!.values }, noticeCurrent: s.noticeMatches, canPublish: canPublish(), canWithdraw: notice?.action === "publish",
      canAcknowledge: false, acknowledgedAt: null, receipt: op ? noticeReceipts.get(op)?.receipt ?? null : null });
  };
  return { apiFetch, setup, metrics: () => ({ gets, posts }), mode: (value: string) => { mode = value; } };
}
