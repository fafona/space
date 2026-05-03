export type TankBattleLobbyReturnArea = "personal" | "merchant";

type TankBattleLobbyReturnSnapshot = {
  area: TankBattleLobbyReturnArea;
  selfSection: "games";
  createdAt: number;
};

const TANK_BATTLE_LOBBY_RETURN_KEY = "faolla:tank-battle:lobby-return:v1";
const TANK_BATTLE_LOBBY_RETURN_MAX_AGE_MS = 2 * 60 * 1000;

function normalizeTankBattleLobbyReturnArea(value: unknown): TankBattleLobbyReturnArea | "" {
  return value === "personal" || value === "merchant" ? value : "";
}

function readSnapshot(): TankBattleLobbyReturnSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TANK_BATTLE_LOBBY_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TankBattleLobbyReturnSnapshot>;
    const area = normalizeTankBattleLobbyReturnArea(parsed.area);
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
    if (!area || parsed.selfSection !== "games" || Date.now() - createdAt > TANK_BATTLE_LOBBY_RETURN_MAX_AGE_MS) {
      window.sessionStorage.removeItem(TANK_BATTLE_LOBBY_RETURN_KEY);
      return null;
    }
    return { area, selfSection: "games", createdAt };
  } catch {
    return null;
  }
}

export function resolveTankBattleLobbyAreaFromHref(href: string): TankBattleLobbyReturnArea {
  if (typeof window === "undefined") return href.startsWith("/me") ? "personal" : "merchant";
  try {
    const url = new URL(href, window.location.origin);
    return url.pathname.startsWith("/me") ? "personal" : "merchant";
  } catch {
    return href.startsWith("/me") ? "personal" : "merchant";
  }
}

export function writeTankBattleLobbyReturnTarget(href: string) {
  if (typeof window === "undefined") return;
  try {
    const snapshot: TankBattleLobbyReturnSnapshot = {
      area: resolveTankBattleLobbyAreaFromHref(href),
      selfSection: "games",
      createdAt: Date.now(),
    };
    window.sessionStorage.setItem(TANK_BATTLE_LOBBY_RETURN_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore browsers that block session storage.
  }
}

export function readTankBattleLobbyReturnTarget(area: TankBattleLobbyReturnArea) {
  const snapshot = readSnapshot();
  return snapshot?.area === area ? snapshot : null;
}

export function clearTankBattleLobbyReturnTarget(area?: TankBattleLobbyReturnArea) {
  if (typeof window === "undefined") return;
  const snapshot = readSnapshot();
  if (area && snapshot?.area !== area) return;
  try {
    window.sessionStorage.removeItem(TANK_BATTLE_LOBBY_RETURN_KEY);
  } catch {
    // Ignore browsers that block session storage.
  }
}
