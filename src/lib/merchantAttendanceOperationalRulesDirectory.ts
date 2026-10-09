import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { parseAttendanceAdminQuery, parseAttendanceAdminResult, type AttendanceAdminLocation } from "./merchantAttendanceAdmin";
import { groupsQueryString, parseGroupsResponse, type GroupItem } from "./merchantAttendanceGroups";
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { attendanceSelfSite } from "./merchantAttendanceSelf";

// Only existing owner-authorized, single-page directories. No membership/Auth
// inference, writes, automatic pagination, or alternate feature-flag bypass.
export async function readOperationalRulesDirectory(input: { apiFetch: AttendanceApiFetch; siteId: string; actorId: string;
  kind: "groups" | "locations"; cursor: string | null; signal: AbortSignal; current: () => boolean }) {
  const siteId = attendanceSelfSite(input.siteId), actorId = captureBrowserUuid(input.actorId);
  const cursor = input.cursor === null ? null : captureBrowserUuid(input.cursor), controller = new AbortController();
  const deadline = performance.now() + 12000; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (e: Error) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}); reject(Error("directory_unavailable")); };
  const timer = setTimeout(abort, 12000); input.signal.addEventListener("abort", abort, { once: true });
  const check = () => { if (input.signal.aborted || controller.signal.aborted || !input.current() || performance.now() >= deadline) throw Error("directory_unavailable"); };
  const groupQuery = { siteId, view: "groups" as const, groupId: null, workerId: null, onDate: null, assignmentId: null, operationId: null, cursorId: cursor };
  const params = new URLSearchParams({ siteId, view: "locations", search: "" }); if (cursor) params.set("cursor", cursor);
  const url = input.kind === "groups" ? `/api/merchant-enterprise/attendance/groups?${groupsQueryString(groupQuery)}` : `/api/merchant-enterprise/attendance/admin?${params}`;
  const task = async () => {
    check(); const response = await input.apiFetch(url, { method: "GET", cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: controller.signal });
    if (controller.signal.aborted || response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("directory_unavailable"); }
    check(); reader = response.body?.getReader(); if (!reader) throw Error("directory_unavailable");
    let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { check(); const part = await reader.read(); check(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 131072) throw Error("directory_too_large"); text += decoder.decode(part.value, { stream: true }); }
    const raw = parseCaptureBrowserJson(text + decoder.decode()); check();
    if (input.kind === "groups") { const result = parseGroupsResponse(raw, groupQuery, null, actorId); check();
      if (result.receipt || result.detail || result.group || result.worker) throw Error("directory_invalid");
      return { kind: "groups" as const, items: result.items as GroupItem[], nextCursor: result.nextCursor }; }
    const body = captureBrowserExact(raw, ["ok", "siteId", "version", "settings", "view", "items", "nextCursor", "receipt", "moduleEnabled"]);
    if (body.ok !== true || typeof body.moduleEnabled !== "boolean") throw Error("directory_invalid");
    const result = parseAttendanceAdminResult(body, parseAttendanceAdminQuery(`https://local.invalid${url}`)); check();
    if (result.receipt) throw Error("directory_invalid");
    return { kind: "locations" as const, items: result.items as AttendanceAdminLocation[], nextCursor: result.nextCursor };
  };
  try { return await Promise.race([task(), stopped]); }
  finally { clearTimeout(timer); input.signal.removeEventListener("abort", abort); controller.abort(); if (reader) { const owned = reader; void owned.cancel().catch(() => {}).finally(() => { try { owned.releaseLock(); } catch { /* A cancelled late read still owns its lock. */ } }); } }
}
