import { NextResponse } from "next/server";
import { handleCheckoutEntry, type CheckoutEntryHttpDependencies } from "../../entry/route-handler";
import { isMemberCheckoutCartUiPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { parseCheckoutEntryQuery } from "@/lib/merchantCheckoutEntry";
/** Reuses the exact verified personal/source-binding discovery, not a second
 * membership authority. Whole request bounded, including a stalled body. */
export async function handleCartCheckoutEntry(request: Request, overrides: Partial<CheckoutEntryHttpDependencies> = {}) {
  const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
  const stopped = () => NextResponse.json({ error: "checkout_entry_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store", vary: "Cookie, Authorization", "referrer-policy": "no-referrer" } });
  let timer: ReturnType<typeof setTimeout> | undefined, stop: () => void = () => {};
  try {
    const bounded = new Promise<Response>(resolve => { stop = () => resolve(stopped()); signal.addEventListener("abort", stop, { once: true });
      timer = setTimeout(() => controller.abort(), 12_000); if (signal.aborted) stop(); });
    const owned = new Request(request, { signal });
    return await Promise.race([handleCheckoutEntry(owned, { ...overrides, enabled: siteId => {
      if (signal.aborted || !(overrides.enabled ?? isMemberCheckoutCartUiPilotEnabled)(siteId)) throw new Error("unavailable"); return true;
    },
      session: async input => { if (signal.aborted) throw new Error("unavailable"); const session = await (overrides.session ?? (await import("@/lib/personalAccountSession.server")).resolvePersonalAccountSessionFromRequest)(input);
        if (signal.aborted) throw new Error("unavailable"); return session; },
      read: async raw => { const query = parseCheckoutEntryQuery(raw); if (query.kind !== "order" || signal.aborted) throw new Error("unavailable");
        const value = await (overrides.read ?? (await import("@/lib/merchantCheckoutEntry.server")).readCheckoutEntryOffers)(query);
        if (signal.aborted) throw new Error("unavailable"); return value; } }, true), bounded]);
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener("abort", stop); controller.abort(); }
}
