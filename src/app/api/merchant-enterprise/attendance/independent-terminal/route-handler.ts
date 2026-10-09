import { requireMerchantEnterpriseEntitlement } from "@/lib/merchantEnterpriseAuth.server";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { TERMINAL_COOKIE, parseTerminalToken } from "@/lib/merchantAttendanceTerminal";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { parseIndependentTerminalBody, parseIndependentTerminalResult } from "@/lib/merchantAttendanceIndependent";
import { executeIndependentTerminal } from "@/lib/merchantAttendanceIndependent.server";
import { independentDeadline, independentReply, independentRequestOrigin, readIndependentBody } from "../independent/transport";

export const independentTerminalDependencies = { entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executeIndependentTerminal, timeoutMs: 12000, bodyTimeoutMs: 5000 };
export async function handleIndependentTerminal(request: Request, overrides: Partial<typeof independentTerminalDependencies> = {}) {
  const d = { ...independentTerminalDependencies, ...overrides };
  return independentDeadline(request, d, async (check, signal) => {
    if (request.method !== "POST") throw new MerchantAttendanceError("method_not_allowed");
    independentRequestOrigin(request); if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(TERMINAL_COOKIE + "="));
    if (cookies.length !== 1) throw new MerchantAttendanceError("attendance_terminal_denied");
    let credential: ReturnType<typeof parseTerminalToken>;
    try { credential = parseTerminalToken(cookies[0].slice(TERMINAL_COOKIE.length + 1)); } catch { throw new MerchantAttendanceError("attendance_terminal_denied"); }
    if (!d.allow(credential.siteId + ":" + credential.terminalId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const body = parseIndependentTerminalBody(await readIndependentBody(request, check, signal, d.bodyTimeoutMs)); check();
    if (body.siteId !== credential.siteId || body.terminalId !== credential.terminalId) throw new MerchantAttendanceError("attendance_terminal_denied");
    const allowNew = attendanceModuleEnabled(await d.entitlement(credential.siteId)); check();
    const result = await d.execute(body, { ...credential, allowNew }, undefined, signal); check();
    const safe = await parseIndependentTerminalResult(result, body); check(); return independentReply({ ok: true, data: safe });
  });
}
