import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantCatalogBootstrapResolutionPlan,
  getUnresolvableBootstrapConflicts,
  getMerchantCatalogBootstrapRelatedProductsWithoutProductTargets,
  getMerchantCatalogBootstrapResolutionProgress,
  hasMerchantCatalogBootstrapResolutionWork,
  isMerchantCatalogBootstrapPreviewCurrent,
  isMerchantCatalogBootstrapResolutionSelectionComplete,
} from "@/components/admin/MerchantCatalogManagerPanel";
import type {
  MerchantCatalogBootstrapResolutionResult,
  MerchantCatalogBootstrapResolutionTarget,
} from "@/lib/merchantCatalog";

function target(
  overrides: Partial<MerchantCatalogBootstrapResolutionTarget> = {},
): MerchantCatalogBootstrapResolutionTarget {
  return {
    targetKey: '["product","product-a","name"]',
    scope: "product",
    field: "name",
    productId: "product-a",
    reasons: ["name"],
    choices: [
      {
        choiceId: "choice-desktop",
        value: "Desktop name",
        sources: [{ blockId: "block-a", viewport: "desktop", occurrence: 0 }],
      },
      {
        choiceId: "choice-mobile",
        value: "Mobile name",
        sources: [{ blockId: "block-a", viewport: "mobile", occurrence: 1 }],
      },
    ],
    allowCustom: false,
    ...overrides,
  };
}

function preview(): MerchantCatalogBootstrapResolutionResult {
  return {
    ok: true,
    catalog: {
      revision: 1,
      updatedAt: "2026-08-17T00:00:00.000Z",
      pricePrefix: "€",
      categories: [],
      products: [],
      collections: [],
    },
    conflicts: [],
    sourceBlockCount: 1,
    resolutionTargets: [],
  };
}

test("bootstrap conflict choices never select a source by default", () => {
  const nameTarget = target();

  assert.equal(isMerchantCatalogBootstrapResolutionSelectionComplete(nameTarget, undefined), false);
  assert.deepEqual(getMerchantCatalogBootstrapResolutionProgress([nameTarget], {}, []), {
    processed: 0,
    total: 1,
  });
  assert.deepEqual(buildMerchantCatalogBootstrapResolutionPlan([nameTarget], {}, []), {
    version: 1,
    selections: [],
    excludedProductIds: [],
  });
});

test("required names and invalid prices require locally valid custom values", () => {
  const nameTarget = target({ reasons: ["name_required"], choices: [], allowCustom: true });
  const priceTarget = target({
    targetKey: '["product","product-a","price"]',
    field: "price",
    reasons: ["price_invalid"],
    choices: [],
    allowCustom: true,
  });

  assert.equal(
    isMerchantCatalogBootstrapResolutionSelectionComplete(nameTarget, {
      targetKey: nameTarget.targetKey,
      customValue: "   ",
    }),
    false,
  );
  assert.equal(
    isMerchantCatalogBootstrapResolutionSelectionComplete(nameTarget, {
      targetKey: nameTarget.targetKey,
      customValue: "Resolved product",
    }),
    true,
  );
  assert.equal(
    isMerchantCatalogBootstrapResolutionSelectionComplete(priceTarget, {
      targetKey: priceTarget.targetKey,
      customValue: "待定",
    }),
    false,
  );
  assert.equal(
    isMerchantCatalogBootstrapResolutionSelectionComplete(priceTarget, {
      targetKey: priceTarget.targetKey,
      customValue: "0",
    }),
    true,
  );
});

test("browsing rules with an oversized placeholder remain selectable when the same collection resolves the placeholder separately", () => {
  const oversizedPlaceholder = "x".repeat(161);
  const browsingRulesTarget = target({
    targetKey: '["collection","collection-a","browsing_rules"]',
    scope: "collection",
    field: "browsing_rules",
    productId: undefined,
    collectionId: "collection-a",
    reasons: ["browsing_rules"],
    choices: [{
      choiceId: "choice-rules",
      value: JSON.stringify({
        searchEnabled: true,
        searchPlaceholder: oversizedPlaceholder,
        hideUnselectedCategory: false,
        groupByCategory: true,
      }),
      sources: [{ blockId: "block-a", viewport: "desktop", occurrence: 0 }],
    }],
    allowCustom: false,
  });
  const placeholderTarget = target({
    targetKey: '["collection","collection-a","search_placeholder_too_long"]',
    scope: "collection",
    field: "search_placeholder_too_long",
    productId: undefined,
    collectionId: "collection-a",
    reasons: ["search_placeholder_too_long"],
    choices: [],
    allowCustom: true,
  });
  const targets = [browsingRulesTarget, placeholderTarget];
  const browsingRulesSelection = {
    targetKey: browsingRulesTarget.targetKey,
    choiceId: "choice-rules",
  } as const;
  const placeholderSelection = {
    targetKey: placeholderTarget.targetKey,
    customValue: "Search products",
  } as const;

  assert.equal(
    isMerchantCatalogBootstrapResolutionSelectionComplete(
      browsingRulesTarget,
      browsingRulesSelection,
    ),
    false,
  );
  assert.equal(
    isMerchantCatalogBootstrapResolutionSelectionComplete(
      browsingRulesTarget,
      browsingRulesSelection,
      targets,
    ),
    true,
  );
  assert.deepEqual(
    getMerchantCatalogBootstrapResolutionProgress(
      targets,
      {
        [browsingRulesTarget.targetKey]: browsingRulesSelection,
        [placeholderTarget.targetKey]: placeholderSelection,
      },
      [],
    ),
    { processed: 2, total: 2 },
  );
  assert.deepEqual(getUnresolvableBootstrapConflicts([], targets).blockedTargets, []);
  assert.deepEqual(
    getUnresolvableBootstrapConflicts([], [browsingRulesTarget]).blockedTargets,
    [browsingRulesTarget],
  );
});

test("excluding a conflicted product completes its targets and removes their selections from the plan", () => {
  const nameTarget = target();
  const priceTarget = target({
    targetKey: '["product","product-a","price"]',
    field: "price",
    reasons: ["price"],
    choices: [{
      choiceId: "choice-price",
      value: "12.50",
      sources: [{ blockId: "block-a", viewport: "desktop", occurrence: 0 }],
    }],
  });
  const collectionTarget = target({
    targetKey: '["collection","collection-a","product_ids"]',
    scope: "collection",
    field: "product_ids",
    productId: undefined,
    collectionId: "collection-a",
    reasons: ["product_ids"],
    choices: [{
      choiceId: "choice-products",
      value: ["product-a"],
      sources: [{ blockId: "block-a", viewport: "desktop", occurrence: 0 }],
    }],
  });
  const draft = {
    [nameTarget.targetKey]: { targetKey: nameTarget.targetKey, choiceId: "choice-desktop" } as const,
    [priceTarget.targetKey]: { targetKey: priceTarget.targetKey, choiceId: "choice-price" } as const,
    [collectionTarget.targetKey]: {
      targetKey: collectionTarget.targetKey,
      choiceId: "choice-products",
    } as const,
  };

  assert.deepEqual(
    getMerchantCatalogBootstrapResolutionProgress(
      [nameTarget, priceTarget, collectionTarget],
      {},
      ["product-a"],
    ),
    { processed: 2, total: 3 },
  );
  assert.deepEqual(
    buildMerchantCatalogBootstrapResolutionPlan(
      [nameTarget, priceTarget, collectionTarget],
      draft,
      ["product-a"],
    ),
    {
      version: 1,
      selections: [draft[collectionTarget.targetKey]],
      excludedProductIds: ["product-a"],
    },
  );
});

test("collection-related products without their own conflict group remain explicitly excludable", () => {
  const productTarget = target({ entityLabel: "Product A" });
  const collectionTarget = target({
    targetKey: '["collection","collection-a","product_ids"]',
    scope: "collection",
    field: "product_ids",
    productId: undefined,
    collectionId: "collection-a",
    reasons: ["product_ids"],
    relatedProducts: [
      { productId: "product-a", entityLabel: "Product A" },
      { productId: "product-b", entityLabel: "Product B" },
      { productId: "product-c", entityLabel: "" },
    ],
    choices: [{
      choiceId: "choice-products",
      value: ["product-a", "product-b"],
      sources: [{ blockId: "block-a", viewport: "desktop", occurrence: 0 }],
    }],
  });
  const duplicateCollectionTarget = target({
    targetKey: '["collection","collection-b","product_ids"]',
    scope: "collection",
    field: "product_ids",
    productId: undefined,
    collectionId: "collection-b",
    reasons: ["product_ids"],
    relatedProducts: [{ productId: "product-b", entityLabel: "Product B duplicate" }],
    choices: [{
      choiceId: "choice-products-b",
      value: ["product-b"],
      sources: [{ blockId: "block-b", viewport: "mobile", occurrence: 1 }],
    }],
  });

  assert.deepEqual(
    getMerchantCatalogBootstrapRelatedProductsWithoutProductTargets([
      productTarget,
      collectionTarget,
      duplicateCollectionTarget,
    ]),
    [
      { productId: "product-b", entityLabel: "Product B" },
      { productId: "product-c", entityLabel: "product-c" },
    ],
  );

  const collectionSelection = {
    targetKey: collectionTarget.targetKey,
    choiceId: "choice-products",
  } as const;
  assert.deepEqual(
    buildMerchantCatalogBootstrapResolutionPlan(
      [collectionTarget],
      { [collectionTarget.targetKey]: collectionSelection },
      ["product-b"],
    ),
    {
      version: 1,
      selections: [collectionSelection],
      excludedProductIds: ["product-b"],
    },
  );
});

test("a preview is invalidated whenever the current resolution plan changes", () => {
  const resolved = preview();

  assert.equal(isMerchantCatalogBootstrapPreviewCurrent(resolved, "token", "plan-a", "plan-a"), true);
  assert.equal(isMerchantCatalogBootstrapPreviewCurrent(resolved, "token", "plan-a", "plan-b"), false);
  assert.equal(isMerchantCatalogBootstrapPreviewCurrent(resolved, "", "plan-a", "plan-a"), false);
  assert.equal(hasMerchantCatalogBootstrapResolutionWork({}, [], null), false);
  assert.equal(hasMerchantCatalogBootstrapResolutionWork({}, ["product-a"], null), true);
  assert.equal(hasMerchantCatalogBootstrapResolutionWork({}, [], resolved), true);
});
