import { NextResponse } from "next/server";
import {
  buildMerchantCustomerDirectory,
  upsertMerchantCustomerProfiles,
  type MerchantCustomerSource,
} from "@/lib/merchantCustomers";
import {
  loadStoredMerchantCustomerDirectory,
  MAX_STORED_MERCHANT_CUSTOMERS,
  saveStoredMerchantCustomerDirectory,
  type MerchantCustomerDirectoryStoreClient,
} from "@/lib/merchantCustomerDirectoryStore";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { listMerchantBookings } from "@/lib/merchantBookings.server";
import { loadStoredMerchantMemberships } from "@/lib/merchantMembershipsStore";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_IMPORT_CUSTOMERS = 2_000;
const mutationTails = new Map<string, Promise<void>>();

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function requireStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) throw new Error("merchant_customer_directory_store_unavailable");
  return supabase as unknown as MerchantCustomerDirectoryStoreClient;
}

async function requireMerchant(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  return session && session.merchantId === siteId ? session : null;
}

async function withCustomerMutationLock<T>(siteId: string, task: () => Promise<T>) {
  const previous = mutationTails.get(siteId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  mutationTails.set(siteId, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (mutationTails.get(siteId) === tail) mutationTails.delete(siteId);
  }
}

function errorResponse(error: string, status: number, message?: string) {
  return NextResponse.json(
    { ok: false, error, ...(message ? { message } : {}) },
    { status },
  );
}

async function loadCustomerDirectory(siteId: string) {
  const store = requireStoreClient();
  const [storedResult, ordersResult, bookingsResult, membershipsResult] =
    await Promise.allSettled([
      loadStoredMerchantCustomerDirectory(store, siteId),
      listMerchantOrders(siteId),
      listMerchantBookings(siteId, {
        includeAutomationState: false,
        includeCustomerEmailLogs: false,
        includeTimeline: false,
      }),
      loadStoredMerchantMemberships(store, siteId),
    ]);

  if (storedResult.status === "rejected") throw storedResult.reason;
  const warnings: string[] = [];
  if (ordersResult.status === "rejected") warnings.push("orders_unavailable");
  if (bookingsResult.status === "rejected") warnings.push("bookings_unavailable");
  if (membershipsResult.status === "rejected") warnings.push("memberships_unavailable");
  const stored = storedResult.value;
  const customers = buildMerchantCustomerDirectory({
    siteId,
    storedCustomers: stored?.customers ?? [],
    orders: ordersResult.status === "fulfilled" ? ordersResult.value : [],
    bookings: bookingsResult.status === "fulfilled" ? bookingsResult.value : [],
    memberships:
      membershipsResult.status === "fulfilled"
        ? membershipsResult.value?.memberships ?? []
        : [],
  });
  return {
    store,
    stored,
    customers,
    warnings,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = trimText(url.searchParams.get("siteId"), 80);
    if (!isMerchantNumericId(siteId)) return errorResponse("invalid_site_id", 400);
    if (!(await requireMerchant(request, siteId))) return errorResponse("unauthorized", 401);
    const result = await loadCustomerDirectory(siteId);
    return NextResponse.json({
      ok: true,
      customers: result.customers,
      total: result.customers.length,
      version: result.stored?.updatedAt ?? "",
      warnings: result.warnings,
    });
  } catch (error) {
    return errorResponse(
      "merchant_customer_directory_load_failed",
      503,
      error instanceof Error ? error.message : "unknown_error",
    );
  }
}

type CustomerMutationBody = {
  siteId?: unknown;
  version?: unknown;
  mode?: unknown;
  customers?: unknown;
  customer?: unknown;
};

async function handleMutation(
  request: Request,
  mutationType: "batch" | "single",
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as CustomerMutationBody | null;
    const siteId = trimText(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) return errorResponse("invalid_site_id", 400);
    if (!(await requireMerchant(request, siteId))) return errorResponse("unauthorized", 401);
    const version = trimText(body?.version, 64);
    const mode = trimText(body?.mode, 20);
    const source: MerchantCustomerSource =
      mode === "import" ? "import" : "manual";
    const rawCustomers =
      mutationType === "batch"
        ? Array.isArray(body?.customers)
          ? body.customers
          : []
        : [body?.customer];
    if (rawCustomers.length === 0) return errorResponse("customer_payload_required", 400);
    if (rawCustomers.length > MAX_IMPORT_CUSTOMERS) {
      return errorResponse("customer_import_limit_exceeded", 413);
    }

    return await withCustomerMutationLock(siteId, async () => {
      const store = requireStoreClient();
      const stored = await loadStoredMerchantCustomerDirectory(store, siteId);
      const currentVersion = stored?.updatedAt ?? "";
      if (version !== currentVersion) {
        return NextResponse.json(
          {
            ok: false,
            error: "merchant_customer_directory_conflict",
            version: currentVersion,
          },
          { status: 409 },
        );
      }
      const upserted = upsertMerchantCustomerProfiles(
        stored?.customers ?? [],
        rawCustomers,
        {
          siteId,
          source,
          replaceEmpty: mutationType === "single",
        },
      );
      if (upserted.customers.length > MAX_STORED_MERCHANT_CUSTOMERS) {
        return errorResponse("merchant_customer_directory_limit_exceeded", 413);
      }
      if (upserted.created === 0 && upserted.updated === 0) {
        return errorResponse("no_valid_customers", 400);
      }
      const saved = await saveStoredMerchantCustomerDirectory(store, {
        siteId,
        customers: upserted.customers,
        expectedUpdatedAt: currentVersion,
      });
      if (saved.error === "merchant_customer_directory_conflict") {
        return NextResponse.json(
          {
            ok: false,
            error: saved.error,
            version: saved.updatedAt ?? "",
          },
          { status: 409 },
        );
      }
      if (saved.error) {
        return errorResponse("merchant_customer_directory_save_failed", 503, saved.error);
      }
      return NextResponse.json({
        ok: true,
        created: upserted.created,
        updated: upserted.updated,
        skipped: upserted.skipped,
        version: saved.updatedAt ?? "",
        storedCount: upserted.customers.length,
      });
    });
  } catch (error) {
    return errorResponse(
      "merchant_customer_directory_save_failed",
      503,
      error instanceof Error ? error.message : "unknown_error",
    );
  }
}

export async function POST(request: Request) {
  return handleMutation(request, "batch");
}

export async function PATCH(request: Request) {
  return handleMutation(request, "single");
}
