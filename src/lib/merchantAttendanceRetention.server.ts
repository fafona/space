import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { RETENTION_ERRORS, parseRetentionCommand, parseRetentionQuery, parseRetentionResult, retentionCommandFingerprintText, retentionWriteQuery } from "./merchantAttendanceRetention";
import { RETENTION_RESULT_LIMIT, type RetentionCommand, type RetentionQuery, type RetentionReceipt } from "./merchantAttendanceRetentionContract";

export function retentionSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_RETENTION_ENABLED !== "1" || !/^[0-9]{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_RETENTION_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => /^[0-9]{8}$/.test(s)) && sites.includes(siteId);
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const retentionCommandFingerprint = (c: RetentionCommand) => sha(retentionCommandFingerprintText(c));
function projectRecord(raw: unknown, siteId: string) {
  const r = exact(raw, ["category", "recordId", "source", "sourceText", "sourceFingerprint", "policy", "anchorAt", "asOf", "dueAt", "ageState", "preservation"]);
  if (typeof r.sourceText !== "string" || Buffer.byteLength(r.sourceText, "utf8") > RETENTION_RESULT_LIMIT || sha(r.sourceText) !== r.sourceFingerprint
    || !same(parseCaptureBrowserJson(r.sourceText), { siteId, category: r.category, recordId: r.recordId, source: r.source })) throw Error("source mismatch");
  const { sourceText: _text, ...publicRecord } = r; void _text; return publicRecord;
}
export function projectRetentionResult(raw: unknown, query: RetentionQuery, actorId: string, command: RetentionCommand | null = null) {
  try {
    safeTree(raw, RETENTION_RESULT_LIMIT * 3);
    const r = exact(raw, ["protocol", "siteId", "actorId", "readAt", "canWrite", "data", "receipt", "disposition"]);
    const d = r.data as Record<string, unknown>; let data: unknown = d;
    if (d?.kind === "record") { exact(d, ["kind", "item"]); data = { kind: "record", item: projectRecord(d.item, query.siteId) }; }
    if (d?.kind === "preview") { exact(d, ["kind", "asOf", "items"]); if (!Array.isArray(d.items) || d.items.length > 100) throw Error("capacity");
      data = { kind: "preview", asOf: d.asOf, items: d.items.map(item => projectRecord(item, query.siteId)) }; }
    const result = parseRetentionResult({ ...r, data }, query, actorId, command);
    const check = (receipt: RetentionReceipt) => { if (receipt.commandFingerprint !== retentionCommandFingerprint(receipt.command)) throw Error("command mismatch"); };
    if (result.receipt) check(result.receipt);
    if (result.data.kind === "history") result.data.items.forEach(check);
    return result;
  } catch { throw new MerchantAttendanceError("attendance_retention_invalid"); }
}
export type RetentionInput = { query: RetentionQuery; authUserId: string; command?: RetentionCommand | null; allowWrite?: boolean };
export async function executeRetention(input: RetentionInput, rpc: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseRetentionQuery(input.query), command = input.command == null ? null : parseRetentionCommand(input.command), allowWrite = input.allowWrite ?? false;
  let authUserId: string;
  try { authUserId = uuid(input.authUserId); if (typeof allowWrite !== "boolean" || command && !same(query, retentionWriteQuery(command))) throw Error("invalid scope"); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  if (!rpc) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await rpc.rpc("faolla_attendance_retention_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(RETENTION_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = projectRetentionResult(response.data, query, authUserId, command);
  if (result.canWrite && !allowWrite) throw new MerchantAttendanceError("attendance_retention_invalid");
  return result;
}
