export const ADMIN_AUTO_RELOAD_STORAGE_KEY = "faolla:admin-auto-reload:v1";
export const ADMIN_AUTO_RELOAD_WINDOW_MS = 60_000;

export type AdminAutoReloadStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AdminAutoReloadState = {
  locationKey: string;
  attemptedAt: number;
};

function readAdminAutoReloadState(storage: AdminAutoReloadStorage): AdminAutoReloadState | null {
  try {
    const raw = storage.getItem(ADMIN_AUTO_RELOAD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminAutoReloadState>;
    const locationKey = typeof parsed.locationKey === "string" ? parsed.locationKey.trim() : "";
    const attemptedAt =
      typeof parsed.attemptedAt === "number" && Number.isFinite(parsed.attemptedAt) ? parsed.attemptedAt : 0;
    return locationKey && attemptedAt > 0 ? { locationKey, attemptedAt } : null;
  } catch {
    return null;
  }
}

export function claimAdminAutoReload(
  storage: AdminAutoReloadStorage | null,
  locationKey: string,
  now = Date.now(),
) {
  const normalizedLocationKey = locationKey.trim();
  if (!storage || !normalizedLocationKey || !Number.isFinite(now)) return false;
  try {
    const current = readAdminAutoReloadState(storage);
    if (
      current?.locationKey === normalizedLocationKey &&
      now >= current.attemptedAt &&
      now - current.attemptedAt <= ADMIN_AUTO_RELOAD_WINDOW_MS
    ) {
      return false;
    }
    storage.setItem(
      ADMIN_AUTO_RELOAD_STORAGE_KEY,
      JSON.stringify({ locationKey: normalizedLocationKey, attemptedAt: now } satisfies AdminAutoReloadState),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearAdminAutoReload(storage: AdminAutoReloadStorage | null, locationKey: string) {
  if (!storage) return;
  try {
    const current = readAdminAutoReloadState(storage);
    if (!current || current.locationKey === locationKey.trim()) {
      storage.removeItem(ADMIN_AUTO_RELOAD_STORAGE_KEY);
    }
  } catch {
    // Storage cleanup is best effort only.
  }
}
