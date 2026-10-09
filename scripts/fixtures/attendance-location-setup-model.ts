import { parseLocationSetupCommand, parseLocationSetupQuery, type LocationSetupCommand, type LocationSetupQuery, type LocationSetupReceipt, type LocationSetupResult, type LocationSetupSnapshot } from "../../src/lib/merchantAttendanceLocationSetup";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const setupOwner = id(1), setupQuery: LocationSetupQuery = { siteId: "99990001", locationId: id(2), operationId: null };
export const setupValues = { purpose: "合成考勤测试", notice: "仅用于隔离演示", contact: "合成负责人", alternative: "人工核查", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
export function createLocationSetupModel(query: LocationSetupQuery = setupQuery) {
  let state: LocationSetupResult = { siteId: query.siteId, locationId: query.locationId, ownerId: setupOwner,
    settingsVersion: 1, channelVersion: 1, channelEnabled: false, attendanceEnabled: true, webClockEnabled: true,
    location: { name: "合成门店", active: true, version: 1, fence: null },
    draft: { revision: 1, settingsVersion: 1, locationVersion: 1, values: { ...setupValues } }, notice: null, noticeMatches: false,
    openWebShift: false, canPrepare: true, canEnable: false, canPause: false, receipt: null };
  let noticeSettings = 0, noticeLocation = 0, noticeFence = "", mode = "normal", enabled = true, reads = 0, posts = 0;
  const records = new Map<string, LocationSetupReceipt>();
  const draftFence = () => state.draft ? { latitude: state.draft.values.latitude, longitude: state.draft.values.longitude, radiusMeters: state.draft.values.radiusMeters } : null;
  const snapshot = (): LocationSetupSnapshot => ({ settingsVersion: state.settingsVersion, channelVersion: state.channelVersion, channelEnabled: state.channelEnabled,
    locationVersion: state.location.version, fence: structuredClone(state.location.fence), draftRevision: state.draft?.revision ?? null });
  const current = (operationId: string | null = null) => {
    const dirty = !!state.draft && (state.draft.settingsVersion !== state.settingsVersion || state.draft.locationVersion !== state.location.version || JSON.stringify(state.location.fence) !== JSON.stringify(draftFence()));
    state.noticeMatches = !!state.location.fence && state.location.active && state.notice?.action === "publish" && noticeSettings === state.settingsVersion && noticeLocation === state.location.version && noticeFence === JSON.stringify(state.location.fence);
    state.canPrepare = enabled && state.location.active && dirty && !state.openWebShift;
    state.canEnable = enabled && state.attendanceEnabled && state.webClockEnabled && !state.channelEnabled && state.noticeMatches;
    state.canPause = state.channelEnabled;
    return { ...structuredClone(state), receipt: structuredClone(records.get(operationId ?? "") ?? null), moduleEnabled: enabled };
  };
  const err = (error: string, status = 409) => Response.json({ ok: false, error }, { status });
  const apiFetch = async (url: string, init: RequestInit = {}) => {
    if (!url.startsWith("/api/merchant-enterprise/attendance/location-setup")) throw Error("synthetic_route_only");
    if (mode === "offline") throw Error("synthetic_offline"); if (mode === "denied") return err("attendance_access_denied", 403);
    let operationId: string | null;
    if (init.method === "POST") {
      posts++; const parsed = parseLocationSetupCommand(JSON.parse(String(init.body))), c = parsed.command;
      if (parsed.query.siteId !== query.siteId || parsed.query.locationId !== query.locationId) return err("attendance_access_denied", 403);
      operationId = c.operationId;
      if (mode === "rejected") return err("attendance_version_conflict"); if (mode === "unsent") throw Error("synthetic_not_delivered");
      const old = records.get(operationId), r = current();
      if (old && JSON.stringify(old.command) !== JSON.stringify(c)) return err("attendance_operation_conflict");
      if (!old) {
        if (!enabled && c.action !== "pause") return err("attendance_platform_paused", 403);
        if (c.expectedChannelVersion !== r.channelVersion || c.action !== "pause" && (c.expectedSettingsVersion !== r.settingsVersion || c.expectedLocationVersion !== r.location.version)) return err("attendance_version_conflict");
        const before = snapshot();
        if (c.action === "prepare") {
          if (!r.draft || c.draftRevision !== r.draft.revision) return err("attendance_version_conflict");
          if (r.openWebShift) return err("attendance_setup_open_web_shift");
          if (!r.canPrepare) return err("attendance_setup_unchanged");
          state.location = { ...state.location, version: state.location.version + 1, fence: draftFence() };
          state.draft = { ...r.draft, revision: r.draft.revision + 1, settingsVersion: state.settingsVersion, locationVersion: state.location.version };
        } else {
          if (state.channelEnabled === (c.action === "enable")) return err("attendance_setup_unchanged");
          if (c.action === "enable" && !r.canEnable) return err("attendance_setup_not_ready");
          state.channelEnabled = c.action === "enable"; state.channelVersion++;
        }
        records.set(operationId, { command: c, before, after: snapshot(), recordedAt: "2026-09-30T10:00:00.123456Z" });
      }
      if (mode === "lost") throw Error("synthetic_response_lost");
      if (mode === "timeout") return new Promise<Response>(() => {});
    } else {
      reads++; const q = parseLocationSetupQuery(new URL(url, "https://local.invalid").href);
      if (q.siteId !== query.siteId || q.locationId !== query.locationId) return err("attendance_access_denied", 403); operationId = q.operationId;
    }
    const result = current(operationId);
    return Response.json({ ok: true, ...result, ...(mode === "wrong_owner" ? { ownerId: id(99) } : {}), ...(mode === "wrong_site" ? { siteId: "99990002" } : {}) });
  };
  return { apiFetch, current, records, metrics: () => ({ reads, posts }), mode: (v: string) => { mode = v; }, enabled: (v: boolean) => { enabled = v; },
    openWebShift: (v: boolean) => { state.openWebShift = v; },
    saveDraft: (values: typeof setupValues) => { state.draft = { revision: (state.draft?.revision ?? 0) + 1, settingsVersion: state.settingsVersion, locationVersion: state.location.version, values: structuredClone(values) }; },
    withdraw: () => { state.notice = { revision: (state.notice?.revision ?? 0) + 1, action: "withdraw" }; },
    editDraft: () => { if (state.draft) state.draft = { ...state.draft, revision: state.draft.revision + 1, settingsVersion: state.settingsVersion, locationVersion: state.location.version, values: { ...state.draft.values, latitude: state.draft.values.latitude + 0.1 } }; },
    changeConfig: () => { state = { ...state, settingsVersion: state.settingsVersion + 1 }; },
    publish: () => { const r = current(); if (!r.draft || r.draft.locationVersion !== r.location.version || r.draft.settingsVersion !== r.settingsVersion) throw Error("synthetic_not_prepared");
      state.notice = { revision: (state.notice?.revision ?? 0) + 1, action: "publish" }; noticeSettings = state.settingsVersion; noticeLocation = state.location.version; noticeFence = JSON.stringify(draftFence()); },
    command: (op: string, action: LocationSetupCommand["action"] = "prepare"): LocationSetupCommand => ({ action, operationId: op, expectedSettingsVersion: state.settingsVersion,
      expectedLocationVersion: state.location.version, expectedChannelVersion: state.channelVersion, draftRevision: action === "prepare" ? state.draft!.revision : null, reason: "合成操作说明" }),
  };
}
