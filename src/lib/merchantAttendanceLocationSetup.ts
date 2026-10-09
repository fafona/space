import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { ATTENDANCE_LOCATION_POLICY_ERRORS, parseAttendanceLocationPolicyQuery, parseAttendanceLocationPolicyValues, type AttendanceLocationPolicyValues, type AttendanceLocationPolicyQuery } from "./merchantAttendanceLocationPolicy";

export type LocationSetupQuery = AttendanceLocationPolicyQuery;
export const parseLocationSetupQuery = parseAttendanceLocationPolicyQuery;
export type LocationSetupCommand = { action: "prepare" | "enable" | "pause"; operationId: string; expectedSettingsVersion: number; expectedLocationVersion: number; expectedChannelVersion: number; draftRevision: number | null; reason: string };
export type LocationSetupFence = { latitude: number; longitude: number; radiusMeters: number };
export type LocationSetupSnapshot = { settingsVersion: number; channelVersion: number; channelEnabled: boolean; locationVersion: number; fence: LocationSetupFence | null; draftRevision: number | null };
export type LocationSetupReceipt = { command: LocationSetupCommand; before: LocationSetupSnapshot; after: LocationSetupSnapshot; recordedAt: string };
export type LocationSetupResult = {
  siteId: string; locationId: string; ownerId: string; settingsVersion: number; channelVersion: number;
  channelEnabled: boolean; attendanceEnabled: boolean; webClockEnabled: boolean;
  location: { name: string; active: boolean; version: number; fence: LocationSetupFence | null };
  draft: { revision: number; settingsVersion: number; locationVersion: number; values: AttendanceLocationPolicyValues } | null;
  notice: { revision: number; action: "publish" | "withdraw" } | null;
  noticeMatches: boolean; openWebShift: boolean; canPrepare: boolean; canEnable: boolean; canPause: boolean; receipt: LocationSetupReceipt | null;
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const obj = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
const exact = (v: Record<string, unknown>, keys: string[]) => { if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(); };
const ver = (v: unknown, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const text = (v: unknown, max: number): string => typeof v === "string" && !!v.trim() && Array.from(v.trim()).length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : fail();
const commandKeys = ["action", "operationId", "expectedSettingsVersion", "expectedLocationVersion", "expectedChannelVersion", "draftRevision", "reason"];
function command(value: unknown): LocationSetupCommand {
  const c = obj(value); exact(c, commandKeys);
  if (!["prepare", "enable", "pause"].includes(String(c.action)) || c.action !== "prepare" && c.draftRevision !== null) return fail();
  return { action: c.action as LocationSetupCommand["action"], operationId: attendanceSelfUuid(c.operationId), expectedSettingsVersion: ver(c.expectedSettingsVersion),
    expectedLocationVersion: ver(c.expectedLocationVersion), expectedChannelVersion: ver(c.expectedChannelVersion), draftRevision: c.action === "prepare" ? ver(c.draftRevision, 9007199254740989) : null, reason: text(c.reason, 240) };
}
export function parseLocationSetupCommand(input: unknown): { query: LocationSetupQuery; command: LocationSetupCommand } {
  const v = obj(input); exact(v, ["siteId", "locationId", ...commandKeys]);
  return { query: { siteId: attendanceSelfSite(v.siteId), locationId: attendanceSelfUuid(v.locationId), operationId: null }, command: command(Object.fromEntries(commandKeys.map(k => [k, v[k]]))) };
}
function fence(input: unknown): LocationSetupFence | null {
  if (input === null) return null; const f = obj(input); exact(f, ["latitude", "longitude", "radiusMeters"]);
  for (const [key, min, max] of [["latitude", -90, 90], ["longitude", -180, 180], ["radiusMeters", 1, 100000]] as const)
    if (typeof f[key] !== "number" || !Number.isFinite(f[key]) || f[key] < min || f[key] > max) fail();
  return { latitude: f.latitude as number, longitude: f.longitude as number, radiusMeters: f.radiusMeters as number };
}
function snapshot(input: unknown): LocationSetupSnapshot {
  const s = obj(input); exact(s, ["settingsVersion", "channelVersion", "channelEnabled", "locationVersion", "fence", "draftRevision"]);
  return { settingsVersion: ver(s.settingsVersion), channelVersion: ver(s.channelVersion), channelEnabled: bool(s.channelEnabled), locationVersion: ver(s.locationVersion),
    fence: fence(s.fence), draftRevision: s.draftRevision === null ? null : ver(s.draftRevision) };
}
export function setupReceiptMatches(receipt: LocationSetupReceipt, expected: LocationSetupCommand) {
  return commandKeys.every(k => receipt.command[k as keyof LocationSetupCommand] === expected[k as keyof LocationSetupCommand]);
}
export function parseLocationSetupResult(input: unknown, expected: LocationSetupQuery & { ownerId: string }): LocationSetupResult {
  const v = obj(input), l = obj(v.location);
  if (v.siteId !== expected.siteId || v.locationId !== expected.locationId || v.ownerId !== expected.ownerId) fail();
  exact(l, ["name", "active", "version", "fence"]);
  const settingsVersion = ver(v.settingsVersion), channelVersion = ver(v.channelVersion), channelEnabled = bool(v.channelEnabled);
  const location = { name: text(l.name, 120), active: bool(l.active), version: ver(l.version), fence: fence(l.fence) };
  const attendanceEnabled = bool(v.attendanceEnabled), webClockEnabled = bool(v.webClockEnabled), noticeMatches = bool(v.noticeMatches);
  let draft: LocationSetupResult["draft"] = null, notice: LocationSetupResult["notice"] = null, receipt: LocationSetupReceipt | null = null;
  if (v.draft !== null) { const d = obj(v.draft); exact(d, ["revision", "settingsVersion", "locationVersion", "values"]); draft = {
    revision: ver(d.revision), settingsVersion: ver(d.settingsVersion), locationVersion: ver(d.locationVersion), values: parseAttendanceLocationPolicyValues(d.values) }; }
  if (v.notice !== null) { const n = obj(v.notice); exact(n, ["revision", "action"]); if (n.action !== "publish" && n.action !== "withdraw") fail(); notice = { revision: ver(n.revision), action: n.action as "publish" | "withdraw" }; }
  const canPrepare = bool(v.canPrepare), canEnable = bool(v.canEnable), canPause = bool(v.canPause), openWebShift = bool(v.openWebShift);
  if (noticeMatches && (!location.active || !location.fence || notice?.action !== "publish") || canPrepare && (!location.active || !draft || openWebShift)
    || canEnable && (channelEnabled || !noticeMatches || !attendanceEnabled || !webClockEnabled) || canPause && !channelEnabled) fail();
  if (v.receipt !== null) {
    const r = obj(v.receipt); exact(r, ["command", "before", "after", "recordedAt"]);
    const c = command(r.command), before = snapshot(r.before), after = snapshot(r.after);
    if (c.operationId !== expected.operationId || c.expectedChannelVersion !== before.channelVersion || before.settingsVersion !== after.settingsVersion
      || after.settingsVersion > settingsVersion || after.channelVersion > channelVersion || after.locationVersion > location.version
      || after.draftRevision !== null && (!draft || after.draftRevision > draft.revision)) fail();
    if (c.action !== "pause" && (before.settingsVersion !== c.expectedSettingsVersion || before.locationVersion !== c.expectedLocationVersion)) fail();
    if (c.action === "prepare") {
      if (before.draftRevision !== c.draftRevision || after.draftRevision !== c.draftRevision! + 1 || after.locationVersion !== before.locationVersion + 1
        || after.fence === null || after.channelVersion !== before.channelVersion || after.channelEnabled !== before.channelEnabled) fail();
    } else if (after.channelVersion !== before.channelVersion + 1 || before.channelEnabled === (c.action === "enable") || after.channelEnabled !== (c.action === "enable")
      || before.locationVersion !== after.locationVersion || before.draftRevision !== after.draftRevision || JSON.stringify(before.fence) !== JSON.stringify(after.fence)) fail();
    if (typeof r.recordedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.recordedAt)) fail();
    receipt = { command: c, before, after, recordedAt: attendanceRecordInstant(r.recordedAt) };
  }
  return { siteId: expected.siteId, locationId: expected.locationId, ownerId: attendanceSelfUuid(v.ownerId), settingsVersion, channelVersion, channelEnabled,
    attendanceEnabled, webClockEnabled, location, draft, notice, noticeMatches, openWebShift, canPrepare, canEnable, canPause, receipt };
}
export const LOCATION_SETUP_ERRORS: Readonly<Record<string, number>> = { ...ATTENDANCE_LOCATION_POLICY_ERRORS, attendance_setup_unchanged: 409, attendance_setup_not_ready: 409, attendance_setup_open_web_shift: 409 };
