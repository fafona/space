import { parseAttendanceChoicesQuery, parseAttendanceChoicesResult, type AttendanceChoice, type AttendanceChoiceKind } from "./merchantAttendanceChoices";
import { attendanceManagementMessage, attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";

type LabelsState = { phase: "idle" | "loading" | "ready" | "failed"; kind: AttendanceChoiceKind;
  items: Readonly<Record<string, AttendanceChoice>>; missing: readonly string[]; message: string };

// Short-lived editor display cache only. Never reused between owners, managers,
// grants or edits; labels and eligibility never change the submitted ID sets.
export class AttendanceChoiceLabelsClient {
  private state: LabelsState = { phase: "idle", kind: "workers", items: {}, missing: [], message: "" };
  private cache = new Map<string, AttendanceChoice | null>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(private readonly options: { siteId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number }) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: LabelsState) { this.state = state; for (const listener of this.listeners) listener(); }
  cancel = () => { this.generation++; this.controller?.abort(); this.controller = null; };
  load = async (kind: AttendanceChoiceKind, ids: readonly string[], seeds: readonly AttendanceChoice[] = [], refresh = false) => {
    this.cancel(); const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", kind, items: {}, missing: [], message: "正在读取已选项名称…" });
    try {
      attendanceSelfSite(this.options.siteId);
      if (!["workers", "locations", "managers"].includes(kind) || ids.length > (kind === "workers" ? 200 : kind === "locations" ? 50 : 1)) throw Error("attendance_invalid_request");
      const sorted = Array.from(ids, attendanceSelfUuid).sort();
      if (new Set(sorted).size !== sorted.length) throw Error("attendance_invalid_request");
      const staged = new Map<string, AttendanceChoice | null>();
      for (const id of sorted) {
        const key = `${kind}:${id}`;
        if (!refresh && this.cache.has(key)) staged.set(id, this.cache.get(key)!);
      }
      if (!refresh) for (const seed of seeds) {
        if (!sorted.includes(seed.id)) continue;
        const expected = parseAttendanceChoicesQuery(`https://attendance.invalid/?siteId=${this.options.siteId}&kind=${kind}&ids=${seed.id}`);
        const parsed = parseAttendanceChoicesResult({ siteId: this.options.siteId, kind, items: [seed], nextCursor: null }, expected);
        staged.set(seed.id, parsed.items[0]);
      }
      const unresolved = sorted.filter(id => !staged.has(id));
      const deadline = Date.now() + (this.options.timeoutMs ?? 12000);
      // Sequential, bounded requests: at most 8 for 200 workers, 2 for 50 places.
      // One deadline for the entire load; no background retry or polling.
      for (let offset = 0; offset < unresolved.length; offset += 25) {
        if (generation !== this.generation) return;
        const timeoutMs = deadline - Date.now(); if (timeoutMs <= 0) throw Error("timeout");
        const batch = unresolved.slice(offset, offset + 25);
        const q = new URLSearchParams({ siteId: this.options.siteId, kind, ids: batch.join(",") });
        const expected = parseAttendanceChoicesQuery(`https://attendance.invalid/?${q}`);
        const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/choices?${q}`, {},
          { signal: controller.signal, maxBytes: 32768, timeoutMs });
        const result = parseAttendanceChoicesResult(body, expected);
        for (const id of batch) staged.set(id, null);
        for (const item of result.items) staged.set(item.id, item);
      }
      if (generation !== this.generation) return;
      const items: Record<string, AttendanceChoice> = {}, missing: string[] = [];
      // Retain only the current selection per kind (200 + 50 + 1 at most).
      for (const key of this.cache.keys()) if (key.startsWith(`${kind}:`)) this.cache.delete(key);
      for (const [id, item] of staged) {
        this.cache.set(`${kind}:${id}`, item);
        if (item) items[id] = item; else missing.push(id);
      }
      this.set({ phase: "ready", kind, items, missing,
        message: missing.length ? "部分已选项未找到或不可访问，保留原编号；不会自动移除或扩大授权。" : "名称为当前信息；保存仍按唯一编号核验。" });
    } catch (error) {
      if (generation !== this.generation) return;
      this.cache.clear();
      this.set({ phase: "failed", kind, items: {}, missing: [], message: `未能读取已选项名称。${attendanceManagementMessage(error)}` });
    } finally { if (generation === this.generation) this.controller = null; }
  };
}
