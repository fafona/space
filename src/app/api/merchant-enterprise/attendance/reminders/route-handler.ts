import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ATTENDANCE_REMINDER_REQUEST_BYTES } from "@/lib/merchantAttendanceReminders";
import { parseAttendanceReminderHttpBodyJson, parseAttendanceReminderHttpQuery, parseAttendanceReminderHttpEnvelope } from "@/lib/merchantAttendanceRemindersHttp";
import { ATTENDANCE_REMINDER_ERRORS, attendanceRemindersSiteEnabled, executeAttendanceReminders, executeAttendanceReminderRecovery } from "@/lib/merchantAttendanceReminders.server";

export const remindersDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  enabled: attendanceRemindersSiteEnabled, allow: createAttendanceSelfLimiter(), execute: executeAttendanceReminders, recover: executeAttendanceReminderRecovery,
  timeoutMs: 12000, bodyTimeoutMs: 5000 };
const ERROR_STATUS = Object.freeze({ ...ATTENDANCE_REMINDER_ERRORS, attendance_rate_limited: 429 });
function fail(code = "attendance_reminder_invalid"): never { throw new MerchantAttendanceError(code); }
async function readBody(request: Request, check: () => void, timeoutMs: number, setCancel: (cancel: (() => void) | null) => void) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_request");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > ATTENDANCE_REMINDER_REQUEST_BYTES)) fail("attendance_invalid_request");
  const reader = request.body?.getReader(); if (!reader) fail("attendance_invalid_request");
  let stopped = false, reject!: (error: Error) => void;
  const interrupted = new Promise<never>((_, r) => { reject = r; }), cancel = () => {
    if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); }
  };
  const timer = setTimeout(cancel, timeoutMs); setCancel(cancel);
  const consume = async () => {
    let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    while (true) {
      check(); if (stopped) fail("attendance_invalid_request"); const part = await reader.read(); check(); if (stopped) fail("attendance_invalid_request"); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > ATTENDANCE_REMINDER_REQUEST_BYTES) fail("attendance_invalid_request"); text += decoder.decode(part.value, { stream: true });
    }
    return parseAttendanceReminderHttpBodyJson(text + decoder.decode());
  };
  const consuming = consume();
  const release = () => { try { reader.releaseLock(); } catch { /* Never replace the original timeout/UTF8/size error. */ } };
  try { return await Promise.race([consuming, interrupted]); }
  catch (error) { if (error instanceof MerchantAttendanceError) throw error; return fail("attendance_invalid_request"); }
  finally {
    stopped = true; clearTimeout(timer); setCancel(null); void reader.cancel().catch(() => {}); release();
    // A still-pending reader may reject on cancellation/release. Observe both
    // branches and release again without delaying HTTP or masking its error.
    void consuming.then(release, release);
  }
}
export async function handleAttendanceReminders(request: Request, overrides: Partial<typeof remindersDependencies> = {}) {
  const deps = { ...remindersDependencies, ...overrides };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token",
  } });
  let stopped = false, reject!: (error: Error) => void, cancelBody: (() => void) | null = null; const work = new AbortController();
  const interrupted = new Promise<never>((_, r) => { reject = r; }), deadline = performance.now() + deps.timeoutMs;
  const stop = () => { if (!stopped) { stopped = true; work.abort(); reject(new MerchantAttendanceError("attendance_reminder_invalid")); cancelBody?.(); } };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, deps.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) { work.abort(); fail(); } };
  const run = async () => {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs < 1 || deps.timeoutMs > 12000 || !Number.isInteger(deps.bodyTimeoutMs) || deps.bodyTimeoutMs < 1 || deps.bodyTimeoutMs > 5000) fail();
    if (request.method !== "GET" && request.method !== "POST") fail("attendance_invalid_request");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    check(); const auth = await deps.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth); const actor = auth.user.id;
    if (typeof actor !== "string" || actor.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) fail("attendance_access_denied");
    if (!deps.allow(actor)) fail("attendance_rate_limited");
    if (request.method === "GET") {
      const input = parseAttendanceReminderHttpQuery(request.url); check();
      // Reads, especially original-id recovery, never evaluate new-write gates
      // or entitlements. SQL rechecks current recipients for normal reads.
      let data;
      if (input.query.mode === "recover") {
        const expectedCommand = input.expectedCommand; if (expectedCommand === null) fail("attendance_invalid_request");
        data = await deps.recover({ query: input.query, expectedCommand, authUserId: actor }, undefined, work.signal);
      } else data = await deps.execute({ query: input.query, command: null, authUserId: actor, allowWrite: false }, undefined, work.signal);
      check(); const envelope = await parseAttendanceReminderHttpEnvelope({ ok: true, data }, input.query, actor, input.expectedCommand); check(); return reply(envelope, 200);
    }
    if (new URL(request.url).search || request.url.includes("#")) fail("attendance_invalid_request");
    const body = await readBody(request, check, deps.bodyTimeoutMs, value => { cancelBody = value; }); check(); let allowWrite = false;
    if (deps.enabled(body.query.siteId)) {
      try { allowWrite = attendanceModuleEnabled(await deps.entitlement(body.query.siteId)); } catch { /* Original saved receipt remains recoverable. */ } check();
    }
    const data = await deps.execute({ query: body.query, command: body.command, authUserId: actor, allowWrite }, undefined, work.signal); check();
    const envelope = await parseAttendanceReminderHttpEnvelope({ ok: true, data }, body.query, actor, body.command); check(); return reply(envelope, 200);
  };
  try { return await Promise.race([run(), interrupted]); }
  catch (error) {
    const code = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? "attendance_reminder_invalid" : "attendance_access_denied"
      : error instanceof MerchantAttendanceError ? error.code : "attendance_reminder_invalid";
    const known = Object.hasOwn(ERROR_STATUS, code) ? code as keyof typeof ERROR_STATUS : "attendance_reminder_invalid";
    return reply({ ok: false, error: { code: known, message: known === "attendance_access_denied" ? "当前账号无权查看或处理此提醒。" : "暂时无法核实提醒结果，请保留原操作编号再核对。" } }, ERROR_STATUS[known]);
  } finally { stopped = true; work.abort(); clearTimeout(timer); request.signal.removeEventListener("abort", stop); }
}
