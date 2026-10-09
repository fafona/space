import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { parseAttendanceLocationPolicyCommand } from "./merchantAttendanceLocationPolicy";
import { parseLocationSetupCommand } from "./merchantAttendanceLocationSetup";
import { parseNoticeCommand } from "./merchantAttendanceLocationNotice";

export type LocationWorkspaceStep = "policy" | "setup" | "notice";
export type LocationWorkspaceActivity = { busy: boolean; pendingId: string | null; receiptId: string | null };
export type LocationWorkspaceIdentity = { siteId: string; ownerId: string; locationId: string };
export type LocationWorkspaceTarget = { step: LocationWorkspaceStep; locationId: string };
type Store = Pick<Storage, "getItem">;
const object = (v: unknown, keys: string[]): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== [...keys].sort().join()) throw Error("invalid_pending");
  return v as Record<string, unknown>;
};
// Routing hints only: never remove/rewrite a pending command or treat a hint as authorization.
export function locationWorkspaceRecovery(storage: Store, identity: LocationWorkspaceIdentity, currentLocation = identity.locationId): LocationWorkspaceTarget | null {
  const { siteId, ownerId, locationId } = identity;
  attendanceSelfSite(siteId); attendanceSelfUuid(ownerId); attendanceSelfUuid(locationId); attendanceSelfUuid(currentLocation);
  if (storage.getItem(`faolla:attendance:config:v1:${siteId}:${ownerId}`) !== null) throw Error("basic_configuration_pending");
  const found: LocationWorkspaceTarget[] = [];
  for (const loc of new Set([currentLocation, locationId])) {
    const raw = storage.getItem(`faolla:attendance:location-policy:v1:${siteId}:${ownerId}:${loc}`); if (raw === null) continue;
    if (raw.length > 5000) throw Error("invalid_pending");
    const p = object(JSON.parse(raw), ["ownerId", "siteId", "locationId", "command"]);
    if (p.ownerId !== ownerId || p.siteId !== siteId || p.locationId !== loc) throw Error("invalid_pending");
    const command = object(p.command, ["operationId", "expectedRevision", "expectedSettingsVersion", "expectedLocationVersion", "values"]);
    parseAttendanceLocationPolicyCommand({ siteId, locationId: loc, ...command });
    found.push({ step: "policy", locationId: loc });
  }
  for (const step of ["setup", "notice"] as const) {
    const key = step === "setup" ? `faolla:attendance:location-setup:v1:${siteId}:${ownerId}` : `faolla:attendance:notice:v1:${siteId}:owner:${ownerId}`;
    const raw = storage.getItem(key); if (raw === null) continue; if (raw.length > 4096) throw Error("invalid_pending");
    const p = object(JSON.parse(raw), [step === "setup" ? "ownerId" : "actorId", "query", "command"]);
    const q = object(p.query, step === "setup" ? ["siteId", "locationId", "operationId"] : ["siteId", "locationId", "operationId", "access", "expectedWorkerId"]);
    if (p[step === "setup" ? "ownerId" : "actorId"] !== ownerId || q.siteId !== siteId || q.operationId !== null
      || step === "notice" && (q.access !== "owner" || q.expectedWorkerId !== null)) throw Error("invalid_pending");
    const loc = attendanceSelfUuid(q.locationId);
    const c = object(p.command, step === "setup" ? ["action", "operationId", "expectedSettingsVersion", "expectedLocationVersion", "expectedChannelVersion", "draftRevision", "reason"]
      : ["action", "operationId", "expectedRevision", "draftRevision", "expectedSettingsVersion", "expectedLocationVersion", "reason"]);
    if (step === "setup") parseLocationSetupCommand({ siteId, locationId: loc, ...c });
    else parseNoticeCommand({ siteId, locationId: loc, access: "owner", expectedWorkerId: null, ...c });
    found.push({ step, locationId: loc });
  }
  return found[0] ?? null;
}

export class AttendanceLocationWorkspace {
  private state: { token: number; target: LocationWorkspaceTarget | null; busy: boolean; pendingId: string | null; dirty: boolean;
    requested: LocationWorkspaceStep | "close" | null; storageBlocked: boolean; message: string } = {
    token: 0, target: null, busy: false, pendingId: null, dirty: false, requested: null, storageBlocked: false, message: "正在核对本页待确认操作…" };
  private listeners = new Set<() => void>(); private sentId: string | null = null; private lastReceipt: string | null = null;
  constructor(readonly identity: LocationWorkspaceIdentity, private readonly storage: () => Store) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private open(target: LocationWorkspaceTarget, recovery: boolean) {
    this.sentId = null; this.lastReceipt = null; this.set({ token: this.state.token + 1, target, busy: true, pendingId: null, dirty: false, requested: null, storageBlocked: false,
      message: recovery ? "先核对下方地点和步骤的原操作。只查询，不会自动提交。" : "切换步骤会重新读取服务器状态，不自动执行下一步。" });
  }
  initialize = () => {
    // Initialization is only for mount/storage recovery, never a replacement for dirty navigation.
    if (this.state.target && !this.state.storageBlocked) return;
    try { const recovery = locationWorkspaceRecovery(this.storage(), this.identity); this.open(recovery ?? { step: "policy", locationId: this.identity.locationId }, !!recovery); }
    catch { this.set({ storageBlocked: true, message: "基础配置仍待确认，或本页恢复存储不可读。请先核对原操作；不会覆盖、删除或启动新设置。" }); }
  };
  report = (token: number, activity: LocationWorkspaceActivity) => {
    if (token !== this.state.token) return;
    if (activity.pendingId) this.sentId = activity.pendingId;
    const confirmed = activity.receiptId !== null && !activity.pendingId && (this.sentId !== null ? activity.receiptId === this.sentId : activity.receiptId !== this.lastReceipt);
    if (activity.receiptId) this.lastReceipt = activity.receiptId;
    if (confirmed) this.sentId = null;
    this.set({ busy: activity.busy, pendingId: activity.pendingId, ...(confirmed ? { dirty: false } : {}) });
  };
  edit = () => { if (this.state.target && !this.state.busy && !this.state.pendingId) this.set({ dirty: true, requested: null }); };
  cancel = () => this.set({ requested: null });
  requiresLeaveWarning = () => {
    if (this.state.dirty || this.state.pendingId) return true;
    try { return locationWorkspaceRecovery(this.storage(), this.identity, this.state.target?.locationId) !== null; }
    catch { return true; }
  };
  navigate = (requested: LocationWorkspaceStep | "close", discard = false): boolean => {
    if (this.state.busy || this.state.pendingId) { this.set({ requested: null, message: "当前操作仍在读取、提交或等待确认，请先核对原编号。" }); return false; }
    if (this.state.storageBlocked && requested === "close") return true; // Leave without altering unreadable data.
    let recovery: LocationWorkspaceTarget | null;
    try { recovery = locationWorkspaceRecovery(this.storage(), this.identity, this.state.target?.locationId); }
    catch { this.set({ requested: null, message: "恢复存储或基础配置有待核对，未切换、未删除原操作。" }); return false; }
    if (this.state.dirty && !discard) { this.set({ requested, message: "有尚未保存的输入。继续切换将丢弃这些输入，但不会删除已提交操作。" }); return false; }
    if (recovery) { this.open(recovery, true); return false; }
    if (requested === "close") return true;
    this.open({ step: requested, locationId: this.identity.locationId }, false); return false;
  };
}
