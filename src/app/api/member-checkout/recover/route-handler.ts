import { NextResponse } from "next/server";
import { checkoutSubmissionRecoveryIdentity } from "@/lib/merchantCheckoutSubmissionPlan.server";
import { checkoutPrincipalKey } from "@/lib/merchantCheckoutQuote.server";
import { readMemberCheckoutResult } from "@/lib/merchantMemberCheckoutResult.server";
import { parseMemberCheckoutResult } from "@/lib/merchantMemberCheckoutResult";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

const defaults = { session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutPilotEnabled, read: readMemberCheckoutResult };
export type MemberCheckoutRecoverDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: {
  "cache-control": "private, no-store, max-age=0", pragma: "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization" } });

async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) throw new Error("checkout_invalid_request");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let count = 0, value = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.byteLength;
      if (count > 1024) { await reader.cancel(); throw new Error("checkout_invalid_request"); }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(value + decoder.decode()) as unknown;
  } catch { throw new Error("checkout_invalid_request"); } finally { reader.releaseLock(); }
}

/** Read-only recovery by the ORIGINAL nonce. No replanning, financial write,
 * membership/source eligibility check or automatic original-submit retry. */
export async function handleMemberCheckoutRecover(request: Request, overrides: Partial<MemberCheckoutRecoverDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  try {
    if ([...new URL(request.url).searchParams].length) throw new Error("checkout_invalid_request");
    const raw = await body(request);
    const authorize = async () => {
      const session = await deps.session(request), verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      return !session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))
        ? null : { accountId: session.accountId, userId: session.userId };
    };
    const principal = await authorize(); if (!principal) return json({ error: "checkout_unauthorized" }, 401);
    const identity = checkoutSubmissionRecoveryIdentity(raw, principal);
    if (!deps.enabled(identity.siteId)) return json({ error: "checkout_disabled" }, 503);
    const result = await deps.read(identity), current = await authorize();
    if (!current || checkoutPrincipalKey(current) !== identity.principalKey) return json({ error: "checkout_unauthorized" }, 401);
    // A concurrent commit can finish after this snapshot. Never label null as
    // failed/unpaid or return permission to replace the original nonce.
    return json(result ? { ok: true, state: "confirmed", result: parseMemberCheckoutResult(result, identity) }
      : { ok: true, state: "unconfirmed" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: ["checkout_invalid_request", "checkout_unauthorized"].includes(code) ? code : "checkout_unavailable" },
      code === "checkout_invalid_request" ? 400 : code === "checkout_unauthorized" ? 401 : 503);
  }
}
export async function POST(request: Request) { return handleMemberCheckoutRecover(request); }
