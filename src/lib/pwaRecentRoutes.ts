export const PWA_RECENT_ROUTES_STORAGE_KEY = "merchant-space:pwa-recent-routes:v1";
export const PWA_RECENT_ROUTES_MAX_ENTRIES = 8;
export const PWA_RECENT_ROUTES_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type PwaRecentRouteKind = "app" | "public";

export type PwaRecentRouteRecord = {
  path: string;
  kind: PwaRecentRouteKind;
  updatedAt: number;
};

function canUseLocalStorage() {
  if (typeof window === "undefined") return false;
  try {
    const probeKey = "__pwa_recent_routes_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function normalizePathname(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized.startsWith("/")) return "";
  if (normalized.startsWith("/api/")) return "";
  if (normalized.startsWith("/_next/")) return "";
  if (normalized === "/launch" || normalized === "/offline" || normalized === "/pwa") return "";
  if (normalized === "/login" || normalized === "/super-admin/login") return "";
  if (normalized.startsWith("/auth/confirm")) return "";
  if (normalized.startsWith("/reset-password")) return "";
  return normalized;
}

function resolveRouteKind(pathname: string): PwaRecentRouteKind {
  if (pathname === "/admin" || pathname.startsWith("/super-admin") || /^\/\d{8}(?:\/|$)/.test(pathname)) {
    return "app";
  }
  return "public";
}

function normalizeRecord(input: unknown, maxAgeMs: number): PwaRecentRouteRecord | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Partial<PwaRecentRouteRecord>;
  const path = normalizePathname(record.path);
  const updatedAt = Number(record.updatedAt ?? 0);
  const kind = record.kind === "app" ? "app" : record.kind === "public" ? "public" : resolveRouteKind(path);
  if (!path || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  if (Date.now() - updatedAt > Math.max(60_000, maxAgeMs)) return null;
  return { path, kind, updatedAt };
}

export function readRecentPwaRoutes(maxAgeMs = PWA_RECENT_ROUTES_MAX_AGE_MS) {
  if (!canUseLocalStorage()) return [] as PwaRecentRouteRecord[];
  try {
    const raw = window.localStorage.getItem(PWA_RECENT_ROUTES_STORAGE_KEY) || "";
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const records = parsed
      .map((entry) => normalizeRecord(entry, maxAgeMs))
      .filter((entry): entry is PwaRecentRouteRecord => Boolean(entry))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, PWA_RECENT_ROUTES_MAX_ENTRIES);
    const snapshot = JSON.stringify(records);
    if (snapshot !== raw) {
      window.localStorage.setItem(PWA_RECENT_ROUTES_STORAGE_KEY, snapshot);
    }
    return records;
  } catch {
    try {
      window.localStorage.removeItem(PWA_RECENT_ROUTES_STORAGE_KEY);
    } catch {
      // Ignore cleanup failures.
    }
    return [];
  }
}

export function persistRecentPwaRoute(pathname: string, updatedAt = Date.now()) {
  const normalizedPath = normalizePathname(pathname);
  if (!normalizedPath || !canUseLocalStorage()) return false;
  const nextKind = resolveRouteKind(normalizedPath);
  const current = readRecentPwaRoutes();
  const next = [
    { path: normalizedPath, kind: nextKind, updatedAt },
    ...current.filter((entry) => entry.path !== normalizedPath),
  ]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, PWA_RECENT_ROUTES_MAX_ENTRIES);
  try {
    window.localStorage.setItem(PWA_RECENT_ROUTES_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function clearRecentPwaRoutes() {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.removeItem(PWA_RECENT_ROUTES_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }
}
