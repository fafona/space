import type { Block } from "@/data/homeBlocks";
import { isMeaningfulProductItem, normalizeProductItems } from "@/lib/productBlock";

export type MerchantCatalogAvailability = "available" | "sold_out" | "hidden";
export type MerchantCatalogViewport = "desktop" | "mobile" | "shared";

export type MerchantCatalogTarget = {
  blockId: string;
  viewport: Exclude<MerchantCatalogViewport, "shared">;
  productIds?: string[];
};

export type MerchantCatalogProduct = {
  id: string;
  code: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  thumbnailUrl: string;
  tag: string;
  availability: MerchantCatalogAvailability;
};

export type MerchantCatalogCategory = {
  id: string;
  name: string;
  productIds: string[];
};

/**
 * A collection is the compatibility boundary between catalog data and a
 * published product block. Desktop and mobile variants remain separate so
 * moving the data does not accidentally change either published layout.
 */
export type MerchantCatalogCollection = {
  id: string;
  blockId: string;
  viewport: MerchantCatalogViewport;
  productIds: string[];
};

export type MerchantCatalog = {
  revision: number;
  updatedAt: string;
  pricePrefix: string;
  categories: MerchantCatalogCategory[];
  products: MerchantCatalogProduct[];
  collections: MerchantCatalogCollection[];
};

export type MerchantCatalogBootstrapSource = {
  blockId: string;
  viewport: MerchantCatalogViewport;
  occurrence: number;
};

export type MerchantCatalogConflictValue = {
  value: string | string[];
  sources: MerchantCatalogBootstrapSource[];
};

export type MerchantCatalogConflict = {
  code: "invalid_input" | "catalog_field_conflict" | "product_field_conflict" | "collection_conflict";
  field: string;
  productId?: string;
  collectionId?: string;
  values: MerchantCatalogConflictValue[];
};

export type MerchantCatalogBootstrapInput = {
  /** A persisted published block tree containing desktop/mobile plan data. */
  blocks?: unknown;
  /** Optional already-separated desktop published blocks. */
  desktopBlocks?: unknown;
  /** Optional already-separated mobile published blocks. */
  mobileBlocks?: unknown;
  revision?: unknown;
  updatedAt?: unknown;
};

export type MerchantCatalogBootstrapResult = {
  ok: boolean;
  /** Null on every conflict so a caller cannot unknowingly persist one side. */
  catalog: MerchantCatalog | null;
  conflicts: MerchantCatalogConflict[];
  sourceBlockCount: number;
};

export type MerchantCatalogMutation =
  | { action: "upsert_product"; product: unknown; productId?: unknown; collectionIds?: unknown }
  | { action: "delete_product"; productId: unknown }
  | { action: "set_availability"; productId: unknown; availability: unknown }
  | { action: "upsert_category"; category: unknown }
  | { action: "delete_category"; categoryId: unknown }
  | { action: "upsert_collection"; collection: unknown }
  | { action: "delete_collection"; collectionId: unknown }
  | { action: "set_price_prefix"; pricePrefix: unknown };

export type MerchantCatalogMutationResult =
  | { ok: true; catalog: MerchantCatalog }
  | { ok: false; error: string };

export const MERCHANT_CATALOG_MAX_PRODUCTS = 1_000;
export const MERCHANT_CATALOG_MAX_CATEGORIES = 200;
export const MERCHANT_CATALOG_MAX_COLLECTIONS = 200;
export const MERCHANT_CATALOG_MAX_SERIALIZED_BYTES = 512_000;
export const MERCHANT_CATALOG_MAX_UNIT_PRICE = 999_999_999.99;

type PublishedProductBlock = Extract<Block, { type: "product" }>;

type ProductBlockCandidate = {
  block: PublishedProductBlock;
  source: MerchantCatalogBootstrapSource;
};

type ProductOccurrence = {
  product: MerchantCatalogProduct;
  source: MerchantCatalogBootstrapSource;
};

type CollectionOccurrence = {
  collection: MerchantCatalogCollection;
  source: MerchantCatalogBootstrapSource;
};

const PRODUCT_FIELDS = [
  ["code", "code"],
  ["name", "name"],
  ["description", "description"],
  ["price", "price"],
  ["imageUrl", "image_url"],
  ["thumbnailUrl", "thumbnail_url"],
  ["tag", "tag"],
  ["availability", "availability"],
] as const satisfies ReadonlyArray<readonly [keyof MerchantCatalogProduct, string]>;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function normalizeAvailability(value: unknown): MerchantCatalogAvailability {
  return value === "sold_out" || value === "hidden" ? value : "available";
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  value.forEach((item) => {
    const text = trimText(item);
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
}

function normalizePublishedProducts(value: unknown): MerchantCatalogProduct[] {
  return normalizeProductItems(Array.isArray(value) ? value : undefined)
    .filter((item) => isMeaningfulProductItem(item))
    .map((item) => ({
      ...item,
      availability: "available" as const,
    }));
}

function stableIdPart(value: string) {
  return Array.from(value)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-");
}

export function createMerchantCatalogCollectionId(blockId: string, viewport: MerchantCatalogViewport) {
  return `collection-${stableIdPart(blockId)}-${viewport}`;
}

function categoryId(name: string) {
  return `category-${stableIdPart(name)}`;
}

function childViewport(key: string, current: MerchantCatalogViewport): MerchantCatalogViewport {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey.includes("mobile") && normalizedKey.includes("plan")) return "mobile";
  if (key === "pagePlanConfig") return "desktop";
  return current;
}

function collectProductBlocks(
  value: unknown,
  viewport: MerchantCatalogViewport,
  candidates: ProductBlockCandidate[],
  visited: WeakSet<object>,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectProductBlocks(item, viewport, candidates, visited));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);

  const record = value as Record<string, unknown>;
  const blockId = trimText(record.id);
  if (record.type === "product" && blockId && record.props && typeof record.props === "object") {
    candidates.push({
      block: record as unknown as PublishedProductBlock,
      source: { blockId, viewport, occurrence: candidates.length },
    });
  }

  Object.entries(record).forEach(([key, child]) => {
    collectProductBlocks(child, childViewport(key, viewport), candidates, visited);
  });
}

function conflictValues<T extends string | string[]>(
  entries: Array<{ value: T; source: MerchantCatalogBootstrapSource }>,
) {
  const grouped = new Map<string, MerchantCatalogConflictValue>();
  entries.forEach(({ value, source }) => {
    const key = Array.isArray(value) ? JSON.stringify(value) : String(value);
    const existing = grouped.get(key);
    if (existing) {
      existing.sources.push(source);
    } else {
      grouped.set(key, { value, sources: [source] });
    }
  });
  return [...grouped.values()];
}

function emptyCatalog(): MerchantCatalog {
  return {
    revision: 1,
    updatedAt: "",
    pricePrefix: "",
    categories: [],
    products: [],
    collections: [],
  };
}

/** Normalize untrusted persisted catalog data without mutating the input. */
export function normalizeMerchantCatalog(value: unknown): MerchantCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyCatalog();
  const record = value as Record<string, unknown>;

  const products: MerchantCatalogProduct[] = [];
  const productIds = new Set<string>();
  if (Array.isArray(record.products)) {
    record.products.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const productRecord = item as Record<string, unknown>;
      const id = trimText(productRecord.id);
      if (!id || productIds.has(id)) return;
      productIds.add(id);
      products.push({
        id,
        code: trimText(productRecord.code),
        name: trimText(productRecord.name),
        description: trimText(productRecord.description),
        price: trimText(productRecord.price),
        imageUrl: trimText(productRecord.imageUrl),
        thumbnailUrl: trimText(productRecord.thumbnailUrl),
        tag: trimText(productRecord.tag),
        availability: normalizeAvailability(productRecord.availability),
      });
    });
  }

  const categories: MerchantCatalogCategory[] = [];
  const categoryIds = new Set<string>();
  if (Array.isArray(record.categories)) {
    record.categories.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const categoryRecord = item as Record<string, unknown>;
      const id = trimText(categoryRecord.id);
      const name = trimText(categoryRecord.name);
      if (!id || !name || categoryIds.has(id)) return;
      categoryIds.add(id);
      categories.push({
        id,
        name,
        productIds: uniqueStrings(categoryRecord.productIds).filter((productId) => productIds.has(productId)),
      });
    });
  }

  const collections: MerchantCatalogCollection[] = [];
  const collectionIds = new Set<string>();
  if (Array.isArray(record.collections)) {
    record.collections.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const collectionRecord = item as Record<string, unknown>;
      const id = trimText(collectionRecord.id);
      const blockId = trimText(collectionRecord.blockId);
      if (!id || !blockId || collectionIds.has(id)) return;
      collectionIds.add(id);
      const viewport = collectionRecord.viewport;
      collections.push({
        id,
        blockId,
        viewport: viewport === "desktop" || viewport === "mobile" ? viewport : "shared",
        productIds: uniqueStrings(collectionRecord.productIds).filter((productId) => productIds.has(productId)),
      });
    });
  }

  return {
    revision: normalizeRevision(record.revision),
    updatedAt: trimText(record.updatedAt),
    pricePrefix: trimText(record.pricePrefix),
    categories,
    products,
    collections,
  };
}

/**
 * Strict reader for already-versioned storage envelopes. Unlike the UI/API
 * normalizer, this never broadens an unknown availability or viewport into a
 * sellable/shared value; corruption must be recovered or surfaced.
 */
export function parseStrictMerchantCatalog(value: unknown): MerchantCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) <= 0 ||
    typeof record.updatedAt !== "string" ||
    !record.updatedAt.trim() ||
    typeof record.pricePrefix !== "string" ||
    !Array.isArray(record.products) ||
    !Array.isArray(record.categories) ||
    !Array.isArray(record.collections)
  ) {
    return null;
  }
  const rawProducts = record.products as unknown[];
  const rawCategories = record.categories as unknown[];
  const rawCollections = record.collections as unknown[];

  const productFields = [
    "id",
    "code",
    "name",
    "description",
    "price",
    "imageUrl",
    "thumbnailUrl",
    "tag",
  ] as const;
  if (
    !rawProducts.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const product = item as Record<string, unknown>;
      return (
        productFields.every((field) => typeof product[field] === "string") &&
        (product.availability === "available" ||
          product.availability === "sold_out" ||
          product.availability === "hidden")
      );
    }) ||
    !rawCategories.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const category = item as Record<string, unknown>;
      return (
        typeof category.id === "string" &&
        typeof category.name === "string" &&
        Array.isArray(category.productIds) &&
        category.productIds.every((productId) => typeof productId === "string")
      );
    }) ||
    !rawCollections.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const collection = item as Record<string, unknown>;
      return (
        typeof collection.id === "string" &&
        typeof collection.blockId === "string" &&
        (collection.viewport === "desktop" ||
          collection.viewport === "mobile" ||
          collection.viewport === "shared") &&
        Array.isArray(collection.productIds) &&
        collection.productIds.every((productId) => typeof productId === "string")
      );
    })
  ) {
    return null;
  }

  const catalog = normalizeMerchantCatalog(record);
  if (
    catalog.products.length !== rawProducts.length ||
    catalog.categories.length !== rawCategories.length ||
    catalog.collections.length !== rawCollections.length ||
    catalog.categories.some(
      (category, index) =>
        category.productIds.length !==
        ((rawCategories[index] as Record<string, unknown>).productIds as unknown[]).length,
    ) ||
    catalog.collections.some(
      (collection, index) =>
        collection.productIds.length !==
        ((rawCollections[index] as Record<string, unknown>).productIds as unknown[]).length,
    ) ||
    getMerchantCatalogValidationError(catalog)
  ) {
    return null;
  }
  const uniqueScopes = new Set(
    catalog.collections.map((collection) => `${collection.blockId}\u0001${collection.viewport}`),
  );
  if (uniqueScopes.size !== catalog.collections.length) return null;
  return catalog;
}

/** Stable JSON boundary for storage/API transport. */
export function serializeMerchantCatalog(value: unknown) {
  return JSON.stringify(normalizeMerchantCatalog(value));
}

/** Parses a JSON catalog, returning the normalized empty catalog on bad input. */
export function parseMerchantCatalog(value: unknown) {
  if (typeof value !== "string") return normalizeMerchantCatalog(value);
  try {
    return normalizeMerchantCatalog(JSON.parse(value));
  } catch {
    return emptyCatalog();
  }
}

/**
 * Keeps both the primary snapshot and its bounded recovery history small enough
 * for the shared pages storage. Mutations are checked again at the store
 * boundary so direct API callers cannot bypass UI maxlength attributes.
 */
export function parseMerchantCatalogUnitPrice(value: unknown): number | null {
  const raw = trimText(value);
  if (!/^(?:0|[1-9]\d*)(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MERCHANT_CATALOG_MAX_UNIT_PRICE) return null;
  return Number(parsed.toFixed(2));
}

export function getMerchantCatalogValidationError(value: unknown): string | null {
  const catalog = normalizeMerchantCatalog(value);
  if (catalog.products.some((product) => !product.id || !product.name)) {
    return "invalid_merchant_catalog_product";
  }
  if (catalog.products.some((product) => parseMerchantCatalogUnitPrice(product.price) === null)) {
    return "invalid_merchant_catalog_product_price";
  }
  if (
    catalog.collections.length > 0 &&
    catalog.products.some(
      (product) =>
        product.availability !== "hidden" &&
        !catalog.collections.some((collection) => collection.productIds.includes(product.id)),
    )
  ) {
    return "merchant_catalog_product_not_placed";
  }
  if (
    catalog.products.length > MERCHANT_CATALOG_MAX_PRODUCTS ||
    catalog.categories.length > MERCHANT_CATALOG_MAX_CATEGORIES ||
    catalog.collections.length > MERCHANT_CATALOG_MAX_COLLECTIONS ||
    catalog.pricePrefix.length > 16
  ) {
    return "merchant_catalog_limit_exceeded";
  }

  const productTooLarge = catalog.products.some(
    (product) =>
      product.id.length > 160 ||
      product.code.length > 120 ||
      product.name.length > 240 ||
      product.description.length > 4_000 ||
      product.price.length > 80 ||
      product.imageUrl.length > 2_048 ||
      product.thumbnailUrl.length > 2_048 ||
      product.tag.length > 120,
  );
  const categoryTooLarge = catalog.categories.some(
    (category) => category.id.length > 160 || category.name.length > 120,
  );
  const collectionTooLarge = catalog.collections.some(
    (collection) => collection.id.length > 200 || collection.blockId.length > 200,
  );
  if (productTooLarge || categoryTooLarge || collectionTooLarge) {
    return "merchant_catalog_limit_exceeded";
  }

  const serializedBytes = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
  return serializedBytes > MERCHANT_CATALOG_MAX_SERIALIZED_BYTES
    ? "merchant_catalog_limit_exceeded"
    : null;
}

export function resolveMerchantCatalogCollection(
  value: unknown,
  blockId: unknown,
  viewport?: unknown,
): MerchantCatalogCollection | null {
  const normalizedBlockId = trimText(blockId);
  if (!normalizedBlockId) return null;
  const catalog = normalizeMerchantCatalog(value);
  const candidates = catalog.collections.filter((collection) => collection.blockId === normalizedBlockId);
  if (candidates.length === 0) return null;
  const requestedViewport = viewport === "desktop" || viewport === "mobile" ? viewport : null;
  const exact = requestedViewport
    ? candidates.filter((collection) => collection.viewport === requestedViewport)
    : [];
  const shared = candidates.filter((collection) => collection.viewport === "shared");
  if (exact.length > 1 || shared.length > 1) return null;
  const chosen = requestedViewport
    ? exact[0] ?? shared[0]
    : shared[0] ?? (candidates.length === 1 ? candidates[0] : undefined);
  return chosen ? { ...chosen, productIds: [...chosen.productIds] } : null;
}

function referencedProductIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return uniqueStrings((value as Record<string, unknown>).productIds);
}

function hasUnknownProductReference(catalog: MerchantCatalog, productIds: string[]) {
  const known = new Set(catalog.products.map((product) => product.id));
  return productIds.some((productId) => !known.has(productId));
}

function syncCategoriesForProduct(
  categories: MerchantCatalogCategory[],
  product: MerchantCatalogProduct,
) {
  const next = categories.map((category) => ({
    ...category,
    productIds: category.productIds.filter((productId) => productId !== product.id),
  }));
  if (!product.tag) return next;
  const categoryIndex = next.findIndex((category) => category.name === product.tag);
  if (categoryIndex >= 0) {
    next[categoryIndex] = {
      ...next[categoryIndex]!,
      productIds: [...next[categoryIndex]!.productIds, product.id],
    };
    return next;
  }
  next.push({ id: categoryId(product.tag), name: product.tag, productIds: [product.id] });
  return next;
}

/** Applies one catalog-management action without mutating or versioning the input. */
export function applyMerchantCatalogMutation(
  value: unknown,
  mutation: MerchantCatalogMutation,
): MerchantCatalogMutationResult {
  const catalog = normalizeMerchantCatalog(value);

  if (mutation.action === "upsert_product") {
    if (!mutation.product || typeof mutation.product !== "object" || Array.isArray(mutation.product)) {
      return { ok: false, error: "invalid_merchant_catalog_product" };
    }
    const raw = mutation.product as Record<string, unknown>;
    if (!trimText(raw.id)) return { ok: false, error: "invalid_merchant_catalog_product_id" };
    const targetProductId = trimText(mutation.productId);
    if (targetProductId && targetProductId !== trimText(raw.id)) {
      return { ok: false, error: "merchant_catalog_product_id_immutable" };
    }
    if (targetProductId && !catalog.products.some((item) => item.id === targetProductId)) {
      return { ok: false, error: "merchant_catalog_product_not_found" };
    }
    if (
      raw.availability !== undefined &&
      raw.availability !== "available" &&
      raw.availability !== "sold_out" &&
      raw.availability !== "hidden"
    ) {
      return { ok: false, error: "invalid_merchant_catalog_availability" };
    }
    const product = normalizeMerchantCatalog({ products: [raw] }).products[0];
    if (!product) return { ok: false, error: "invalid_merchant_catalog_product" };
    if (!product.name) return { ok: false, error: "invalid_merchant_catalog_product" };
    if (parseMerchantCatalogUnitPrice(product.price) === null) {
      return { ok: false, error: "invalid_merchant_catalog_product_price" };
    }
    const productIndex = catalog.products.findIndex((item) => item.id === product.id);
    const isNewProduct = productIndex < 0;
    const collectionMembershipProvided = mutation.collectionIds !== undefined;
    if (collectionMembershipProvided && !Array.isArray(mutation.collectionIds)) {
      return { ok: false, error: "invalid_merchant_catalog_product_collections" };
    }
    if (isNewProduct && catalog.collections.length > 0 && !collectionMembershipProvided) {
      return { ok: false, error: "invalid_merchant_catalog_product_collections" };
    }
    const selectedCollectionIds = new Set(uniqueStrings(mutation.collectionIds));
    if (
      collectionMembershipProvided &&
      [...selectedCollectionIds].some(
        (collectionId) => !catalog.collections.some((collection) => collection.id === collectionId),
      )
    ) {
      return { ok: false, error: "merchant_catalog_collection_not_found" };
    }
    const effectivePlacementCount = collectionMembershipProvided
      ? selectedCollectionIds.size
      : catalog.collections.filter((collection) => collection.productIds.includes(product.id)).length;
    if (
      product.availability !== "hidden" &&
      catalog.collections.length > 0 &&
      effectivePlacementCount === 0
    ) {
      return { ok: false, error: "merchant_catalog_product_not_placed" };
    }
    const products = catalog.products.map((item) => ({ ...item }));
    if (productIndex >= 0) products[productIndex] = product;
    else products.push(product);
    return {
      ok: true,
      catalog: {
        ...catalog,
        products,
        categories: syncCategoriesForProduct(catalog.categories, product),
        collections: catalog.collections.map((collection) => ({
          ...collection,
          productIds: collectionMembershipProvided
            ? selectedCollectionIds.has(collection.id)
              ? collection.productIds.includes(product.id)
                ? [...collection.productIds]
                : [...collection.productIds, product.id]
              : collection.productIds.filter((productId) => productId !== product.id)
            : [...collection.productIds],
        })),
      },
    };
  }

  if (mutation.action === "delete_product") {
    const productId = trimText(mutation.productId);
    if (!productId) return { ok: false, error: "invalid_merchant_catalog_product_id" };
    if (!catalog.products.some((product) => product.id === productId)) {
      return { ok: false, error: "merchant_catalog_product_not_found" };
    }
    return {
      ok: true,
      catalog: {
        ...catalog,
        products: catalog.products.filter((product) => product.id !== productId),
        categories: catalog.categories.map((category) => ({
          ...category,
          productIds: category.productIds.filter((id) => id !== productId),
        })),
        collections: catalog.collections.map((collection) => ({
          ...collection,
          productIds: collection.productIds.filter((id) => id !== productId),
        })),
      },
    };
  }

  if (mutation.action === "set_availability") {
    const productId = trimText(mutation.productId);
    if (!productId) return { ok: false, error: "invalid_merchant_catalog_product_id" };
    const availability = mutation.availability;
    if (
      availability !== "available" &&
      availability !== "sold_out" &&
      availability !== "hidden"
    ) {
      return { ok: false, error: "invalid_merchant_catalog_availability" };
    }
    if (!catalog.products.some((product) => product.id === productId)) {
      return { ok: false, error: "merchant_catalog_product_not_found" };
    }
    if (
      availability !== "hidden" &&
      catalog.collections.length > 0 &&
      !catalog.collections.some((collection) => collection.productIds.includes(productId))
    ) {
      return { ok: false, error: "merchant_catalog_product_not_placed" };
    }
    return {
      ok: true,
      catalog: {
        ...catalog,
        products: catalog.products.map((product) =>
          product.id === productId ? { ...product, availability } : { ...product },
        ),
      },
    };
  }

  if (mutation.action === "upsert_category") {
    if (!mutation.category || typeof mutation.category !== "object" || Array.isArray(mutation.category)) {
      return { ok: false, error: "invalid_merchant_catalog_category" };
    }
    const raw = mutation.category as Record<string, unknown>;
    const id = trimText(raw.id);
    const name = trimText(raw.name);
    const productIds = referencedProductIds(raw);
    if (!id || !name) return { ok: false, error: "invalid_merchant_catalog_category" };
    if (catalog.categories.some((category) => category.id !== id && category.name === name)) {
      return { ok: false, error: "merchant_catalog_category_name_conflict" };
    }
    if (hasUnknownProductReference(catalog, productIds)) {
      return { ok: false, error: "merchant_catalog_product_reference_not_found" };
    }
    const category = { id, name, productIds } satisfies MerchantCatalogCategory;
    const categoryIndex = catalog.categories.findIndex((item) => item.id === id);
    const previousCategory = categoryIndex >= 0 ? catalog.categories[categoryIndex]! : null;
    const selectedProductIds = new Set(productIds);
    const previouslySelectedProductIds = new Set(previousCategory?.productIds ?? []);
    const categories = catalog.categories.map((item) => ({
      ...item,
      productIds:
        item.id === id
          ? [...productIds]
          : item.productIds.filter((productId) => !selectedProductIds.has(productId)),
    }));
    if (categoryIndex >= 0) categories[categoryIndex] = category;
    else categories.push(category);
    const products = catalog.products.map((product) => {
      if (selectedProductIds.has(product.id)) return { ...product, tag: name };
      if (
        previouslySelectedProductIds.has(product.id) ||
        (previousCategory && product.tag === previousCategory.name)
      ) {
        const remainingCategory = categories.find((item) => item.productIds.includes(product.id));
        return { ...product, tag: remainingCategory?.name ?? "" };
      }
      return { ...product };
    });
    return { ok: true, catalog: { ...catalog, categories, products } };
  }

  if (mutation.action === "delete_category") {
    const categoryIdValue = trimText(mutation.categoryId);
    if (!categoryIdValue) return { ok: false, error: "invalid_merchant_catalog_category_id" };
    const deletedCategory = catalog.categories.find((category) => category.id === categoryIdValue);
    if (!deletedCategory) {
      return { ok: false, error: "merchant_catalog_category_not_found" };
    }
    const categories = catalog.categories.filter((category) => category.id !== categoryIdValue);
    const deletedProductIds = new Set(deletedCategory.productIds);
    return {
      ok: true,
      catalog: {
        ...catalog,
        categories,
        products: catalog.products.map((product) => {
          if (!deletedProductIds.has(product.id) && product.tag !== deletedCategory.name) return { ...product };
          const remainingCategory = categories.find((category) => category.productIds.includes(product.id));
          return { ...product, tag: remainingCategory?.name ?? "" };
        }),
      },
    };
  }

  if (mutation.action === "upsert_collection") {
    if (!mutation.collection || typeof mutation.collection !== "object" || Array.isArray(mutation.collection)) {
      return { ok: false, error: "invalid_merchant_catalog_collection" };
    }
    const raw = mutation.collection as Record<string, unknown>;
    const id = trimText(raw.id);
    const blockId = trimText(raw.blockId);
    const productIds = referencedProductIds(raw);
    if (!id || !blockId) return { ok: false, error: "invalid_merchant_catalog_collection" };
    if (raw.viewport !== "desktop" && raw.viewport !== "mobile" && raw.viewport !== "shared") {
      return { ok: false, error: "invalid_merchant_catalog_viewport" };
    }
    if (
      catalog.collections.some(
        (collection) =>
          collection.id !== id &&
          collection.blockId === blockId &&
          collection.viewport === raw.viewport,
      )
    ) {
      return { ok: false, error: "merchant_catalog_collection_scope_conflict" };
    }
    if (hasUnknownProductReference(catalog, productIds)) {
      return { ok: false, error: "merchant_catalog_product_reference_not_found" };
    }
    const collection = { id, blockId, viewport: raw.viewport, productIds } satisfies MerchantCatalogCollection;
    const collectionIndex = catalog.collections.findIndex((item) => item.id === id);
    const collections = catalog.collections.map((item) => ({ ...item, productIds: [...item.productIds] }));
    if (collectionIndex >= 0) collections[collectionIndex] = collection;
    else collections.push(collection);
    const nextCatalog = { ...catalog, collections };
    if (getMerchantCatalogValidationError(nextCatalog) === "merchant_catalog_product_not_placed") {
      return { ok: false, error: "merchant_catalog_product_not_placed" };
    }
    return { ok: true, catalog: nextCatalog };
  }

  if (mutation.action === "delete_collection") {
    const collectionIdValue = trimText(mutation.collectionId);
    if (!collectionIdValue) return { ok: false, error: "invalid_merchant_catalog_collection_id" };
    if (!catalog.collections.some((collection) => collection.id === collectionIdValue)) {
      return { ok: false, error: "merchant_catalog_collection_not_found" };
    }
    const nextCatalog = {
      ...catalog,
      collections: catalog.collections.filter((collection) => collection.id !== collectionIdValue),
    };
    if (getMerchantCatalogValidationError(nextCatalog) === "merchant_catalog_product_not_placed") {
      return { ok: false, error: "merchant_catalog_product_not_placed" };
    }
    return { ok: true, catalog: nextCatalog };
  }

  if (typeof mutation.pricePrefix !== "string") {
    return { ok: false, error: "invalid_merchant_catalog_price_prefix" };
  }
  return { ok: true, catalog: { ...catalog, pricePrefix: mutation.pricePrefix.trim() } };
}

/**
 * Builds an initial operating catalog from currently published product blocks.
 * Any ambiguity blocks the result instead of choosing desktop, mobile, or an
 * arbitrary block occurrence.
 */
export function bootstrapMerchantCatalogFromPublishedBlocks(
  input: MerchantCatalogBootstrapInput,
): MerchantCatalogBootstrapResult {
  const candidates: ProductBlockCandidate[] = [];
  const conflicts: MerchantCatalogConflict[] = [];

  const sources: Array<{ field: "blocks" | "desktopBlocks" | "mobileBlocks"; value: unknown; viewport: MerchantCatalogViewport }> = [
    { field: "blocks", value: input?.blocks, viewport: "shared" },
    { field: "desktopBlocks", value: input?.desktopBlocks, viewport: "desktop" },
    { field: "mobileBlocks", value: input?.mobileBlocks, viewport: "mobile" },
  ];
  sources.forEach(({ field, value, viewport }) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      conflicts.push({
        code: "invalid_input",
        field,
        values: [{ value: trimText(value) || typeof value, sources: [] }],
      });
      return;
    }
    collectProductBlocks(value, viewport, candidates, new WeakSet<object>());
  });

  const prefixValues = conflictValues(
    candidates.map(({ block, source }) => ({ value: trimText(block.props.productPricePrefix), source })),
  );
  if (prefixValues.length > 1) {
    conflicts.push({ code: "catalog_field_conflict", field: "price_prefix", values: prefixValues });
  }
  const categoryOptionValues = conflictValues(
    candidates.map(({ block, source }) => ({
      value: uniqueStrings(block.props.productTagOptions),
      source,
    })),
  );
  if (categoryOptionValues.length > 1) {
    conflicts.push({ code: "catalog_field_conflict", field: "category_options", values: categoryOptionValues });
  }

  const productsById = new Map<string, ProductOccurrence[]>();
  const collectionsById = new Map<string, CollectionOccurrence[]>();
  candidates.forEach(({ block, source }) => {
    const productIds: string[] = [];
    const seenInCollection = new Set<string>();
    normalizePublishedProducts(block.props.products).forEach((product) => {
      if (!seenInCollection.has(product.id)) {
        seenInCollection.add(product.id);
        productIds.push(product.id);
      }
      const occurrences = productsById.get(product.id) ?? [];
      occurrences.push({ product, source });
      productsById.set(product.id, occurrences);
    });

    const collection: MerchantCatalogCollection = {
      id: createMerchantCatalogCollectionId(block.id, source.viewport),
      blockId: block.id,
      viewport: source.viewport,
      productIds,
    };
    const collectionOccurrences = collectionsById.get(collection.id) ?? [];
    collectionOccurrences.push({ collection, source });
    collectionsById.set(collection.id, collectionOccurrences);
  });

  const products: MerchantCatalogProduct[] = [];
  productsById.forEach((occurrences, productId) => {
    let productHasConflict = false;
    const missingNameOccurrences = occurrences.filter(({ product }) => !product.name);
    if (missingNameOccurrences.length > 0) {
      productHasConflict = true;
      conflicts.push({
        code: "product_field_conflict",
        field: "name_required",
        productId,
        values: conflictValues(
          missingNameOccurrences.map(({ product, source }) => ({ value: product.name, source })),
        ),
      });
    }
    const invalidPriceOccurrences = occurrences.filter(
      ({ product }) => parseMerchantCatalogUnitPrice(product.price) === null,
    );
    if (invalidPriceOccurrences.length > 0) {
      productHasConflict = true;
      conflicts.push({
        code: "product_field_conflict",
        field: "price_invalid",
        productId,
        values: conflictValues(
          invalidPriceOccurrences.map(({ product, source }) => ({ value: product.price, source })),
        ),
      });
    }
    PRODUCT_FIELDS.forEach(([property, field]) => {
      const values = conflictValues(
        occurrences.map(({ product, source }) => ({ value: String(product[property]), source })),
      );
      if (values.length <= 1) return;
      productHasConflict = true;
      conflicts.push({ code: "product_field_conflict", field, productId, values });
    });
    if (!productHasConflict) products.push({ ...occurrences[0]!.product });
  });

  const collections: MerchantCatalogCollection[] = [];
  collectionsById.forEach((occurrences, id) => {
    const values = conflictValues(
      occurrences.map(({ collection, source }) => ({ value: collection.productIds, source })),
    );
    if (values.length > 1) {
      conflicts.push({
        code: "collection_conflict",
        field: "product_ids",
        collectionId: id,
        values,
      });
      return;
    }
    collections.push({ ...occurrences[0]!.collection, productIds: [...occurrences[0]!.collection.productIds] });
  });

  if (conflicts.length > 0) {
    return { ok: false, catalog: null, conflicts, sourceBlockCount: candidates.length };
  }

  const categoriesByName = new Map<string, MerchantCatalogCategory>();
  const categoryOptions = categoryOptionValues[0]?.value;
  if (Array.isArray(categoryOptions)) {
    categoryOptions.forEach((name) => {
      categoriesByName.set(name, { id: categoryId(name), name, productIds: [] });
    });
  }
  products.forEach((product) => {
    if (!product.tag) return;
    const category = categoriesByName.get(product.tag) ?? {
      id: categoryId(product.tag),
      name: product.tag,
      productIds: [],
    };
    if (!category.productIds.includes(product.id)) category.productIds.push(product.id);
    categoriesByName.set(product.tag, category);
  });

  const catalog = normalizeMerchantCatalog({
    revision: input?.revision,
    updatedAt: input?.updatedAt,
    pricePrefix: prefixValues[0]?.value ?? "",
    categories: [...categoriesByName.values()],
    products,
    collections,
  });
  return { ok: true, catalog, conflicts: [], sourceBlockCount: candidates.length };
}
