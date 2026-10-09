// 240: independent owner ledger. Authentication is never inferred from a scope.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { OPERATIONAL_RULE_LEDGER_BODY_LIMIT, OPERATIONAL_RULE_LEDGER_ERRORS, OPERATIONAL_RULE_LEDGER_MESSAGES,
  parseOperationalRuleLedgerJson, parseOperationalRuleLedgerBody, parseOperationalRuleLedgerHttpQuery, parseOperationalRuleLedgerResponse, type OperationalRuleLedgerErrorCode } from "@/lib/merchantAttendanceOperationalRuleLedger";
import { executeOperationalRuleLedger } from "@/lib/merchantAttendanceOperationalRuleLedger.server";
export function operationalRuleLedgerEnabled(siteId: string) { if (process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED !== "1") return false;
  const ids = process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_SITE_IDS ?? "", list = ids.split(","); if (ids.length > 899 || list.length > 100 || list.some(id => id.length !== 8 || !/^[0-9]{8}$/.test(id))) return false; return list.includes(siteId); }
export const operationalRuleLedgerDependencies = { enabled: operationalRuleLedgerEnabled, authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement, allow: createAttendanceSelfLimiter(), execute: executeOperationalRuleLedger, bodyTimeoutMs: 12000 };
async function readBody(request: Request, timeout: number) { if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_request");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > OPERATIONAL_RULE_LEDGER_BODY_LIMIT)) throw new MerchantAttendanceError("attendance_operational_rule_too_large");
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 12000) throw new MerchantAttendanceError("attendance_operational_rule_invalid"); const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  let stopped = false, reject!: (e: Error) => void; const until = performance.now() + timeout, interrupted = new Promise<never>((_, r) => { reject = r; });
  const stop = () => { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); }; const timer = setTimeout(stop, timeout); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => { let text = "", n = 0; const decoder = new TextDecoder("utf-8", { fatal: true }); while (true) { if (stopped || request.signal.aborted || performance.now() >= until) throw new MerchantAttendanceError("attendance_invalid_request"); const c = await reader.read();
    if (stopped || request.signal.aborted || performance.now() >= until) throw new MerchantAttendanceError("attendance_invalid_request"); if (c.done) break; n += c.value.byteLength; if (n > OPERATIONAL_RULE_LEDGER_BODY_LIMIT) throw new MerchantAttendanceError("attendance_operational_rule_too_large"); text += decoder.decode(c.value, { stream: true }); } return parseOperationalRuleLedgerJson(text + decoder.decode(), "request"); };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interrupted]); } catch (e) { if (e instanceof MerchantAttendanceError) throw e; throw new MerchantAttendanceError("attendance_invalid_request"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {}); reader.releaseLock(); } }
export async function handleOperationalRuleLedger(request: Request, overrides: Partial<typeof operationalRuleLedgerDependencies> = {}) {
  const deps = { ...operationalRuleLedgerDependencies, ...overrides }, reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
  const error = (code: OperationalRuleLedgerErrorCode) => reply({ ok: false, error: { code, message: OPERATIONAL_RULE_LEDGER_MESSAGES[code] } }, OPERATIONAL_RULE_LEDGER_ERRORS[code]);
  if (!["GET", "POST"].includes(request.method)) return error("attendance_invalid_request");
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin() || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) return error("attendance_access_denied");
  try { if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request"); let parsed, query;
    try { parsed = request.method === "POST" ? parseOperationalRuleLedgerBody(await readBody(request, deps.bodyTimeoutMs)) : null; query = parsed?.query ?? parseOperationalRuleLedgerHttpQuery(request.url); }
    catch (e) { if (e instanceof MerchantAttendanceError && e.code === "attendance_operational_rule_too_large") throw e; throw new MerchantAttendanceError("attendance_invalid_request"); }
    const auth = await deps.authenticate(request); if (!auth.authenticationMethods.length || auth.authenticationMethods.some(x => ["invite", "magiclink", "recovery"].includes(x))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(auth.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_operational_rule_invalid");
    const safeWithdraw = parsed?.command.action === "withdraw", safeRead = !parsed && ["detail", "history", "catalog", "recover"].includes(query.mode), enabled = deps.enabled(query.siteId); let allowWrite = false;
    if (enabled && !safeWithdraw && query.mode !== "recover") { if (safeRead || parsed) { try { allowWrite = attendanceModuleEnabled(await deps.entitlement(query.siteId)); } catch { /* SQL still verifies the current owner and original command; failed eligibility cannot grant fresh writes. */ } }
      else allowWrite = attendanceModuleEnabled(await deps.entitlement(query.siteId)); }
    if (!parsed && !safeRead && !allowWrite) throw new MerchantAttendanceError("attendance_operational_rule_disabled");
    const result = await deps.execute({ query, command: parsed?.command ?? null, authUserId, allowWrite }); const value = { ok: true, data: result };
    await parseOperationalRuleLedgerResponse(value, query, authUserId, parsed?.command ?? null); return reply(value, 200);
  } catch (e) { if (e instanceof MerchantEnterpriseAccessError) return error(e.status === 503 ? "attendance_operational_rule_invalid" : "attendance_access_denied");
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_operational_rule_invalid"; return error(Object.hasOwn(OPERATIONAL_RULE_LEDGER_ERRORS, code) ? code as OperationalRuleLedgerErrorCode : "attendance_operational_rule_invalid"); }
}
