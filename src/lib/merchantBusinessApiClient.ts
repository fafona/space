const MERCHANT_BUSINESS_API_BASE_ORIGIN = "https://merchant-business.invalid";

export const MERCHANT_BUSINESS_API_DEFAULT_TIMEOUT_MS = 30_000;
export const MERCHANT_BUSINESS_API_MIN_TIMEOUT_MS = 100;
export const MERCHANT_BUSINESS_API_MAX_TIMEOUT_MS = 60_000;

export type MerchantBusinessApiRequestInit = RequestInit & {
  timeoutMs?: number;
};

export type MerchantBusinessApiClient = (
  path: string,
  init?: MerchantBusinessApiRequestInit,
) => Promise<Response>;

export type MerchantBusinessApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type MerchantBusinessApiAuthMode = "employee" | "owner";

export type MerchantBusinessApiClientOptions = {
  authMode: MerchantBusinessApiAuthMode;
  accessToken?: string | null;
  defaultHeaders?: HeadersInit;
  timeoutMs?: number;
  fetchImpl?: MerchantBusinessApiFetch;
};

export class MerchantBusinessApiPathError extends TypeError {
  readonly code = "merchant_business_api_path_invalid";

  constructor() {
    super("Merchant business API requests require a same-origin relative /api path.");
    this.name = "MerchantBusinessApiPathError";
  }
}

export class MerchantBusinessApiTimeoutError extends Error {
  readonly code = "merchant_business_api_timeout";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Merchant business API request timed out after ${timeoutMs}ms.`);
    this.name = "MerchantBusinessApiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class MerchantBusinessApiCredentialError extends Error {
  readonly code = "merchant_business_api_credentials_invalid";

  constructor() {
    super("Merchant business API credentials are invalid for the selected auth mode.");
    this.name = "MerchantBusinessApiCredentialError";
  }
}

export type MerchantBusinessCachePolicy = Readonly<{
  mode: "default" | "disabled";
  allowPersistentRead: boolean;
  allowPersistentWrite: boolean;
  allowStaleOnError: boolean;
}>;

export const MERCHANT_BUSINESS_OWNER_CACHE_POLICY: MerchantBusinessCachePolicy =
  Object.freeze({
    mode: "disabled",
    allowPersistentRead: false,
    allowPersistentWrite: false,
    allowStaleOnError: false,
  });

export const MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY: MerchantBusinessCachePolicy =
  Object.freeze({
    mode: "disabled",
    allowPersistentRead: false,
    allowPersistentWrite: false,
    allowStaleOnError: false,
  });

function normalizedAccessToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveMerchantBusinessCachePolicy(
  authMode: MerchantBusinessApiAuthMode,
): MerchantBusinessCachePolicy {
  return authMode === "employee"
    ? MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY
    : MERCHANT_BUSINESS_OWNER_CACHE_POLICY;
}

export function normalizeMerchantBusinessApiTimeoutMs(
  value: number | null | undefined,
  fallback = MERCHANT_BUSINESS_API_DEFAULT_TIMEOUT_MS,
) {
  const normalizedFallback = Number.isFinite(fallback)
    ? Math.min(
        MERCHANT_BUSINESS_API_MAX_TIMEOUT_MS,
        Math.max(MERCHANT_BUSINESS_API_MIN_TIMEOUT_MS, Math.round(fallback)),
      )
    : MERCHANT_BUSINESS_API_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value)) return normalizedFallback;
  return Math.min(
    MERCHANT_BUSINESS_API_MAX_TIMEOUT_MS,
    Math.max(MERCHANT_BUSINESS_API_MIN_TIMEOUT_MS, Math.round(Number(value))),
  );
}

export function normalizeMerchantBusinessApiPath(value: string) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    throw new MerchantBusinessApiPathError();
  }

  let parsed: URL;
  try {
    parsed = new URL(value, `${MERCHANT_BUSINESS_API_BASE_ORIGIN}/`);
  } catch {
    throw new MerchantBusinessApiPathError();
  }

  if (
    parsed.origin !== MERCHANT_BUSINESS_API_BASE_ORIGIN ||
    (parsed.pathname !== "/api" && !parsed.pathname.startsWith("/api/")) ||
    parsed.hash
  ) {
    throw new MerchantBusinessApiPathError();
  }

  return `${parsed.pathname}${parsed.search}`;
}

function mergeMerchantBusinessHeaders(
  defaultHeaders: HeadersInit | undefined,
  requestHeaders: HeadersInit | undefined,
) {
  const headers = new Headers(defaultHeaders);
  new Headers(requestHeaders).forEach((value, name) => headers.set(name, value));
  return headers;
}

function removeCallerCredentialHeaders(headers: Headers, employeeRequest: boolean) {
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.delete("cookie");
  headers.delete("x-merchant-access-token");
  headers.delete("x-merchant-refresh-token");
  headers.delete("x-merchant-expires-in");

  if (!employeeRequest) return;
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith("x-merchant-")) headers.delete(name);
  }
}

function createAbortError() {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function readAbortReason(signal: AbortSignal) {
  return signal.reason === undefined ? createAbortError() : signal.reason;
}

export function createMerchantBusinessApiClient(
  options: MerchantBusinessApiClientOptions,
): MerchantBusinessApiClient {
  const accessToken = normalizedAccessToken(options.accessToken);
  const employeeRequest = options.authMode === "employee";
  if (
    (options.authMode !== "employee" && options.authMode !== "owner") ||
    (employeeRequest && !accessToken) ||
    (!employeeRequest && Boolean(accessToken))
  ) {
    throw new MerchantBusinessApiCredentialError();
  }
  const defaultTimeoutMs = normalizeMerchantBusinessApiTimeoutMs(options.timeoutMs);
  const fetchImpl: MerchantBusinessApiFetch =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  return async (path, init = {}) => {
    const normalizedPath = normalizeMerchantBusinessApiPath(path);
    const timeoutMs = normalizeMerchantBusinessApiTimeoutMs(
      init.timeoutMs,
      defaultTimeoutMs,
    );
    const callerSignal = init.signal ?? null;
    if (callerSignal?.aborted) throw readAbortReason(callerSignal);

    const headers = mergeMerchantBusinessHeaders(
      options.defaultHeaders,
      init.headers,
    );
    removeCallerCredentialHeaders(headers, employeeRequest);
    if (employeeRequest) headers.set("x-merchant-access-token", accessToken);

    const requestController = new AbortController();
    let timedOut = false;
    const timeoutError = new MerchantBusinessApiTimeoutError(timeoutMs);
    let rejectCancellation: (reason: unknown) => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const abortFromCaller = () => {
      const reason = readAbortReason(callerSignal!);
      rejectCancellation(reason);
      requestController.abort(reason);
    };
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      rejectCancellation(timeoutError);
      requestController.abort(timeoutError);
    }, timeoutMs);

    const requestInit = { ...init };
    delete requestInit.timeoutMs;

    try {
      let request: Promise<Response>;
      try {
        request = Promise.resolve(
          fetchImpl(normalizedPath, {
            ...requestInit,
            headers,
            credentials: employeeRequest ? "omit" : "include",
            cache: "no-store",
            mode: "same-origin",
            redirect: "error",
            signal: requestController.signal,
          }),
        );
      } catch (error) {
        request = Promise.reject(error);
      }
      return await Promise.race([request, cancellation]);
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw error;
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  };
}
