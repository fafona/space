import { NextResponse } from "next/server";
import { handleCheckoutEntry, type CheckoutEntryHttpDependencies } from "../../entry/route-handler";
import { isMemberCheckoutCartUiPilotEnabled, isMemberCheckoutIntentPilotEnabled, isMemberCheckoutAccountDraftPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { parseCheckoutEntryQuery } from "@/lib/merchantCheckoutEntry";
import { isMemberCheckoutLegacyReviewEnabled } from "@/lib/merchantCheckoutLegacyReviewPilot.server";
import { isMemberCheckoutLegacyHandoffEnabled } from "@/lib/merchantCheckoutLegacyHandoffPilot.server";
/** Reuses the exact verified personal/source-binding discovery, not a second
 * membership authority. Whole request bounded, including a stalled body. */
export async function handleCartCheckoutEntry(request: Request, overrides: Partial<CheckoutEntryHttpDependencies> & { intentEnabled?: (siteId: string) => boolean; draftEnabled?: (siteId: string) => boolean; legacyReviewEnabled?: (siteId: string) => boolean; legacyHandoffEnabled?: (siteId: string) => boolean } = {}) {
  const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
  const stopped = () => NextResponse.json({ error: "checkout_entry_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store", vary: "Cookie, Authorization", "referrer-policy": "no-referrer" } });
  let timer: ReturnType<typeof setTimeout> | undefined, stop: () => void = () => {}, intent: boolean | undefined, draft: boolean | undefined, legacy: boolean | undefined, handoff: boolean | undefined;
  try {
    const bounded = new Promise<Response>(resolve => { stop = () => resolve(stopped()); signal.addEventListener("abort", stop, { once: true });
      timer = setTimeout(() => controller.abort(), 12_000); if (signal.aborted) stop(); });
    const owned = new Request(request, { signal });
    const response = await Promise.race([handleCheckoutEntry(owned, { ...overrides, enabled: siteId => {
      if (signal.aborted || !(overrides.enabled ?? isMemberCheckoutCartUiPilotEnabled)(siteId)) throw new Error("unavailable");
      const current = (overrides.intentEnabled ?? isMemberCheckoutIntentPilotEnabled)(siteId);
      const owned = (overrides.draftEnabled ?? isMemberCheckoutAccountDraftPilotEnabled)(siteId);
      const review = (overrides.legacyReviewEnabled ?? isMemberCheckoutLegacyReviewEnabled)(siteId);
      const isolate = (overrides.legacyHandoffEnabled ?? isMemberCheckoutLegacyHandoffEnabled)(siteId);
      if (intent !== undefined && intent !== current || draft !== undefined && draft !== owned || legacy !== undefined && legacy !== review || handoff !== undefined && handoff !== isolate || owned && !current) throw new Error("unavailable"); intent = current; draft = owned; legacy = review; handoff = isolate; return true;
    },
      session: async input => { if (signal.aborted) throw new Error("unavailable"); const session = await (overrides.session ?? (await import("@/lib/personalAccountSession.server")).resolvePersonalAccountSessionFromRequest)(input);
        if (signal.aborted) throw new Error("unavailable"); return session; },
      read: async raw => { const query = parseCheckoutEntryQuery(raw); if (query.kind !== "order" || signal.aborted) throw new Error("unavailable");
        const value = await (overrides.read ?? (await import("@/lib/merchantCheckoutEntry.server")).readCheckoutEntryOffers)(query);
        if (signal.aborted) throw new Error("unavailable"); return value; } }, true), bounded]);
    if (!intent || !response.ok) return response;
    const value = await response.json(); if (signal.aborted) return stopped();
    return NextResponse.json({ ...value, ...(value.entry ? { intent: true, ...(draft ? { ownedDraft: true, ...(legacy ? { legacyReview: true, ...(handoff ? { legacyHandoff: true } : {}) } : {}) } : {}) } : {}) }, { status: response.status, headers: response.headers });
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener("abort", stop); controller.abort(); }
}
