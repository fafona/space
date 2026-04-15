import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "@/data/homeBlocks";
import { buildPersistedBlocksFromPlanConfig, type PagePlanConfig } from "@/lib/pagePlans";
import {
  DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS,
  applyPlanTemplateToBlocks,
  extractPlanTemplateCoverBackground,
  extractPlanTemplateCoverImage,
  type PlanTemplateApplyScope,
  type PlanTemplateReplaceOptions,
} from "@/lib/planTemplateRuntime";

function makeConfig(blocks: Block[]): PagePlanConfig {
  return {
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: "方案1",
        blocks,
        pages: [{ id: "page-1", name: "页面1", blocks }],
        activePageId: "page-1",
      },
      {
        id: "plan-2",
        name: "方案2",
        blocks,
        pages: [{ id: "page-1", name: "页面1", blocks }],
        activePageId: "page-1",
      },
      {
        id: "plan-3",
        name: "方案3",
        blocks,
        pages: [{ id: "page-1", name: "页面1", blocks }],
        activePageId: "page-1",
      },
    ],
  };
}

test("extractPlanTemplateCoverImage prefers page background image", () => {
  const blocks = buildPersistedBlocksFromPlanConfig(
    makeConfig([
      {
        id: "search",
        type: "search-bar",
        props: {
          heading: "搜索",
          pageBgImageUrl: "https://example.com/cover.jpg",
        },
      },
    ]),
  );

  assert.equal(extractPlanTemplateCoverImage(blocks), "https://example.com/cover.jpg");
});

test("extractPlanTemplateCoverBackground falls back to captured background color", () => {
  const blocks = buildPersistedBlocksFromPlanConfig(
    makeConfig([
      {
        id: "search",
        type: "search-bar",
        props: {
          heading: "鎼滅储",
          pageBgColor: "linear-gradient(135deg, #112233 0%, #445566 100%)",
          pageBgColorOpacity: 0.82,
        },
      },
    ]),
  );

  assert.deepEqual(extractPlanTemplateCoverBackground(blocks), {
    color: "linear-gradient(135deg, #112233 0%, #445566 100%)",
    colorOpacity: 0.82,
    fillMode: undefined,
    imageOpacity: undefined,
    imageUrl: undefined,
    opacity: undefined,
    position: undefined,
  });
});

test("default plan template replace options keep data blocks untouched", () => {
  assert.equal(DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS.galleryImages, false);
  assert.equal(DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS.productData, false);
  assert.equal(DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS.contactInfo, false);
});

test("applyPlanTemplateToBlocks preserves opted-out style and data fields", () => {
  const templateBlocks = buildPersistedBlocksFromPlanConfig(
    makeConfig([
      {
        id: "search",
        type: "search-bar",
        props: {
          heading: "模板搜索",
          fontFamily: "Template Font",
          searchButtonBgColor: "#111111",
          pageBgColor: "#ff6600",
        },
      },
      {
        id: "gallery",
        type: "gallery",
        props: {
          heading: "模板相册",
          images: ["https://example.com/template-gallery.jpg"],
        },
      },
      {
        id: "product",
        type: "product",
        props: {
          heading: "模板产品",
          products: [{ id: "t-1", name: "Template product", imageUrl: "https://example.com/template-product.jpg" }],
          productNameTypography: { fontFamily: "Template Product Font" },
        },
      },
      {
        id: "contact",
        type: "contact",
        props: {
          heading: "模板联系",
          phone: "10086",
        },
      },
    ]),
  );

  const targetBlocks = buildPersistedBlocksFromPlanConfig(
    makeConfig([
      {
        id: "search",
        type: "search-bar",
        props: {
          heading: "当前搜索",
          fontFamily: "Keep Font",
          searchButtonBgColor: "#abcdef",
          pageBgColor: "#224466",
        },
      },
      {
        id: "gallery",
        type: "gallery",
        props: {
          heading: "当前相册",
          images: ["https://example.com/keep-gallery.jpg"],
        },
      },
      {
        id: "product",
        type: "product",
        props: {
          heading: "当前产品",
          products: [{ id: "k-1", name: "Keep product", imageUrl: "https://example.com/keep-product.jpg" }],
          productNameTypography: { fontFamily: "Keep Product Font" },
        },
      },
      {
        id: "contact",
        type: "contact",
        props: {
          heading: "当前联系",
          phone: "123456",
        },
      },
    ]),
  );

  const scope: PlanTemplateApplyScope = {
    desktop: {
      enabled: true,
      applyBackground: false,
      selectedPlanId: "plan-1",
      selectedPageKeys: ["plan-1::0"],
    },
    mobile: {
      enabled: false,
      applyBackground: false,
      selectedPlanId: "",
      selectedPageKeys: [],
    },
  };
  const replace: PlanTemplateReplaceOptions = {
    typography: false,
    buttonStyles: false,
    galleryImages: false,
    productData: false,
    contactInfo: false,
  };

  const merged = applyPlanTemplateToBlocks(templateBlocks, targetBlocks, scope, replace);
  const planConfig = (merged[0]?.props as { pagePlanConfig?: PagePlanConfig } | undefined)?.pagePlanConfig;
  const pageBlocks = planConfig?.plans?.[0]?.pages?.[0]?.blocks ?? [];

  const searchProps = (pageBlocks[0]?.props ?? {}) as Record<string, unknown>;
  const galleryProps = (pageBlocks[1]?.props ?? {}) as Record<string, unknown>;
  const productProps = (pageBlocks[2]?.props ?? {}) as Record<string, unknown>;
  const contactProps = (pageBlocks[3]?.props ?? {}) as Record<string, unknown>;

  assert.equal(searchProps.fontFamily, "Keep Font");
  assert.equal(searchProps.searchButtonBgColor, "#abcdef");
  assert.equal(searchProps.pageBgColor, "#224466");
  assert.deepEqual(galleryProps.images, ["https://example.com/keep-gallery.jpg"]);
  assert.deepEqual(productProps.products, [{ id: "k-1", name: "Keep product", imageUrl: "https://example.com/keep-product.jpg" }]);
  assert.deepEqual(productProps.productNameTypography, { fontFamily: "Keep Product Font" });
  assert.equal(contactProps.phone, "123456");
});

test("applyPlanTemplateToBlocks only updates the selected plan", () => {
  const templateConfig: PagePlanConfig = {
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: "方案1",
        blocks: [{ id: "text-a", type: "text", props: { heading: "A", text: "template-a", pageBgColor: "#111111" } }],
        pages: [{ id: "page-1", name: "页面1", blocks: [{ id: "text-a", type: "text", props: { heading: "A", text: "template-a", pageBgColor: "#111111" } }] }],
        activePageId: "page-1",
      },
      {
        id: "plan-2",
        name: "方案2",
        blocks: [{ id: "text-b", type: "text", props: { heading: "B", text: "template-b", pageBgColor: "#222222" } }],
        pages: [{ id: "page-1", name: "页面1", blocks: [{ id: "text-b", type: "text", props: { heading: "B", text: "template-b", pageBgColor: "#222222" } }] }],
        activePageId: "page-1",
      },
      {
        id: "plan-3",
        name: "方案3",
        blocks: [{ id: "text-c", type: "text", props: { heading: "C", text: "template-c", pageBgColor: "#333333" } }],
        pages: [{ id: "page-1", name: "页面1", blocks: [{ id: "text-c", type: "text", props: { heading: "C", text: "template-c", pageBgColor: "#333333" } }] }],
        activePageId: "page-1",
      },
    ],
  };

  const targetConfig: PagePlanConfig = {
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: "方案1",
        blocks: [{ id: "text-a", type: "text", props: { heading: "A", text: "keep-a", pageBgColor: "#aaaaaa" } }],
        pages: [{ id: "page-1", name: "页面1", blocks: [{ id: "text-a", type: "text", props: { heading: "A", text: "keep-a", pageBgColor: "#aaaaaa" } }] }],
        activePageId: "page-1",
      },
      {
        id: "plan-2",
        name: "方案2",
        blocks: [{ id: "text-b", type: "text", props: { heading: "B", text: "keep-b", pageBgColor: "#bbbbbb" } }],
        pages: [{ id: "page-1", name: "页面1", blocks: [{ id: "text-b", type: "text", props: { heading: "B", text: "keep-b", pageBgColor: "#bbbbbb" } }] }],
        activePageId: "page-1",
      },
      {
        id: "plan-3",
        name: "方案3",
        blocks: [{ id: "text-c", type: "text", props: { heading: "C", text: "keep-c", pageBgColor: "#cccccc" } }],
        pages: [{ id: "page-1", name: "页面1", blocks: [{ id: "text-c", type: "text", props: { heading: "C", text: "keep-c", pageBgColor: "#cccccc" } }] }],
        activePageId: "page-1",
      },
    ],
  };

  const merged = applyPlanTemplateToBlocks(
    buildPersistedBlocksFromPlanConfig(templateConfig),
    buildPersistedBlocksFromPlanConfig(targetConfig),
    {
      desktop: {
        enabled: true,
        applyBackground: true,
        selectedPlanId: "plan-2",
        selectedPageKeys: ["plan-2::0"],
      },
      mobile: {
        enabled: false,
        applyBackground: false,
        selectedPlanId: "",
        selectedPageKeys: [],
      },
    },
    {
      typography: true,
      buttonStyles: true,
      galleryImages: true,
      productData: true,
      contactInfo: true,
    },
  );

  const mergedConfig = (merged[0]?.props as { pagePlanConfig?: PagePlanConfig } | undefined)?.pagePlanConfig;
  const plan1Text = ((mergedConfig?.plans[0]?.pages[0]?.blocks[0]?.props ?? {}) as Record<string, unknown>).text;
  const plan2Text = ((mergedConfig?.plans[1]?.pages[0]?.blocks[0]?.props ?? {}) as Record<string, unknown>).text;
  const plan3Text = ((mergedConfig?.plans[2]?.pages[0]?.blocks[0]?.props ?? {}) as Record<string, unknown>).text;

  assert.equal(plan1Text, "keep-a");
  assert.equal(plan2Text, "template-b");
  assert.equal(plan3Text, "keep-c");
});
