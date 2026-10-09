import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import {
  PERIOD_DELEGATION_ERRORS, parsePeriodDelegationQuery, parsePeriodDelegationBody, parsePeriodDelegationResult,
  periodDelegationFingerprintText, periodDelegationReceiptMatches,
  type PeriodDelegationQuery, type PeriodDelegationCommand,
} from "./merchantAttendancePeriodDelegation";

/** Explicit independent rollout and at most64 exact site IDs; never a wildcard. */
export function periodDelegationEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!/^[0-9]{8}$/.test(siteId) || siteId.length !== 8 || env.FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_PERIOD_DELEGATION_SITES;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(value => value.trim());
  return sites.length <= 64 && new Set(sites).size === sites.length
    && sites.every(value => /^[0-9]{8}$/.test(value) && value.length === 8) && sites.includes(siteId);
}

//Metadata-only owner discovery remains reachable so a rolled-back rollout does
//not strand revocation. Neither this exception nor exact recovery grants period
//source access. SQL must still authenticate the actual actor for every call.
export function periodDelegationSafetyAccess(query: PeriodDelegationQuery, command: PeriodDelegationCommand | null) {
  return command === null && (query.mode === "recover" || query.access === "owner" && ["list", "detail"].includes(query.mode))
    || query.access === "owner" && command?.action === "revoke";
}

export async function executePeriodDelegation(input: {
  query: PeriodDelegationQuery; command: PeriodDelegationCommand | null; authUserId: string; allowWrite: boolean;
}, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parsePeriodDelegationQuery(input.query);
  const command = input.command === null ? null : parsePeriodDelegationBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (!input.allowWrite && !periodDelegationSafetyAccess(query, command)) throw new MerchantAttendanceError("attendance_period_delegation_disabled");
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const fingerprint = command ? createHash("sha256").update(periodDelegationFingerprintText(query, command), "utf8").digest("hex") : null;
  let response;
  try {
    response = await service.rpc("faolla_attendance_period_delegation_v1", {
      p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite,
    });
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(PERIOD_DELEGATION_ERRORS, code) ? code : "attendance_unavailable");
  }
  const result = parsePeriodDelegationResult(response.data, query, { authUserId }, command);
  if (command && (!result.receipt || !periodDelegationReceiptMatches(result.receipt, command, fingerprint!))) {
    throw new MerchantAttendanceError("attendance_period_delegation_invalid");
  }
  return result;
}
