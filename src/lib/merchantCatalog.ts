import type { Block } from "@/data/homeBlocks";
import { MERCHANT_ID_REGEX } from "@/lib/merchantIdRules";
import {
  isMeaningfulProductItem,
  normalizeProductCode,
  normalizeProductItems,
} from "@/lib/productBlock";

export type MerchantCatalogAvailability = "available" | "sold_out" | "hidden";
export type MerchantCatalogViewport = "desktop" | "mobile" | "shared";

export type MerchantCatalogBrowsingRules = {
  searchEnabled: boolean;
  searchPlaceholder: string;
  hideUnselectedCategory: boolean;
  groupByCategory: boolean;
};

export type MerchantCatalogTarget = {
  blockId: string;
  viewport: Exclude<MerchantCatalogViewport, "shared">;
  productIds?: string[];
  browsingRules?: MerchantCatalogBrowsingRules;
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
  browsingRules?: MerchantCatalogBrowsingRules;
};

export type MerchantCatalog = {
  revision: number;
  updatedAt: string;
  pricePrefix: string;
  categories: MerchantCatalogCategory[];
  products: MerchantCatalogProduct[];
  collections: MerchantCatalogCollection[];
};

export const MERCHANT_CATALOG_CHANGED_EVENT = "faolla:merchant-catalog-changed";

export type MerchantCatalogChangedEventDetail = {
  siteId: string;
  revision: number;
};

export function createMerchantCatalogRuntimeContextKey(
  siteId: string,
  blockId: string,
  viewport: unknown,
) {
  const normalizedSiteId = String(siteId ?? "").trim();
  const normalizedBlockId = String(blockId ?? "").trim();
  if (
    !normalizedBlockId ||
    (viewport !== "desktop" && viewport !== "mobile")
  ) {
    return "";
  }
  return JSON.stringify([normalizedSiteId, normalizedBlockId, viewport]);
}

export function isMerchantCatalogRuntimeContextCurrent(
  resolvedContextKey: string,
  currentContextKey: string,
) {
  return Boolean(currentContextKey) && resolvedContextKey === currentContextKey;
}

/**
 * Keep the browser refresh signal deliberately small: it identifies only the
 * merchant and catalog revision, and never carries products or customer data.
 */
export function parseMerchantCatalogChangedEventDetail(
  value: unknown,
): MerchantCatalogChangedEventDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const siteId = typeof record.siteId === "string" ? record.siteId.trim() : "";
  const revision = Number(record.revision);
  if (!MERCHANT_ID_REGEX.test(siteId) || !Number.isSafeInteger(revision) || revision < 0) {
    return null;
  }
  return { siteId, revision };
}

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

export type MerchantCatalogBootstrapResolutionTargetKey = string;

export type MerchantCatalogBootstrapResolutionChoice = {
  choiceId: string;
  value: string | string[];
  sources: MerchantCatalogBootstrapSource[];
};

export type MerchantCatalogBootstrapResolutionTarget = {
  targetKey: MerchantCatalogBootstrapResolutionTargetKey;
  scope: "catalog" | "product" | "collection";
  field: string;
  productId?: string;
  collectionId?: string;
  entityLabel?: string;
  relatedProducts?: Array<{ productId: string; entityLabel: string }>;
  reasons: string[];
  choices: MerchantCatalogBootstrapResolutionChoice[];
  allowCustom: boolean;
};

export type MerchantCatalogBootstrapResolutionSelection =
  | { targetKey: MerchantCatalogBootstrapResolutionTargetKey; choiceId: string }
  | { targetKey: MerchantCatalogBootstrapResolutionTargetKey; customValue: string };

export type MerchantCatalogBootstrapResolutionPlan = {
  version: 1;
  selections: MerchantCatalogBootstrapResolutionSelection[];
  excludedProductIds: string[];
};

export type MerchantCatalogBootstrapResolutionError =
  | "merchant_catalog_bootstrap_resolution_invalid"
  | "merchant_catalog_bootstrap_resolution_incomplete"
  | "merchant_catalog_bootstrap_unresolved_conflict"
  | "merchant_catalog_bootstrap_validation_failed";

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
  resolutionTargets: MerchantCatalogBootstrapResolutionTarget[];
};

export type MerchantCatalogBootstrapResolutionResult = MerchantCatalogBootstrapResult & {
  error?: MerchantCatalogBootstrapResolutionError;
  errorTargetKey?: MerchantCatalogBootstrapResolutionTargetKey;
  validationError?: string;
};

export type MerchantCatalogMutation =
  | { action: "upsert_product"; product: unknown; productId?: unknown; collectionIds?: unknown }
  | { action: "bulk_import_products"; items: unknown }
  | { action: "bulk_set_product_images"; items: unknown; merchantId: unknown }
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

export type MerchantCatalogProductImportAction = "create" | "update" | "unchanged";

export type MerchantCatalogProductImportRow = {
  rowIndex: number;
  code: string;
  normalizedCode: string;
  action: MerchantCatalogProductImportAction;
  productId: string;
};

export type MerchantCatalogProductImportSummary = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
};

export type MerchantCatalogProductImportPlan =
  | {
      ok: true;
      catalog: MerchantCatalog;
      rows: MerchantCatalogProductImportRow[];
      summary: MerchantCatalogProductImportSummary;
    }
  | { ok: false; error: string; rowIndex?: number };

export type MerchantCatalogProductImageMatchStatus = "matched" | "unmatched" | "duplicate";

export type MerchantCatalogProductImageMatchRow = {
  rowIndex: number;
  fileName: string;
  code: string;
  normalizedCode: string;
  status: MerchantCatalogProductImageMatchStatus;
  productId?: string;
};

export type MerchantCatalogProductImageMatchSummary = {
  total: number;
  matched: number;
  unmatched: number;
  duplicates: number;
};

export type MerchantCatalogProductImageMatchPlan =
  | {
      ok: true;
      rows: MerchantCatalogProductImageMatchRow[];
      summary: MerchantCatalogProductImageMatchSummary;
    }
  | {
      ok: false;
      error: string;
      rowIndex?: number;
      rows?: MerchantCatalogProductImageMatchRow[];
      summary?: MerchantCatalogProductImageMatchSummary;
    };

export type MerchantCatalogProductImageImportAction =
  | "update"
  | "unchanged"
  | "unmatched"
  | "duplicate";

export type MerchantCatalogProductImageImportRow = Omit<MerchantCatalogProductImageMatchRow, "status"> & {
  action: MerchantCatalogProductImageImportAction;
  imageUrl: string;
  thumbnailUrl: string;
};

export type MerchantCatalogProductImageImportSummary = MerchantCatalogProductImageMatchSummary & {
  updated: number;
  unchanged: number;
};

export type MerchantCatalogProductImageImportPlan =
  | {
      ok: true;
      catalog: MerchantCatalog;
      rows: MerchantCatalogProductImageImportRow[];
      summary: MerchantCatalogProductImageImportSummary;
    }
  | {
      ok: false;
      error: string;
      rowIndex?: number;
      rows?: MerchantCatalogProductImageImportRow[] | MerchantCatalogProductImageMatchRow[];
      summary?: MerchantCatalogProductImageImportSummary | MerchantCatalogProductImageMatchSummary;
    };

export type MerchantCatalogProductImageAssetReference = {
  url: string;
  bucket: "page-assets" | "assets" | "uploads" | "public";
  objectPath: string;
};

export type MerchantCatalogPreparedProductImageImportItem = {
  rowIndex: number;
  fileName: string;
  code: string;
  normalizedCode: string;
  imageUrl: string;
  thumbnailUrl: string;
  imageAsset: MerchantCatalogProductImageAssetReference;
  thumbnailAsset?: MerchantCatalogProductImageAssetReference;
};

export type MerchantCatalogPreparedProductImageImport =
  | { ok: true; items: MerchantCatalogPreparedProductImageImportItem[] }
  | { ok: false; error: string; rowIndex?: number };

export const MERCHANT_CATALOG_MAX_PRODUCTS = 1_000;
export const MERCHANT_CATALOG_MAX_CATEGORIES = 200;
export const MERCHANT_CATALOG_MAX_COLLECTIONS = 200;
export const MERCHANT_CATALOG_MAX_SERIALIZED_BYTES = 512_000;
export const MERCHANT_CATALOG_MAX_UNIT_PRICE = 999_999_999.99;
export const MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_IMPORT_ITEMS = 100;
export const MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH = 160;

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

function normalizeMerchantCatalogBrowsingRules(value: unknown): MerchantCatalogBrowsingRules | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.searchEnabled !== "boolean" ||
    typeof record.searchPlaceholder !== "string" ||
    typeof record.hideUnselectedCategory !== "boolean" ||
    typeof record.groupByCategory !== "boolean"
  ) {
    return undefined;
  }
  return {
    searchEnabled: record.searchEnabled,
    searchPlaceholder: record.searchPlaceholder.trim(),
    hideUnselectedCategory: record.hideUnselectedCategory,
    groupByCategory: record.groupByCategory,
  };
}

function publishedBrowsingRules(block: PublishedProductBlock): MerchantCatalogBrowsingRules {
  return {
    searchEnabled: block.props.productSearchEnabled !== false,
    searchPlaceholder: trimText(block.props.productSearchPlaceholder),
    hideUnselectedCategory: block.props.productTagHideUnselected !== false,
    groupByCategory: block.props.productGroupByTag === true,
  };
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

function bootstrapProductEntityLabel(productId: string, occurrences: ProductOccurrence[]) {
  const names = occurrences.map(({ product }) => product.name.trim());
  if (names.length > 0 && names.every(Boolean) && new Set(names).size === 1) return names[0]!;
  const codes = occurrences.map(({ product }) => product.code.trim());
  if (codes.length > 0 && codes.every(Boolean) && new Set(codes).size === 1) return codes[0]!;
  return productId;
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

function bootstrapResolutionHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    first = Math.imul(first ^ codeUnit, 0x01000193);
    second = Math.imul(second ^ codeUnit, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function resolutionValueKey(value: string | string[]) {
  return Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(String(value));
}

function resolutionTargetIdentity(conflict: MerchantCatalogConflict): {
  scope: MerchantCatalogBootstrapResolutionTarget["scope"];
  field: string;
  entityId: string;
} | null {
  if (conflict.code === "invalid_input") return null;
  if (conflict.code === "catalog_field_conflict") {
    return { scope: "catalog", field: conflict.field, entityId: "" };
  }
  if (conflict.code === "product_field_conflict" && conflict.productId) {
    const field = conflict.field === "name_required"
      ? "name"
      : conflict.field === "price_invalid"
        ? "price"
        : conflict.field;
    return { scope: "product", field, entityId: conflict.productId };
  }
  if (conflict.code === "collection_conflict" && conflict.collectionId) {
    return { scope: "collection", field: conflict.field, entityId: conflict.collectionId };
  }
  return null;
}

function createResolutionTargetKey(
  scope: MerchantCatalogBootstrapResolutionTarget["scope"],
  entityId: string,
  field: string,
): MerchantCatalogBootstrapResolutionTargetKey {
  return JSON.stringify([scope, entityId, field]);
}

function isValidResolutionCandidate(
  field: string,
  reasons: string[],
  value: string | string[],
) {
  if (field === "name" && reasons.includes("name_required")) {
    return typeof value === "string" && Boolean(value.trim());
  }
  if (field === "price" && reasons.includes("price_invalid")) {
    return typeof value === "string" && parseMerchantCatalogUnitPrice(value) !== null;
  }
  if (field === "search_placeholder_too_long") {
    return typeof value === "string" && value.trim().length <= MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH;
  }
  return true;
}

function buildBootstrapResolutionTargets(
  conflicts: MerchantCatalogConflict[],
  productLabels: ReadonlyMap<string, string> = new Map(),
) {
  const targets = new Map<MerchantCatalogBootstrapResolutionTargetKey, MerchantCatalogBootstrapResolutionTarget>();
  conflicts.forEach((conflict) => {
    const identity = resolutionTargetIdentity(conflict);
    if (!identity) return;
    const targetKey = createResolutionTargetKey(identity.scope, identity.entityId, identity.field);
    const existing = targets.get(targetKey);
    const target: MerchantCatalogBootstrapResolutionTarget = existing ?? {
      targetKey,
      scope: identity.scope,
      field: identity.field,
      ...(identity.scope === "product" ? { productId: identity.entityId } : {}),
      ...(identity.scope === "collection" ? { collectionId: identity.entityId } : {}),
      ...(identity.scope === "product"
        ? { entityLabel: productLabels.get(identity.entityId) ?? identity.entityId }
        : {}),
      reasons: [],
      choices: [],
      allowCustom: false,
    };
    if (!target.reasons.includes(conflict.field)) target.reasons.push(conflict.field);
    target.allowCustom = target.reasons.some((reason) =>
      reason === "name_required" ||
      reason === "price_invalid" ||
      reason === "search_placeholder_too_long"
    );
    const choicesByValue = new Map(target.choices.map((choice) => [resolutionValueKey(choice.value), choice]));
    conflict.values.forEach((entry) => {
      const valueKey = resolutionValueKey(entry.value);
      const prior = choicesByValue.get(valueKey);
      if (prior) {
        const knownSources = new Set(prior.sources.map((source) => JSON.stringify(source)));
        entry.sources.forEach((source) => {
          const sourceKey = JSON.stringify(source);
          if (!knownSources.has(sourceKey)) {
            knownSources.add(sourceKey);
            prior.sources.push(source);
          }
        });
        return;
      }
      const choice: MerchantCatalogBootstrapResolutionChoice = {
        choiceId: `choice-${bootstrapResolutionHash(`${targetKey}\u0000${valueKey}`)}`,
        value: Array.isArray(entry.value) ? [...entry.value] : entry.value,
        sources: entry.sources.map((source) => ({ ...source })),
      };
      target.choices.push(choice);
      choicesByValue.set(valueKey, choice);
    });
    targets.set(targetKey, target);
  });

  return [...targets.values()].map((target) => {
    const choices = target.choices.filter((choice) =>
      isValidResolutionCandidate(target.field, target.reasons, choice.value)
    );
    if (target.scope !== "collection" || target.field !== "product_ids") {
      return { ...target, choices };
    }
    const relatedProductIds: string[] = [];
    const seenProductIds = new Set<string>();
    choices.forEach((choice) => {
      if (!Array.isArray(choice.value)) return;
      choice.value.forEach((productId) => {
        if (!productId || seenProductIds.has(productId)) return;
        seenProductIds.add(productId);
        relatedProductIds.push(productId);
      });
    });
    return {
      ...target,
      choices,
      relatedProducts: relatedProductIds.map((productId) => ({
        productId,
        entityLabel: productLabels.get(productId) ?? productId,
      })),
    };
  });
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
      const browsingRules = normalizeMerchantCatalogBrowsingRules(collectionRecord.browsingRules);
      collections.push({
        id,
        blockId,
        viewport: viewport === "desktop" || viewport === "mobile" ? viewport : "shared",
        productIds: uniqueStrings(collectionRecord.productIds).filter((productId) => productIds.has(productId)),
        ...(browsingRules ? { browsingRules } : {}),
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
      const hasBrowsingRules = Object.prototype.hasOwnProperty.call(collection, "browsingRules");
      const browsingRules = hasBrowsingRules
        ? normalizeMerchantCatalogBrowsingRules(collection.browsingRules)
        : undefined;
      return (
        typeof collection.id === "string" &&
        typeof collection.blockId === "string" &&
        (collection.viewport === "desktop" ||
          collection.viewport === "mobile" ||
          collection.viewport === "shared") &&
        Array.isArray(collection.productIds) &&
        collection.productIds.every((productId) => typeof productId === "string") &&
        (!hasBrowsingRules ||
          Boolean(
            browsingRules &&
              browsingRules.searchPlaceholder.length <= MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH,
          ))
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
    (collection) =>
      collection.id.length > 200 ||
      collection.blockId.length > 200 ||
      (collection.browsingRules?.searchPlaceholder.length ?? 0) >
        MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH,
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
  return chosen
    ? {
        ...chosen,
        productIds: [...chosen.productIds],
        ...(chosen.browsingRules ? { browsingRules: { ...chosen.browsingRules } } : {}),
      }
    : null;
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
  const baseId = categoryId(product.tag);
  let id = baseId;
  let suffix = 2;
  while (next.some((category) => category.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  next.push({ id, name: product.tag, productIds: [product.id] });
  return next;
}

function importProductIdHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    first = Math.imul(first ^ codeUnit, 0x01000193);
    second = Math.imul(second ^ codeUnit, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function createImportedProductId(normalizedCode: string, usedIds: Set<string>) {
  const baseId = `import-product-${importProductIdHash(normalizedCode)}`;
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function merchantCatalogProductsEqual(
  left: MerchantCatalogProduct,
  right: MerchantCatalogProduct,
) {
  return (
    left.id === right.id &&
    left.code === right.code &&
    left.name === right.name &&
    left.description === right.description &&
    left.price === right.price &&
    left.imageUrl === right.imageUrl &&
    left.thumbnailUrl === right.thumbnailUrl &&
    left.tag === right.tag &&
    left.availability === right.availability
  );
}

/**
 * Builds an all-or-nothing product import without mutating or versioning the
 * catalog. Both browser previews and server mutations use this exact planner.
 */
export function planMerchantCatalogProductImport(
  value: unknown,
  items: unknown,
): MerchantCatalogProductImportPlan {
  const catalog = normalizeMerchantCatalog(value);
  if (!Array.isArray(items)) {
    return { ok: false, error: "invalid_merchant_catalog_import_items" };
  }
  if (items.length === 0) {
    return { ok: false, error: "invalid_merchant_catalog_import_items" };
  }
  if (items.length > MERCHANT_CATALOG_MAX_PRODUCTS) {
    return { ok: false, error: "merchant_catalog_limit_exceeded" };
  }

  const existingByCode = new Map<string, MerchantCatalogProduct>();
  for (const product of catalog.products) {
    const normalizedCode = normalizeProductCode(product.code);
    if (!normalizedCode) continue;
    if (existingByCode.has(normalizedCode)) {
      return { ok: false, error: "merchant_catalog_existing_duplicate_code" };
    }
    existingByCode.set(normalizedCode, product);
  }

  const importedCodes = new Set<string>();
  const importTextEncoder = new TextEncoder();
  let importedFieldBytes = 2;
  const importedRows: Array<{
    rowIndex: number;
    code: string;
    normalizedCode: string;
    raw: Record<string, unknown>;
  }> = [];
  for (let rowIndex = 0; rowIndex < items.length; rowIndex += 1) {
    const item = items[rowIndex];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "invalid_merchant_catalog_import_row", rowIndex };
    }
    const raw = item as Record<string, unknown>;
    for (const field of ["code", "name", "description", "price", "tag"] as const) {
      const fieldValue = typeof raw[field] === "string" ? raw[field] : "";
      if (fieldValue.length > MERCHANT_CATALOG_MAX_SERIALIZED_BYTES) {
        return { ok: false, error: "merchant_catalog_limit_exceeded", rowIndex };
      }
      importedFieldBytes += importTextEncoder.encode(fieldValue).byteLength + field.length + 6;
      if (importedFieldBytes > MERCHANT_CATALOG_MAX_SERIALIZED_BYTES) {
        return { ok: false, error: "merchant_catalog_limit_exceeded", rowIndex };
      }
    }
    const code = trimText(raw.code);
    const normalizedCode = normalizeProductCode(code);
    if (!code || !normalizedCode) {
      return { ok: false, error: "invalid_merchant_catalog_import_code", rowIndex };
    }
    if (importedCodes.has(normalizedCode)) {
      return { ok: false, error: "merchant_catalog_import_duplicate_code", rowIndex };
    }
    importedCodes.add(normalizedCode);
    importedRows.push({ rowIndex, code, normalizedCode, raw });
  }

  const products = catalog.products.map((product) => ({ ...product }));
  let categories = catalog.categories.map((category) => ({
    ...category,
    productIds: [...category.productIds],
  }));
  const usedProductIds = new Set(products.map((product) => product.id));
  const rows: MerchantCatalogProductImportRow[] = [];
  const summary: MerchantCatalogProductImportSummary = {
    total: importedRows.length,
    created: 0,
    updated: 0,
    unchanged: 0,
  };

  for (const imported of importedRows) {
    const name = trimText(imported.raw.name);
    const description = trimText(imported.raw.description);
    const price = trimText(imported.raw.price);
    const tag = trimText(imported.raw.tag);
    const existing = existingByCode.get(imported.normalizedCode);

    if (price && parseMerchantCatalogUnitPrice(price) === null) {
      return {
        ok: false,
        error: "invalid_merchant_catalog_import_product_price",
        rowIndex: imported.rowIndex,
      };
    }

    if (existing) {
      const product: MerchantCatalogProduct = {
        ...existing,
        code: imported.code,
        name: name || existing.name,
        description: description || existing.description,
        price: price || existing.price,
        tag: tag || existing.tag,
      };
      const productIndex = products.findIndex((candidate) => candidate.id === existing.id);
      const action: MerchantCatalogProductImportAction = merchantCatalogProductsEqual(existing, product)
        ? "unchanged"
        : "update";
      if (action === "update") {
        products[productIndex] = product;
        if (product.tag !== existing.tag) categories = syncCategoriesForProduct(categories, product);
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
      rows.push({
        rowIndex: imported.rowIndex,
        code: imported.code,
        normalizedCode: imported.normalizedCode,
        action,
        productId: product.id,
      });
      continue;
    }

    if (!name) {
      return {
        ok: false,
        error: "invalid_merchant_catalog_import_product_name",
        rowIndex: imported.rowIndex,
      };
    }
    if (!price || parseMerchantCatalogUnitPrice(price) === null) {
      return {
        ok: false,
        error: "invalid_merchant_catalog_import_product_price",
        rowIndex: imported.rowIndex,
      };
    }

    const product: MerchantCatalogProduct = {
      id: createImportedProductId(imported.normalizedCode, usedProductIds),
      code: imported.code,
      name,
      description,
      price,
      imageUrl: "",
      thumbnailUrl: "",
      tag,
      availability: "hidden",
    };
    usedProductIds.add(product.id);
    products.push(product);
    if (tag) categories = syncCategoriesForProduct(categories, product);
    summary.created += 1;
    rows.push({
      rowIndex: imported.rowIndex,
      code: imported.code,
      normalizedCode: imported.normalizedCode,
      action: "create",
      productId: product.id,
    });
  }

  const nextCatalog: MerchantCatalog = {
    ...catalog,
    products,
    categories,
    collections: catalog.collections.map((collection) => ({
      ...collection,
      productIds: [...collection.productIds],
    })),
  };
  const validationError = getMerchantCatalogValidationError(nextCatalog);
  if (validationError) return { ok: false, error: validationError };
  return { ok: true, catalog: nextCatalog, rows, summary };
}

function productImageFileCode(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function readProductImageFileNames(value: unknown):
  | {
      ok: true;
      rows: Array<{ rowIndex: number; fileName: string; code: string; normalizedCode: string }>;
    }
  | { ok: false; error: string; rowIndex?: number } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "invalid_merchant_catalog_image_import_items" };
  }
  if (value.length > MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_IMPORT_ITEMS) {
    return { ok: false, error: "merchant_catalog_image_import_limit_exceeded" };
  }

  const encoder = new TextEncoder();
  let inputBytes = 2;
  const rows: Array<{ rowIndex: number; fileName: string; code: string; normalizedCode: string }> = [];
  for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
    const rawFileName = value[rowIndex];
    if (typeof rawFileName !== "string") {
      return { ok: false, error: "invalid_merchant_catalog_image_file_name", rowIndex };
    }
    const fileName = rawFileName.trim();
    inputBytes += encoder.encode(fileName).byteLength + 4;
    if (
      !fileName ||
      fileName.length > 255 ||
      inputBytes > MERCHANT_CATALOG_MAX_SERIALIZED_BYTES ||
      /[\\/\u0000-\u001f]/.test(fileName)
    ) {
      return { ok: false, error: "invalid_merchant_catalog_image_file_name", rowIndex };
    }
    const code = productImageFileCode(fileName).trim();
    const normalizedCode = normalizeProductCode(code);
    if (!code || !normalizedCode) {
      return { ok: false, error: "invalid_merchant_catalog_image_file_name", rowIndex };
    }
    rows.push({ rowIndex, fileName, code, normalizedCode });
  }
  return { ok: true, rows };
}

/**
 * Matches filenames before any upload occurs. This is the single filename to
 * product matching boundary shared by preview and the persisted mutation.
 */
export function planMerchantCatalogProductImageMatches(
  value: unknown,
  fileNames: unknown,
): MerchantCatalogProductImageMatchPlan {
  const catalog = normalizeMerchantCatalog(value);
  const parsed = readProductImageFileNames(fileNames);
  if (!parsed.ok) return parsed;

  const productsByCode = new Map<string, MerchantCatalogProduct[]>();
  for (const product of catalog.products) {
    const normalizedCode = normalizeProductCode(product.code);
    if (!normalizedCode) continue;
    const products = productsByCode.get(normalizedCode) ?? [];
    products.push(product);
    productsByCode.set(normalizedCode, products);
  }
  const importedCodeCounts = new Map<string, number>();
  let importedDuplicateRowIndex: number | undefined;
  const seenCodes = new Set<string>();
  for (const row of parsed.rows) {
    importedCodeCounts.set(row.normalizedCode, (importedCodeCounts.get(row.normalizedCode) ?? 0) + 1);
    if (seenCodes.has(row.normalizedCode) && importedDuplicateRowIndex === undefined) {
      importedDuplicateRowIndex = row.rowIndex;
    }
    seenCodes.add(row.normalizedCode);
  }

  let existingDuplicateRowIndex: number | undefined;
  const rows = parsed.rows.map<MerchantCatalogProductImageMatchRow>((row) => {
    const candidates = productsByCode.get(row.normalizedCode) ?? [];
    const duplicate = (importedCodeCounts.get(row.normalizedCode) ?? 0) > 1 || candidates.length > 1;
    if (candidates.length > 1 && existingDuplicateRowIndex === undefined) {
      existingDuplicateRowIndex = row.rowIndex;
    }
    if (duplicate) return { ...row, status: "duplicate" };
    const product = candidates[0];
    return product
      ? { ...row, status: "matched", productId: product.id }
      : { ...row, status: "unmatched" };
  });
  const summary: MerchantCatalogProductImageMatchSummary = {
    total: rows.length,
    matched: rows.filter((row) => row.status === "matched").length,
    unmatched: rows.filter((row) => row.status === "unmatched").length,
    duplicates: rows.filter((row) => row.status === "duplicate").length,
  };
  if (importedDuplicateRowIndex !== undefined) {
    return {
      ok: false,
      error: "merchant_catalog_image_import_duplicate_code",
      rowIndex: importedDuplicateRowIndex,
      rows,
      summary,
    };
  }
  if (existingDuplicateRowIndex !== undefined) {
    return {
      ok: false,
      error: "merchant_catalog_existing_duplicate_code",
      rowIndex: existingDuplicateRowIndex,
      rows,
      summary,
    };
  }
  return { ok: true, rows, summary };
}

const MERCHANT_CATALOG_ASSET_BUCKETS = new Set(["page-assets", "assets", "uploads", "public"]);

function isAllowedMerchantCatalogAssetHost(hostname: string, protocol: string) {
  const normalizedHost = hostname.toLowerCase();
  const local = normalizedHost === "localhost" || normalizedHost === "127.0.0.1";
  if (protocol !== "https:" && !(protocol === "http:" && local)) return false;
  return (
    local ||
    normalizedHost === "faolla.com" ||
    normalizedHost.endsWith(".faolla.com") ||
    normalizedHost.endsWith(".supabase.co")
  );
}

function parseMerchantCatalogProductImageAssetUrl(
  value: unknown,
  merchantId: string,
  role: "image" | "thumbnail",
): MerchantCatalogProductImageAssetReference | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2_048 || /^(?:data|blob):/i.test(raw)) return null;

  let pathname = "";
  if (raw.startsWith("/")) {
    if (raw.startsWith("//") || raw.includes("?") || raw.includes("#")) return null;
    pathname = raw;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (
      !isAllowedMerchantCatalogAssetHost(parsed.hostname, parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    pathname = parsed.pathname;
  }
  if (pathname.includes("%") || pathname.includes("\\") || pathname.includes("//")) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts.length !== 10 ||
    parts[0] !== "storage" ||
    parts[1] !== "v1" ||
    parts[2] !== "object" ||
    parts[3] !== "public" ||
    !MERCHANT_CATALOG_ASSET_BUCKETS.has(parts[4] ?? "") ||
    parts[5] !== "merchant-assets" ||
    parts[6] !== merchantId ||
    !/^20\d{2}$/.test(parts[7] ?? "") ||
    !/^(?:0[1-9]|1[0-2])$/.test(parts[8] ?? "")
  ) {
    return null;
  }
  const fileName = parts[9] ?? "";
  const regularImage = /^\d{10,16}-[a-z0-9]{6}\.(?:jpe?g|png|webp)$/.test(fileName);
  const thumbnail = /^\d{10,16}-[a-z0-9]{6}-thumb\.webp$/.test(fileName);
  if ((role === "image" && !regularImage) || (role === "thumbnail" && !thumbnail)) return null;
  const bucket = parts[4] as MerchantCatalogProductImageAssetReference["bucket"];
  const objectPath = parts.slice(5).join("/");
  return {
    url: `/storage/v1/object/public/${bucket}/${objectPath}`,
    bucket,
    objectPath,
  };
}

export function prepareMerchantCatalogProductImageImport(
  items: unknown,
  merchantIdValue: unknown,
): MerchantCatalogPreparedProductImageImport {
  const merchantId = trimText(merchantIdValue);
  if (!MERCHANT_ID_REGEX.test(merchantId)) {
    return { ok: false, error: "invalid_merchant_catalog_image_merchant_id" };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "invalid_merchant_catalog_image_import_items" };
  }
  if (items.length > MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_IMPORT_ITEMS) {
    return { ok: false, error: "merchant_catalog_image_import_limit_exceeded" };
  }

  const encoder = new TextEncoder();
  let inputBytes = 2;
  const prepared: MerchantCatalogPreparedProductImageImportItem[] = [];
  for (let rowIndex = 0; rowIndex < items.length; rowIndex += 1) {
    const raw = items[rowIndex];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "invalid_merchant_catalog_image_import_row", rowIndex };
    }
    const record = raw as Record<string, unknown>;
    if (
      typeof record.fileName !== "string" ||
      typeof record.imageUrl !== "string" ||
      (record.thumbnailUrl !== undefined && typeof record.thumbnailUrl !== "string")
    ) {
      return { ok: false, error: "invalid_merchant_catalog_image_import_row", rowIndex };
    }
    const fileName = record.fileName.trim();
    const imageUrl = record.imageUrl.trim();
    const thumbnailUrl = trimText(record.thumbnailUrl);
    inputBytes += encoder.encode(fileName).byteLength + encoder.encode(imageUrl).byteLength + encoder.encode(thumbnailUrl).byteLength + 36;
    if (inputBytes > MERCHANT_CATALOG_MAX_SERIALIZED_BYTES) {
      return { ok: false, error: "merchant_catalog_limit_exceeded", rowIndex };
    }
    const parsedFileName = readProductImageFileNames([fileName]);
    if (!parsedFileName.ok) {
      return { ok: false, error: parsedFileName.error, rowIndex };
    }
    const imageAsset = parseMerchantCatalogProductImageAssetUrl(imageUrl, merchantId, "image");
    if (!imageAsset) {
      return { ok: false, error: "invalid_merchant_catalog_product_image_asset", rowIndex };
    }
    const thumbnailAsset = thumbnailUrl
      ? parseMerchantCatalogProductImageAssetUrl(thumbnailUrl, merchantId, "thumbnail")
      : null;
    if (thumbnailUrl && !thumbnailAsset) {
      return { ok: false, error: "invalid_merchant_catalog_product_thumbnail_asset", rowIndex };
    }
    if (thumbnailAsset) {
      const imageBasePath = imageAsset.objectPath.replace(/\.[^.]+$/, "");
      if (
        thumbnailAsset.bucket !== imageAsset.bucket ||
        thumbnailAsset.objectPath !== `${imageBasePath}-thumb.webp`
      ) {
        return { ok: false, error: "invalid_merchant_catalog_product_thumbnail_asset", rowIndex };
      }
    }
    const fileRow = parsedFileName.rows[0]!;
    prepared.push({
      ...fileRow,
      rowIndex,
      imageUrl: imageAsset.url,
      thumbnailUrl: thumbnailAsset?.url ?? "",
      imageAsset,
      ...(thumbnailAsset ? { thumbnailAsset } : {}),
    });
  }
  return { ok: true, items: prepared };
}

/** Plans an atomic image import after the upload endpoint has returned assets. */
export function planMerchantCatalogProductImageImport(
  value: unknown,
  items: unknown,
  merchantId: unknown,
): MerchantCatalogProductImageImportPlan {
  const catalog = normalizeMerchantCatalog(value);
  const prepared = prepareMerchantCatalogProductImageImport(items, merchantId);
  if (!prepared.ok) return prepared;
  const matches = planMerchantCatalogProductImageMatches(
    catalog,
    prepared.items.map((item) => item.fileName),
  );
  if (!matches.ok) return matches;

  const products = catalog.products.map((product) => ({ ...product }));
  let updated = 0;
  let unchanged = 0;
  const rows = matches.rows.map<MerchantCatalogProductImageImportRow>((match) => {
    const { status: matchStatus, ...matchFields } = match;
    const imported = prepared.items[match.rowIndex]!;
    if (matchStatus === "unmatched" || !match.productId) {
      return {
        ...matchFields,
        action: "unmatched",
        imageUrl: imported.imageUrl,
        thumbnailUrl: imported.thumbnailUrl,
      };
    }
    const productIndex = products.findIndex((product) => product.id === match.productId);
    const product = products[productIndex]!;
    const changed = product.imageUrl !== imported.imageUrl || product.thumbnailUrl !== imported.thumbnailUrl;
    if (changed) {
      products[productIndex] = {
        ...product,
        imageUrl: imported.imageUrl,
        thumbnailUrl: imported.thumbnailUrl,
      };
      updated += 1;
    } else {
      unchanged += 1;
    }
    return {
      ...matchFields,
      action: changed ? "update" : "unchanged",
      imageUrl: imported.imageUrl,
      thumbnailUrl: imported.thumbnailUrl,
    };
  });
  const summary: MerchantCatalogProductImageImportSummary = {
    ...matches.summary,
    updated,
    unchanged,
  };
  const nextCatalog: MerchantCatalog = {
    ...catalog,
    products,
    categories: catalog.categories.map((category) => ({ ...category, productIds: [...category.productIds] })),
    collections: catalog.collections.map((collection) => ({ ...collection, productIds: [...collection.productIds] })),
  };
  const validationError = getMerchantCatalogValidationError(nextCatalog);
  if (validationError) return { ok: false, error: validationError, rows, summary };
  return { ok: true, catalog: nextCatalog, rows, summary };
}

/** Applies one catalog-management action without mutating or versioning the input. */
export function applyMerchantCatalogMutation(
  value: unknown,
  mutation: MerchantCatalogMutation,
): MerchantCatalogMutationResult {
  const catalog = normalizeMerchantCatalog(value);

  if (mutation.action === "bulk_import_products") {
    const plan = planMerchantCatalogProductImport(catalog, mutation.items);
    return plan.ok
      ? { ok: true, catalog: plan.catalog }
      : { ok: false, error: plan.error };
  }

  if (mutation.action === "bulk_set_product_images") {
    const plan = planMerchantCatalogProductImageImport(catalog, mutation.items, mutation.merchantId);
    if (!plan.ok) return { ok: false, error: plan.error };
    if (plan.summary.updated === 0) {
      return { ok: false, error: "merchant_catalog_image_import_no_changes" };
    }
    return { ok: true, catalog: plan.catalog };
  }

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
    const hasBrowsingRules = Object.prototype.hasOwnProperty.call(raw, "browsingRules");
    const browsingRules = hasBrowsingRules
      ? normalizeMerchantCatalogBrowsingRules(raw.browsingRules)
      : undefined;
    if (!id || !blockId) return { ok: false, error: "invalid_merchant_catalog_collection" };
    if (
      hasBrowsingRules &&
      (!browsingRules ||
        browsingRules.searchPlaceholder.length > MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH)
    ) {
      return { ok: false, error: "invalid_merchant_catalog_browsing_rules" };
    }
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
    const existingCollection = catalog.collections.find((item) => item.id === id);
    const effectiveBrowsingRules = hasBrowsingRules
      ? browsingRules
      : existingCollection?.browsingRules;
    const collection = {
      id,
      blockId,
      viewport: raw.viewport,
      productIds,
      ...(effectiveBrowsingRules ? { browsingRules: { ...effectiveBrowsingRules } } : {}),
    } satisfies MerchantCatalogCollection;
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

    const browsingRules = publishedBrowsingRules(block);
    const collection: MerchantCatalogCollection = {
      id: createMerchantCatalogCollectionId(block.id, source.viewport),
      blockId: block.id,
      viewport: source.viewport,
      productIds,
      browsingRules,
    };
    if (
      browsingRules.searchPlaceholder.length >
      MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH
    ) {
      conflicts.push({
        code: "collection_conflict",
        field: "search_placeholder_too_long",
        collectionId: collection.id,
        values: [{ value: browsingRules.searchPlaceholder, sources: [source] }],
      });
    }
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
    const browsingRuleValues = conflictValues(
      occurrences.map(({ collection, source }) => ({
        value: JSON.stringify(collection.browsingRules),
        source,
      })),
    );
    if (browsingRuleValues.length > 1) {
      conflicts.push({
        code: "collection_conflict",
        field: "browsing_rules",
        collectionId: id,
        values: browsingRuleValues,
      });
      return;
    }
    const collection = occurrences[0]!.collection;
    collections.push({
      ...collection,
      productIds: [...collection.productIds],
      ...(collection.browsingRules ? { browsingRules: { ...collection.browsingRules } } : {}),
    });
  });

  if (conflicts.length > 0) {
    const productLabels = new Map(
      [...productsById.entries()].map(([productId, occurrences]) => [
        productId,
        bootstrapProductEntityLabel(productId, occurrences),
      ]),
    );
    return {
      ok: false,
      catalog: null,
      conflicts,
      sourceBlockCount: candidates.length,
      resolutionTargets: buildBootstrapResolutionTargets(conflicts, productLabels),
    };
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
  return { ok: true, catalog, conflicts: [], sourceBlockCount: candidates.length, resolutionTargets: [] };
}

function isSupportedBootstrapResolutionTarget(target: MerchantCatalogBootstrapResolutionTarget) {
  if (target.scope === "catalog") {
    return target.field === "price_prefix" || target.field === "category_options";
  }
  if (target.scope === "product") {
    return PRODUCT_FIELDS.some(([, field]) => field === target.field);
  }
  return target.field === "product_ids" ||
    target.field === "browsing_rules" ||
    target.field === "search_placeholder_too_long";
}

function normalizeCustomBootstrapResolution(
  target: MerchantCatalogBootstrapResolutionTarget,
  value: string,
): { ok: true; value: string } | { ok: false } {
  if (!target.allowCustom) return { ok: false };
  const normalized = value.trim();
  if (target.scope === "product" && target.field === "name" && target.reasons.includes("name_required")) {
    return normalized && normalized.length <= 240 ? { ok: true, value: normalized } : { ok: false };
  }
  if (target.scope === "product" && target.field === "price" && target.reasons.includes("price_invalid")) {
    return normalized.length <= 80 && parseMerchantCatalogUnitPrice(normalized) !== null
      ? { ok: true, value: normalized }
      : { ok: false };
  }
  if (
    target.scope === "collection" &&
    target.field === "search_placeholder_too_long" &&
    target.reasons.includes("search_placeholder_too_long")
  ) {
    return normalized.length <= MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH
      ? { ok: true, value: normalized }
      : { ok: false };
  }
  return { ok: false };
}

/**
 * Resolves an initial catalog exclusively from explicit, fingerprint-bound UI
 * decisions. This function never mutates published blocks and never chooses a
 * conflicting side implicitly.
 */
export function resolveMerchantCatalogBootstrapFromPublishedBlocks(
  input: MerchantCatalogBootstrapInput,
  plan: MerchantCatalogBootstrapResolutionPlan,
): MerchantCatalogBootstrapResolutionResult {
  const bootstrap = bootstrapMerchantCatalogFromPublishedBlocks(input);
  const invalid = (errorTargetKey?: string): MerchantCatalogBootstrapResolutionResult => ({
    ...bootstrap,
    ok: false,
    catalog: null,
    error: "merchant_catalog_bootstrap_resolution_invalid",
    ...(errorTargetKey ? { errorTargetKey } : {}),
  });

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return invalid();
  const rawPlan = plan as unknown as Record<string, unknown>;
  if (
    rawPlan.version !== 1 ||
    !Array.isArray(rawPlan.selections) ||
    !Array.isArray(rawPlan.excludedProductIds)
  ) {
    return invalid();
  }

  const candidates: ProductBlockCandidate[] = [];
  const sourceInputs: Array<{ value: unknown; viewport: MerchantCatalogViewport }> = [
    { value: input?.blocks, viewport: "shared" },
    { value: input?.desktopBlocks, viewport: "desktop" },
    { value: input?.mobileBlocks, viewport: "mobile" },
  ];
  sourceInputs.forEach(({ value, viewport }) => {
    if (Array.isArray(value)) collectProductBlocks(value, viewport, candidates, new WeakSet<object>());
  });

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
      browsingRules: publishedBrowsingRules(block),
    };
    const occurrences = collectionsById.get(collection.id) ?? [];
    occurrences.push({ collection, source });
    collectionsById.set(collection.id, occurrences);
  });

  const excludedProductIds = new Set<string>();
  for (const value of rawPlan.excludedProductIds) {
    if (typeof value !== "string" || !value || value !== value.trim() || excludedProductIds.has(value)) {
      return invalid();
    }
    if (!productsById.has(value)) return invalid();
    excludedProductIds.add(value);
  }

  const targetsByKey = new Map(bootstrap.resolutionTargets.map((target) => [target.targetKey, target]));
  if (bootstrap.conflicts.some((conflict) => !resolutionTargetIdentity(conflict))) {
    return {
      ...bootstrap,
      ok: false,
      catalog: null,
      error: "merchant_catalog_bootstrap_unresolved_conflict",
    };
  }
  if ([...targetsByKey.values()].some((target) => !isSupportedBootstrapResolutionTarget(target))) {
    return {
      ...bootstrap,
      ok: false,
      catalog: null,
      error: "merchant_catalog_bootstrap_unresolved_conflict",
    };
  }

  const resolvedValues = new Map<MerchantCatalogBootstrapResolutionTargetKey, string | string[]>();
  for (const rawSelection of rawPlan.selections) {
    if (!rawSelection || typeof rawSelection !== "object" || Array.isArray(rawSelection)) return invalid();
    const record = rawSelection as Record<string, unknown>;
    const targetKey = typeof record.targetKey === "string" ? record.targetKey : "";
    if (!targetKey || resolvedValues.has(targetKey)) return invalid(targetKey || undefined);
    const target = targetsByKey.get(targetKey);
    if (!target) return invalid(targetKey);
    if (target.productId && excludedProductIds.has(target.productId)) return invalid(targetKey);
    const hasChoiceId = Object.prototype.hasOwnProperty.call(record, "choiceId");
    const hasCustomValue = Object.prototype.hasOwnProperty.call(record, "customValue");
    if (hasChoiceId === hasCustomValue) return invalid(targetKey);
    if (hasChoiceId) {
      if (typeof record.choiceId !== "string" || !record.choiceId) return invalid(targetKey);
      const choice = target.choices.find((candidate) => candidate.choiceId === record.choiceId);
      if (!choice) return invalid(targetKey);
      resolvedValues.set(targetKey, Array.isArray(choice.value) ? [...choice.value] : choice.value);
      continue;
    }
    if (typeof record.customValue !== "string") return invalid(targetKey);
    const custom = normalizeCustomBootstrapResolution(target, record.customValue);
    if (!custom.ok) return invalid(targetKey);
    resolvedValues.set(targetKey, custom.value);
  }

  for (const target of bootstrap.resolutionTargets) {
    if (target.productId && excludedProductIds.has(target.productId)) continue;
    if (!resolvedValues.has(target.targetKey)) {
      return {
        ...bootstrap,
        ok: false,
        catalog: null,
        error: "merchant_catalog_bootstrap_resolution_incomplete",
        errorTargetKey: target.targetKey,
      };
    }
  }

  const targetValue = (
    scope: MerchantCatalogBootstrapResolutionTarget["scope"],
    entityId: string,
    field: string,
  ) => resolvedValues.get(createResolutionTargetKey(scope, entityId, field));

  const products: MerchantCatalogProduct[] = [];
  productsById.forEach((occurrences, productId) => {
    if (excludedProductIds.has(productId)) return;
    const product = { ...occurrences[0]!.product };
    PRODUCT_FIELDS.forEach(([property, field]) => {
      const value = targetValue("product", productId, field);
      if (typeof value === "string") product[property] = value as never;
    });
    products.push(product);
  });

  const collections: MerchantCatalogCollection[] = [];
  let unresolvedTargetKey = "";
  collectionsById.forEach((occurrences, collectionId) => {
    if (unresolvedTargetKey) return;
    const first = occurrences[0]!.collection;
    const productIdsValue = targetValue("collection", collectionId, "product_ids");
    if (productIdsValue !== undefined && !Array.isArray(productIdsValue)) {
      unresolvedTargetKey = createResolutionTargetKey("collection", collectionId, "product_ids");
      return;
    }
    let browsingRules = first.browsingRules ? { ...first.browsingRules } : undefined;
    const browsingRulesValue = targetValue("collection", collectionId, "browsing_rules");
    if (browsingRulesValue !== undefined) {
      if (typeof browsingRulesValue !== "string") {
        unresolvedTargetKey = createResolutionTargetKey("collection", collectionId, "browsing_rules");
        return;
      }
      try {
        browsingRules = normalizeMerchantCatalogBrowsingRules(JSON.parse(browsingRulesValue));
      } catch {
        browsingRules = undefined;
      }
      if (!browsingRules) {
        unresolvedTargetKey = createResolutionTargetKey("collection", collectionId, "browsing_rules");
        return;
      }
    }
    const searchPlaceholderValue = targetValue("collection", collectionId, "search_placeholder_too_long");
    if (searchPlaceholderValue !== undefined) {
      if (typeof searchPlaceholderValue !== "string" || !browsingRules) {
        unresolvedTargetKey = createResolutionTargetKey("collection", collectionId, "search_placeholder_too_long");
        return;
      }
      browsingRules = { ...browsingRules, searchPlaceholder: searchPlaceholderValue };
    }
    collections.push({
      ...first,
      productIds: [...(Array.isArray(productIdsValue) ? productIdsValue : first.productIds)]
        .filter((productId) => !excludedProductIds.has(productId)),
      ...(browsingRules ? { browsingRules } : {}),
    });
  });
  if (unresolvedTargetKey) {
    return {
      ...bootstrap,
      ok: false,
      catalog: null,
      error: "merchant_catalog_bootstrap_unresolved_conflict",
      errorTargetKey: unresolvedTargetKey,
    };
  }

  const prefixValues = conflictValues(
    candidates.map(({ block, source }) => ({ value: trimText(block.props.productPricePrefix), source })),
  );
  const categoryOptionValues = conflictValues(
    candidates.map(({ block, source }) => ({ value: uniqueStrings(block.props.productTagOptions), source })),
  );
  const resolvedPrefix = targetValue("catalog", "", "price_prefix");
  const resolvedCategoryOptions = targetValue("catalog", "", "category_options");
  if (
    (resolvedPrefix !== undefined && typeof resolvedPrefix !== "string") ||
    (resolvedCategoryOptions !== undefined && !Array.isArray(resolvedCategoryOptions))
  ) {
    return {
      ...bootstrap,
      ok: false,
      catalog: null,
      error: "merchant_catalog_bootstrap_unresolved_conflict",
    };
  }

  const categoriesByName = new Map<string, MerchantCatalogCategory>();
  const categoryOptions = Array.isArray(resolvedCategoryOptions)
    ? resolvedCategoryOptions
    : categoryOptionValues[0]?.value;
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
    pricePrefix: typeof resolvedPrefix === "string" ? resolvedPrefix : prefixValues[0]?.value ?? "",
    categories: [...categoriesByName.values()],
    products,
    collections,
  });
  const validationError = getMerchantCatalogValidationError(catalog);
  if (validationError) {
    return {
      ...bootstrap,
      ok: false,
      catalog: null,
      error: "merchant_catalog_bootstrap_validation_failed",
      validationError,
    };
  }
  return {
    ok: true,
    catalog,
    conflicts: [],
    sourceBlockCount: bootstrap.sourceBlockCount,
    resolutionTargets: bootstrap.resolutionTargets,
  };
}
