import {
  enqueueMerchantOutboxEvent,
  type MerchantOutboxEnqueueConfig,
  type MerchantOutboxEnqueueResult,
  type MerchantOutboxRpcClient,
} from "@/lib/merchantOutboxEnqueue.server";
import type {
  MerchantOutboxClaimedEvent,
  MerchantOutboxEventInput,
} from "@/lib/merchantOutbox.server";
import {
  MerchantOutboxTaskError,
  type MerchantOutboxTaskHandler,
} from "@/lib/merchantOutboxWorker.server";
import {
  GoogleBusinessProfileRequestError,
  syncGoogleBusinessProfileReviews,
} from "@/lib/googleBusinessProfileServer";
import {
  loadGoogleBusinessProfileIntegration,
  saveGoogleBusinessProfileIntegration,
  type GoogleBusinessProfileIntegration,
  type GoogleBusinessProfileStoreClient,
} from "@/lib/googleBusinessProfileStore";

export type GoogleReviewsOutboxSyncReason =
  | "stale_public_read"
  | "manual_refresh";

type GoogleReviewsOutboxDependencies = {
  load: (
    client: GoogleBusinessProfileStoreClient,
    siteId: string,
  ) => Promise<GoogleBusinessProfileIntegration | null>;
  sync: (
    integration: GoogleBusinessProfileIntegration,
    options: { signal: AbortSignal },
  ) => Promise<GoogleBusinessProfileIntegration>;
  save: (
    client: GoogleBusinessProfileStoreClient,
    integration: GoogleBusinessProfileIntegration,
  ) => Promise<GoogleBusinessProfileIntegration>;
};

const GOOGLE_REVIEWS_OUTBOX_REASONS = new Set<GoogleReviewsOutboxSyncReason>([
  "stale_public_read",
  "manual_refresh",
]);
const MINIMUM_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const MAXIMUM_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value: unknown) {
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(trimText(value));
  if (!Number.isFinite(timestamp)) {
    throw new MerchantOutboxTaskError("google_reviews_sync_timestamp_invalid", {
      retryable: false,
    });
  }
  return timestamp;
}

function normalizeDedupeWindowMs(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 15 * 60 * 1000;
  return Math.min(
    MAXIMUM_DEDUPE_WINDOW_MS,
    Math.max(MINIMUM_DEDUPE_WINDOW_MS, Math.round(parsed)),
  );
}

function normalizeReason(value: unknown): GoogleReviewsOutboxSyncReason {
  const reason = trimText(value) as GoogleReviewsOutboxSyncReason;
  if (!GOOGLE_REVIEWS_OUTBOX_REASONS.has(reason)) {
    throw new MerchantOutboxTaskError("google_reviews_sync_reason_invalid", {
      retryable: false,
    });
  }
  return reason;
}

export function buildGoogleReviewsSyncOutboxInput(input: {
  siteId: string;
  reason: GoogleReviewsOutboxSyncReason;
  requestedAt?: string | number | Date;
  dedupeWindowMs?: number;
}): MerchantOutboxEventInput {
  const siteId = trimText(input.siteId);
  if (!/^\d{8}$/.test(siteId)) {
    throw new MerchantOutboxTaskError("google_reviews_sync_site_invalid", {
      retryable: false,
    });
  }
  const reason = normalizeReason(input.reason);
  const requestedAt = normalizeTimestamp(input.requestedAt ?? Date.now());
  const windowMs = normalizeDedupeWindowMs(input.dedupeWindowMs);
  const bucketAt = new Date(Math.floor(requestedAt / windowMs) * windowMs).toISOString();
  return {
    merchantId: siteId,
    eventType: "google.reviews.sync",
    aggregateType: "google_reviews",
    aggregateId: siteId,
    operationId: `${reason}:${bucketAt}`,
    payload: {
      version: 1,
      reason,
      requestedAt: bucketAt,
    },
    maxAttempts: 6,
    priority: 200,
  };
}

export async function enqueueGoogleReviewsSyncShadow(
  client: MerchantOutboxRpcClient,
  input: Parameters<typeof buildGoogleReviewsSyncOutboxInput>[0],
  options?: {
    config?: MerchantOutboxEnqueueConfig;
  },
): Promise<MerchantOutboxEnqueueResult> {
  return enqueueMerchantOutboxEvent(
    client,
    buildGoogleReviewsSyncOutboxInput(input),
    options,
  );
}

function assertGoogleReviewsSyncEvent(event: MerchantOutboxClaimedEvent) {
  if (
    event.eventType !== "google.reviews.sync" ||
    event.aggregateType !== "google_reviews" ||
    event.aggregateId !== event.merchantId
  ) {
    throw new MerchantOutboxTaskError("google_reviews_sync_event_invalid", {
      retryable: false,
    });
  }
  const version = event.payload.version;
  const reason = normalizeReason(event.payload.reason);
  const requestedAt = trimText(event.payload.requestedAt);
  if (
    version !== 1 ||
    !requestedAt ||
    !Number.isFinite(Date.parse(requestedAt))
  ) {
    throw new MerchantOutboxTaskError("google_reviews_sync_payload_invalid", {
      retryable: false,
    });
  }
  return { reason, requestedAt };
}

function toTaskError(error: unknown) {
  if (error instanceof MerchantOutboxTaskError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new MerchantOutboxTaskError("google_reviews_sync_aborted", {
      retryable: true,
      retryAfterSeconds: 30,
    });
  }
  if (error instanceof GoogleBusinessProfileRequestError) {
    const permanentCodes = new Set([
      "google_business_profile_access_denied",
      "google_business_profile_not_configured",
      "google_location_not_selected",
      "google_reauthorization_required",
    ]);
    const retryable =
      !permanentCodes.has(error.code) &&
      (error.code === "google_api_timeout" ||
        error.status === 429 ||
        error.status >= 500);
    return new MerchantOutboxTaskError(error.code, {
      retryable,
      retryAfterSeconds: retryable
        ? error.status === 429
          ? 60
          : 30
        : undefined,
    });
  }
  return new MerchantOutboxTaskError("google_reviews_sync_failed", {
    retryable: true,
  });
}

export function createGoogleReviewsSyncOutboxHandler(
  client: GoogleBusinessProfileStoreClient,
  dependencies: GoogleReviewsOutboxDependencies = {
    load: loadGoogleBusinessProfileIntegration,
    sync: syncGoogleBusinessProfileReviews,
    save: saveGoogleBusinessProfileIntegration,
  },
): MerchantOutboxTaskHandler {
  return async (event, context) => {
    assertGoogleReviewsSyncEvent(event);
    if (context.signal.aborted) {
      throw new MerchantOutboxTaskError("google_reviews_sync_aborted", {
        retryable: true,
        retryAfterSeconds: 30,
      });
    }
    try {
      const integration = await dependencies.load(client, event.merchantId);
      if (!integration || !integration.selectedLocationName) {
        throw new MerchantOutboxTaskError("google_reviews_not_connected", {
          retryable: false,
        });
      }
      const next = await dependencies.sync(integration, {
        signal: context.signal,
      });
      await dependencies.save(client, next);
      return {
        syncedAt: next.snapshot?.syncedAt ?? next.updatedAt,
        reviewCount: next.snapshot?.reviews.length ?? 0,
        totalReviewCount: next.snapshot?.totalReviewCount ?? 0,
      };
    } catch (error) {
      throw toTaskError(error);
    }
  };
}
