import { CheckoutClientError, checkoutClientStorageKey, type CheckoutClientExclusive, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { createCartCheckoutController } from "./merchantCheckoutCartClient";
import { createIntentPointsCheckoutController, createIntentOnSiteCheckoutController } from "./merchantCheckoutSingleIntentClient";
import { assertCheckoutDraftLease, withCheckoutDraftLease, type CheckoutDraftReleaseCheck, type CheckoutDraftLease } from "./merchantCheckoutDraftLease";
import { parseUnusedReferenceReview, parseClosedUnusedReference, type UnusedReferenceReview } from "./merchantCheckoutUnusedReference";

export type BoundCheckoutRequest = (path: string, body: unknown, signal: AbortSignal, operationKey?: string) => Promise<unknown>;
export type UnusedReferenceView = { unusedReferenceReview?: UnusedReferenceReview | null; unusedReferenceBusy?: boolean; unusedReferenceError?: string };
export type UnusedReferenceActions = { reviewUnused(): Promise<void>; closeUnused(confirmed: boolean, verifyDraft?: CheckoutDraftReleaseCheck): Promise<void> };
type Options = Omit<Parameters<typeof createCartCheckoutController>[0], "request"> & { boundRequest?: BoundCheckoutRequest };
type CoreState = { phase: string; pending: boolean; error: string; original?: unknown; originalReview?: unknown };
type Core = { storageKey: string; getSnapshot(): CoreState; subscribe(fn: () => void): () => void; activate(): Promise<void>; deactivate(): void;
  recover(): Promise<void>; edit(): void; preview(...args: never[]): Promise<void>; submit(...args: never[]): Promise<void>; startAnother(...args: never[]): Promise<void> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
function need(v: unknown, code = "checkout_reference_unconfirmed"): asserts v { if (!v) throw new CheckoutClientError(code); }
export function checkoutReferenceBindingKey(siteId: string, accountId: string) { checkoutClientStorageKey(siteId, accountId); return `faolla-checkout-reference-owner-v1:${siteId}:${accountId}`; }
export function boundCheckoutRequest(accountId: string): BoundCheckoutRequest {
  need(/^\d{8}$/.test(accountId), "checkout_unauthorized");
  return async (path, body, signal, operationKey) => {
    need(/^\/api\/member-checkout\/(?:single\/(?:points|on-site)\/preview|intent\/(?:pending|review|acknowledge|retained-review|register-retained|unused-review|close-unused|bound-submit\/(?:points|on-site|cart))|cart\/(?:preview|recover|result|cancel))$/.test(path));
    need(operationKey === undefined || hash(operationKey));
    const r = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", accept: "application/json", "x-checkout-account-scope": accountId, ...(operationKey ? { "x-checkout-operation-scope": operationKey } : {}) }, body: JSON.stringify(body) });
    const value: unknown = await r.json().catch(() => null);
    if (!r.ok || !object(value) || value.ok !== true) throw new CheckoutClientError(object(value) && typeof value.error === "string" ? value.error : "checkout_unconfirmed", r.status);
    return value;
  };
}

/** Independent opt-in composition. Old storage/schema/controllers remain
 * unchanged. Only a FRESH submit under the common lock can write a sidecar,
 * before a separate operation-bound financial route can run. Old unknown v1
 * references never acquire a fabricated binding during recovery. */
function protect<C extends Core>(options: Options, kind: "points" | "on-site" | "cart", make: (options: Parameters<typeof createCartCheckoutController>[0]) => C) {
  const key = checkoutClientStorageKey(options.siteId, options.accountId), bindingKey = checkoutReferenceBindingKey(options.siteId, options.accountId);
  const request = options.boundRequest ?? boundCheckoutRequest(options.accountId);
  const exclusive: CheckoutClientExclusive = options.exclusive ?? (async (name, run) => {
    if (!navigator.locks) throw new CheckoutClientError("checkout_browser_unsupported");
    return navigator.locks.request(name, { ifAvailable: true }, async lock => { if (!lock) return false; await run(); return true; });
  });
  let active = false, epoch = 0, busy = false, abort = new AbortController(), context: { fresh: boolean; lease: CheckoutDraftLease } | null = null;
  let review: UnusedReferenceReview | null = null, error = "";
  const storage = () => { try { return options.storage ?? window.localStorage; } catch { throw new CheckoutClientError("checkout_storage_unavailable"); } };
  const reference = () => {
    const raw = storage().getItem(key); need(raw !== null && raw.length <= 256, "checkout_reference_unbound");
    let v: unknown; try { v = JSON.parse(raw); } catch { throw new CheckoutClientError("checkout_reference_unbound"); }
    need(object(v) && Object.keys(v).length === 2 && v.version === 1 && uuid(v.nonce) && raw === JSON.stringify({ version: 1, nonce: v.nonce }), "checkout_reference_unbound");
    return { raw, nonce: v.nonce };
  };
  const binding = () => {
    const ref = reference(), raw = storage().getItem(bindingKey); need(raw !== null && raw.length <= 1024, "checkout_reference_unbound");
    let v: unknown; try { v = JSON.parse(raw); } catch { throw new CheckoutClientError("checkout_reference_unbound"); }
    need(object(v) && Object.keys(v).length === 3 && v.version === 1 && v.reference === ref.raw && hash(v.operationKey)
      && raw === JSON.stringify({ version: 1, reference: ref.raw, operationKey: v.operationKey }), "checkout_reference_unbound");
    return { ...ref, bindingRaw: raw, operationKey: v.operationKey };
  };
  const live = (run: number) => active && epoch === run && !abort.signal.aborted;
  const guard = (run: number, expected: { raw: string; bindingRaw: string }) => { need(live(run)); need(storage().getItem(key) === expected.raw && storage().getItem(bindingKey) === expected.bindingRaw, "checkout_other_tab"); };
  let reviewedBinding: ReturnType<typeof binding> | null = null;
  const call = async (path: string, body: unknown, run: number, operationKey?: string, parent?: AbortSignal) => {
    need(live(run)); const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]); let stop: () => void = () => {};
    try { const value = await Promise.race([Promise.resolve().then(() => { need(live(run) && !signal.aborted); return request(path, body, signal, operationKey); }), new Promise<never>((_, reject) => {
      stop = () => reject(new CheckoutClientError("checkout_reference_unconfirmed")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); need(live(run) && !signal.aborted); return value; } finally { signal.removeEventListener("abort", stop); }
  };
  const held: CheckoutClientExclusive = (name, run) => exclusive(name, () => withCheckoutDraftLease(name, async lease => {
    need(name === key && !context); context = { fresh: storage().getItem(key) === null, lease };
    try { await run(); } finally { context = null; }
  }));
  const facade: CheckoutClientRequest = async (path, body, signal) => {
    const run = epoch; need(live(run) && !signal.aborted);
    if (path.endsWith("/submit")) {
      need(context?.fresh && object(body) && body.siteId === options.siteId); assertCheckoutDraftLease(context.lease, key); context.fresh = false;
      const ref = reference(), previous = storage().getItem(bindingKey); need(body.nonce === ref.nonce);
      const response = await call("/api/member-checkout/intent/unused-review", { siteId: options.siteId, nonce: ref.nonce }, run, undefined, signal);
      need(live(run) && !signal.aborted && storage().getItem(key) === ref.raw && storage().getItem(bindingKey) === previous, "checkout_other_tab");
      need(object(response) && response.ok === true && response.readOnly === true && object(response.review) && hash(response.review.operationKey));
      const checked = parseUnusedReferenceReview(response.review, { siteId: options.siteId, operationKey: response.review.operationKey }); need(checked.state === "unused");
      const bindingRaw = JSON.stringify({ version: 1, reference: ref.raw, operationKey: checked.operationKey });
      storage().setItem(bindingKey, bindingRaw); guard(run, { raw: ref.raw, bindingRaw }); need(!signal.aborted);
      return call(`/api/member-checkout/intent/bound-submit/${kind}`, body, run, checked.operationKey, signal);
    }
    const target = path === "/api/member-checkout/preview" ? "/api/member-checkout/single/points/preview"
      : path === "/api/member-checkout/on-site/preview" ? "/api/member-checkout/single/on-site/preview" : path;
    return call(target, body, run, undefined, signal);
  };
  const base = make({ ...options, intentEnabled: true, request: facade, exclusive: held });
  type State = ReturnType<C["getSnapshot"]> & UnusedReferenceView;
  let state: State = base.getSnapshot() as State; const listeners = new Set<() => void>(); let unsubscribe = () => {};
  const publish = () => { state = { ...base.getSnapshot(), unusedReferenceReview: review, unusedReferenceBusy: busy, unusedReferenceError: error, ...(busy ? { phase: "recovering" } : {}) } as State; listeners.forEach(fn => fn()); };
  const unknown = () => { const s = base.getSnapshot(); return s.pending && s.phase === "unconfirmed" && !s.original && !s.originalReview; };
  const fail = (e: unknown) => { review = null; reviewedBinding = null; error = e instanceof CheckoutClientError ? e.code : "checkout_reference_unconfirmed"; };
  const wrapped = { ...base,
    getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() { wrapped.deactivate(); active = true; const run = ++epoch; abort = new AbortController(); unsubscribe = base.subscribe(publish); await base.activate(); if (live(run)) publish(); },
    deactivate() { active = false; epoch++; abort.abort(); busy = false; review = null; reviewedBinding = null; error = ""; unsubscribe(); base.deactivate(); state = base.getSnapshot() as State; },
    async recover() { if (!active || busy) return; review = null; reviewedBinding = null; error = ""; await base.recover(); publish(); },
    edit() { if (!busy) base.edit(); },
    preview: async (...args: Parameters<C["preview"]>) => { if (!busy) { review = null; error = ""; await base.preview(...args); } },
    submit: async (...args: Parameters<C["submit"]>) => { if (!busy) { review = null; error = ""; await base.submit(...args); } },
    startAnother: async (...args: Parameters<C["startAnother"]>) => { if (!busy) await base.startAnother(...args); },
    async reviewUnused() {
      if (!active || busy || !unknown()) return; const run = epoch; busy = true; review = null; reviewedBinding = null; error = ""; publish();
      try { const ref = binding(); const r = await call("/api/member-checkout/intent/unused-review", { siteId: options.siteId, nonce: ref.nonce }, run, ref.operationKey); guard(run, ref);
        need(object(r) && r.ok === true && r.readOnly === true); review = parseUnusedReferenceReview(r.review, { siteId: options.siteId, operationKey: ref.operationKey }); reviewedBinding = ref;
        if (review.state === "original") { review = null; await base.recover(); guard(run, ref); }
      } catch (e) { if (live(run)) fail(e); } finally { if (live(run)) { busy = false; publish(); } }
    },
    async closeUnused(confirmed: boolean, verifyDraft?: CheckoutDraftReleaseCheck) {
      if (confirmed !== true || !active || busy || !unknown() || !review || !reviewedBinding || review.state === "original" || !review.reviewHash) return;
      const run = epoch, checked = review, ref = reviewedBinding; busy = true; error = ""; publish();
      try { guard(run, ref); need(ref.operationKey === checked.operationKey);
        const locked = await held(key, async () => {
          const lease = context!.lease; guard(run, ref); need(kind !== "cart" || verifyDraft, "checkout_draft_unconfirmed");
          const verify = () => { guard(run, ref); if (verifyDraft) { try { need(verifyDraft(lease) === undefined); } catch { throw new CheckoutClientError("checkout_draft_unconfirmed"); } } guard(run, ref); };
          verify(); const r = await call("/api/member-checkout/intent/close-unused", { siteId: options.siteId, nonce: ref.nonce, reviewHash: checked.reviewHash }, run, ref.operationKey); verify();
          need(object(r) && r.ok === true); parseClosedUnusedReference(r.closure, { siteId: options.siteId, operationKey: ref.operationKey, reviewHash: checked.reviewHash! }); verify();
          // Keep the sidecar and every host key. Never prepare/consume a cart.
          storage().removeItem(key); need(storage().getItem(key) === null && storage().getItem(bindingKey) === ref.bindingRaw, "checkout_storage_unavailable");
          base.deactivate(); review = null; await base.activate(); need(live(run));
        }); need(locked, "checkout_other_tab");
      } catch (e) { if (live(run)) fail(e); } finally { if (live(run)) { busy = false; publish(); } }
    },
  };
  return wrapped as Omit<C, "getSnapshot"> & { getSnapshot(): State } & UnusedReferenceActions;
}
export function createBoundPointsCheckoutController(options: Options) { return protect(options, "points", createIntentPointsCheckoutController); }
export function createBoundOnSiteCheckoutController(options: Options) { return protect(options, "on-site", createIntentOnSiteCheckoutController); }
export function createBoundCartCheckoutController(options: Options) { return protect(options, "cart", createCartCheckoutController); }
