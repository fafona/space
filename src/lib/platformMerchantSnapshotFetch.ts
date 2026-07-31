type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type PlatformMerchantSnapshotFetchOptions = {
  fetchImpl?: FetchImplementation;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "PATCH"]);
const RETRYABLE_STATUS_CODES = new Set([408, 502, 503, 504]);

function readRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.trim().toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.trim().toUpperCase();
  }
  return "GET";
}

function readErrorPart(value: unknown, key: "name" | "message" | "code") {
  if (!value || typeof value !== "object") return "";
  const part = (value as Record<string, unknown>)[key];
  return typeof part === "string" ? part.trim() : "";
}

export function isRetryablePlatformMerchantSnapshotFetchError(error: unknown) {
  if (readErrorPart(error, "name") === "AbortError") return false;
  const cause =
    error && typeof error === "object"
      ? (error as { cause?: unknown }).cause
      : undefined;
  const description = [
    readErrorPart(error, "name"),
    readErrorPart(error, "message"),
    readErrorPart(error, "code"),
    readErrorPart(cause, "name"),
    readErrorPart(cause, "message"),
    readErrorPart(cause, "code"),
  ]
    .filter(Boolean)
    .join(" ");
  return /fetch failed|failed to fetch|networkerror|network request failed|load failed|econnreset|econnrefused|eai_again|enotfound|etimedout|und_err_connect_timeout|und_err_socket/i.test(
    description,
  );
}

function cloneRequestInput(input: RequestInfo | URL) {
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.clone();
  }
  return input;
}

function readRequestSignal(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal;
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.signal;
  }
  return undefined;
}

function throwIfRequestAborted(signal: AbortSignal | null | undefined) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("request aborted", "AbortError");
}

export function createPlatformMerchantSnapshotFetch(
  options: PlatformMerchantSnapshotFetchOptions = {},
): FetchImplementation {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 200);
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));

  return async (input, init) => {
    const canRetry = RETRYABLE_METHODS.has(readRequestMethod(input, init));
    const signal = readRequestSignal(input, init);

    try {
      const response = await fetchImpl(cloneRequestInput(input), {
        ...init,
        cache: "no-store",
      });
      if (!canRetry || !RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (!canRetry || !isRetryablePlatformMerchantSnapshotFetchError(error)) {
        throw error;
      }
    }

    throwIfRequestAborted(signal);
    await sleep(retryDelayMs);
    throwIfRequestAborted(signal);
    return fetchImpl(cloneRequestInput(input), {
      ...init,
      cache: "no-store",
    });
  };
}
