import { NextResponse } from "next/server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfSite, attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { captureBrowserExact } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import { parseTerminalToken, TERMINAL_COOKIE } from "@/lib/merchantAttendanceTerminal";
import { attendancePin, pinWorkerNo } from "@/lib/merchantAttendancePin";
import { parseAttendanceLocationClockCommand } from "@/lib/merchantAttendanceLocationClock";
import { parseOnsiteClockBody } from "@/lib/merchantAttendanceOnsiteQr";
import { operationalPunchEnabled } from "@/lib/merchantAttendanceOperationalPunchActivation.server";
import { executeOperationalPunch, operationalPunchErrorStatus, type OperationalPunchServiceInput } from "@/lib/merchantAttendanceOperationalPunch.server";
import { parseOperationalPunchQuery, parseOperationalPunchCommand, parseOperationalPunchJson, type OperationalPunchChannel } from "@/lib/merchantAttendanceOperationalPunch";
import { attendanceSelfScheduleAdoptionEnabled, attendanceSelfScheduleAdoptionBindRules } from "@/lib/merchantAttendanceSelfScheduleAdoption.server";
import { attendanceLocationScheduleEnabled, attendanceLocationScheduleBindRules } from "@/lib/merchantAttendanceLocationSchedule.server";
import { attendancePinScheduleEnabled, attendancePinScheduleBindRules } from "@/lib/merchantAttendancePinSchedule.server";
import { attendanceOnsiteScheduleEnabled, attendanceOnsiteScheduleBindRules } from "@/lib/merchantAttendanceOnsiteSchedule.server";
import { attendanceSelfDependencies } from "../self/route-handler";
import { attendanceLocationClockDependencies } from "../location-clock/route-handler";
import { pinClockDependencies } from "../terminal-clock/route-handler";
import { onsiteClockDependencies } from "../onsite-clock/route-handler";

const BODY_LIMIT = 4096, RESPONSE_LIMIT = 262144;
const AUTH_ERRORS: Readonly<Record<string, number>> = { unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, employee_password_authentication_required: 403, enterprise_management_disabled: 403 };
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
const uuid = (v: unknown) => typeof v === "string" && v.length === 36 ? attendanceSelfUuid(v) : invalid();
const site = (v: unknown) => typeof v === "string" && v.length === 8 ? attendanceSelfSite(v) : invalid();
function exact(v: unknown, keys: readonly string[]) { try { return captureBrowserExact(v, keys); } catch { return invalid(); } }

// Four new routes share only transport plumbing, never a fabricated common
// credential. Existing per-channel rate buckets are shared with old endpoints.
function dependencies(channel: OperationalPunchChannel) {
  const original = channel === "self" ? attendanceSelfDependencies : channel === "location" ? attendanceLocationClockDependencies
    : channel === "pin" ? pinClockDependencies : onsiteClockDependencies;
  return { baseEnabled: original.enabled, featureEnabled: operationalPunchEnabled,
    authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement, allow: original.allow,
    scheduleEnabled: channel === "self" ? attendanceSelfScheduleAdoptionEnabled : channel === "location" ? attendanceLocationScheduleEnabled
      : channel === "pin" ? attendancePinScheduleEnabled : attendanceOnsiteScheduleEnabled,
    bindRules: channel === "self" ? attendanceSelfScheduleAdoptionBindRules : channel === "location" ? attendanceLocationScheduleBindRules
      : channel === "pin" ? attendancePinScheduleBindRules : attendanceOnsiteScheduleBindRules,
    execute: executeOperationalPunch, bodyTimeoutMs: 5000 };
}
export type OperationalPunchRouteDependencies = ReturnType<typeof dependencies>;

async function readBody(request: Request, timeoutMs: number): Promise<unknown> {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!length || /[^0-9]/.test(length) || Number(length) > BODY_LIMIT)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader(); if (!reader) invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true }), until = performance.now() + timeoutMs;
  let bytes = 0, text = "", stopped = false, rejectStop!: (error: MerchantAttendanceError) => void;
  const interruption = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = () => { if (stopped) return; stopped = true; rejectStop(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, timeoutMs); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    while (true) {
      if (stopped || request.signal.aborted || performance.now() >= until) invalid();
      const chunk = await reader.read(); if (stopped || request.signal.aborted || performance.now() >= until) invalid();
      if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > BODY_LIMIT) throw new MerchantAttendanceError("attendance_body_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return parseOperationalPunchJson(text + decoder.decode(), "request");
  };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interruption]); }
  catch (error) { void reader.cancel().catch(() => {}); if (error instanceof MerchantAttendanceError) throw error; return invalid(); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}
function readQuery(request: Request, channel: OperationalPunchChannel) {
  const raw = request.url;
  if (raw.length > BODY_LIMIT || new TextEncoder().encode(raw).byteLength > BODY_LIMIT || /[\s\\#\u0000-\u001f\u007f-\u009f]/.test(raw)) invalid();
  let url: URL; try { url = new URL(raw); if (/[\u0000-\u001f\u007f-\u009f]/.test(decodeURIComponent(raw))) invalid(); } catch { return invalid(); }
  if (url.username || url.password || url.hash || url.pathname !== `/api/merchant-enterprise/attendance/operational-punch-${channel}`) invalid();
  const values: Record<string, string> = {}, names = channel === "location" ? ["siteId", "mode", "operationId", "expectedWorkerId"] : ["siteId", "mode", "operationId"];
  for (const [key, value] of url.searchParams) { if (!names.includes(key) || Object.hasOwn(values, key) || !value) invalid(); values[key] = value; }
  const query = parseOperationalPunchQuery(Object.fromEntries(Object.entries(values).filter(([key]) => !["siteId", "expectedWorkerId"].includes(key))));
  return { siteId: site(values.siteId), query, expectedWorkerId: channel === "location" ? uuid(values.expectedWorkerId) : null };
}
function parseBody(raw: unknown, channel: OperationalPunchChannel) {
  const b = exact(raw, channel === "pin" ? ["workerNo", "pin", "query", "command"] : ["siteId", "query", "command", ...(channel === "location" ? ["position", "positionFailure"] : channel === "onsite" ? ["token"] : [])]);
  return b;
}

export function makeOperationalPunchHandler(channel: OperationalPunchChannel) {
  const defaults = dependencies(channel);
  return { dependencies: defaults, handle: async (request: Request, overrides: Partial<OperationalPunchRouteDependencies> = {}) => {
    const d = { ...defaults, ...overrides }, methods = channel === "pin" ? ["POST"] : ["GET", "POST"];
    const reply = (body: unknown, status: number) => NextResponse.json(body && typeof body === "object" && "ok" in body && body.ok === false && "error" in body && typeof body.error === "string"
      ? { ok: false, error: { code: body.error, message: body.error } } : body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token",
      ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: methods.join(", ") } : {}) } });
    if (!d.baseEnabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
    if (!methods.includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
    const origin = request.headers.get("origin");
    if (!isCanonicalPortalRequest(request) || origin !== null && origin !== resolveCanonicalPortalOrigin()
      || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
    try {
      if (request.method === "POST" && (new URL(request.url).search || new URL(request.url).pathname !== `/api/merchant-enterprise/attendance/operational-punch-${channel}`)) invalid();
      let transport: OperationalPunchServiceInput;
      const placeholder = { moduleEnabled: false, allowOperationalStart: false, allowSchedule: false, bindRules: false };
      if (channel === "pin") {
        const cookies = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(TERMINAL_COOKIE + "="));
        if (cookies.length !== 1) throw new MerchantAttendanceError("attendance_terminal_denied");
        let credential; try { credential = parseTerminalToken(cookies[0].slice(TERMINAL_COOKIE.length + 1)); } catch { throw new MerchantAttendanceError("attendance_terminal_denied"); }
        if (!d.allow(`${credential.siteId}:${credential.terminalId}`)) throw new MerchantAttendanceError("attendance_rate_limited");
        const b = parseBody(await readBody(request, d.bodyTimeoutMs), channel), query = parseOperationalPunchQuery(b.query);
        const command = b.command === null ? null : parseOperationalPunchCommand(b.command, channel, credential.siteId);
        transport = { ...placeholder, channel, ...credential, query, command, workerNo: pinWorkerNo(b.workerNo), pin: attendancePin(b.pin) };
      } else {
        const context = await d.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context); const authUserId = uuid(context.user.id);
        if (!d.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
        if (request.method === "GET") {
          const q = readQuery(request, channel), common = { ...placeholder, siteId: q.siteId, query: q.query, command: null, authUserId };
          transport = channel === "location" ? { ...common, channel, expectedWorkerId: q.expectedWorkerId!, position: null, positionFailure: null }
            : channel === "onsite" ? { ...common, channel, token: null } : { ...common, channel };
        } else {
          const b = parseBody(await readBody(request, d.bodyTimeoutMs), channel), siteId = site(b.siteId), query = parseOperationalPunchQuery(b.query);
          if (b.command === null) invalid(); const command = parseOperationalPunchCommand(b.command, channel, siteId), common = { ...placeholder, siteId, query, command, authUserId };
          if (channel === "location") { const clock = parseAttendanceLocationClockCommand({ siteId, ...command.clock, position: b.position, positionFailure: b.positionFailure }).command;
            transport = { ...common, channel, expectedWorkerId: clock.expectedWorkerId, position: clock.position, positionFailure: clock.positionFailure }; }
          else if (channel === "onsite") { const body = parseOnsiteClockBody({ siteId, command: command.clock, token: b.token }); transport = { ...common, channel, token: body.token }; }
          else transport = { ...common, channel };
        }
      }
      if (transport.command && (transport.query.mode !== "recover" || transport.query.operationId !== transport.command.clock.operationId)) invalid();
      transport.moduleEnabled = attendanceModuleEnabled(await d.entitlement(transport.siteId));
      transport.allowOperationalStart = d.featureEnabled(transport.siteId);
      transport.allowSchedule = transport.moduleEnabled && d.scheduleEnabled(transport.siteId); transport.bindRules = d.bindRules(transport.siteId);
      // The new flag never removes recovery or fixed-session break/finish. SQL
      // distinguishes these from fresh starts under the activation/config locks.
      if (request.signal.aborted) invalid(); const result = await d.execute(transport);
      const body = { ok: true, data: result }; if (Buffer.byteLength(JSON.stringify(body), "utf8") > RESPONSE_LIMIT) throw new MerchantAttendanceError("attendance_operational_punch_too_large");
      return reply(body, 200);
    } catch (error) {
      if (error instanceof MerchantEnterpriseAccessError) {
        if (channel === "pin") return reply({ ok: false, error: "attendance_terminal_denied" }, 403);
        if (AUTH_ERRORS[error.code] === error.status) return reply({ ok: false, error: error.code }, error.status);
        return reply({ ok: false, error: "attendance_unavailable" }, 503);
      }
      const codes = operationalPunchErrorStatus(channel), code = error instanceof MerchantAttendanceError && Object.hasOwn(codes, error.code) ? error.code : "attendance_operational_punch_invalid";
      return reply({ ok: false, error: code }, codes[code] ?? 503);
    }
  } };
}
const self = makeOperationalPunchHandler("self");
export const operationalPunchSelfDependencies = self.dependencies;
export const handleOperationalPunchSelf = self.handle;
