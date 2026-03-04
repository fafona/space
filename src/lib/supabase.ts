import { createClient } from "@supabase/supabase-js";

const REQUIRED_SUPABASE_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const rawAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const missingEnvKeys = REQUIRED_SUPABASE_ENV_KEYS.filter((key) => {
  if (key === "NEXT_PUBLIC_SUPABASE_URL") {
    return !rawUrl;
  }
  return !rawAnon;
});
const isDevelopment = process.env.NODE_ENV === "development";

export const hasSupabaseEnv = missingEnvKeys.length === 0;
export const isSupabaseFallbackMode = !hasSupabaseEnv && isDevelopment;
export const isSupabaseEnabled = hasSupabaseEnv || isSupabaseFallbackMode;
export const BACKEND_UNAVAILABLE_NOTICE = "Backend service is unavailable. Showing cached local content.";
export const supabaseMissingEnvNotice =
  missingEnvKeys.length > 0
    ? `Backend config missing: ${missingEnvKeys.join(", ")}.${isDevelopment ? " Development fallback is enabled." : " Please configure environment variables."}`
    : null;

if (supabaseMissingEnvNotice && typeof window !== "undefined") {
  console.warn(`[supabase] ${supabaseMissingEnvNotice}`);
}

const fallbackUrl = isSupabaseFallbackMode ? "http://127.0.0.1:54321" : "https://invalid.supabase.local";
const fallbackAnon = "fallback-anon-key";
export const resolvedSupabaseUrl = rawUrl || fallbackUrl;
export const resolvedSupabaseAnonKey = rawAnon || fallbackAnon;
const shouldAutoRefreshSession = process.env.NEXT_PUBLIC_SUPABASE_DISABLE_AUTO_REFRESH !== "1";
const DEFAULT_FETCH_TIMEOUT_MS = isDevelopment ? 2200 : 9000;
const DEFAULT_FETCH_COOLDOWN_MS = isDevelopment ? 20_000 : 8_000;
const DEFAULT_WRITE_FETCH_TIMEOUT_MS = isDevelopment ? 45_000 : 60_000;

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const SUPABASE_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.NEXT_PUBLIC_SUPABASE_FETCH_TIMEOUT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
);
const SUPABASE_FETCH_COOLDOWN_MS = parsePositiveInt(
  process.env.NEXT_PUBLIC_SUPABASE_FETCH_COOLDOWN_MS,
  DEFAULT_FETCH_COOLDOWN_MS,
);
const SUPABASE_WRITE_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.NEXT_PUBLIC_SUPABASE_WRITE_TIMEOUT_MS,
  DEFAULT_WRITE_FETCH_TIMEOUT_MS,
);

let supabaseNetworkCooldownUntil = 0;

function activateSupabaseCooldown(ms = SUPABASE_FETCH_COOLDOWN_MS) {
  supabaseNetworkCooldownUntil = Date.now() + Math.max(1_000, ms);
}

function clearSupabaseCooldown() {
  supabaseNetworkCooldownUntil = 0;
}

function isSupabaseCooldownActive() {
  return Date.now() < supabaseNetworkCooldownUntil;
}

function isTransientNetworkError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (name === "AbortError") return true;
  if (message.includes("signal is aborted without reason")) return true;
  if (/failed to fetch|networkerror|load failed|timeout/i.test(message)) return true;
  return false;
}

function mergeAbortSignals(signal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(200, timeoutMs));

  let detach: (() => void) | null = null;
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      const relay = () => controller.abort();
      signal.addEventListener("abort", relay, { once: true });
      detach = () => signal.removeEventListener("abort", relay);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (detach) detach();
    },
  };
}

function makeSupabaseUnavailableResponse(
  detail: string,
  options?: { status?: number; statusText?: string; upstreamStatus?: number },
) {
  const status = typeof options?.status === "number" ? options.status : 408;
  const statusText = options?.statusText ?? "Request Timeout";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (typeof options?.upstreamStatus === "number") {
    headers["x-upstream-status"] = String(options.upstreamStatus);
  }
  return new Response(
    JSON.stringify({
      message: `supabase_unavailable:${detail}`,
      detail,
      status,
      at: new Date().toISOString(),
    }),
    {
      status,
      statusText,
      headers,
    },
  );
}

const nativeFetch = typeof fetch === "function" ? fetch.bind(globalThis) : null;
const safeSupabaseFetch: typeof fetch = async (input, init) => {
  if (!nativeFetch) {
    return makeSupabaseUnavailableResponse("fetch_unavailable");
  }
  const method = typeof init?.method === "string" ? init.method.trim().toUpperCase() : "GET";
  const isReadRequest = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const requestTimeoutMs = isReadRequest
    ? SUPABASE_FETCH_TIMEOUT_MS
    : Math.max(SUPABASE_WRITE_FETCH_TIMEOUT_MS, SUPABASE_FETCH_TIMEOUT_MS);
  if (isReadRequest && isSupabaseCooldownActive()) {
    return makeSupabaseUnavailableResponse("cooldown_active", {
      status: 429,
      statusText: "Too Many Requests",
    });
  }
  const { signal, cleanup } = mergeAbortSignals(init?.signal ?? null, requestTimeoutMs);
  try {
    const response = await nativeFetch(input, {
      ...init,
      signal,
      cache: "no-store",
    });
    if (response.status >= 520) {
      if (isReadRequest) activateSupabaseCooldown();
      return makeSupabaseUnavailableResponse("upstream_unavailable", {
        status: 408,
        statusText: "Request Timeout",
        upstreamStatus: response.status,
      });
    }
    if (response.status >= 500) {
      if (isReadRequest) activateSupabaseCooldown(8_000);
      return makeSupabaseUnavailableResponse("upstream_server_error", {
        status: 409,
        statusText: "Conflict",
        upstreamStatus: response.status,
      });
    } else if (response.ok && isReadRequest) {
      clearSupabaseCooldown();
    }
    return response;
  } catch (error) {
    if (isTransientNetworkError(error)) {
      if (isReadRequest) activateSupabaseCooldown();
      return makeSupabaseUnavailableResponse(`network_or_abort_${method.toLowerCase()}`);
    }
    if (isReadRequest) activateSupabaseCooldown(8_000);
    return makeSupabaseUnavailableResponse(`fetch_exception_${method.toLowerCase()}`);
  } finally {
    cleanup();
  }
};

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  global: {
    fetch: safeSupabaseFetch,
  },
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: shouldAutoRefreshSession,
  },
});

export async function canReachSupabaseGateway(timeoutMs = 4000): Promise<boolean> {
  if (!isSupabaseEnabled || typeof fetch !== "function") return false;
  if (isSupabaseCooldownActive()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(200, timeoutMs));

  try {
    const response = await fetch(`${resolvedSupabaseUrl}/auth/v1/settings`, {
      method: "GET",
      headers: {
        apikey: resolvedSupabaseAnonKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const ok = response.status >= 200 && response.status < 500;
    if (ok) {
      clearSupabaseCooldown();
      return true;
    }
    if (response.status >= 520) {
      activateSupabaseCooldown();
    }
    return false;
  } catch {
    activateSupabaseCooldown();
    return false;
  } finally {
    clearTimeout(timer);
  }
}
