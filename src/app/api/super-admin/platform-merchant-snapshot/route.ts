import { NextResponse } from "next/server";
import {
  normalizePlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";
import { createPlatformMerchantSnapshotFetch } from "@/lib/platformMerchantSnapshotFetch";
import {
  loadStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function createServerSupabaseClient() {
  return createServerSupabaseServiceClient({
    fetch: createPlatformMerchantSnapshotFetch(),
  });
}

export async function GET(request: Request) {
  if (!(await isSuperAdminRequestAuthorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "platform_merchant_snapshot_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredPlatformMerchantSnapshot(
    supabase as unknown as PlatformMerchantSnapshotStoreClient,
    { bypassCache: true, includeHistory: false },
  );
  return NextResponse.json({
    ok: true,
    payload: payload ?? normalizePlatformMerchantSnapshotPayload({}),
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  if (!(await isSuperAdminRequestAuthorized(request))) {
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

  const saveResult = await savePlatformMerchantSnapshot(
    supabase as unknown as PlatformMerchantSnapshotStoreClient,
    payload,
    {
      expectedRevision: payload.revision,
    },
  );

  if (saveResult.code === "conflict") {
    return NextResponse.json(
      {
        error: "platform_merchant_snapshot_conflict",
        payload: saveResult.payload ?? normalizePlatformMerchantSnapshotPayload({}),
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

  const savedPayload = saveResult.payload ?? payload;
  const revision = savedPayload.revision;
  return NextResponse.json({
    ok: true,
    count: savedPayload.snapshot.length,
    defaultSortRule: savedPayload.defaultSortRule,
    revision,
    payload: { revision },
  });
}
