import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OUTAGE_LINKS_ERRORS, assertOutageLinksWriteQuery, outageLinksCommandFingerprintText, parseOutageLinksCommand, parseOutageLinksQuery, parseOutageLinksResult } from "./merchantAttendanceOutageLinks";
import type { OutageLinksCommand, OutageLinksQuery } from "./merchantAttendanceOutageLinksContract";

// Not exposed until the complete recovery/self/period workflow is accepted.
export function outageLinksSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_OUTAGE_LINKS_ENABLED !== "1" || typeof siteId !== "string" || siteId.length !== 8 || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_OUTAGE_LINKS_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export const outageLinksCommandFingerprint = (q: OutageLinksQuery, c: OutageLinksCommand) => createHash("sha256").update(outageLinksCommandFingerprintText(q, c), "utf8").digest("hex");
function projectSource(raw: unknown, kind: "entry" | "preview") {
  if (raw === null) return null;
  const keys = kind === "entry" ? ["operationId", "revision", "action", "actorId", "reason", "sources", "evidence", "sourceText", "fingerprint", "recordedAt"] : ["fingerprint", "evidence", "sourceText", "eligible", "observations", "blockers"];
  const v = exact(raw, keys);
  if (v.evidence === null) {
    if (v.sourceText !== null) throw Error("unexpected source");
  } else if (typeof v.sourceText !== "string" || Buffer.byteLength(v.sourceText, "utf8") > 131072
    || createHash("sha256").update(v.sourceText, "utf8").digest("hex") !== v.fingerprint || !same(parseCaptureBrowserJson(v.sourceText), v.evidence)) throw Error("invalid source");
  const { sourceText: _text, ...result } = v; void _text; return result;
}
export function projectOutageLinksResult(raw: unknown, query: OutageLinksQuery, actorId: string, command: OutageLinksCommand | null = null) {
  try {
    safeTree(raw, 1048576);
    const v = exact(raw, ["protocol", "siteId", "access", "mode", "actorId", "declarationId", "readAt", "canWrite", "revision", "current", "preview", "history", "historyTruncated", "receipt"]);
    const receipt = v.receipt === null ? null : exact(v.receipt, ["operationId", "commandFingerprint", "entry"]);
    const projected = { ...v, current: projectSource(v.current, "entry"), preview: projectSource(v.preview, "preview"),
      receipt: receipt === null ? null : { ...receipt, entry: projectSource(receipt.entry, "entry") } };
    const result = parseOutageLinksResult(projected, query, actorId, command);
    if (command && result.receipt?.commandFingerprint !== outageLinksCommandFingerprint(query, command)) throw Error("command mismatch");
    return result;
  } catch { throw new MerchantAttendanceError("attendance_outage_links_invalid"); }
}
export async function executeOutageLinks(input: { query: OutageLinksQuery; authUserId: string; command?: OutageLinksCommand | null; moduleEnabled?: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOutageLinksQuery(input.query), command = input.command == null ? null : parseOutageLinksCommand(input.command);
  let authUserId: string;
  try { authUserId = uuid(input.authUserId); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  const moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (command) assertOutageLinksWriteQuery(query);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_outage_links_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command,
    p_allow_write: moduleEnabled && outageLinksSiteEnabled(query.siteId) }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OUTAGE_LINKS_ERRORS, code) ? code : "attendance_unavailable"); }
  return projectOutageLinksResult(response.data, query, authUserId, command);
}
