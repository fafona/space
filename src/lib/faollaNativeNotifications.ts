"use client";

export type FaollaNativeNotificationPermission = NotificationPermission | "unsupported";

type FaollaNativeNotificationPayload = {
  title: string;
  body: string;
  url: string;
  badgeCount: number;
  sound: boolean;
  vibrate: boolean;
};

type FaollaNativeNotificationSyncPayload = {
  enabled: boolean;
  baseUrl: string;
  siteId: string;
  merchantEmail: string;
  merchantName: string;
  officialLastReadAt: string;
  peerLastRead: string;
  unreadCount: number;
  latestNotificationKey: string;
  sound: boolean;
  vibrate: boolean;
};

type FaollaNativeNotificationBridge = {
  getNotificationPermissionState?: () => string;
  requestNotificationPermission?: () => string;
  showMessageNotification?: (payloadJson: string) => void;
  syncUnreadBadge?: (unreadCount: number) => void;
  configureNotificationSync?: (payloadJson: string) => void;
};

type FaollaNativeNotificationWindow = Window &
  typeof globalThis & {
    FaollaNativeUpdates?: FaollaNativeNotificationBridge;
  };

function getBridge() {
  if (typeof window === "undefined") return null;
  const bridge = (window as FaollaNativeNotificationWindow).FaollaNativeUpdates;
  return bridge && typeof bridge === "object" ? bridge : null;
}

function normalizePermissionState(value: unknown): FaollaNativeNotificationPermission {
  if (value === "granted" || value === "denied" || value === "default") return value;
  return "unsupported";
}

export function canUseFaollaNativeNotifications() {
  const bridge = getBridge();
  return Boolean(
    bridge &&
      typeof bridge.showMessageNotification === "function" &&
      typeof bridge.syncUnreadBadge === "function",
  );
}

export function readFaollaNativeNotificationPermission(): FaollaNativeNotificationPermission {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getNotificationPermissionState !== "function") return "unsupported";
  try {
    return normalizePermissionState(bridge.getNotificationPermissionState());
  } catch {
    return "unsupported";
  }
}

export function requestFaollaNativeNotificationPermission(): FaollaNativeNotificationPermission {
  const bridge = getBridge();
  if (!bridge || typeof bridge.requestNotificationPermission !== "function") return "unsupported";
  try {
    return normalizePermissionState(bridge.requestNotificationPermission());
  } catch {
    return "unsupported";
  }
}

export function showFaollaNativeMessageNotification(payload: FaollaNativeNotificationPayload) {
  const bridge = getBridge();
  if (!bridge || typeof bridge.showMessageNotification !== "function") return false;
  try {
    bridge.showMessageNotification(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function syncFaollaNativeUnreadBadge(unreadCount: number) {
  const bridge = getBridge();
  if (!bridge || typeof bridge.syncUnreadBadge !== "function") return false;
  try {
    bridge.syncUnreadBadge(Math.max(0, Math.min(999, Math.round(unreadCount))));
    return true;
  } catch {
    return false;
  }
}

export function configureFaollaNativeNotificationSync(payload: FaollaNativeNotificationSyncPayload) {
  const bridge = getBridge();
  if (!bridge || typeof bridge.configureNotificationSync !== "function") return false;
  try {
    bridge.configureNotificationSync(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
