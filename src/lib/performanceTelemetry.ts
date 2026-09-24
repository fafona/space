const PERFORMANCE_SAMPLE_STORAGE_PREFIX = "faolla:performance-sample:v1";
const WEB_VITAL_SAMPLE_RATE = 0.2;
const ADMIN_API_SAMPLE_RATE = 0.1;
const ADMIN_API_SLOW_MS = 800;
const ADMIN_API_POOR_MS = 2500;

const WEB_VITAL_NAMES = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);
const PERFORMANCE_RATINGS = new Set(["good", "needs-improvement", "poor"]);

type PerformanceRating = "good" | "needs-improvement" | "poor";
type PerformanceEventKind = "web_vital" | "admin_api";
type PerformanceSamplingUnit = "session" | "event";

type PerformanceSampling = {
  sampled: boolean;
  rate: number;
  unit: PerformanceSamplingUnit;
  diagnostic: boolean;
};

type PerformanceRuntimeContext = {
  pagePath: string;
  device: string;
  network: string;
  saveData: boolean;
  build: string;
};

type PerformanceAnalyticsInput = {
  kind: PerformanceEventKind;
  name: string;
  value: number;
  rating: PerformanceRating;
  pagePath: string;
  detail: string;
  phase?: "headers" | "json";
};

export type WebVitalPerformanceInput = {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
};

export type AdminApiPerformanceResult = {
  endpoint: string;
  method: string;
  durationMs: number;
  status: number;
  ok: boolean;
  phase?: "headers" | "json";
  json?: "ok" | "error" | "not_started";
};

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function trimText(value: unknown, maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function roundMetric(value: number, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  const multiplier = 10 ** Math.max(0, digits);
  return Math.round(Math.max(0, value) * multiplier) / multiplier;
}

function isDynamicPathSegment(segment: string) {
  if (!segment) return false;
  if (/^\d{6,}$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(segment)) return true;
  if (/^[a-z0-9_-]{18,}$/i.test(segment) && /\d/.test(segment)) return true;
  if (segment.includes("@")) return true;
  return false;
}

export function sanitizePerformancePath(pathname: unknown) {
  const raw = trimText(pathname, 500).split("?")[0]?.split("#")[0] || "/";
  const segments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return "/";

  const sanitized = segments.map((segment, index) => {
    const previous = segments[index - 1]?.toLowerCase() ?? "";
    if (index === 0 && /^\d{8}$/.test(segment)) return ":merchant";
    if (previous === "site") return ":merchant";
    if (previous === "card") return ":card";
    if (previous === "share" || previous === "order" || previous === "booking") return ":id";
    return isDynamicPathSegment(segment) ? ":id" : segment.slice(0, 48);
  });
  return `/${sanitized.join("/")}`.slice(0, 180);
}

export function classifyAdminApiPerformance(durationMs: number, status: number): PerformanceRating {
  if (!Number.isFinite(status) || status <= 0 || status >= 400 || durationMs >= ADMIN_API_POOR_MS) {
    return "poor";
  }
  if (durationMs >= ADMIN_API_SLOW_MS) return "needs-improvement";
  return "good";
}

export function normalizeWebVitalPerformance(input: WebVitalPerformanceInput): PerformanceAnalyticsInput | null {
  const name = trimText(input.name, 16).toUpperCase();
  const value = Number(input.value);
  if (!WEB_VITAL_NAMES.has(name) || !Number.isFinite(value) || value < 0) return null;
  const rating = PERFORMANCE_RATINGS.has(trimText(input.rating, 32))
    ? (trimText(input.rating, 32) as PerformanceRating)
    : "needs-improvement";
  const navigationType = trimText(input.navigationType, 32).replace(/[^a-z0-9_-]/gi, "") || "unknown";
  const storedValue = name === "CLS" ? roundMetric(value * 1000) : roundMetric(value);
  const unit = name === "CLS" ? "score_x1000" : "ms";

  return {
    kind: "web_vital",
    name,
    value: storedValue,
    rating,
    pagePath: "/",
    detail: `unit=${unit};nav=${navigationType}`,
  };
}

function readRuntimeContext(): PerformanceRuntimeContext {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      pagePath: "/",
      device: "unknown",
      network: "unknown",
      saveData: false,
      build: "unknown",
    };
  }
  const viewportWidth =
    Number.isFinite(window.visualViewport?.width) && Number(window.visualViewport?.width) > 0
      ? Number(window.visualViewport?.width)
      : window.innerWidth;
  const device = viewportWidth <= 767 ? "mobile" : viewportWidth <= 1180 ? "tablet" : "desktop";
  const connection =
    typeof navigator !== "undefined" ? (navigator as NavigatorWithConnection).connection : undefined;
  const network = trimText(connection?.effectiveType, 16).replace(/[^a-z0-9-]/gi, "") || "unknown";
  const build = trimText(document.documentElement.dataset.faollaBuild, 40).slice(0, 12) || "unknown";
  return {
    pagePath: sanitizePerformancePath(window.location.pathname),
    device,
    network,
    saveData: connection?.saveData === true,
    build,
  };
}

function isLocalRuntime() {
  if (typeof window === "undefined") return true;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function readPerformanceSample(bucket: string, rate: number): Pick<PerformanceSampling, "sampled" | "unit"> {
  if (typeof window === "undefined") return { sampled: false, unit: "session" };
  const key = `${PERFORMANCE_SAMPLE_STORAGE_PREFIX}:${bucket}`;
  try {
    const current = window.sessionStorage.getItem(key);
    if (current === "1") return { sampled: true, unit: "session" };
    if (current === "0") return { sampled: false, unit: "session" };
    const sampled = Math.random() < rate;
    window.sessionStorage.setItem(key, sampled ? "1" : "0");
    return { sampled, unit: "session" };
  } catch {
    // Storage-restricted browsers retain the existing per-event fallback, but
    // must not be described as a stable session cohort in downstream analysis.
    return { sampled: Math.random() < rate, unit: "event" };
  }
}

export function preparePerformanceAnalyticsEvent(
  input: PerformanceAnalyticsInput,
  runtime: PerformanceRuntimeContext,
  sampling: PerformanceSampling,
): PerformanceAnalyticsInput | null {
  if (!sampling.sampled && !sampling.diagnostic) return null;
  // SLO percentiles use only perf_v=2 + sample=slo. Slow/error events inside
  // that cohort MUST remain SLO samples; moving them to diagnostics would bias
  // the cohort in the opposite direction. Report at most one event per metric.
  // sample_rate is the uniform cohort inclusion probability; report_rate is
  // the combined stream's inclusion probability, including diagnostic capture.
  const fields = [
    "perf_v=2",
    `sample=${sampling.sampled ? "slo" : "diagnostic"}`,
    `sample_rate=${sampling.rate}`,
    `report_rate=${sampling.diagnostic ? 1 : sampling.rate}`,
    `sample_unit=${sampling.unit}`,
    `phase=${input.kind === "admin_api" ? input.phase ?? "headers" : "web_vital"}`,
    input.detail,
    `device=${runtime.device}`,
    `build=${runtime.build}`,
    `network=${runtime.network}`,
    `save_data=${runtime.saveData ? "1" : "0"}`,
  ];
  // analytics.trackPerformanceMetric prefixes the rating before applying its
  // 240-character storage limit. Preserve complete fields (including build IDs)
  // and reserve that prefix so the sampling contract survives transport.
  const detailLimit = 240 - `rating=${input.rating};`.length;
  let detail = "";
  for (const field of fields) {
    if (!field) continue;
    const next = detail ? `${detail};${field}` : field;
    if (next.length <= detailLimit) detail = next;
  }

  return { ...input, pagePath: sanitizePerformancePath(runtime.pagePath), detail };
}

function queuePerformanceAnalytics(input: PerformanceAnalyticsInput, alwaysReport: boolean, sampleRate: number) {
  try {
    if (isLocalRuntime()) return;
    // Decide the uniform cohort even for diagnostics so slow/error events can
    // be identified as part of the unbiased sample without sending duplicates.
    const sample = readPerformanceSample(input.kind, sampleRate);
    if (!sample.sampled && !alwaysReport) return;
    const event = preparePerformanceAnalyticsEvent(input, readRuntimeContext(), {
      ...sample,
      rate: sampleRate,
      diagnostic: alwaysReport,
    });
    if (!event) return;
    void import("@/lib/analytics")
      .then(({ trackPerformanceMetric }) => {
        trackPerformanceMetric(event);
      })
      .catch(() => {
        // Telemetry must never affect the user workflow.
      });
  } catch {
    // Browser context/storage failures must not replace successful responses
    // or the original request error with a telemetry exception.
  }
}

export function reportWebVitalPerformance(input: WebVitalPerformanceInput) {
  const metric = normalizeWebVitalPerformance(input);
  if (!metric) return;
  queuePerformanceAnalytics(metric, metric.rating === "poor", WEB_VITAL_SAMPLE_RATE);
}

function describeAdminApiRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof window === "undefined") return null;
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof Request !== "undefined" && input instanceof Request
          ? input.url
          : "";
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return null;
    const method =
      trimText(init?.method, 12) ||
      (typeof Request !== "undefined" && input instanceof Request ? trimText(input.method, 12) : "") ||
      "GET";
    return {
      endpoint: sanitizePerformancePath(url.pathname),
      method: method.toUpperCase(),
    };
  } catch {
    return null;
  }
}

export function normalizeAdminApiPerformance(input: AdminApiPerformanceResult): PerformanceAnalyticsInput {
  const durationMs = roundMetric(input.durationMs);
  const rating = input.json === "error" ? "poor" : classifyAdminApiPerformance(durationMs, input.status);
  return {
    kind: "admin_api",
    name: `${input.method}:${input.endpoint}`.slice(0, 120),
    value: durationMs,
    rating,
    pagePath: "/admin",
    detail: `status=${Math.max(0, Math.round(input.status))};ok=${input.ok ? "1" : "0"};unit=ms${input.json ? `;json=${input.json}` : ""}`,
    ...(input.phase ? { phase: input.phase } : {}),
  };
}

function reportAdminApiPerformance(input: AdminApiPerformanceResult) {
  const metric = normalizeAdminApiPerformance(input);
  queuePerformanceAnalytics(metric, metric.rating !== "good", ADMIN_API_SAMPLE_RATE);
}

export async function fetchWithAdminPerformance(input: RequestInfo | URL, init: RequestInit = {}) {
  const descriptor = describeAdminApiRequest(input, init);
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  try {
    const response = await fetch(input, init);
    if (descriptor) {
      const finishedAt =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
      reportAdminApiPerformance({
        ...descriptor,
        durationMs: Math.max(0, finishedAt - startedAt),
        status: response.status,
        ok: response.ok,
      });
    }
    return response;
  } catch (error) {
    if (descriptor) {
      const finishedAt =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
      reportAdminApiPerformance({
        ...descriptor,
        durationMs: Math.max(0, finishedAt - startedAt),
        status: 0,
        ok: false,
      });
    }
    throw error;
  }
}

type AdminJsonPerformanceOptions = {
  // Explicit opt-in compatibility with response.json().catch(() => null).
  // Network errors still reject; all JSON-body errors return null, including
  // body-stage aborts, exactly as the caller's previous catch would have done.
  jsonErrorFallback: null;
};

function readPerformanceClock() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  } catch {
    // Measuring a request must never stop the request itself.
  }
  return Date.now();
}

export function fetchJsonWithAdminPerformance<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ response: Response; data: T }>;
export function fetchJsonWithAdminPerformance<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: AdminJsonPerformanceOptions,
): Promise<{ response: Response; data: T | null }>;
/** Measures fetch start through JSON-body download and parsing, not UI readiness.
 * Consumes the original body once and never clones it. HTTP failures are returned
 * to the caller; by default network, abort and JSON errors retain their identity.
 * This is an alternative to fetchWithAdminPerformance, not a wrapper around it,
 * so an opted-in request produces at most one metric with phase=json.
 */
export async function fetchJsonWithAdminPerformance<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options?: AdminJsonPerformanceOptions,
): Promise<{ response: Response; data: T | null }> {
  let descriptor: ReturnType<typeof describeAdminApiRequest> = null;
  try {
    descriptor = describeAdminApiRequest(input, init);
  } catch {
    // Do not fail the user's request because its telemetry description failed.
  }
  const startedAt = readPerformanceClock();
  let response: Response | undefined;
  let json: NonNullable<AdminApiPerformanceResult["json"]> = "not_started";
  try {
    response = await fetch(input, init);
    try {
      const data = await response.json() as T;
      json = "ok";
      return { response, data };
    } catch (error) {
      json = "error";
      if (options?.jsonErrorFallback === null) return { response, data: null };
      throw error;
    }
  } finally {
    if (descriptor) {
      try {
        reportAdminApiPerformance({
          ...descriptor,
          durationMs: Math.max(0, readPerformanceClock() - startedAt),
          status: response?.status ?? 0,
          ok: response?.ok ?? false,
          phase: "json",
          json,
        });
      } catch {
        // Preserve the result or original rejection even if measurement fails.
      }
    }
  }
}
