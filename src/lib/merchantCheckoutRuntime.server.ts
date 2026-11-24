import { Buffer } from "node:buffer";
import methods from "./merchantCheckoutRuntimeMethods.json";
import { resolveServerSupabaseUrl } from "./serverSupabaseUrl";

type Environment = Record<string, string | undefined>;
export type CheckoutRuntimeResponse = { data: unknown; error: { message: string } | null };
type Options = { environment?: Environment; fetch?: typeof fetch; now?: () => number; timeoutMs?: number };
const limit = 33_554_432, unavailable = () => ({ data: null, error: { message: "checkout_runtime_unavailable" } });
const invalid = (): never => { throw Error("checkout_runtime_unavailable"); };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Configuration sanity ONLY, not JWT verification or end-user authentication.
 * The real gateway must verify signature/issuer/audience and allowed role switch.
 * No signing keys, minting, refresh, browser token or service-key fallback. */
function activeJwt(value: string, role: string, now: number, notAfter: number) {
  try {
    if (value.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
    const [header, payload] = value.split(".").slice(0, 2).map(part => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(part, "base64url"))));
    return object(header) && ["HS256", "RS256", "ES256", "EdDSA"].includes(String(header.alg)) && object(payload) && payload.role === role
      && typeof payload.exp === "number" && Number.isSafeInteger(payload.exp) && payload.exp * 1000 > notAfter
      && (payload.nbf === undefined || typeof payload.nbf === "number" && Number.isFinite(payload.nbf) && payload.nbf * 1000 <= now);
  } catch { return false; }
}
function configuration(environment: Environment, now: number, timeout: number) {
  try {
    if (typeof window !== "undefined") return null;
    const url = new URL(resolveServerSupabaseUrl(environment));
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) return null;
    const jwt = (environment.FAOLLA_CHECKOUT_RUNTIME_JWT ?? "").trim(), apiKey = (environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
    if (!activeJwt(jwt, "faolla_checkout_runtime", now, now + timeout) || !(/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(apiKey) || activeJwt(apiKey, "anon", now, now + timeout))) return null;
    return { url: new URL("/rest/v1/rpc/faolla_checkout_runtime_v1", url).href, jwt, apiKey };
  } catch { return null; }
}
// Copy JSON data without executing getters/toJSON or silently coercing missing,
// nonfinite, class, sparse or cyclic values into a different trusted plan.
function jsonCopy(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (depth > 100) return invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value) || Object.getOwnPropertySymbols(value).length) return invalid();
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.keys(descriptors).filter(k => !(Array.isArray(value) && k === "length"));
    if (Array.isArray(value) && (keys.length !== value.length || keys.some((k, i) => k !== String(i)))) return invalid();
    const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key]; if (!descriptor.enumerable || !("value" in descriptor)) return invalid();
      Object.defineProperty(copy, key, { value: jsonCopy(descriptor.value, seen, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    return copy;
  } finally { seen.delete(value); }
}
async function bounded<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return invalid();
  let stop = () => {};
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    stop = () => reject(Error("checkout_runtime_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
  })]); } finally { signal.removeEventListener("abort", stop); }
}
async function responseJson(response: Response, signal: AbortSignal) {
  if (response.redirected || !response.body || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
    || Number(response.headers.get("content-length") ?? 0) > limit) { void response.body?.cancel().catch(() => {}); return invalid(); }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0, done = false;
  try {
    while (true) {
      const chunk = await bounded(reader.read(), signal); if (chunk.done) { done = true; break; }
      size += chunk.value.byteLength; if (size > limit) return invalid(); text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode(); if (signal.aborted) return invalid(); return JSON.parse(text) as unknown;
  } finally { if (!done) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

class RuntimeCall implements PromiseLike<CheckoutRuntimeResponse> {
  private promise?: Promise<CheckoutRuntimeResponse>;
  private signals: AbortSignal[] = [];
  constructor(private readonly run: (signals: AbortSignal[]) => Promise<CheckoutRuntimeResponse>) {}
  abortSignal(signal: AbortSignal) { if (this.promise) return invalid(); this.signals.push(signal); return this; }
  then<T = CheckoutRuntimeResponse, E = never>(fulfilled?: ((value: CheckoutRuntimeResponse) => T | PromiseLike<T>) | null, rejected?: ((reason: unknown) => E | PromiseLike<E>) | null): Promise<T | E> {
    this.promise ??= this.run(this.signals); return this.promise.then(fulfilled, rejected);
  }
}

/** Server-only fixed RPC capability. No from/auth/storage API, user headers,
 * redirects, cookies, retries or env aliases for a broader credential. Repeated
 * awaiting of the same call shares ONE dispatch, including ambiguous failures. */
export function createServerMerchantCheckoutRuntimeClient(options: Options = {}) {
  const environment = options.environment ?? process.env, now = options.now ?? Date.now, transport = options.fetch ?? globalThis.fetch;
  const timeout = options.timeoutMs ?? 12_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 12_000 || !configuration(environment, now(), timeout)) return null;
  return { rpc(name: string, args: Record<string, unknown>) {
    const expected = Object.hasOwn(methods, name) ? (methods as Record<string, string[]>)[name] : null;
    if (!expected || !object(args) || Object.keys(args).length !== expected.length || expected.some(key => !Object.hasOwn(args, key))) return invalid();
    const body = JSON.stringify({ p_function: name, p_arguments: jsonCopy(args) }); if (Buffer.byteLength(body, "utf8") > limit) return invalid();
    return new RuntimeCall(async signals => {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeout), signal = AbortSignal.any([...signals, abort.signal]);
      try {
        const config = configuration(environment, now(), timeout); if (!config || signal.aborted) return unavailable();
        const pending = transport(config.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json",
          "accept-profile": "public", "content-profile": "public", apikey: config.apiKey, authorization: `Bearer ${config.jwt}` },
          body, signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
        void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
        const response = await bounded(pending, signal), data = await responseJson(response, signal);
        if (response.status === 200) return { data, error: null };
        if (response.status >= 400 && object(data) && data.code === "P0001" && typeof data.message === "string"
          && /^(?:checkout_[a-z0-9_]{1,80}|booking_atomic_[a-z0-9_]{1,80}|order_update_conflict|merchant_memberships_conflict|merchant_membership_settings_conflict|merchant_coupons_conflict)$/.test(data.message))
          return { data: null, error: { message: data.message } };
        return unavailable();
      } catch { return unavailable(); } finally { clearTimeout(timer); }
    });
  } };
}
