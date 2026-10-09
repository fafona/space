import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { terminalSecret } from "./merchantAttendanceTerminal";
import { terminalHash } from "./merchantAttendanceTerminal.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ONSITE_QR_ERRORS, ONSITE_QR_MAX_TOKEN_BYTES, parseOnsiteClaims, parseOnsiteClockBody, parseOnsiteClockResult,
  type OnsiteClaims, type OnsiteCommand, type OnsiteClockResult, type OnsiteIssueResult } from "./merchantAttendanceOnsiteQr";

export type OnsiteIssueInput = { siteId: string; terminalId: string; secret: string };
export type OnsiteClockInput = {
  siteId: string; authUserId: string; token: string | null; command: OnsiteCommand | null; operationId: string | null; allowNew: boolean;
};
const MAC_DOMAIN = "faolla.attendance.onsite.v1\0";

function signingKey(): Buffer {
  // A separate mandatory 256-bit key: never reuse terminal, auth or PIN secrets.
  const value = process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new MerchantAttendanceError("attendance_unavailable");
  return Buffer.from(value, "hex");
}
function mac(encoded: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(MAC_DOMAIN, "utf8").update(`aq1.${encoded}`, "utf8").digest();
}
function sign(claims: OnsiteClaims, key: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(parseOnsiteClaims(claims)), "utf8").toString("base64url");
  const token = `aq1.${encoded}.${mac(encoded, key).toString("base64url")}`;
  if (Buffer.byteLength(token, "utf8") > ONSITE_QR_MAX_TOKEN_BYTES) throw new MerchantAttendanceError("attendance_qr_invalid");
  return token;
}
export function signOnsiteToken(claims: OnsiteClaims): string {
  return sign(claims, signingKey());
}

/** Verify authenticity and canonical structure only. SQL checks terminal state
 * and clock freshness after its locks, except for an exact committed replay. */
export function verifyOnsiteToken(token: string): OnsiteClaims {
  const key = signingKey();
  try {
    if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > ONSITE_QR_MAX_TOKEN_BYTES) throw Error("token_size");
    const parts = /^aq1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!parts) throw Error("token_format");
    const payload = Buffer.from(parts[1], "base64url"), signature = Buffer.from(parts[2], "base64url");
    if (payload.toString("base64url") !== parts[1] || signature.length !== 32 || signature.toString("base64url") !== parts[2]
      || !timingSafeEqual(signature, mac(parts[1], key))) throw Error("token_signature");
    const serialized = payload.toString("utf8"), claims = parseOnsiteClaims(JSON.parse(serialized));
    if (JSON.stringify(claims) !== serialized) throw Error("token_noncanonical");
    return claims;
  } catch { throw new MerchantAttendanceError("attendance_qr_invalid"); }
}

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MerchantAttendanceError("attendance_invalid_request");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new MerchantAttendanceError("attendance_invalid_request");
  return value;
}
async function rpc(name: string, args: Record<string, unknown>, service: AttendanceSelfRpc | null): Promise<unknown> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let result: Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
  try { result = await service.rpc(name, args); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ONSITE_QR_ERRORS, code) ? code : "attendance_unavailable");
  }
  return result.data;
}

export async function executeOnsiteIssue(input: OnsiteIssueInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<OnsiteIssueResult> {
  const value = exact(input, ["siteId", "terminalId", "secret"]);
  const siteId = attendanceSelfSite(value.siteId), terminalId = attendanceSelfUuid(value.terminalId), secret = terminalSecret(value.secret);
  // Fail closed before any RPC when the separately provisioned key is missing.
  const key = signingKey();
  const data = await rpc("faolla_attendance_onsite_issue_v1", { p_site: siteId, p_terminal: terminalId, p_secret_hash: terminalHash(secret) }, service);
  try {
    const issued = exact(data, ["siteId", "terminalId", "locationId", "pairedAtMs", "issuedAtMs", "expiresAtMs"]);
    if (issued.siteId !== siteId || issued.terminalId !== terminalId) throw Error("issue_scope");
    const claims = parseOnsiteClaims({ v: 1, purpose: "faolla.attendance.onsite", ...issued, nonce: randomUUID() });
    return { siteId, terminalId, locationId: claims.locationId, issuedAtMs: claims.issuedAtMs, expiresAtMs: claims.expiresAtMs, token: sign(claims, key) };
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}

export async function executeOnsiteClock(input: OnsiteClockInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<OnsiteClockResult> {
  const value = exact(input, ["siteId", "authUserId", "token", "command", "operationId", "allowNew"]);
  const siteId = attendanceSelfSite(value.siteId), authUserId = attendanceSelfUuid(value.authUserId);
  if (typeof value.allowNew !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  const operationId = value.operationId === null ? null : attendanceSelfUuid(value.operationId);
  let claims: OnsiteClaims | null = null, command: OnsiteCommand | null = null;
  if (value.command !== null) {
    if (operationId !== null) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = parseOnsiteClockBody({ siteId, token: value.token, command: value.command });
    command = parsed.command;
    claims = verifyOnsiteToken(parsed.token);
    if (claims.siteId !== siteId || claims.locationId !== command.locationId) throw new MerchantAttendanceError("attendance_qr_invalid");
  } else if (value.token !== null) throw new MerchantAttendanceError("attendance_invalid_request");
  const data = await rpc(attendanceClockRpcName("onsite", siteId), {
    p_site: siteId, p_auth: authUserId, p_claims: claims, p_command: command, p_operation: operationId, p_allow_new: value.allowNew,
  }, service);
  return parseOnsiteClockResult(data, { siteId, command, operationId });
}
