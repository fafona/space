import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  mergePlatformMerchantConfigHistoryBySiteId,
  normalizePlatformMerchantSnapshotPayload,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";
import { mergePublishedMerchantSnapshots } from "@/lib/platformPublished";
import {
  loadStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SaveErrorLike = { message?: string } | null;

type LooseQueryBuilder = PromiseLike<{ data?: unknown; error: SaveErrorLike }> & {
  select: (columns: string) => LooseQueryBuilder;
  update: (payload: Record<string, unknown>) => LooseQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: SaveErrorLike }>;
  is: (column: string, value: unknown) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  limit: (value: number) => LooseQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: SaveErrorLike }>;
};

type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder;
};

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function createServerSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as LooseSupabaseClient;
}

function mergePlatformMerchantSnapshotPayloads(
  incoming: PlatformMerchantSnapshotPayload,
  existing: PlatformMerchantSnapshotPayload,
): PlatformMerchantSnapshotPayload {
  const mergedCurrent = mergePublishedMerchantSnapshots(incoming.snapshot, existing.snapshot);
  const mergedIds = new Set(mergedCurrent.map((site) => site.id));
  const appendedExisting = existing.snapshot.filter((site) => !mergedIds.has(site.id));
  return normalizePlatformMerchantSnapshotPayload({
    revision: incoming.revision || existing.revision,
    snapshot: [...mergedCurrent, ...appendedExisting],
    defaultSortRule: incoming.defaultSortRule || existing.defaultSortRule,
    merchantConfigHistoryBySiteId: mergePlatformMerchantConfigHistoryBySiteId(
      incoming.merchantConfigHistoryBySiteId,
      existing.merchantConfigHistoryBySiteId,
    ),
  });
}

export async function GET(request: Request) {
  if (!isSuperAdminRequestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "platform_merchant_snapshot_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient);
  return NextResponse.json({
    ok: true,
    payload: payload ?? normalizePlatformMerchantSnapshotPayload({}),
  });
}

export async function POST(request: Request) {
  if (!isSuperAdminRequestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "platform_merchant_snapshot_env_missing" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const payload = normalizePlatformMerchantSnapshotPayload(body);
  if (payload.snapshot.length === 0) {
    return NextResponse.json({ error: "empty_snapshot" }, { status: 400 });
  }

  const existingPayload = await loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient);
  if (existingPayload && payload.revision !== existingPayload.revision) {
    return NextResponse.json(
      {
        error: "platform_merchant_snapshot_conflict",
        payload: existingPayload,
      },
      { status: 409 },
    );
  }
  const nextPayload = existingPayload
    ? mergePlatformMerchantSnapshotPayloads(payload, existingPayload)
    : payload;

  const saveResult = await savePlatformMerchantSnapshot(
    supabase as unknown as PlatformMerchantSnapshotStoreClient,
    nextPayload,
    {
      expectedRevision: existingPayload?.revision ?? "",
    },
  );

  if (saveResult.code === "conflict") {
    return NextResponse.json(
      {
        error: "platform_merchant_snapshot_conflict",
        payload: saveResult.payload ?? existingPayload ?? normalizePlatformMerchantSnapshotPayload({}),
      },
      { status: 409 },
    );
  }

  if (saveResult.error) {
    return NextResponse.json(
      {
        error: "platform_merchant_snapshot_save_failed",
        message: saveResult.error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: saveResult.payload?.snapshot.length ?? nextPayload.snapshot.length,
    defaultSortRule: saveResult.payload?.defaultSortRule ?? nextPayload.defaultSortRule,
    payload: saveResult.payload ?? nextPayload,
  });
}
