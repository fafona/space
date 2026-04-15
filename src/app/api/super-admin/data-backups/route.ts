import { NextResponse } from "next/server";
import { normalizePlatformState } from "@/data/platformControlStore";
import {
  createPlatformAdminDataBackupEntry,
  getMadridDateKey,
  isPlatformAdminAutoBackupDue,
  summarizePlatformAdminDataBackupEntry,
  type PlatformAdminDataBackupRestoreScope,
  type PlatformAdminDataBackupSource,
} from "@/lib/platformAdminDataBackup";
import {
  loadStoredPlatformAdminDataBackups,
  savePlatformAdminDataBackups,
  type PlatformAdminDataBackupStoreClient,
} from "@/lib/platformAdminDataBackupStore";
import {
  loadStoredPlatformMerchantConfigArchive,
  savePlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient,
} from "@/lib/platformMerchantConfigArchiveStore";
import {
  loadStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import {
  loadStoredPlatformSupportInbox,
  savePlatformSupportInbox,
  type PlatformSupportInboxStoreClient,
} from "@/lib/platformSupportInboxStore";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBackupSource(value: unknown): PlatformAdminDataBackupSource {
  return value === "auto" ? "auto" : "manual";
}

function normalizeRestoreScope(value: unknown): PlatformAdminDataBackupRestoreScope | null {
  return value === "support_messages" || value === "user_manage" ? value : null;
}

function createSupabase() {
  return createServerSupabaseServiceClient();
}

export async function GET(request: Request) {
  if (!isSuperAdminRequestAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabase();
  if (!supabase) {
    return noStoreJson({ error: "super_admin_backup_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredPlatformAdminDataBackups(supabase as unknown as PlatformAdminDataBackupStoreClient);
  return noStoreJson({
    ok: true,
    backups: payload.backups.map((item) => summarizePlatformAdminDataBackupEntry(item)),
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  if (!isSuperAdminRequestAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabase();
  if (!supabase) {
    return noStoreJson({ error: "super_admin_backup_env_missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        source?: unknown;
        operator?: unknown;
        summary?: unknown;
        platformState?: unknown;
        merchantAccounts?: unknown;
      }
    | null;

  const source = normalizeBackupSource(body?.source);
  const operator = trimText(body?.operator) || "平台管理员";
  const platformState = normalizePlatformState((body?.platformState ?? {}) as Record<string, unknown>);
  const merchantAccounts = Array.isArray(body?.merchantAccounts) ? body?.merchantAccounts : [];

  const existingPayload = await loadStoredPlatformAdminDataBackups(supabase as unknown as PlatformAdminDataBackupStoreClient);
  const currentMadridDateKey = getMadridDateKey();
  if (source === "auto" && !isPlatformAdminAutoBackupDue(existingPayload, currentMadridDateKey)) {
    return noStoreJson({
      ok: true,
      created: false,
      backups: existingPayload.backups.map((item) => summarizePlatformAdminDataBackupEntry(item)),
    });
  }

  const [merchantSnapshot, merchantConfigArchive, supportInbox] = await Promise.all([
    loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient),
    loadStoredPlatformMerchantConfigArchive(supabase as unknown as PlatformMerchantConfigArchiveStoreClient),
    loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient),
  ]);

  const nextEntry = createPlatformAdminDataBackupEntry({
    source,
    operator,
    summary: trimText(body?.summary),
    scheduleDateKey: source === "auto" ? currentMadridDateKey : null,
    snapshot: {
      platformState,
      merchantSnapshot,
      merchantConfigArchive,
      supportInbox,
      merchantAccounts,
    },
  });
  const saveResult = await savePlatformAdminDataBackups(
    supabase as unknown as PlatformAdminDataBackupStoreClient,
    {
      backups: [nextEntry, ...existingPayload.backups],
    },
  );

  if (saveResult.error) {
    return noStoreJson(
      {
        error: "super_admin_backup_save_failed",
        message: saveResult.error,
      },
      { status: 500 },
    );
  }

  return noStoreJson({
    ok: true,
    created: true,
    backup: summarizePlatformAdminDataBackupEntry(nextEntry),
    backups: (saveResult.payload?.backups ?? existingPayload.backups).map((item) => summarizePlatformAdminDataBackupEntry(item)),
  });
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  if (!isSuperAdminRequestAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabase();
  if (!supabase) {
    return noStoreJson({ error: "super_admin_backup_env_missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        backupId?: unknown;
        scope?: unknown;
      }
    | null;
  const backupId = trimText(body?.backupId);
  const scope = normalizeRestoreScope(body?.scope);
  if (!backupId || !scope) {
    return noStoreJson({ error: "super_admin_backup_restore_invalid_payload" }, { status: 400 });
  }

  const payload = await loadStoredPlatformAdminDataBackups(supabase as unknown as PlatformAdminDataBackupStoreClient);
  const target = payload.backups.find((item) => item.id === backupId);
  if (!target) {
    return noStoreJson({ error: "super_admin_backup_not_found" }, { status: 404 });
  }

  if (scope === "user_manage") {
    const merchantSnapshotSave = await savePlatformMerchantSnapshot(
      supabase as unknown as PlatformMerchantSnapshotStoreClient,
      target.snapshot.merchantSnapshot ?? {
        revision: "",
        snapshot: [],
        defaultSortRule: "created_desc",
        merchantConfigHistoryBySiteId: {},
      },
    );
    if (merchantSnapshotSave.error) {
      return noStoreJson(
        {
          error: "super_admin_backup_restore_snapshot_failed",
          message: merchantSnapshotSave.error,
        },
        { status: 500 },
      );
    }

    const archiveSave = await savePlatformMerchantConfigArchive(
      supabase as unknown as PlatformMerchantConfigArchiveStoreClient,
      target.snapshot.merchantConfigArchive,
    );
    if (archiveSave.error) {
      return noStoreJson(
        {
          error: "super_admin_backup_restore_archive_failed",
          message: archiveSave.error,
        },
        { status: 500 },
      );
    }

    return noStoreJson({
      ok: true,
      scope,
      backup: summarizePlatformAdminDataBackupEntry(target),
      platformState: target.snapshot.platformState,
      merchantAccounts: target.snapshot.merchantAccounts,
    });
  }

  const supportSave = await savePlatformSupportInbox(
    supabase as unknown as PlatformSupportInboxStoreClient,
    target.snapshot.supportInbox,
  );
  if (supportSave.error) {
    return noStoreJson(
      {
        error: "super_admin_backup_restore_support_failed",
        message: supportSave.error,
      },
      { status: 500 },
    );
  }

  return noStoreJson({
    ok: true,
    scope,
    backup: summarizePlatformAdminDataBackupEntry(target),
    threads: target.snapshot.supportInbox.threads,
  });
}
