import {
  incrementMerchantNativePushTokenBadges,
  listMerchantNativePushTokensForMerchant,
  removeMerchantNativePushTokens,
  type MerchantNativePushTokenRecord,
} from "@/lib/merchantNativePushTokens";
import {
  loadStoredMerchantNativePushTokens,
  saveStoredMerchantNativePushTokens,
  type MerchantNativePushTokenStoreClient,
} from "@/lib/merchantNativePushTokenStore";

type FirebaseAppModule = typeof import("firebase-admin/app");
type FirebaseMessagingModule = typeof import("firebase-admin/messaging");

type MerchantNativePushNotificationInput = {
  merchantId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  icon?: string;
};

type FirebaseSendResult = {
  delivered: number;
  pruned: number;
  skipped: boolean;
};

let firebaseAppModule: FirebaseAppModule | null = null;
let firebaseMessagingModule: FirebaseMessagingModule | null = null;
let firebaseAppInitialized = false;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function readFirebaseServiceAccount() {
  const serviceAccountJson = trimText(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson) as {
        project_id?: unknown;
        client_email?: unknown;
        private_key?: unknown;
      };
      return {
        projectId: trimText(parsed.project_id),
        clientEmail: trimText(parsed.client_email),
        privateKey: normalizePrivateKey(trimText(parsed.private_key)),
      };
    } catch {
      return null;
    }
  }

  const projectId = trimText(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = trimText(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizePrivateKey(trimText(process.env.FIREBASE_PRIVATE_KEY));
  if (!projectId || !clientEmail || !privateKey) return null;
  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

export function isMerchantNativePushConfigured() {
  return Boolean(readFirebaseServiceAccount());
}

async function loadFirebaseModules() {
  if (!firebaseAppModule) {
    firebaseAppModule = await import("firebase-admin/app");
  }
  if (!firebaseMessagingModule) {
    firebaseMessagingModule = await import("firebase-admin/messaging");
  }
  return {
    app: firebaseAppModule,
    messaging: firebaseMessagingModule,
  };
}

async function getFirebaseMessaging() {
  const credentials = readFirebaseServiceAccount();
  if (!credentials) return null;
  const modules = await loadFirebaseModules();
  const appName = "faolla-native-push";
  if (!firebaseAppInitialized && !modules.app.getApps().some((item) => item.name === appName)) {
    modules.app.initializeApp(
      {
        credential: modules.app.cert({
          projectId: credentials.projectId,
          clientEmail: credentials.clientEmail,
          privateKey: credentials.privateKey,
        }),
      },
      appName,
    );
  }
  firebaseAppInitialized = true;
  const app = modules.app.getApp(appName);
  return modules.messaging.getMessaging(app);
}

function isInvalidFirebaseTokenError(errorCode: string) {
  return (
    errorCode === "messaging/registration-token-not-registered" ||
    errorCode === "messaging/invalid-registration-token" ||
    errorCode === "messaging/invalid-argument"
  );
}

function buildNativePayload(input: MerchantNativePushNotificationInput, record: MerchantNativePushTokenRecord) {
  const badgeCount = Math.max(0, Math.min(999, Math.round(record.badgeCount)));
  const url = trimText(input.url);
  return {
    title: trimText(input.title) || "Faolla",
    body: trimText(input.body) || "New Faolla notification",
    url: url.includes("appShell=") ? url : `${url}${url.includes("?") ? "&" : "?"}appShell=faolla`,
    tag: trimText(input.tag),
    key: `${trimText(input.tag) || "faolla"}:${record.token.slice(-12)}:${record.lastDeliveredAt || record.updatedAt}`,
    badgeCount: String(badgeCount),
    unreadCount: String(badgeCount),
    sound: "true",
    vibrate: "true",
  };
}

export async function notifyMerchantNativePushTokens(
  supabase: MerchantNativePushTokenStoreClient,
  input: MerchantNativePushNotificationInput,
): Promise<FirebaseSendResult> {
  const merchantId = normalizeMerchantId(input.merchantId);
  if (!merchantId || !isMerchantNativePushConfigured()) {
    return {
      delivered: 0,
      pruned: 0,
      skipped: true,
    };
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return {
      delivered: 0,
      pruned: 0,
      skipped: true,
    };
  }

  const payload = await loadStoredMerchantNativePushTokens(supabase);
  const activeTokens = listMerchantNativePushTokensForMerchant(payload, merchantId);
  if (activeTokens.length === 0) {
    return {
      delivered: 0,
      pruned: 0,
      skipped: true,
    };
  }

  const prepared = incrementMerchantNativePushTokenBadges(payload, merchantId, 1);
  if (prepared.deliveries.length === 0) {
    return {
      delivered: 0,
      pruned: 0,
      skipped: true,
    };
  }
  await saveStoredMerchantNativePushTokens(supabase, prepared.payload);

  const invalidTokens: string[] = [];
  let delivered = 0;
  await Promise.all(
    prepared.deliveries.map(async (record) => {
      try {
        await messaging.send({
          token: record.token,
          data: buildNativePayload(input, record),
          android: {
            priority: "high",
            ttl: 60_000,
          },
        });
        delivered += 1;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error ? trimText((error as { code?: unknown }).code) : "";
        if (isInvalidFirebaseTokenError(code)) {
          invalidTokens.push(record.token);
        }
      }
    }),
  );

  if (invalidTokens.length === 0) {
    return {
      delivered,
      pruned: 0,
      skipped: false,
    };
  }

  const prunedPayload = removeMerchantNativePushTokens(prepared.payload, invalidTokens);
  const saveResult = await saveStoredMerchantNativePushTokens(supabase, prunedPayload);
  return {
    delivered,
    pruned: saveResult.error ? 0 : invalidTokens.length,
    skipped: false,
  };
}
