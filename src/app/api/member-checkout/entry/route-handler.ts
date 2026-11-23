import { NextResponse } from "next/server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { checkoutPrincipalKey } from "@/lib/merchantCheckoutQuote.server";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { readCheckoutEntryOffers } from "@/lib/merchantCheckoutEntry.server";
import { parseCheckoutEntryAccess, parseCheckoutEntryQuery } from "@/lib/merchantCheckoutEntry";
import { isMemberCheckoutIntentPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
const defaults = { session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutPilotEnabled, read: readCheckoutEntryOffers, recoveryEnabled: isMemberCheckoutIntentPilotEnabled };
export type CheckoutEntryHttpDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie, Authorization", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", "x-content-type-options": "nosniff" } });
async function readBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) throw new Error("checkout_entry_invalid");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, value = "";
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); throw new Error("checkout_entry_invalid"); } value += decoder.decode(part.value, { stream: true }); }
    return JSON.parse(value + decoder.decode());
  } catch { throw new Error("checkout_entry_invalid"); } finally { reader.releaseLock(); }
}
export async function handleCheckoutEntry(request: Request, overrides: Partial<CheckoutEntryHttpDependencies> = {}, preserveEmptyAccount = false) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  let query;
  try {
    if (new URL(request.url).search) return json({ error: "checkout_entry_invalid" }, 400);
    query = parseCheckoutEntryQuery(await readBody(request));
  } catch { return json({ error: "checkout_entry_invalid" }, 400); }
  try {
    if (!deps.enabled(query.siteId)) return json({ ok: true, entry: null });
    const recoveryEnabled = deps.recoveryEnabled(query.siteId);
    const recoveryHint = recoveryEnabled ? { recovery: { siteId: query.siteId } } : {};
    const authorize = async () => { const session = await deps.session(request), stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      return session && !session.servicePaused && typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? session : null; };
    const initial = await authorize();
    if (!initial) return json({ ok: true, entry: null, ...(deps.enabled(query.siteId) && deps.recoveryEnabled(query.siteId) === recoveryEnabled ? recoveryHint : {}) });
    const principal = checkoutPrincipalKey(initial), offers = await deps.read(query), after = await authorize();
    if (!after || checkoutPrincipalKey(after) !== principal || !deps.enabled(query.siteId) || deps.recoveryEnabled(query.siteId) !== recoveryEnabled) return json({ error: "checkout_unauthorized" }, 401);
    const entry = parseCheckoutEntryAccess({ ok: true, entry: { siteId: query.siteId, accountId: initial.accountId, query, offers, ...(recoveryEnabled ? { recoveryEnabled: true } : {}) } }, query);
    return json({ ok: true, entry: entry && (entry.offers.length || preserveEmptyAccount || entry.recoveryEnabled) ? { ...entry, query } : null, ...recoveryHint });
  } catch { return json({ error: "checkout_entry_unavailable" }, 503); }
}
export function POST(request: Request) { return handleCheckoutEntry(request); }
