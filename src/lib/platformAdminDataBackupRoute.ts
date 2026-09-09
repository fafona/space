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
import { withPlatformAdminDataBackupScope } from "@/lib/platformAdminDataBackupScope";
import { tryPlatformAdminBackupRead } from "@/lib/platformAdminBackupStrictRead";
import {
  buildPlatformAdminBackupRestorePreview,
  isPlatformAdminBackupRestoreAction,
  matchesPlatformAdminBackupRestorePreviewToken,
  type PlatformAdminBackupRestoreCurrent,
} from "@/lib/platformAdminBackupRestorePreview.server";
import { assertPlatformAdminBackupPlatformState, assertPlatformAdminBackupMerchantAccounts } from "@/lib/platformAdminBackupValidation";
import { getPlatformSnapshotWriteMode, PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID } from "@/lib/platformSnapshotAtomicMode.server";
import { handlePlatformAdminBackupRestoreAtomic } from "@/lib/platformAdminBackupRestoreAtomic.server";
import type { PlatformSnapshotAtomicClient } from "@/lib/platformSnapshotAtomic.server";
import { platformSnapshotRestoreReceiptActorKey } from "@/lib/platformSnapshotRestoreReceipt.server";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const payload = body && typeof body === "object" && !Array.isArray(body) && (body as { ok?: unknown }).ok === true
    ? withPlatformAdminDataBackupScope(body as Record<string, unknown>)
    : body;
  const response = NextResponse.json(payload, init);
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

function projectMerchantAccountSummaries(value: unknown) {
  if (!Array.isArray(value)) throw new Error("invalid");
  const summaryFields = new Set([
    "merchantId", "merchantName", "email", "username", "loginId", "createdAt", "authUserId", "emailConfirmed",
    "emailConfirmedAt", "lastSignInAt", "manualCreated", "hasPublishedSite", "siteSlug", "siteUpdatedAt",
    "publishedBytes", "publishedBytesKnown", "visits", "visitsKnown",
  ]);
  // The UI lists richer account objects. These named fields were never part of
  // the documented snapshot summary. Do not silently drop arbitrary future fields.
  const excludedFields = new Set([
    "accountType", "accountId", "profileSnapshot", "profileConfigHistory", "personalServiceConfig", "personalServicePaused",
  ]);
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid");
    const entries = Object.entries(entry);
    if (entries.some(([key]) => !summaryFields.has(key) && !excludedFields.has(key))) throw new Error("invalid");
    return Object.fromEntries(entries.filter(([key]) => summaryFields.has(key)));
  });
}

export type PlatformAdminDataBackupRouteDependencies = {
  authorize: (request: Request) => Promise<boolean>;
  readAuthorizedSession?: (request: Request) => Promise<{ deviceId: string } | null>;
  createClient: () => unknown;
};

/** The route supplies the real super-admin guard and service client; tests use no external services. */
export function createPlatformAdminDataBackupHandlers(dependencies: PlatformAdminDataBackupRouteDependencies) {
  const createSupabase = dependencies.createClient;
  const isSuperAdminRequestAuthorized = dependencies.authorize;

  async function GET(request: Request) {
    if (!(await isSuperAdminRequestAuthorized(request))) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = createSupabase();
    if (!supabase) {
      return noStoreJson({ error: "super_admin_backup_env_missing" }, { status: 503 });
    }

    const backupRead = await tryPlatformAdminBackupRead(() =>
      loadStoredPlatformAdminDataBackups(supabase as unknown as PlatformAdminDataBackupStoreClient, { strict: true }));
    if (!backupRead.ok) return noStoreJson({ error: backupRead.error }, { status: 503 });
    const payload = backupRead.value;
    const url = new URL(request.url);
    const backupId = trimText(url.searchParams.get("backupId"));
    if (backupId) {
      const target = payload.backups.find((item) => item.id === backupId);
      if (!target) {
        return noStoreJson({ error: "super_admin_backup_not_found" }, { status: 404 });
      }
      return noStoreJson({
        ok: true,
        backup: target,
      });
    }
    return noStoreJson({
      ok: true,
      backups: payload.backups.map((item) => summarizePlatformAdminDataBackupEntry(item)),
    });
  }

  async function POST(request: Request) {
    if (!isTrustedSameOriginMutationRequest(request)) {
      return getTrustedMutationRequestErrorResponse();
    }
    if (!(await isSuperAdminRequestAuthorized(request))) {
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

    let merchantAccounts: ReturnType<typeof projectMerchantAccountSummaries>;
    try {
      if (!body || (body.source !== "manual" && body.source !== "auto")) throw new Error("invalid");
      assertPlatformAdminBackupPlatformState(body.platformState);
      merchantAccounts = projectMerchantAccountSummaries(body.merchantAccounts);
      assertPlatformAdminBackupMerchantAccounts(merchantAccounts);
    } catch {
      return noStoreJson({ error: "super_admin_backup_invalid_payload" }, { status: 400 });
    }
    const source = normalizeBackupSource(body?.source);
    const operator = trimText(body?.operator) || "平台管理员";
    const platformState = normalizePlatformState((body?.platformState ?? {}) as Record<string, unknown>);

    const existingRead = await tryPlatformAdminBackupRead(() =>
      loadStoredPlatformAdminDataBackups(supabase as unknown as PlatformAdminDataBackupStoreClient, { strict: true }));
    if (!existingRead.ok) return noStoreJson({ error: existingRead.error }, { status: 503 });
    const existingPayload = existingRead.value;
    const currentMadridDateKey = getMadridDateKey();
    if (source === "auto" && !isPlatformAdminAutoBackupDue(existingPayload, currentMadridDateKey)) {
      return noStoreJson({
        ok: true,
        created: false,
        backups: existingPayload.backups.map((item) => summarizePlatformAdminDataBackupEntry(item)),
      });
    }

    const sourcesRead = await tryPlatformAdminBackupRead(() => Promise.all([
      loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient, { strict: true }),
      loadStoredPlatformMerchantConfigArchive(supabase as unknown as PlatformMerchantConfigArchiveStoreClient, { strict: true }),
      loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient, { strict: true }),
    ]));
    if (!sourcesRead.ok) return noStoreJson({ error: sourcesRead.error }, { status: 503 });
    const [merchantSnapshot, merchantConfigArchive, supportInbox] = sourcesRead.value;

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
    let saveResult: Awaited<ReturnType<typeof savePlatformAdminDataBackups>>;
    try {
      saveResult = await savePlatformAdminDataBackups(
        supabase as unknown as PlatformAdminDataBackupStoreClient,
        { backups: [nextEntry, ...existingPayload.backups] },
        { requireAllWrites: true, expectedPayload: existingPayload },
      );
      if (saveResult.error) throw new Error("unconfirmed");
    } catch {
      return noStoreJson({ error: "super_admin_backup_save_failed", outcome: "partial_or_unknown", retrySafe: false }, { status: 500 });
    }

    return noStoreJson({
      ok: true,
      created: true,
      backup: summarizePlatformAdminDataBackupEntry(nextEntry),
      backups: (saveResult.payload?.backups ?? existingPayload.backups).map((item) => summarizePlatformAdminDataBackupEntry(item)),
    });
  }

  async function PATCH(request: Request) {
    if (!isTrustedSameOriginMutationRequest(request)) {
      return getTrustedMutationRequestErrorResponse();
    }
    if (!(await isSuperAdminRequestAuthorized(request))) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }

    let atomicMode: boolean;
    try { atomicMode = getPlatformSnapshotWriteMode() === "atomic"; }
    catch { return noStoreJson({ error: PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID,
      outcome: "not_started", retrySafe: false }, { status: 503 }); }
    let atomicContext: { actorKey: string } | undefined;
    if (atomicMode) {
      if (!dependencies.readAuthorizedSession) return noStoreJson({ error: "super_admin_backup_restore_identity_unavailable",
        outcome: "not_started", retrySafe: false }, { status: 503 });
      let session;
      try { session = await dependencies.readAuthorizedSession(request); } catch { session = null; }
      if (!session) return noStoreJson({ error: "unauthorized" }, { status: 401 });
      try { atomicContext = { actorKey: platformSnapshotRestoreReceiptActorKey(session) }; }
      catch { return noStoreJson({ error: "super_admin_backup_restore_identity_unavailable",
        outcome: "not_started", retrySafe: false }, { status: 503 }); }
    }

    const supabase = createSupabase();
    if (!supabase) {
      return noStoreJson({ error: "super_admin_backup_env_missing" }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          backupId?: unknown;
          scope?: unknown;
          action?: unknown;
          confirmationToken?: unknown;
          confirmEmpty?: unknown;
          operationId?: unknown;
        }
      | null;
    const backupId = trimText(body?.backupId);
    const scope = normalizeRestoreScope(body?.scope);
    if (!backupId || !scope) {
      return noStoreJson({ error: "super_admin_backup_restore_invalid_payload" }, { status: 400 });
    }
    if (!isPlatformAdminBackupRestoreAction(body?.action)) {
      return noStoreJson({ error: "super_admin_backup_restore_preview_required" }, { status: 400 });
    }

    // Local candidate only: bind source catalog and target in one restore RPC.
    // Default off keeps the old explicit-preview workflow; no fallback on error.
    try {
      if (atomicMode) {
        const result = await handlePlatformAdminBackupRestoreAtomic(supabase as PlatformSnapshotAtomicClient,
          body, atomicContext);
        return noStoreJson(result.body, { status: result.status });
      }
    } catch {
      // Mode validation already happened before dispatch. An unexpected failure
      // here can follow a commit or response serialization; never imply no write.
      return noStoreJson({ error: "super_admin_backup_restore_incomplete",
        outcome: "partial_or_unknown", retrySafe: false }, { status: 503 });
    }

    const backupRead = await tryPlatformAdminBackupRead(() =>
      loadStoredPlatformAdminDataBackups(supabase as unknown as PlatformAdminDataBackupStoreClient, { strict: true }));
    if (!backupRead.ok) return noStoreJson({ error: backupRead.error }, { status: 503 });
    const target = backupRead.value.backups.find((item) => item.id === backupId);
    if (!target) {
      return noStoreJson({ error: "super_admin_backup_not_found" }, { status: 404 });
    }

    // This observes the validated business view, not a physical database snapshot
    // or CAS. It cannot exclude writes after this read or partial writer failures.
    const currentRead = await tryPlatformAdminBackupRead(async (): Promise<PlatformAdminBackupRestoreCurrent> => {
      if (scope === "user_manage") {
        const [merchantSnapshot, merchantConfigArchive] = await Promise.all([
          loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient, { strict: true }),
          loadStoredPlatformMerchantConfigArchive(supabase as unknown as PlatformMerchantConfigArchiveStoreClient, { strict: true }),
        ]);
        return { scope, merchantSnapshot, merchantConfigArchive };
      }
      const supportInbox = await loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient, { strict: true });
      return { scope, supportInbox };
    });
    if (!currentRead.ok) return noStoreJson({ error: currentRead.error }, { status: 503 });
    const preview = buildPlatformAdminBackupRestorePreview(target, currentRead.value);
    if (body.action === "preview") {
      return noStoreJson({ ok: true, preview });
    }
    if (!matchesPlatformAdminBackupRestorePreviewToken(body.confirmationToken, preview)) {
      return noStoreJson({ error: "super_admin_backup_restore_preview_stale" }, { status: 409 });
    }
    if (preview.requiresEmptyConfirmation && body.confirmEmpty !== true) {
      return noStoreJson({ error: "super_admin_backup_restore_empty_confirmation_required" }, { status: 400 });
    }

    // Do not expose raw database errors or claim no writes happened once a
    // writer has started. No compensating rollback or automatic retry is safe.
    const incomplete = () => noStoreJson({
      error: "super_admin_backup_restore_incomplete", outcome: "partial_or_unknown", retrySafe: false,
    }, { status: 500 });

    try {
      if (scope === "user_manage") {
        const merchantSnapshotSave = await savePlatformMerchantSnapshot(
          supabase as unknown as PlatformMerchantSnapshotStoreClient,
          target.snapshot.merchantSnapshot ?? {
            revision: "",
            snapshot: [],
            defaultSortRule: "created_desc",
            merchantConfigHistoryBySiteId: {},
          },
          { requireAllWrites: true },
        );
        if (merchantSnapshotSave.error) {
          return incomplete();
        }

        const archiveSave = await savePlatformMerchantConfigArchive(
          supabase as unknown as PlatformMerchantConfigArchiveStoreClient,
          target.snapshot.merchantConfigArchive,
          { requireAllWrites: true },
        );
        if (archiveSave.error) {
          return incomplete();
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
        { replace: true, requireAllWrites: true },
      );
      if (supportSave.error) {
        return incomplete();
      }

      return noStoreJson({
        ok: true,
        scope,
        backup: summarizePlatformAdminDataBackupEntry(target),
        threads: target.snapshot.supportInbox.threads,
      });
    } catch {
      return incomplete();
    }
  }

  return { GET, POST, PATCH };
}
