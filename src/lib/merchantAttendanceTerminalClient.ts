import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { AttendanceManagementRejected, attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { TERMINAL_API, TERMINAL_ERRORS, parseTerminalBody, parseTerminalList, terminalMessage, terminalPairToken,
  type TerminalCommand, type TerminalList, type TerminalQuery } from "./merchantAttendanceTerminal";

export const terminalErrorStatuses = { ...Object.fromEntries(Object.entries(TERMINAL_ERRORS).map(([key, v]) => [key, v.status])),
  unauthorized: 401, forbidden_origin: 403, enterprise_management_disabled: 403 };
export function newTerminalPairSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
type List = TerminalList & { moduleEnabled: boolean };
export class AttendanceTerminalClient {
  private state: { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: List | null;
    pending: TerminalCommand | null; pairToken: string | null; message: string } = {
    phase: "loading", result: null, pending: null, pairToken: null, message: "正在读取门店终端…",
  };
  private generation = 0; private disposed = false; private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private options: { siteId: string; ownerId?: string; apiFetch: AttendanceApiFetch; randomId?: () => string; randomSecret?: () => string; timeoutMs?: number }) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  hide = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "blocked", result: null, pending: null, pairToken: null,
      message: "配对码已从此页面清除。请重新读取终端；如未完成配对，请撤销原终端后再创建。" });
  };
  dispose = () => { this.disposed = true; this.hide(); };
  initialize = async () => { this.disposed = false; await this.load(); };
  private async request(query: TerminalQuery, command: TerminalCommand | null) {
    const g = ++this.generation; this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.set({ phase: command ? "saving" : "loading", result: null, pairToken: null, message: command ? "正在提交，请勿重复操作…" : "正在核对终端状态…" });
    try {
      const search = new URLSearchParams({ siteId: query.siteId });
      if (query.cursor) search.set("cursor", query.cursor); if (query.terminalId) search.set("terminalId", query.terminalId);
      const body = await attendanceManagementRequest(this.options.apiFetch, command ? TERMINAL_API : `${TERMINAL_API}?${search}`, command
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: query.siteId, command }) } : {},
      { signal: controller.signal, timeoutMs: this.options.timeoutMs, errorStatuses: terminalErrorStatuses, maxBytes: 65536 });
      if (this.disposed || g !== this.generation) return;
      const result = { ...parseTerminalList({ siteId: body.siteId, items: body.items, nextCursor: body.nextCursor },
        { ...query, terminalId: command?.terminalId ?? query.terminalId }), moduleEnabled: body.moduleEnabled as boolean };
      const p = this.state.pending, item = p ? result.items.find(t => t.id === p.terminalId) : undefined;
      if (p) {
        if (!item || p.action === "revoke" && item.state !== "revoked") {
          this.set({ phase: "unconfirmed", result, message: "尚未确认原操作。可以再次查询，或明确选择原样重试；不会自动新建。" }); return;
        }
        if (p.action === "create" && (item.locationId !== p.locationId || item.label !== p.label)) throw Error("mismatched_terminal");
        this.set({ pending: null, pairToken: p.action === "create" && item.state === "pending"
          ? terminalPairToken(query.siteId, p.terminalId, p.pairSecret) : null });
      }
      this.set({ phase: "ready", result, message: "已读取当前状态。此阶段只完成设备配对，不提供 PIN 打卡。" });
    } catch (error) {
      if (this.disposed || g !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      if (["unauthorized", "attendance_access_denied", "forbidden_origin", "enterprise_management_disabled"].includes(code)) {
        this.set({ phase: "blocked", result: null, pending: null, pairToken: null, message: terminalMessage(code) });
      } else if (command && error instanceof AttendanceManagementRejected) {
        this.set({ phase: "blocked", result: null, pending: null, pairToken: null, message: terminalMessage(code) });
      } else this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, pairToken: null, message: terminalMessage(code) });
    } finally { if (g === this.generation) this.controller = null; }
  }
  load = async (cursor: string | null = null) => {
    if (this.disposed || this.controller) return;
    await this.request({ siteId: this.options.siteId, cursor: this.state.pending ? null : cursor, terminalId: this.state.pending?.terminalId ?? null }, null);
  };
  create = async (locationId: string, label: string) => {
    if (this.disposed || this.controller || this.state.pending || this.state.phase !== "ready" || !this.state.result?.moduleEnabled) return;
    try {
      const command = parseTerminalBody({ siteId: this.options.siteId, command: { action: "create", terminalId: (this.options.randomId ?? (() => crypto.randomUUID()))(),
        locationId, label: label.trim(), pairSecret: (this.options.randomSecret ?? newTerminalPairSecret)() } }).command;
      this.set({ pending: command }); await this.retry();
    } catch { this.set({ message: "请检查终端名称和地点，并使用支持安全随机数的浏览器。未生成有效操作前不会提交。" }); }
  };
  revoke = async (terminalId: string) => {
    if (this.disposed || this.controller || this.state.pending || this.state.phase !== "ready") return;
    const command = parseTerminalBody({ siteId: this.options.siteId, command: { action: "revoke", terminalId } }).command;
    this.set({ pending: command }); await this.retry();
  };
  retry = async () => {
    if (this.disposed || this.controller || !this.state.pending) return;
    await this.request({ siteId: this.options.siteId, cursor: null, terminalId: null }, this.state.pending);
  };
}
