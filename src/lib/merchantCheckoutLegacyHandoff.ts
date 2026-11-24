import type { AccountCartScope } from "./merchantCheckoutAccountDraft";
import { checkoutClientStorageKey, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { assertCheckoutDraftLease, type CheckoutDraftLease } from "./merchantCheckoutDraftLease";
import { parseLegacyOrderReview, parseLegacyReviewRequest, type LegacyOrderReview, type LegacyReviewRequest } from "./merchantCheckoutLegacyReview";
import { legacyReviewStorageKey } from "./merchantCheckoutLegacyReviewClient";
const endpoint = "/api/member-checkout/legacy/handoff-review";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function legacyHandoffStorageKey(s: AccountCartScope) {
  legacyReviewStorageKey(s.siteId, s.blockId); if (!/^\d{8}$/.test(s.accountId)) throw new Error("checkout_unauthorized");
  return `merchant-space:product-cart:legacy-isolation:v1:${s.siteId}:${s.blockId}:${s.accountId}`;
}
export function legacyHandoffTransport(accountId: string): CheckoutClientRequest {
  if (!/^\d{8}$/.test(accountId)) throw new Error("checkout_unauthorized");
  return async (path, body, signal) => {
    if (path !== endpoint) throw new Error("checkout_legacy_handoff_unavailable");
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error("checkout_legacy_handoff_unavailable"); return response.json();
  };
}
/** A local explicit decision to use an ALREADY SEPARATE account cart. Never
 * ownership/payment proof, a server token, import, old-cart retirement, or a
 * nonce release. Only a scoped marker is written, under the account's lock. */
export function createLegacyCartHandoff(scope: AccountCartScope, ports: {
  storage?: Pick<Storage, "getItem" | "setItem">; request?: CheckoutClientRequest;
} = {}) {
  const s = { ...scope }, key = legacyHandoffStorageKey(s), request = ports.request ?? legacyHandoffTransport(s.accountId);
  const storage = () => ports.storage ?? window.localStorage;
  let active = false, epoch = 0, abort = new AbortController(), cached: { legacy: string; marker: string } | null = null;
  const valid = (run: number) => { if (!active || run !== epoch || abort.signal.aborted) throw new Error("checkout_draft_inactive"); };
  const coordinates = (raw: string): LegacyReviewRequest => {
    if (new TextEncoder().encode(raw).length > 1_048_576) throw new Error("checkout_legacy_handoff_unavailable");
    const value: unknown = JSON.parse(raw); if (!object(value)) throw new Error("checkout_legacy_handoff_unavailable");
    return parseLegacyReviewRequest({ siteId: s.siteId, blockId: s.blockId, requestId: value.clientRequestId });
  };
  const digest = async (raw: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))).map(n => n.toString(16).padStart(2, "0")).join("");
  const parseMarker = (raw: string) => {
    if (new TextEncoder().encode(raw).length > 4096) throw new Error("checkout_legacy_handoff_unavailable");
    const v: unknown = JSON.parse(raw);
    if (!object(v) || !exact(v, ["version", "scope", "legacyHash", "review", "confirmedAt"]) || v.version !== 1 || !object(v.scope)
      || !exact(v.scope, ["siteId", "blockId", "accountId"]) || v.scope.siteId !== s.siteId || v.scope.blockId !== s.blockId || v.scope.accountId !== s.accountId
      || typeof v.legacyHash !== "string" || !/^[a-f0-9]{64}$/.test(v.legacyHash) || typeof v.confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.confirmedAt)
      || !Number.isFinite(Date.parse(v.confirmedAt)) || new Date(v.confirmedAt).toISOString() !== v.confirmedAt) throw new Error("checkout_legacy_handoff_unavailable");
    if (!object(v.review)) throw new Error("checkout_legacy_handoff_unavailable");
    const q = parseLegacyReviewRequest({ siteId: s.siteId, blockId: s.blockId, requestId: v.review.requestId });
    const review = parseLegacyOrderReview(v.review, q); if (!review.order) throw new Error("checkout_legacy_handoff_unavailable"); return { legacyHash: v.legacyHash, review };
  };
  const recheck = async (q: LegacyReviewRequest, run: number, guard: () => void, deadline: number) => {
    valid(run); guard(); const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
    const current = () => { valid(run); guard(); if (signal.aborted || Date.now() >= deadline) throw new Error("checkout_legacy_handoff_unavailable"); };
    let stop: () => void = () => {};
    try {
      const response = await Promise.race([Promise.resolve().then(() => { current(); return request(endpoint, q, signal); }), new Promise<never>((_, reject) => { stop = () => reject(new Error("checkout_legacy_handoff_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); })]);
      current(); if (!object(response) || response.ok !== true || response.readOnly !== true) throw new Error("checkout_legacy_handoff_unavailable");
      const review = parseLegacyOrderReview(response.review, q); if (!review.order) throw new Error("checkout_legacy_handoff_unavailable"); return review;
    } finally { signal.removeEventListener("abort", stop); }
  };
  return {
    storageKey: key,
    activate() { abort.abort(); abort = new AbortController(); active = true; epoch++; cached = null; },
    deactivate() { active = false; epoch++; abort.abort(); cached = null; },
    matches(raw: string | null) { return active && cached !== null && raw === cached.legacy && storage().getItem(key) === cached.marker; },
    async prepare(raw: string | null, guard: () => void, lease: CheckoutDraftLease) {
      const run = epoch, deadline = Date.now() + 12_000; const check = () => { valid(run); assertCheckoutDraftLease(lease, checkoutClientStorageKey(s.siteId, s.accountId)); guard(); if (Date.now() >= deadline) throw new Error("checkout_legacy_handoff_unavailable"); };
      check(); cached = null; const marker = storage().getItem(key); if (raw === null || marker === null) return;
      const q = coordinates(raw), saved = parseMarker(marker), hash = await digest(raw); check();
      if (hash !== saved.legacyHash || saved.review.requestId !== q.requestId) return;
      const live = await recheck(q, run, check, deadline);
      if (storage().getItem(key) !== marker) throw new Error("checkout_cart_changed");
      if (JSON.stringify(live) !== JSON.stringify(saved.review)) return;
      check(); cached = { legacy: raw, marker };
    },
    async confirm(raw: string, expected: LegacyOrderReview, confirmed: boolean, guard: () => void, lease: CheckoutDraftLease) {
      const run = epoch, deadline = Date.now() + 12_000; const check = () => { valid(run); assertCheckoutDraftLease(lease, checkoutClientStorageKey(s.siteId, s.accountId)); guard(); if (Date.now() >= deadline) throw new Error("checkout_legacy_handoff_unavailable"); };
      check(); if (confirmed !== true) throw new Error("checkout_legacy_confirmation_required");
      const q = coordinates(raw), previous = storage().getItem(key), reviewed = parseLegacyOrderReview(expected, q);
      if (!reviewed.order) throw new Error("checkout_legacy_handoff_unavailable"); if (previous !== null) parseMarker(previous);
      const hash = await digest(raw); check(); const live = await recheck(q, run, check, deadline);
      if (JSON.stringify(live) !== JSON.stringify(reviewed) || storage().getItem(key) !== previous) throw new Error("checkout_cart_changed");
      const marker = JSON.stringify({ version: 1, scope: s, legacyHash: hash, review: live, confirmedAt: new Date().toISOString() });
      check(); storage().setItem(key, marker); check();
      if (storage().getItem(key) !== marker) throw new Error("checkout_storage_unavailable"); cached = { legacy: raw, marker };
    },
  };
}
export type LegacyCartHandoff = ReturnType<typeof createLegacyCartHandoff>;
