const PERFORMANCE_SAMPLE_STORAGE_PREFIX = "faolla:performance-sample:v1";
const WEB_VITAL_SAMPLE_RATE = 0.2;
const ADMIN_API_SAMPLE_RATE = 0.1;
const ADMIN_API_SLOW_MS = 800;
const ADMIN_API_POOR_MS = 2500;

const WEB_VITAL_NAMES = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);
const PERFORMANCE_RATINGS = new Set(["good", "needs-improvement", "poor"]);

type PerformanceRating = "good" | "needs-improvement" | "poor";
type PerformanceEventKind = "web_vital" | "admin_api";

type PerformanceAnalyticsInput = {
  kind: PerformanceEventKind;
  name: string;
  value: number;
  rating: PerformanceRating;
  pagePath: string;
  detail: string;
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

function readRuntimeContext() {
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

function isSampledSession(bucket: string, rate: number) {
  if (typeof window === "undefined") return false;
  const key = `${PERFORMANCE_SAMPLE_STORAGE_PREFIX}:${bucket}`;
  try {
    const current = window.sessionStorage.getItem(key);
    if (current === "1") return true;
    if (current === "0") return false;
    const sampled = Math.random() < rate;
    window.sessionStorage.setItem(key, sampled ? "1" : "0");
    return sampled;
  } catch {
    return Math.random() < rate;
  }
}

function queuePerformanceAnalytics(input: PerformanceAnalyticsInput, alwaysReport: boolean, sampleRate: number) {
  if (isLocalRuntime()) return;
  if (!alwaysReport && !isSampledSession(input.kind, sampleRate)) return;
  const runtime = readRuntimeContext();
  const detail = [
    input.detail,
    `device=${runtime.device}`,
    `network=${runtime.network}`,
    `save_data=${runtime.saveData ? "1" : "0"}`,
    `build=${runtime.build}`,
  ]
    .filter(Boolean)
    .join(";")
    .slice(0, 240);

  void import("@/lib/analytics")
    .then(({ trackPerformanceMetric }) => {
      trackPerformanceMetric({
        ...input,
        pagePath: runtime.pagePath,
        detail,
      });
    })
    .catch(() => {
      // Telemetry must never affect the user workflow.
    });
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

function reportAdminApiPerformance(input: AdminApiPerformanceResult) {
  const durationMs = roundMetric(input.durationMs);
  const rating = classifyAdminApiPerformance(durationMs, input.status);
  const metric: PerformanceAnalyticsInput = {
    kind: "admin_api",
    name: `${input.method}:${input.endpoint}`.slice(0, 120),
    value: durationMs,
    rating,
    pagePath: "/admin",
    detail: `status=${Math.max(0, Math.round(input.status))};ok=${input.ok ? "1" : "0"};unit=ms`,
  };
  queuePerformanceAnalytics(metric, rating !== "good", ADMIN_API_SAMPLE_RATE);
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
