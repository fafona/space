import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createMerchantCatalogCollectionResolver } from "@/lib/merchantCatalogReadIndex";
import { loadMerchantCatalog } from "@/lib/merchantCatalogStore";
import { hasPublishedProductBlockForViewport } from "@/lib/merchantOrderCatalog";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { fetchPublishedSiteBlocksFromSupabase } from "@/lib/publishedSiteData";
import {
  MAX_PUBLIC_CATALOG_BATCH_SIZE,
  type PublicCatalogBatchResponse,
  type PublicCatalogBatchResult,
} from "@/lib/merchantPublicCatalog";
import type { MerchantCatalogPublicRouteDependencies } from "./route-handler";

export const MAX_PUBLIC_CATALOG_BATCH_BODY_BYTES = 64 * 1024;
const DEFAULT_DEPENDENCIES: MerchantCatalogPublicRouteDependencies = {
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  loadCatalog: loadMerchantCatalog,
  fetchPublishedBlocks: fetchPublishedSiteBlocksFromSupabase,
};
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}
class InvalidBatchBody extends Error {
  constructor(readonly status: number) { super("invalid_catalog_batch_body"); }
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new InvalidBatchBody(400);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_PUBLIC_CATALOG_BATCH_BODY_BYTES) {
    void request.body.cancel().catch(() => {});
    throw new InvalidBatchBody(413);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let content = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PUBLIC_CATALOG_BATCH_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new InvalidBatchBody(413);
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof InvalidBatchBody) throw error;
    throw new InvalidBatchBody(400);
  } finally {
    reader.releaseLock();
  }
}

export async function handleMerchantCatalogPublicPost(
  request: Request,
  dependencyOverrides: Partial<MerchantCatalogPublicRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_catalog_batch_body" }, 400);
    const input = body as Record<string, unknown>;
    const siteId = typeof input.siteId === "string" ? input.siteId.trim() : "";
    const viewport = typeof input.viewport === "string" ? input.viewport.trim() : "";
    if (!isMerchantNumericId(siteId)) return json({ error: "invalid_site_id" }, 400);
    if (viewport !== "desktop" && viewport !== "mobile") return json({ error: "invalid_catalog_viewport" }, 400);
    // Count BEFORE deduplicating so repeats cannot bypass the request bound.
    if (!Array.isArray(input.blockIds) || input.blockIds.length < 1 || input.blockIds.length > MAX_PUBLIC_CATALOG_BATCH_SIZE) {
      return json({ error: "invalid_catalog_batch_size" }, 400);
    }
    const requestedIds: string[] = [];
    for (const id of input.blockIds) {
      if (typeof id !== "string" || !id.trim() || id.trim().length > 200) return json({ error: "invalid_block_id" }, 400);
      requestedIds.push(id.trim());
    }
    const blockIds = [...new Set(requestedIds)];
    const snapshot = await dependencies.loadSnapshotSite(siteId);
    if (!snapshot?.permissionConfig?.allowProductBlock) return json({ error: "product_catalog_disabled" }, 403);
    const [catalog, publishedSite] = await Promise.all([
      dependencies.loadCatalog(siteId),
      dependencies.fetchPublishedBlocks(siteId),
    ]);
    const resolveCollection = catalog ? createMerchantCatalogCollectionResolver(catalog) : null;
    const migratedBlockIds = new Set(catalog?.collections.map((collection) => collection.blockId) ?? []);
    const productById = new Map(catalog?.products.map((product) => [product.id, product] as const) ?? []);
    const visibleUnion = new Set<string>();
    const results: PublicCatalogBatchResult[] = blockIds.map((blockId) => {
      if (!catalog) return { blockId, status: "legacy" };
      const collection = resolveCollection!(blockId, viewport);
      if (!collection) {
        return migratedBlockIds.has(blockId)
          ? { blockId, status: "error", error: "merchant_catalog_scope_unavailable", statusCode: 409 }
          : { blockId, status: "legacy" };
      }
      if (!publishedSite?.blocks?.length || !hasPublishedProductBlockForViewport(publishedSite.blocks, blockId, viewport)) {
        return { blockId, status: "error", error: "merchant_catalog_binding_unpublished", statusCode: 409 };
      }
      const productIds = collection.productIds.filter((id) => {
        const product = productById.get(id);
        return product && product.availability !== "hidden";
      });
      productIds.forEach((id) => visibleUnion.add(id));
      return {
        blockId,
        status: "ready",
        collection: { id: collection.id, blockId: collection.blockId, viewport: collection.viewport },
        productIds,
        ...(collection.browsingRules ? { browsingRules: { ...collection.browsingRules } } : {}),
      };
    });
    const response: PublicCatalogBatchResponse = {
      ok: true,
      siteId,
      viewport,
      catalog: catalog && results.some((result) => result.status === "ready") ? {
        revision: catalog.revision,
        updatedAt: catalog.updatedAt,
        pricePrefix: catalog.pricePrefix,
        products: [...visibleUnion].map((id) => productById.get(id)!),
        categories: catalog.categories.map((category) => ({
          id: category.id,
          name: category.name,
          productIds: category.productIds.filter((id) => visibleUnion.has(id)),
        })),
      } : null,
      results,
    };
    return json(response);
  } catch (error) {
    if (error instanceof InvalidBatchBody) return json({ error: error.message }, error.status);
    return json({ error: "order_catalog_unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  return handleMerchantCatalogPublicPost(request);
}
