import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  applyMerchantCatalogMutation,
  bootstrapMerchantCatalogFromPublishedBlocks,
  type MerchantCatalogMutation,
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

type CatalogAction = MerchantCatalogMutation["action"] | "bootstrap";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function normalizeAction(value: unknown): CatalogAction | null {
  return value === "bootstrap" ||
    value === "upsert_product" ||
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

function bootstrapFingerprint(bootstrap: ReturnType<typeof bootstrapMerchantCatalogFromPublishedBlocks>) {
  const catalog = bootstrap.catalog
    ? {
        pricePrefix: bootstrap.catalog.pricePrefix,
        categories: bootstrap.catalog.categories,
        products: bootstrap.catalog.products,
        collections: bootstrap.catalog.collections,
      }
    : null;
  return createHash("sha256")
    .update(JSON.stringify({ catalog, conflicts: bootstrap.conflicts, sourceBlockCount: bootstrap.sourceBlockCount }))
    .digest("hex");
}

async function authorizeCatalogRequest(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
  if (!session || session.merchantId !== siteId) return { error: "unauthorized" as const };
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  if (!site?.permissionConfig?.allowProductBlock || !site.permissionConfig.allowOrderManagement) {
    return { error: "order_management_disabled" as const };
  }
  return { error: null };
}

function mutationFromBody(action: Exclude<CatalogAction, "bootstrap">, body: Record<string, unknown>): MerchantCatalogMutation {
  if (action === "upsert_product") {
    return {
      action,
      product: body.product,
      productId: body.productId,
      collectionIds: body.collectionIds,
    };
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
  if (error === "merchant_catalog_limit_exceeded") return 413;
  if (
    error === "merchant_catalog_revision_conflict" ||
    error === "merchant_catalog_already_initialized" ||
    error === "merchant_catalog_category_name_conflict" ||
    error === "merchant_catalog_collection_scope_conflict" ||
    error === "merchant_catalog_product_id_immutable" ||
    error === "merchant_catalog_product_not_placed" ||
    error === "merchant_catalog_bootstrap_source_changed"
  ) {
    return 409;
  }
  if (error.endsWith("_not_found")) return 404;
  if (error.startsWith("invalid_")) return 400;
  return 503;
}

function mutationErrorResponse(error: string, catalog: Awaited<ReturnType<typeof loadStoredMerchantCatalog>>) {
  return noStoreJson(
    {
      error,
      catalog,
      currentRevision: catalog?.revision ?? 0,
    },
    { status: mutationErrorStatus(error) },
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = trimText(searchParams.get("siteId"));
  if (!isMerchantNumericId(siteId)) return noStoreJson({ error: "invalid_site_id" }, { status: 400 });

  const authorization = await authorizeCatalogRequest(request, siteId);
  if (authorization.error) {
    return noStoreJson(
      { error: authorization.error },
      { status: authorization.error === "unauthorized" ? 401 : 403 },
    );
  }
  const serviceClient = createServerSupabaseServiceClient();
  if (!serviceClient) return noStoreJson({ error: "catalog_storage_unavailable" }, { status: 503 });
  const supabase = serviceClient as unknown as MerchantCatalogStoreClient;

  try {
    const catalog = await loadStoredMerchantCatalog(supabase, siteId);
    if (catalog) return noStoreJson({ ok: true, catalog, bootstrap: null });
    const published = await fetchPublishedSiteBlocksFromSupabase(siteId, { fresh: true });
    const bootstrap = bootstrapMerchantCatalogFromPublishedBlocks({
      blocks: published?.blocks ?? [],
      revision: 1,
      updatedAt: new Date().toISOString(),
    });
    return noStoreJson({
      ok: true,
      catalog: null,
      bootstrap,
      bootstrapFingerprint: bootstrapFingerprint(bootstrap),
    });
  } catch (error) {
    return noStoreJson(
      { error: "merchant_catalog_load_failed", message: error instanceof Error ? error.message : "unknown_error" },
      { status: 503 },
    );
  }
}

async function mutateCatalog(request: Request) {
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

  const authorization = await authorizeCatalogRequest(request, siteId);
  if (authorization.error) {
    return noStoreJson(
      { error: authorization.error },
      { status: authorization.error === "unauthorized" ? 401 : 403 },
    );
  }
  const serviceClient = createServerSupabaseServiceClient();
  if (!serviceClient) return noStoreJson({ error: "catalog_storage_unavailable" }, { status: 503 });
  const supabase = serviceClient as unknown as MerchantCatalogStoreClient;

  try {
    if (action === "bootstrap") {
      const published = await fetchPublishedSiteBlocksFromSupabase(siteId, { fresh: true });
      if (!published?.blocks) {
        return noStoreJson({ error: "merchant_catalog_bootstrap_unavailable" }, { status: 409 });
      }
      const bootstrap = bootstrapMerchantCatalogFromPublishedBlocks({
        blocks: published.blocks,
        revision: 1,
        updatedAt: new Date().toISOString(),
      });
      const currentBootstrapFingerprint = bootstrapFingerprint(bootstrap);
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
      if (!bootstrap.ok || !bootstrap.catalog) {
        return noStoreJson(
          { error: "merchant_catalog_bootstrap_conflict", conflicts: bootstrap.conflicts, bootstrap },
          { status: 409 },
        );
      }
      if (bootstrap.sourceBlockCount === 0) {
        return noStoreJson({ error: "merchant_catalog_bootstrap_empty", bootstrap }, { status: 409 });
      }
      const result = await mutateStoredMerchantCatalog(supabase, {
        siteId,
        expectedRevision,
        source: "orders-catalog-bootstrap",
        mutate: (current) =>
          current
            ? { ok: false, error: "merchant_catalog_already_initialized" }
            : { ok: true, catalog: bootstrap.catalog! },
      });
      if (result.error) return mutationErrorResponse(result.error, result.catalog);
      return noStoreJson({ ok: true, catalog: result.catalog, warning: result.warning ?? null });
    }

    const mutation = mutationFromBody(action, body ?? {});
    const result = await mutateStoredMerchantCatalog(supabase, {
      siteId,
      expectedRevision,
      source: `orders-catalog-${action}`,
      mutate: (current) =>
        current
          ? applyMerchantCatalogMutation(current, mutation)
          : { ok: false, error: "merchant_catalog_not_found" },
    });
    if (result.error) return mutationErrorResponse(result.error, result.catalog);
    return noStoreJson({ ok: true, catalog: result.catalog, warning: result.warning ?? null });
  } catch (error) {
    return noStoreJson(
      { error: "merchant_catalog_update_failed", message: error instanceof Error ? error.message : "unknown_error" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  return mutateCatalog(request);
}

export async function PATCH(request: Request) {
  return mutateCatalog(request);
}
