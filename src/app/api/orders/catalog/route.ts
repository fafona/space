import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  applyMerchantCatalogMutation,
  bootstrapMerchantCatalogFromPublishedBlocks,
  MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_BYTES,
  planMerchantCatalogProductImageImport,
  prepareMerchantCatalogProductImageImport,
  resolveMerchantCatalogBootstrapFromPublishedBlocks,
  type MerchantCatalogBootstrapResolutionPlan,
  type MerchantCatalogMutation,
  type MerchantCatalogPreparedProductImageImportItem,
  type MerchantCatalogProductImageImportPlan,
} from "@/lib/merchantCatalog";
import {
  loadStoredMerchantCatalog,
  mutateStoredMerchantCatalog,
  type MerchantCatalogStoreClient,
} from "@/lib/merchantCatalogStore";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { fetchPublishedSiteBlocksFromSupabase } from "@/lib/publishedSiteData";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CatalogAction = MerchantCatalogMutation["action"] | "bootstrap" | "preview_bootstrap";

export type MerchantCatalogMutationRouteDependencies = {
  resolveSession: typeof resolveMerchantSessionFromRequest;
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  createServiceClient: () => MerchantCatalogStoreClient | null;
  loadCatalog: typeof loadStoredMerchantCatalog;
  mutateCatalog: typeof mutateStoredMerchantCatalog;
  fetchPublishedBlocks: typeof fetchPublishedSiteBlocksFromSupabase;
  verifyProductImageAssets: typeof verifyMerchantCatalogProductImageAssets;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function catalogServiceUnavailableResponse() {
  return noStoreJson({ error: "merchant_catalog_service_unavailable" }, { status: 503 });
}

type MerchantCatalogStorageObjectInfoClient = MerchantCatalogStoreClient & {
  storage?: {
    from(bucket: string): {
      info(objectPath: string): Promise<{ data: unknown; error: unknown }>;
    };
  };
};

export type MerchantCatalogProductImageAssetVerification =
  | { ok: true }
  | { ok: false; error: string; rowIndex: number };

function storageErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return 0;
  const record = error as Record<string, unknown>;
  const status = Number(record.statusCode ?? record.status ?? 0);
  return Number.isFinite(status) ? status : 0;
}

function storageObjectContentType(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object"
    ? (record.metadata as Record<string, unknown>)
    : {};
  return trimText(
    record.contentType ??
      record.content_type ??
      metadata.mimetype ??
      metadata.contentType ??
      metadata.content_type,
  )
    .split(";", 1)[0]!
    .toLowerCase();
}

function storageObjectSize(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object"
    ? (record.metadata as Record<string, unknown>)
    : {};
  const size = Number(record.size ?? metadata.size ?? Number.NaN);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

/** Verifies every asset that will be persisted with bounded storage traffic. */
export async function verifyMerchantCatalogProductImageAssets(
  serviceClient: MerchantCatalogStoreClient,
  items: MerchantCatalogPreparedProductImageImportItem[],
): Promise<MerchantCatalogProductImageAssetVerification> {
  const storage = (serviceClient as MerchantCatalogStorageObjectInfoClient).storage;
  if (!storage) {
    return {
      ok: false,
      error: "merchant_catalog_product_image_asset_verification_failed",
      rowIndex: items[0]?.rowIndex ?? 0,
    };
  }
  const unique = new Map<
    string,
    {
      rowIndex: number;
      role: "image" | "thumbnail";
      bucket: string;
      objectPath: string;
    }
  >();
  items.forEach((item) => {
    const references = [
      { role: "image" as const, asset: item.imageAsset },
      ...(item.thumbnailAsset ? [{ role: "thumbnail" as const, asset: item.thumbnailAsset }] : []),
    ];
    references.forEach(({ role, asset }) => {
      const key = `${asset.bucket}\u0000${asset.objectPath}`;
      if (!unique.has(key)) unique.set(key, { rowIndex: item.rowIndex, role, ...asset });
    });
  });
  const references = [...unique.values()];
  const outcomes: Array<MerchantCatalogProductImageAssetVerification | undefined> = new Array(references.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < references.length) {
      const index = cursor;
      cursor += 1;
      const reference = references[index]!;
      let result: { data: unknown; error: unknown };
      try {
        result = await storage.from(reference.bucket).info(reference.objectPath);
      } catch {
        outcomes[index] = {
          ok: false,
          error: "merchant_catalog_product_image_asset_verification_failed",
          rowIndex: reference.rowIndex,
        };
        continue;
      }
      if (result.error || !result.data) {
        outcomes[index] = {
          ok: false,
          error:
            storageErrorStatus(result.error) === 404
              ? "merchant_catalog_product_image_asset_not_found"
              : "merchant_catalog_product_image_asset_verification_failed",
          rowIndex: reference.rowIndex,
        };
        continue;
      }
      const contentType = storageObjectContentType(result.data);
      const extension = reference.objectPath.split(".").pop()?.toLowerCase() ?? "";
      const expectedContentType = reference.role === "thumbnail" || extension === "webp"
        ? "image/webp"
        : extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : extension === "png"
            ? "image/png"
            : "";
      const validContentType = Boolean(expectedContentType) && contentType === expectedContentType;
      if (!validContentType) {
        outcomes[index] = {
          ok: false,
          error:
            reference.role === "thumbnail"
              ? "invalid_merchant_catalog_product_thumbnail_asset"
              : "invalid_merchant_catalog_product_image_asset",
          rowIndex: reference.rowIndex,
        };
        continue;
      }
      const size = storageObjectSize(result.data);
      if (size === null) {
        outcomes[index] = {
          ok: false,
          error: "merchant_catalog_product_image_asset_verification_failed",
          rowIndex: reference.rowIndex,
        };
        continue;
      }
      if (size <= 0 || size > MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_BYTES) {
        outcomes[index] = {
          ok: false,
          error: "merchant_catalog_product_image_asset_limit_exceeded",
          rowIndex: reference.rowIndex,
        };
        continue;
      }
      outcomes[index] = { ok: true };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(8, Math.max(1, references.length)) }, () => worker()),
  );
  return outcomes.find(
    (outcome): outcome is Extract<MerchantCatalogProductImageAssetVerification, { ok: false }> =>
      Boolean(outcome && !outcome.ok),
  ) ?? { ok: true };
}

function normalizeAction(value: unknown): CatalogAction | null {
  return value === "bootstrap" ||
    value === "preview_bootstrap" ||
    value === "upsert_product" ||
    value === "bulk_import_products" ||
    value === "bulk_set_product_images" ||
    value === "delete_product" ||
    value === "set_availability" ||
    value === "upsert_category" ||
    value === "delete_category" ||
    value === "upsert_collection" ||
    value === "delete_collection" ||
    value === "set_price_prefix"
    ? value
    : null;
}

function readExpectedRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function hashJson(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

/**
 * Hash the complete fresh published block tree, not just bootstrap conflicts.
 * A conflict preview intentionally omits common fields, so hashing only that
 * summary would let an otherwise valid product value change between preview
 * and commit without invalidating the confirmation token.
 */
function publishedBlocksFingerprint(blocks: unknown) {
  return hashJson({ version: 2, blocks });
}

function catalogFingerprintPayload(
  catalog: ReturnType<typeof resolveMerchantCatalogBootstrapFromPublishedBlocks>["catalog"],
) {
  return catalog
    ? {
        pricePrefix: catalog.pricePrefix,
        categories: catalog.categories,
        products: catalog.products,
        collections: catalog.collections,
      }
    : null;
}

function resolutionPlanFingerprintPayload(plan: MerchantCatalogBootstrapResolutionPlan) {
  const selections = plan.selections
    .map((selection) => {
      const targetKey = trimText(selection.targetKey);
      return "choiceId" in selection
        ? { targetKey, choiceId: trimText(selection.choiceId) }
        : { targetKey, customValue: selection.customValue };
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return {
    version: plan.version,
    selections,
    excludedProductIds: [...plan.excludedProductIds].map(trimText).sort((left, right) => left.localeCompare(right, "en")),
  };
}

function resolutionFingerprint(
  plan: MerchantCatalogBootstrapResolutionPlan,
  resolved: ReturnType<typeof resolveMerchantCatalogBootstrapFromPublishedBlocks>,
) {
  return hashJson({
    version: 1,
    plan: resolutionPlanFingerprintPayload(plan),
    catalog: catalogFingerprintPayload(resolved.catalog),
  });
}

function resolutionErrorStatus(error: string) {
  if (
    error === "merchant_catalog_bootstrap_resolution_invalid" ||
    error === "merchant_catalog_bootstrap_validation_failed"
  ) {
    return 400;
  }
  if (
    error === "merchant_catalog_bootstrap_resolution_incomplete" ||
    error === "merchant_catalog_bootstrap_unresolved_conflict"
  ) {
    return 409;
  }
  return 503;
}

function resolutionErrorResponse(
  resolved: ReturnType<typeof resolveMerchantCatalogBootstrapFromPublishedBlocks>,
) {
  const error = resolved.error ?? "merchant_catalog_bootstrap_unresolved_conflict";
  return noStoreJson(
    {
      error,
      preview: resolved,
      ...(resolved.errorTargetKey ? { errorTargetKey: resolved.errorTargetKey } : {}),
      ...(resolved.validationError ? { validationError: resolved.validationError } : {}),
    },
    { status: resolutionErrorStatus(error) },
  );
}

async function authorizeCatalogRequest(
  request: Request,
  siteId: string,
  dependencies: Pick<MerchantCatalogMutationRouteDependencies, "resolveSession" | "loadSnapshotSite">,
) {
  const session = await dependencies.resolveSession(request, { hintedMerchantId: siteId });
  if (!session || session.merchantId !== siteId) return { error: "unauthorized" as const };
  const site = await dependencies.loadSnapshotSite(siteId);
  if (!site?.permissionConfig?.allowProductBlock || !site.permissionConfig.allowOrderManagement) {
    return { error: "order_management_disabled" as const };
  }
  return { error: null };
}

const DEFAULT_MUTATION_DEPENDENCIES: MerchantCatalogMutationRouteDependencies = {
  resolveSession: resolveMerchantSessionFromRequest,
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  createServiceClient: () =>
    createServerSupabaseServiceClient() as unknown as MerchantCatalogStoreClient | null,
  loadCatalog: loadStoredMerchantCatalog,
  mutateCatalog: mutateStoredMerchantCatalog,
  fetchPublishedBlocks: fetchPublishedSiteBlocksFromSupabase,
  verifyProductImageAssets: verifyMerchantCatalogProductImageAssets,
};

function mutationFromBody(
  action: Exclude<CatalogAction, "bootstrap" | "preview_bootstrap">,
  body: Record<string, unknown>,
  authorizedSiteId: string,
): MerchantCatalogMutation {
  if (action === "upsert_product") {
    return {
      action,
      product: body.product,
      productId: body.productId,
      collectionIds: body.collectionIds,
    };
  }
  if (action === "bulk_import_products") return { action, items: body.items };
  if (action === "bulk_set_product_images") {
    return { action, items: body.items, merchantId: authorizedSiteId };
  }
  if (action === "delete_product") return { action, productId: body.productId };
  if (action === "set_availability") {
    return { action, productId: body.productId, availability: body.availability };
  }
  if (action === "upsert_category") return { action, category: body.category };
  if (action === "delete_category") return { action, categoryId: body.categoryId };
  if (action === "upsert_collection") return { action, collection: body.collection };
  if (action === "delete_collection") return { action, collectionId: body.collectionId };
  return { action, pricePrefix: body.pricePrefix };
}

function mutationErrorStatus(error: string) {
  if (
    error === "merchant_catalog_limit_exceeded" ||
    error === "merchant_catalog_image_import_limit_exceeded" ||
    error === "merchant_catalog_product_image_asset_limit_exceeded"
  ) return 413;
  if (
    error === "merchant_catalog_revision_conflict" ||
    error === "merchant_catalog_already_initialized" ||
    error === "merchant_catalog_category_name_conflict" ||
    error === "merchant_catalog_collection_scope_conflict" ||
    error === "merchant_catalog_product_id_immutable" ||
    error === "merchant_catalog_product_not_placed" ||
    error === "merchant_catalog_import_duplicate_code" ||
    error === "merchant_catalog_image_import_duplicate_code" ||
    error === "merchant_catalog_existing_duplicate_code" ||
    error === "merchant_catalog_image_import_no_changes" ||
    error === "merchant_catalog_bootstrap_source_changed" ||
    error === "merchant_catalog_bootstrap_resolution_changed"
  ) {
    return 409;
  }
  if (error === "merchant_catalog_product_image_asset_verification_failed") return 503;
  if (error.endsWith("_not_found")) return 404;
  if (error.startsWith("invalid_")) return 400;
  return 503;
}

function mutationErrorResponse(
  error: string,
  catalog: Awaited<ReturnType<typeof loadStoredMerchantCatalog>>,
  details?: { rowIndex?: number; rows?: unknown; summary?: unknown },
) {
  return noStoreJson(
    {
      error,
      catalog,
      currentRevision: catalog?.revision ?? 0,
      ...(details?.rowIndex !== undefined ? { rowIndex: details.rowIndex } : {}),
      ...(details?.rows ? { rows: details.rows } : {}),
      ...(details?.summary ? { summary: details.summary } : {}),
    },
    { status: mutationErrorStatus(error) },
  );
}

export async function handleMerchantCatalogGet(
  request: Request,
  dependencyOverrides: Partial<MerchantCatalogMutationRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_MUTATION_DEPENDENCIES, ...dependencyOverrides };
  const { searchParams } = new URL(request.url);
  const siteId = trimText(searchParams.get("siteId"));
  if (!isMerchantNumericId(siteId)) return noStoreJson({ error: "invalid_site_id" }, { status: 400 });

  try {
    const authorization = await authorizeCatalogRequest(request, siteId, dependencies);
    if (authorization.error) {
      return noStoreJson(
        { error: authorization.error },
        { status: authorization.error === "unauthorized" ? 401 : 403 },
      );
    }
    const serviceClient = dependencies.createServiceClient();
    if (!serviceClient) return noStoreJson({ error: "catalog_storage_unavailable" }, { status: 503 });
    const supabase = serviceClient;
    const catalog = await dependencies.loadCatalog(supabase, siteId);
    if (catalog) return noStoreJson({ ok: true, catalog, bootstrap: null });
    const published = await dependencies.fetchPublishedBlocks(siteId, { fresh: true });
    const publishedBlocks = published?.blocks ?? [];
    const bootstrap = bootstrapMerchantCatalogFromPublishedBlocks({
      blocks: publishedBlocks,
      revision: 1,
      updatedAt: new Date().toISOString(),
    });
    return noStoreJson({
      ok: true,
      catalog: null,
      bootstrap,
      bootstrapFingerprint: publishedBlocksFingerprint(publishedBlocks),
    });
  } catch {
    return catalogServiceUnavailableResponse();
  }
}

export async function GET(request: Request) {
  return handleMerchantCatalogGet(request);
}

export async function handleMerchantCatalogMutation(
  request: Request,
  dependencyOverrides: Partial<MerchantCatalogMutationRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_MUTATION_DEPENDENCIES, ...dependencyOverrides };
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const siteId = trimText(body?.siteId);
  if (!isMerchantNumericId(siteId)) return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  const action = normalizeAction(body?.action);
  if (!action) return noStoreJson({ error: "invalid_merchant_catalog_action" }, { status: 400 });
  const expectedRevision = readExpectedRevision(body?.expectedRevision);
  if (expectedRevision === null) {
    return noStoreJson({ error: "invalid_merchant_catalog_expected_revision" }, { status: 400 });
  }

  try {
    const authorization = await authorizeCatalogRequest(request, siteId, dependencies);
    if (authorization.error) {
      return noStoreJson(
        { error: authorization.error },
        { status: authorization.error === "unauthorized" ? 401 : 403 },
      );
    }
    const serviceClient = dependencies.createServiceClient();
    if (!serviceClient) return noStoreJson({ error: "catalog_storage_unavailable" }, { status: 503 });
    const supabase = serviceClient;
    if (action === "bootstrap" || action === "preview_bootstrap") {
      if (action === "preview_bootstrap" && expectedRevision !== 0) {
        return noStoreJson({ error: "invalid_merchant_catalog_expected_revision" }, { status: 400 });
      }
      const published = await dependencies.fetchPublishedBlocks(siteId, { fresh: true });
      if (!published?.blocks) {
        return noStoreJson({ error: "merchant_catalog_bootstrap_unavailable" }, { status: 409 });
      }
      const input = {
        blocks: published.blocks,
        revision: 1,
        updatedAt: new Date().toISOString(),
      };
      const bootstrap = bootstrapMerchantCatalogFromPublishedBlocks(input);
      const currentBootstrapFingerprint = publishedBlocksFingerprint(published.blocks);
      if (trimText(body?.sourceFingerprint) !== currentBootstrapFingerprint) {
        return noStoreJson(
          {
            error: "merchant_catalog_bootstrap_source_changed",
            bootstrap,
            bootstrapFingerprint: currentBootstrapFingerprint,
          },
          { status: 409 },
        );
      }

      if (action === "preview_bootstrap") {
        const resolutionPlan = body?.resolutionPlan as MerchantCatalogBootstrapResolutionPlan;
        const resolved = resolveMerchantCatalogBootstrapFromPublishedBlocks(input, resolutionPlan);
        if (resolved.error || !resolved.ok || !resolved.catalog) {
          return resolutionErrorResponse(resolved);
        }
        if (resolved.sourceBlockCount === 0) {
          return noStoreJson({ error: "merchant_catalog_bootstrap_empty", preview: resolved }, { status: 409 });
        }
        return noStoreJson({
          ok: true,
          preview: resolved,
          resolutionFingerprint: resolutionFingerprint(resolutionPlan, resolved),
        });
      }

      const hasResolutionPlan = Object.prototype.hasOwnProperty.call(body ?? {}, "resolutionPlan");
      const resolutionPlan = body?.resolutionPlan as MerchantCatalogBootstrapResolutionPlan;
      let resolvedBootstrap = bootstrap;
      if (hasResolutionPlan) {
        const resolved = resolveMerchantCatalogBootstrapFromPublishedBlocks(input, resolutionPlan);
        if (resolved.error || !resolved.ok || !resolved.catalog) {
          return resolutionErrorResponse(resolved);
        }
        if (resolved.sourceBlockCount === 0) {
          return noStoreJson({ error: "merchant_catalog_bootstrap_empty", bootstrap: resolved }, { status: 409 });
        }
        const currentResolutionFingerprint = resolutionFingerprint(resolutionPlan, resolved);
        if (trimText(body?.resolutionFingerprint) !== currentResolutionFingerprint) {
          return noStoreJson(
            {
              error: "merchant_catalog_bootstrap_resolution_changed",
              preview: resolved,
              resolutionFingerprint: currentResolutionFingerprint,
            },
            { status: 409 },
          );
        }
        resolvedBootstrap = resolved;
      }
      if (!resolvedBootstrap.ok || !resolvedBootstrap.catalog) {
        return noStoreJson(
          { error: "merchant_catalog_bootstrap_conflict", conflicts: bootstrap.conflicts, bootstrap },
          { status: 409 },
        );
      }
      if (resolvedBootstrap.sourceBlockCount === 0) {
        return noStoreJson({ error: "merchant_catalog_bootstrap_empty", bootstrap: resolvedBootstrap }, { status: 409 });
      }
      const result = await dependencies.mutateCatalog(supabase, {
        siteId,
        expectedRevision,
        source: "orders-catalog-bootstrap",
        mutate: (current) =>
          current
            ? { ok: false, error: "merchant_catalog_already_initialized" }
            : { ok: true, catalog: resolvedBootstrap.catalog! },
      });
      if (result.error) return mutationErrorResponse(result.error, result.catalog);
      return noStoreJson({ ok: true, catalog: result.catalog, warning: result.warning ?? null });
    }

    const preparedImageImport = action === "bulk_set_product_images"
      ? prepareMerchantCatalogProductImageImport(body?.items, siteId)
      : null;
    if (preparedImageImport && !preparedImageImport.ok) {
      return noStoreJson(
        {
          error: preparedImageImport.error,
          ...(preparedImageImport.rowIndex !== undefined ? { rowIndex: preparedImageImport.rowIndex } : {}),
        },
        { status: mutationErrorStatus(preparedImageImport.error) },
      );
    }

    const mutation = mutationFromBody(action, body ?? {}, siteId);
    const imageOutcome: {
      plan?: MerchantCatalogProductImageImportPlan;
      verificationFailure?: Extract<MerchantCatalogProductImageAssetVerification, { ok: false }>;
    } = {};
    const result = await dependencies.mutateCatalog(supabase, {
      siteId,
      expectedRevision,
      source: `orders-catalog-${action}`,
      mutate: async (current) => {
        if (!current) return { ok: false, error: "merchant_catalog_not_found" };
        if (mutation.action !== "bulk_set_product_images" || !preparedImageImport?.ok) {
          return applyMerchantCatalogMutation(current, mutation);
        }
        const plan = planMerchantCatalogProductImageImport(current, mutation.items, siteId);
        imageOutcome.plan = plan;
        if (!plan.ok) return { ok: false, error: plan.error };
        if (plan.summary.updated === 0) {
          return { ok: false, error: "merchant_catalog_image_import_no_changes" };
        }
        const updatedRows = new Set(
          plan.rows.filter((row) => row.action === "update").map((row) => row.rowIndex),
        );
        const verification = await dependencies.verifyProductImageAssets(
          supabase,
          preparedImageImport.items.filter((item) => updatedRows.has(item.rowIndex)),
        );
        if (!verification.ok) {
          imageOutcome.verificationFailure = verification;
          return { ok: false, error: verification.error };
        }
        return { ok: true, catalog: plan.catalog };
      },
    });
    if (result.error) {
      const detailRowIndex = imageOutcome.verificationFailure?.rowIndex ??
        (imageOutcome.plan && !imageOutcome.plan.ok ? imageOutcome.plan.rowIndex : undefined);
      return mutationErrorResponse(
        result.error,
        result.catalog,
        imageOutcome.verificationFailure || imageOutcome.plan
          ? {
              ...(detailRowIndex !== undefined ? { rowIndex: detailRowIndex } : {}),
              ...(imageOutcome.plan?.rows ? { rows: imageOutcome.plan.rows } : {}),
              ...(imageOutcome.plan?.summary ? { summary: imageOutcome.plan.summary } : {}),
            }
          : undefined,
      );
    }
    return noStoreJson({
      ok: true,
      catalog: result.catalog,
      warning: result.warning ?? null,
      ...(imageOutcome.plan?.ok
        ? { rows: imageOutcome.plan.rows, summary: imageOutcome.plan.summary }
        : {}),
    });
  } catch {
    return catalogServiceUnavailableResponse();
  }
}

export async function POST(request: Request) {
  return handleMerchantCatalogMutation(request);
}

export async function PATCH(request: Request) {
  return handleMerchantCatalogMutation(request);
}
