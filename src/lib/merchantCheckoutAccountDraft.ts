import { checkoutClientStorageKey, type CheckoutClientExclusive } from "./merchantCheckoutClient";
import { assertCheckoutDraftLease, withCheckoutDraftLease, type CheckoutDraftLease } from "./merchantCheckoutDraftLease";
import type { ProductItem } from "./productBlock";
import type { MerchantOrderCustomerInput } from "./merchantOrders";

export type AccountCartScope = { siteId: string; blockId: string; accountId: string };
export type AccountCartItem = { productId: string; quantity: number; checked: boolean; product: ProductItem; unitPrice: number; unitPriceText: string };
export type AccountCartData = { items: AccountCartItem[]; customer: MerchantOrderCustomerInput; clientRequestId: string };
export type AccountCartSnapshot = { ready: boolean; busy: boolean; error: string; raw: string | null; revision: number; data: AccountCartData; legacyPresent: boolean; legacyPending: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
const emptyData = (): AccountCartData => ({ items: [], customer: { name: "", phone: "", email: "", note: "" }, clientRequestId: "" });
const blank = (): AccountCartSnapshot => ({ ready: false, busy: false, error: "", raw: null, revision: 0, data: emptyData(), legacyPresent: false, legacyPending: false });
function scopeValid(s: AccountCartScope) {
  if (!/^\d{8}$/.test(s.siteId) || !/^\d{8}$/.test(s.accountId) || !/^[A-Za-z0-9:_-]{1,160}$/.test(s.blockId)) throw new Error("checkout_draft_invalid");
}
export function accountCartStorageKey(s: AccountCartScope) { scopeValid(s); return `merchant-space:product-cart:v2:${s.siteId}:${s.blockId}:${s.accountId}`; }
export function parseAccountCartData(raw: unknown): AccountCartData {
  if (!object(raw) || !exact(raw, ["items", "customer", "clientRequestId"]) || raw.clientRequestId !== "" || !Array.isArray(raw.items) || raw.items.length > 100
    || !object(raw.customer) || !exact(raw.customer, ["name", "phone", "email", "note"])) throw new Error("checkout_draft_invalid");
  const customer = raw.customer;
  if (!["name", "phone", "email", "note"].every(k => text(customer[k], k === "note" ? 2000 : 500))) throw new Error("checkout_draft_invalid");
  const ids = new Set<string>();
  const items = raw.items.map(value => {
    if (!object(value) || !exact(value, ["productId", "quantity", "checked", "product", "unitPrice", "unitPriceText"]) || typeof value.productId !== "string"
      || !/^[A-Za-z0-9:_-]{1,160}$/.test(value.productId) || ids.has(value.productId) || !Number.isSafeInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 999
      || typeof value.checked !== "boolean" || typeof value.unitPrice !== "number" || !Number.isFinite(value.unitPrice) || value.unitPrice < 0 || value.unitPrice > 1e9
      || !text(value.unitPriceText, 200) || !object(value.product)) throw new Error("checkout_draft_invalid");
    const p = value.product, keys = ["id", "code", "name", "description", "imageUrl", "thumbnailUrl", "tag", "price"];
    if (!exact(p, keys) || p.id !== value.productId || !keys.every(k => text(p[k], 20000))
      || typeof p.name !== "string") throw new Error("checkout_draft_invalid");
    ids.add(value.productId); return structuredClone(value) as AccountCartItem;
  });
  return { items, customer: structuredClone(customer) as MerchantOrderCustomerInput, clientRequestId: "" };
}
function parseEnvelope(raw: string | null, scope: AccountCartScope) {
  if (raw === null) return { revision: 0, data: emptyData() };
  if (new TextEncoder().encode(raw).length > 1_048_576) throw new Error("checkout_draft_invalid");
  const value: unknown = JSON.parse(raw);
  if (!object(value) || !exact(value, ["version", "scope", "revision", "data"]) || value.version !== 1 || !object(value.scope)
    || !exact(value.scope, ["siteId", "blockId", "accountId"]) || value.scope.siteId !== scope.siteId || value.scope.blockId !== scope.blockId || value.scope.accountId !== scope.accountId
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || Number(value.revision) >= Number.MAX_SAFE_INTEGER) throw new Error("checkout_draft_invalid");
  return { revision: Number(value.revision), data: parseAccountCartData(value.data) };
}
/** Local hints only, never payment authority. Unknown shared v1 drafts remain
 * untouched and are NEVER adopted into an account. Every owned writer uses
 * the same site/account Web Lock as financial nonce/ack operations. */
export function createAccountCartDraft(scope: AccountCartScope, ports: {
  storage?: Pick<Storage, "getItem" | "setItem">; exclusive?: CheckoutClientExclusive;
} = {}) {
  const ownedScope = { ...scope }, storageKey = accountCartStorageKey(ownedScope), lockKey = checkoutClientStorageKey(scope.siteId, scope.accountId);
  const legacyKey = `merchant-space:product-cart:v1:${scope.siteId}:${scope.blockId}`;
  const exclusive: CheckoutClientExclusive = ports.exclusive ?? (async (key, run) => {
    if (!navigator.locks) throw new Error("checkout_browser_unsupported");
    return navigator.locks.request(key, { ifAvailable: true }, async lock => { if (!lock) return false; await run(); return true; });
  });
  let state = blank(), active = false, epoch = 0;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<AccountCartSnapshot>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const storage = () => ports.storage ?? window.localStorage;
  const valid = (run: number) => { if (!active || epoch !== run) throw new Error("checkout_draft_inactive"); };
  const read = (run: number) => {
    valid(run); const raw = storage().getItem(storageKey), next = parseEnvelope(raw, ownedScope), legacy = storage().getItem(legacyKey);
    let legacyPending = false;
    if (legacy !== null) { try { if (legacy.length > 1_048_576) throw new Error("large"); const value: unknown = JSON.parse(legacy);
      legacyPending = !object(value) || typeof value.clientRequestId !== "string" || value.clientRequestId.trim() !== "";
    } catch { legacyPending = true; } }
    valid(run); return { raw, ...next, legacyPresent: legacy !== null, legacyPending };
  };
  const errors = new Set(["checkout_draft_invalid", "checkout_draft_inactive", "checkout_browser_unsupported", "checkout_other_tab", "checkout_cart_changed", "checkout_legacy_original_pending"]);
  const fail = (error: unknown) => { const code = error instanceof Error ? error.message : "";
    emit({ ready: false, busy: false, error: errors.has(code) ? code : "checkout_storage_unavailable" }); };
  const locked = async (run: number, task: (lease: CheckoutDraftLease) => Promise<void>) => {
    const acquired = await exclusive(lockKey, async () => { valid(run); await withCheckoutDraftLease(lockKey, task); });
    valid(run); if (!acquired) throw new Error("checkout_other_tab");
  };
  const controller = {
    storageKey, lockKey, legacyKey, getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() { active = true; const run = ++epoch; state = blank(); emit({ busy: true });
      try { let loaded: ReturnType<typeof read> | undefined; await locked(run, async () => { loaded = read(run); }); valid(run); emit({ ...loaded, ready: true, busy: false, error: "" }); }
      catch (error) { if (active && epoch === run) fail(error); }
    },
    deactivate() { active = false; epoch++; state = blank(); emit({}); },
    async refresh() { if (!active || state.busy) return; const run = epoch; emit({ busy: true, ready: false });
      try { let loaded: ReturnType<typeof read> | undefined; await locked(run, async () => { loaded = read(run); }); valid(run); emit({ ...loaded, ready: true, busy: false, error: "" }); }
      catch (error) { if (active && epoch === run) fail(error); }
    },
    async edit(update: (data: AccountCartData) => AccountCartData) {
      if (!active || !state.ready || state.busy) return; const run = epoch, expected = state.raw; emit({ busy: true });
      try { await locked(run, async lease => { if (storage().getItem(lockKey) !== null) throw new Error("checkout_other_tab");
        await controller.persist(expected, update(structuredClone(state.data)), lease); }); }
      catch (error) { if (active && epoch === run) fail(error); }
      finally { if (active && epoch === run) emit({ busy: false }); }
    },
    async save(expected: string | null, data: AccountCartData): Promise<string> {
      const run = epoch; valid(run); let raw = "";
      await locked(run, async lease => { if (storage().getItem(lockKey) !== null) throw new Error("checkout_other_tab");
        raw = await controller.persist(expected, data, lease); }); return raw;
    },
    /** Exact saved bytes, scope and legacy barrier, under the caller's live
     * financial lock. A read check never adopts, repairs or rewrites a draft. */
    verify(expected: string | null, lease: CheckoutDraftLease): undefined {
      const run = epoch; valid(run); assertCheckoutDraftLease(lease, lockKey);
      const current = read(run);
      if (expected === null || current.raw !== expected) throw new Error("checkout_cart_changed");
      if (current.legacyPending) throw new Error("checkout_legacy_original_pending");
      valid(run); return undefined;
    },
    async persist(expected: string | null, next: AccountCartData, lease?: CheckoutDraftLease): Promise<string> {
      const run = epoch; valid(run); assertCheckoutDraftLease(lease, lockKey);
      const current = read(run); if (current.raw !== expected) { emit({ ...current }); throw new Error("checkout_cart_changed"); }
      if (current.legacyPending) throw new Error("checkout_legacy_original_pending");
      const data = parseAccountCartData(next), revision = current.revision + 1;
      if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER) throw new Error("checkout_draft_invalid");
      const raw = JSON.stringify({ version: 1, scope: ownedScope, revision, data });
      if (new TextEncoder().encode(raw).length > 1_048_576) throw new Error("checkout_draft_invalid");
      valid(run); storage().setItem(storageKey, raw); valid(run);
      if (storage().getItem(storageKey) !== raw) throw new Error("checkout_storage_unavailable");
      emit({ ...current, raw, revision, data, ready: true, error: "" }); return raw;
    },
  }; return controller;
}
export type AccountCartDraft = ReturnType<typeof createAccountCartDraft>;
