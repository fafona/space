import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OUTAGE_REVIEW_ERRORS, assertOutageReviewWriteQuery, outageReviewCommandFingerprintText, parseOutageReviewCommand, parseOutageReviewQuery, parseOutageReviewResult } from "./merchantAttendanceOutageReview";
import type { OutageReviewCommand, OutageReviewQuery } from "./merchantAttendanceOutageReviewContract";
export function outageReviewSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_OUTAGE_REVIEW_ENABLED !== "1" || typeof siteId !== "string" || siteId.length !== 8 || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_OUTAGE_REVIEW_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim()); return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export const outageReviewCommandFingerprint = (q: OutageReviewQuery, c: OutageReviewCommand) => createHash("sha256").update(outageReviewCommandFingerprintText(q, c), "utf8").digest("hex");
function projectProposal(raw: unknown) {
  if (raw === null) return null;
  const r = exact(raw, ["operationId", "revision", "action", "actorId", "resultVersion", "resultFingerprint", "reason", "recordedAt", "evidence", "sourceText"]);
  if (typeof r.sourceText !== "string" || Buffer.byteLength(r.sourceText, "utf8") > 131072 || createHash("sha256").update(r.sourceText, "utf8").digest("hex") !== r.resultFingerprint || !same(parseCaptureBrowserJson(r.sourceText), r.evidence)) throw Error("invalid source");
  const { sourceText: _text, ...p } = r; void _text; return p;
}
export function projectOutageReviewResult(raw: unknown, query: OutageReviewQuery, actorId: string, command: OutageReviewCommand | null = null) {
  try {
    safeTree(raw, 1048576);
    const v = exact(raw, ["protocol", "siteId", "access", "mode", "actorId", "declarationId", "readAt", "canWrite", "revision", "resultVersion", "current", "proposal", "response", "status", "history", "historyTruncated", "receipt"]);
    const receipt = v.receipt === null ? null : exact(v.receipt, ["operationId", "commandFingerprint", "entry", "proposal"]);
    const result = parseOutageReviewResult({ ...v, proposal: projectProposal(v.proposal), receipt: receipt === null ? null : { ...receipt, proposal: projectProposal(receipt.proposal) } }, query, actorId, command);
    if (command && result.receipt?.commandFingerprint !== outageReviewCommandFingerprint(query, command)) throw Error("command mismatch");
    return result;
  } catch { throw new MerchantAttendanceError("attendance_outage_review_invalid"); }
}
export async function executeOutageReview(input: { query: OutageReviewQuery; authUserId: string; command?: OutageReviewCommand | null; moduleEnabled?: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOutageReviewQuery(input.query), command = input.command == null ? null : parseOutageReviewCommand(input.command);
  let authUserId: string; try { authUserId = uuid(input.authUserId); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  const moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (command) assertOutageReviewWriteQuery(query, command);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_outage_review_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: moduleEnabled && outageReviewSiteEnabled(query.siteId) }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OUTAGE_REVIEW_ERRORS, code) ? code : "attendance_unavailable"); }
  return projectOutageReviewResult(response.data, query, authUserId, command);
}
