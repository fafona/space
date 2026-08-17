import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { resolveMerchantCatalogCollection } from "@/lib/merchantCatalog";
import { loadMerchantCatalog } from "@/lib/merchantCatalogStore";
import { hasPublishedProductBlockForViewport } from "@/lib/merchantOrderCatalog";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { fetchPublishedSiteBlocksFromSupabase } from "@/lib/publishedSiteData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type MerchantCatalogPublicRouteDependencies = {
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  loadCatalog: typeof loadMerchantCatalog;
  fetchPublishedBlocks: typeof fetchPublishedSiteBlocksFromSupabase;
};

const DEFAULT_DEPENDENCIES: MerchantCatalogPublicRouteDependencies = {
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  loadCatalog: loadMerchantCatalog,
  fetchPublishedBlocks: fetchPublishedSiteBlocksFromSupabase,
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function handleMerchantCatalogPublicGet(
  request: Request,
  dependencyOverrides: Partial<MerchantCatalogPublicRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId")?.trim() ?? "";
    const blockId = searchParams.get("blockId")?.trim() ?? "";
    const viewport = searchParams.get("viewport")?.trim() ?? "";
    if (!isMerchantNumericId(siteId)) return json({ error: "invalid_site_id" }, 400);
    if (!blockId || blockId.length > 200) return json({ error: "invalid_block_id" }, 400);
    if (viewport !== "desktop" && viewport !== "mobile") {
      return json({ error: "invalid_catalog_viewport" }, 400);
    }

    const snapshot = await dependencies.loadSnapshotSite(siteId);
    if (!snapshot?.permissionConfig?.allowProductBlock) {
      return json({ error: "product_catalog_disabled" }, 403);
    }
    const [catalog, publishedSite] = await Promise.all([
      dependencies.loadCatalog(siteId),
      dependencies.fetchPublishedBlocks(siteId),
    ]);
    if (!catalog) return json({ ok: true, catalog: null });
    const collection = resolveMerchantCatalogCollection(catalog, blockId, viewport);
    if (!collection) {
      const blockWasMigrated = catalog.collections.some((candidate) => candidate.blockId === blockId);
      return blockWasMigrated
        ? json({ error: "merchant_catalog_scope_unavailable" }, 409)
        : json({ ok: true, catalog: null });
    }
    if (
      !publishedSite?.blocks?.length ||
      !hasPublishedProductBlockForViewport(publishedSite.blocks, blockId, viewport)
    ) {
      return json({ error: "merchant_catalog_binding_unpublished" }, 409);
    }

    const productById = new Map(catalog.products.map((product) => [product.id, product] as const));
    const products = collection.productIds.flatMap((productId) => {
      const product = productById.get(productId);
      return product && product.availability !== "hidden" ? [product] : [];
    });
    const visibleProductIds = new Set(products.map((product) => product.id));
    const categories = catalog.categories.map((category) => ({
      id: category.id,
      name: category.name,
      productIds: category.productIds.filter((productId) => visibleProductIds.has(productId)),
    }));
    return json({
      ok: true,
      catalog: {
        revision: catalog.revision,
        updatedAt: catalog.updatedAt,
        pricePrefix: catalog.pricePrefix,
        ...(collection.browsingRules ? { browsingRules: { ...collection.browsingRules } } : {}),
        collection: {
          id: collection.id,
          blockId: collection.blockId,
          viewport: collection.viewport,
        },
        categories,
        products,
      },
    });
  } catch {
    return json({ error: "order_catalog_unavailable" }, 503);
  }
}

export async function GET(request: Request) {
  return handleMerchantCatalogPublicGet(request);
}
