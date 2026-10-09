// 242: channel-specific transport adapters. No credential/GPS/token is part of
// the durable intent. Authentication and atomic business writes remain in SQL.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { terminalObject, terminalSecret } from "./merchantAttendanceTerminal";
import { terminalHash } from "./merchantAttendanceTerminal.server";
import { attendancePin, pinWorkerNo } from "./merchantAttendancePin";
import { attendancePinPepper, deriveAttendancePin, withAttendancePinKdf } from "./merchantAttendancePin.server";
import { parseAttendanceLocationClockCommand, type AttendancePositionFailure } from "./merchantAttendanceLocationClock";
import { evaluateAttendanceLocation, type AttendanceFence, type AttendancePosition } from "./merchantAttendanceLocation";
import { parseOnsiteClockBody } from "./merchantAttendanceOnsiteQr";
import { verifyOnsiteToken } from "./merchantAttendanceOnsiteQr.server";
import { SELF_SCHEDULE_ADOPTION_ERRORS } from "./merchantAttendanceSelfScheduleAdoption";
import { LOCATION_SCHEDULE_ERRORS } from "./merchantAttendanceLocationSchedule";
import { PIN_SCHEDULE_ERRORS } from "./merchantAttendancePinSchedule";
import { ONSITE_SCHEDULE_ERRORS } from "./merchantAttendanceOnsiteSchedule";
import { OPERATIONAL_PUNCH_ERRORS, parseOperationalPunchQuery, parseOperationalPunchCommand, parseOperationalPunchRpcResult,
  type OperationalPunchChannel, type OperationalPunchCommand, type OperationalPunchQuery, type OperationalPunchResult, type OperationalPunchParseInput } from "./merchantAttendanceOperationalPunch";

type Common = { siteId: string; query: OperationalPunchQuery; command: OperationalPunchCommand | null;
  moduleEnabled: boolean; allowOperationalStart: boolean; allowSchedule: boolean; bindRules: boolean };
export type OperationalPunchServiceInput = Common & (
  | { channel: "self"; authUserId: string }
  | { channel: "location"; authUserId: string; expectedWorkerId: string; position: AttendancePosition | null; positionFailure: AttendancePositionFailure | null }
  | { channel: "pin"; terminalId: string; secret: string; workerNo: string; pin: string }
  | { channel: "onsite"; authUserId: string; token: string | null }
);
export function operationalPunchErrorStatus(channel: OperationalPunchChannel): Readonly<Record<string, number>> {
  const original = channel === "self" ? SELF_SCHEDULE_ADOPTION_ERRORS : channel === "location" ? LOCATION_SCHEDULE_ERRORS
    : channel === "pin" ? PIN_SCHEDULE_ERRORS : ONSITE_SCHEDULE_ERRORS;
  return { ...original, ...OPERATIONAL_PUNCH_ERRORS };
}
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
const uuid = (v: unknown) => typeof v === "string" && v.length === 36 ? attendanceSelfUuid(v) : invalid();
const site = (v: unknown) => typeof v === "string" && v.length === 8 ? attendanceSelfSite(v) : invalid();
function parsedCommon(input: OperationalPunchServiceInput) {
  const siteId = site(input.siteId), query = parseOperationalPunchQuery(input.query);
  if (!["self", "location", "pin", "onsite"].includes(input.channel)
    || [input.moduleEnabled, input.allowOperationalStart, input.allowSchedule, input.bindRules].some(v => typeof v !== "boolean")) invalid();
  const command = input.command === null ? null : parseOperationalPunchCommand(input.command, input.channel, siteId);
  if (command && (query.mode !== "recover" || query.operationId !== command.clock.operationId)) invalid();
  return { siteId, query, command };
}
/** Unknown SQL errors/bodies are not evidence that a write failed. */
async function call(service: AttendanceSelfRpc | null, channel: OperationalPunchChannel, name: string, args: Record<string, unknown>) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc(name, args); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(operationalPunchErrorStatus(channel), code) ? code : "attendance_operational_punch_invalid"); }
  return response.data;
}
const gates = (input: Common) => ({ p_allow_new_sessions: input.moduleEnabled, p_allow_operational_start: input.allowOperationalStart,
  p_allow_schedule: input.allowSchedule, p_bind_rules: input.bindRules });

/** Same real begin → process-wide single KDF → channel finish as the old PIN
 * clock. Never call standalone finish and then a writer with a consumed lease. */
async function executePin(input: Extract<OperationalPunchServiceInput, { channel: "pin" }>, service: AttendanceSelfRpc | null): Promise<OperationalPunchResult> {
  const commonInput = parsedCommon(input), terminalId = uuid(input.terminalId), secret = terminalSecret(input.secret);
  const workerNo = pinWorkerNo(input.workerNo), pin = attendancePin(input.pin), key = attendancePinPepper();
  return withAttendancePinKdf(async () => {
    const common = { p_site: commonInput.siteId, p_terminal: terminalId, p_secret_hash: terminalHash(secret), p_no: workerNo, p_lease: randomUUID() };
    const raw = await call(service, "pin", "faolla_attendance_pin_begin_v1", { ...common, p_allow: true }) as Record<string, unknown>;
    if (raw?.limited === true) { terminalObject(raw, ["limited"]); throw new MerchantAttendanceError("attendance_pin_busy"); }
    let denied = false, salt: string, verifier: string, binding: { siteId: string; workerId: string; employeeId: string };
    if (raw?.denied === true) {
      terminalObject(raw, ["denied"]); denied = true; salt = randomBytes(16).toString("hex"); verifier = "0".repeat(64);
      binding = { siteId: commonInput.siteId, workerId: "dummy", employeeId: "dummy" };
    } else {
      const r = terminalObject(raw, ["workerId", "employeeId", "revision", "salt", "verifier"]);
      if (typeof r.salt !== "string" || r.salt.length !== 32 || !/^[0-9a-f]{32}$/.test(r.salt)
        || typeof r.verifier !== "string" || r.verifier.length !== 64 || !/^[0-9a-f]{64}$/.test(r.verifier)
        || !Number.isSafeInteger(r.revision) || Number(r.revision) < 1) throw new MerchantAttendanceError("attendance_operational_punch_invalid");
      salt = r.salt; verifier = r.verifier; binding = { siteId: commonInput.siteId, workerId: uuid(r.workerId), employeeId: uuid(r.employeeId) };
    }
    const candidate = await deriveAttendancePin(pin, salt, binding, key);
    const verified = !denied && timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(verifier, "hex"));
    if (denied) throw new MerchantAttendanceError("attendance_pin_denied");
    const rawResult = await call(service, "pin", "faolla_attendance_operational_punch_pin_v1", { ...common, p_verified: verified,
      p_query: commonInput.query, p_command: commonInput.command, ...gates(input) });
    // Business rejection is returned AFTER SQL consumes the PIN lease. Do not
    // interpret it as a successful result or invent a separate finish RPC.
    if (rawResult && typeof rawResult === "object" && Object.hasOwn(rawResult, "error")) {
      const r = captureBrowserExact(rawResult, ["error"]), code = typeof r.error === "string" ? r.error : "";
      throw new MerchantAttendanceError(Object.hasOwn(operationalPunchErrorStatus("pin"), code) ? code : "attendance_operational_punch_invalid");
    }
    return parseOperationalPunchRpcResult(rawResult, { ...commonInput, channel: "pin", write: commonInput.command !== null, authUserId: null,
      terminalId, workerNo, expectedWorkerId: binding.workerId, expectedEmployeeId: binding.employeeId });
  });
}

export async function executeOperationalPunch(input: OperationalPunchServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<OperationalPunchResult> {
  if (input.channel === "pin") return executePin(input, service);
  const parsed = parsedCommon(input), authUserId = uuid(input.authUserId);
  const common = { p_site: parsed.siteId, p_auth: authUserId, p_query: parsed.query, p_command: parsed.command, ...gates(input) };
  if (input.channel === "self") {
    const raw = await call(service, "self", "faolla_attendance_operational_punch_self_v1", common);
    return parseOperationalPunchRpcResult(raw, { ...parsed, channel: "self", authUserId, write: parsed.command !== null });
  }
  if (input.channel === "onsite") {
    let claims = null;
    if (parsed.command) {
      const body = parseOnsiteClockBody({ siteId: parsed.siteId, command: parsed.command.clock, token: input.token });
      claims = verifyOnsiteToken(body.token);
      if (claims.siteId !== parsed.siteId || claims.locationId !== body.command.locationId) throw new MerchantAttendanceError("attendance_qr_invalid");
    } else if (input.token !== null) invalid();
    const raw = await call(service, "onsite", "faolla_attendance_operational_punch_onsite_v1", { ...common, p_claims: claims });
    return parseOperationalPunchRpcResult(raw, { ...parsed, channel: "onsite", authUserId, write: parsed.command !== null });
  }
  const expectedWorkerId = uuid(input.expectedWorkerId);
  const clockCommand = parsed.command ? parseAttendanceLocationClockCommand({ siteId: parsed.siteId, ...parsed.command.clock,
    position: input.position, positionFailure: input.positionFailure }).command : null;
  if (clockCommand ? clockCommand.expectedWorkerId !== expectedWorkerId : input.position !== null || input.positionFailure !== null) invalid();
  const locationCommon = { ...common, p_expected_worker: expectedWorkerId, p_require_clock: parsed.command !== null };
  // All preparation and final writes use the NEW RPC; no activated old-endpoint
  // fallback. The private fence remains inside this function and raw parser.
  const raw = await call(service, "location", "faolla_attendance_operational_punch_location_v1", { ...locationCommon, p_command: null, p_assertion: null });
  const expected: OperationalPunchParseInput = { ...parsed, channel: "location", authUserId, expectedWorkerId, write: false };
  const before = await parseOperationalPunchRpcResult(raw, expected);
  if (!parsed.command || !clockCommand) return before;
  let assertion: Record<string, unknown> | null = null;
  if (!before.operation && before.channel === "location" && before.clock.policy && before.clock.noticeGate.ready && !clockCommand.safeFinish) {
    try {
      const envelope = captureBrowserExact(raw, ["result", "source"]);
      const clock = (envelope.result as { clock: Record<string, unknown> }).clock;
      if (typeof clock.internalPolicyFingerprint !== "string" || clock.internalPolicyFingerprint.length !== 32 || !/^[0-9a-f]{32}$/.test(clock.internalPolicyFingerprint)) throw Error("fingerprint");
      const fence = clock.internalFence as AttendanceFence; if (!fence || fence.maxAgeMs !== 60000) throw Error("fence");
      const range = evaluateAttendanceLocation(fence, clockCommand.position, clockCommand.position?.capturedAt ?? "2000-01-01T00:00:00.000Z");
      if (clockCommand.position && !["inside", "outside", "uncertain"].includes(range.reason)) throw Error("classification");
      assertion = { policyFingerprint: clock.internalPolicyFingerprint, algorithmVersion: 1, reason: clockCommand.position ? range.reason : clockCommand.positionFailure,
        capturedAt: clockCommand.position?.capturedAt ?? null, accuracyMeters: clockCommand.position?.accuracyMeters ?? null,
        distanceMeters: range.distanceMeters === null ? null : Math.round(range.distanceMeters) };
    } catch { throw new MerchantAttendanceError("attendance_operational_punch_invalid"); }
  }
  // Even an exact earlier receipt goes through the original-number new POST
  // verifier, binding the COMPLETE choice. SQL handles paused replay atomically.
  const saved = await call(service, "location", "faolla_attendance_operational_punch_location_v1", { ...locationCommon, p_assertion: assertion });
  return parseOperationalPunchRpcResult(saved, { ...expected, write: true });
}
