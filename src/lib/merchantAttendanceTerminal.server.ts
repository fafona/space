import { createHash, randomBytes } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { TERMINAL_ERRORS, parseTerminalDevice, parseTerminalList, terminalPairToken, type TerminalCommand, type TerminalQuery } from "./merchantAttendanceTerminal";

export type TerminalAdminInput = TerminalQuery & { authUserId: string; command: TerminalCommand | null; allowCreate: boolean };
export type TerminalDeviceInput = { siteId: string; terminalId: string; secret: string; deviceSecret: string | null; allowPair: boolean };
export function terminalHash(secret: string) { return createHash("sha256").update(secret, "utf8").digest("hex"); }
export function createTerminalDeviceSecret() { return randomBytes(32).toString("base64url"); }
async function rpc(name: string, args: Record<string, unknown>, service: AttendanceSelfRpc | null) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const result = await service.rpc(name, args);
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(TERMINAL_ERRORS, code) ? code : "attendance_unavailable");
  }
  return result.data;
}
export async function executeTerminalAdmin(input: TerminalAdminInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const command = input.command?.action === "create" ? {
    action: "create", terminalId: input.command.terminalId, locationId: input.command.locationId, label: input.command.label, pairHash: terminalHash(input.command.pairSecret),
  } : input.command;
  const data = await rpc("faolla_attendance_terminal_admin_v1", {
    p_site: input.siteId, p_auth: input.authUserId, p_query: { cursor: input.cursor, terminalId: input.terminalId }, p_command: command, p_allow_create: input.allowCreate,
  }, service);
  try {
    const result = parseTerminalList(data, { ...input, terminalId: command?.terminalId ?? input.terminalId });
    if (command && (result.items.length !== 1 || command.action === "revoke" && result.items[0].state !== "revoked"
      || command.action === "create" && (result.items[0].locationId !== command.locationId || result.items[0].label !== command.label))) throw Error("mismatched_terminal");
    return result;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
export async function executeTerminalDevice(input: TerminalDeviceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const data = await rpc("faolla_attendance_terminal_device_v1", {
    p_site: input.siteId, p_id: input.terminalId, p_secret_hash: terminalHash(input.secret),
    p_device_hash: input.deviceSecret === null ? null : terminalHash(input.deviceSecret), p_allow_pair: input.allowPair,
  }, service);
  try { return parseTerminalDevice(data, input); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
export function terminalCookieValue(input: TerminalDeviceInput) {
  if (!input.deviceSecret) throw new MerchantAttendanceError("attendance_invalid_request");
  return terminalPairToken(input.siteId, input.terminalId, input.deviceSecret);
}
