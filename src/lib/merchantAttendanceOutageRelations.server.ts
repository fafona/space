import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OUTAGE_RELATIONS_ERRORS, assertOutageRelationsWriteQuery, outageRelationsCommandFingerprintText,
  parseOutageRelationsCommand, parseOutageRelationsQuery, parseOutageRelationsResult } from "./merchantAttendanceOutageRelations";
import type { OutageRelationsCommand, OutageRelationsQuery } from "./merchantAttendanceOutageRelationsContract";

export function outageRelationsSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED !== "1" || typeof siteId !== "string" || !/^[0-9]{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => /^[0-9]{8}$/.test(s)) && sites.includes(siteId);
}
export const outageRelationsCommandFingerprint = (q: OutageRelationsQuery, c: OutageRelationsCommand) =>
  createHash("sha256").update(outageRelationsCommandFingerprintText(q, c), "utf8").digest("hex");
function projectSource(raw: unknown, kind: "entry" | "preview") {
  if (raw === null) return null;
  const v = exact(raw, kind === "entry" ? ["pair", "operationId", "revision", "action", "kind", "actorId", "reason", "evidence", "sourceText", "fingerprint", "recordedAt"]
    : ["fingerprint", "evidence", "sourceText", "eligible", "blockers"]);
  if (v.evidence === null) { if (v.sourceText !== null) throw Error("unexpected source"); }
  else if (typeof v.sourceText !== "string" || Buffer.byteLength(v.sourceText, "utf8") > 131072
    || createHash("sha256").update(v.sourceText, "utf8").digest("hex") !== v.fingerprint
    || !same(parseCaptureBrowserJson(v.sourceText), v.evidence)) throw Error("invalid source");
  const { sourceText: _text, ...publicItem } = v; void _text; return publicItem;
}
export function projectOutageRelationsResult(raw: unknown, query: OutageRelationsQuery, actorId: string, command: OutageRelationsCommand | null = null) {
  try {
    safeTree(raw, 1048576);
    const v = exact(raw, ["protocol", "siteId", "access", "mode", "actorId", "declarationId", "relatedDeclarationId", "readAt", "canWrite", "items", "revision", "current", "preview", "history", "historyTruncated", "receipt"]);
    const receipt = v.receipt === null ? null : exact(v.receipt, ["operationId", "commandFingerprint", "entry"]);
    const result = parseOutageRelationsResult({ ...v, current: projectSource(v.current, "entry"), preview: projectSource(v.preview, "preview"),
      receipt: receipt === null ? null : { ...receipt, entry: projectSource(receipt.entry, "entry") } }, query, actorId, command);
    if (command && result.receipt?.commandFingerprint !== outageRelationsCommandFingerprint(query, command)) throw Error("command mismatch");
    return result;
  } catch { throw new MerchantAttendanceError("attendance_outage_relations_invalid"); }
}
export async function executeOutageRelations(input: { query: OutageRelationsQuery; authUserId: string; command?: OutageRelationsCommand | null; moduleEnabled?: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOutageRelationsQuery(input.query), command = input.command == null ? null : parseOutageRelationsCommand(input.command);
  let authUserId: string;
  try { authUserId = uuid(input.authUserId); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  const moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (command) assertOutageRelationsWriteQuery(query);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_outage_relations_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command,
    p_allow_write: moduleEnabled && outageRelationsSiteEnabled(query.siteId) }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OUTAGE_RELATIONS_ERRORS, code) ? code : "attendance_unavailable"); }
  return projectOutageRelationsResult(response.data, query, authUserId, command);
}
