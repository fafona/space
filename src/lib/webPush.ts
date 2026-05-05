import {
  incrementMerchantPushSubscriptionBadges,
  listMerchantPushSubscriptionsForMerchant,
  removeMerchantPushSubscriptionsByEndpoint,
  type MerchantPushSubscriptionPayload,
  type MerchantWebPushSubscription,
} from "@/lib/merchantPushSubscriptions";
import {
  loadStoredMerchantPushSubscriptions,
  saveStoredMerchantPushSubscriptions,
  type MerchantPushSubscriptionStoreClient,
} from "@/lib/merchantPushSubscriptionStore";
import {
  notifyMerchantNativePushTokens,
} from "@/lib/firebaseCloudMessaging";
import type { MerchantNativePushTokenStoreClient } from "@/lib/merchantNativePushTokenStore";

type MerchantPushNotificationInput = {
  merchantId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  icon?: string;
};

type WebPushErrorLike = {
  statusCode?: number;
  body?: string;
  message?: string;
};

type WebPushModule = typeof import("web-push");
type WebPushSubscriptionInput = import("web-push").PushSubscription;

let webPushConfigured = false;
let webPushModule: WebPushModule | null = null;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function readWebPushConfig() {
  const publicKey =
    trimText(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY) ||
    trimText(process.env.WEB_PUSH_PUBLIC_KEY);
  const privateKey = trimText(process.env.WEB_PUSH_PRIVATE_KEY);
  const subject = trimText(process.env.WEB_PUSH_SUBJECT) || "mailto:support@faolla.com";
  return {
    publicKey,
    privateKey,
    subject,
  };
}

export function readMerchantWebPushPublicKey() {
  return readWebPushConfig().publicKey;
}

export function isMerchantWebPushConfigured() {
  const { publicKey, privateKey, subject } = readWebPushConfig();
  return Boolean(publicKey && privateKey && subject);
}

async function loadWebPushModule() {
  if (webPushModule) return webPushModule;
  const loaded = (await import(/* webpackIgnore: true */ "web-push")) as
    | WebPushModule
    | { default?: WebPushModule };
  const resolved = "default" in loaded && loaded.default ? loaded.default : loaded;
  webPushModule = resolved as WebPushModule;
  return webPushModule;
}

async function ensureMerchantWebPushConfigured() {
  const { publicKey, privateKey, subject } = readWebPushConfig();
  if (!publicKey || !privateKey || !subject) return false;
  const webpush = await loadWebPushModule();
  if (!webPushConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    webPushConfigured = true;
  }
  return webpush;
}

async function sendMerchantWebPushMessage(
  subscription: MerchantWebPushSubscription,
  payload: Record<string, unknown>,
) {
  const webpush = await ensureMerchantWebPushConfigured();
  if (!webpush) {
    return {
      ok: false,
      expired: false,
      message: "merchant_web_push_not_configured",
    };
  }
  try {
    await webpush.sendNotification(subscription as WebPushSubscriptionInput, JSON.stringify(payload), {
      TTL: 60,
      urgency: "high",
      topic: trimText(payload.tag),
    });
    return { ok: true, expired: false, message: "" };
  } catch (error) {
    const detail = error as WebPushErrorLike;
    const statusCode = typeof detail.statusCode === "number" ? detail.statusCode : 0;
    const message = trimText(detail.body) || trimText(detail.message) || "merchant_web_push_send_failed";
    return {
      ok: false,
      expired: statusCode === 404 || statusCode === 410,
      message,
    };
  }
}

export async function syncMerchantPushBadgeCountForSubscription(
  supabase: MerchantPushSubscriptionStoreClient,
  merchantId: string,
  endpoint: string,
  badgeCount: number,
  permission?: "default" | "granted" | "denied" | "unsupported",
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  const normalizedEndpoint = trimText(endpoint);
  if (!normalizedMerchantId || !normalizedEndpoint) {
    return { error: "merchant_push_sync_invalid" };
  }
  const payload = await loadStoredMerchantPushSubscriptions(supabase);
  const nextPayload = {
    ...payload,
    subscriptions: payload.subscriptions.map((item) =>
      item.endpoint !== normalizedEndpoint || item.merchantId !== normalizedMerchantId
        ? item
        : {
            ...item,
            badgeCount: Math.max(0, Math.min(999, Math.round(badgeCount))),
            permission: permission ?? item.permission,
            updatedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          },
    ),
  } satisfies MerchantPushSubscriptionPayload;
  return saveStoredMerchantPushSubscriptions(supabase, nextPayload);
}

export async function notifyMerchantPushSubscribers(
  supabase: MerchantPushSubscriptionStoreClient & MerchantNativePushTokenStoreClient,
  input: MerchantPushNotificationInput,
) {
  const merchantId = normalizeMerchantId(input.merchantId);
  if (!merchantId) {
    return {
      delivered: 0,
      pruned: 0,
      skipped: true,
    };
  }

  const nativeDelivery = await notifyMerchantNativePushTokens(supabase, input).catch(() => ({
    delivered: 0,
    pruned: 0,
    skipped: true,
  }));

  if (!isMerchantWebPushConfigured()) {
    return {
      delivered: nativeDelivery.delivered,
      pruned: nativeDelivery.pruned,
      skipped: nativeDelivery.skipped,
    };
  }

  const payload = await loadStoredMerchantPushSubscriptions(supabase);
  const activeSubscriptions = listMerchantPushSubscriptionsForMerchant(payload, merchantId);
  if (activeSubscriptions.length === 0) {
    return {
      delivered: nativeDelivery.delivered,
      pruned: nativeDelivery.pruned,
      skipped: nativeDelivery.skipped,
    };
  }

  const prepared = incrementMerchantPushSubscriptionBadges(payload, merchantId, 1);
  if (prepared.deliveries.length === 0) {
    return {
      delivered: nativeDelivery.delivered,
      pruned: nativeDelivery.pruned,
      skipped: nativeDelivery.skipped,
    };
  }

  await saveStoredMerchantPushSubscriptions(supabase, prepared.payload);

  const expiredEndpoints: string[] = [];
  let delivered = 0;
  await Promise.all(
    prepared.deliveries.map(async (record) => {
      const result = await sendMerchantWebPushMessage(record.subscription, {
        title: input.title,
        body: input.body,
        url: input.url,
        tag: input.tag,
        badgeCount: record.badgeCount,
        icon: trimText(input.icon) || "/faolla-app-icon-192.png",
      });
      if (result.ok) {
        delivered += 1;
        return;
      }
      if (result.expired) {
        expiredEndpoints.push(record.endpoint);
      }
    }),
  );

  if (expiredEndpoints.length === 0) {
    return {
      delivered: delivered + nativeDelivery.delivered,
      pruned: nativeDelivery.pruned,
      skipped: false,
    };
  }

  const prunedPayload = removeMerchantPushSubscriptionsByEndpoint(prepared.payload, expiredEndpoints);
  const saveResult = await saveStoredMerchantPushSubscriptions(supabase, prunedPayload);
  return {
    delivered: delivered + nativeDelivery.delivered,
    pruned: (saveResult.error ? 0 : expiredEndpoints.length) + nativeDelivery.pruned,
    skipped: false,
  };
}
