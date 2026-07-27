import assert from "node:assert/strict";
import test from "node:test";

import type { Block } from "../data/homeBlocks";
import {
  backfillProductThumbnailsInBlocks,
  buildInlineAssetsRecoveryMessage,
  buildInitialImageCompressionPlan,
  computePublishDiffSummary,
  formatInlineAssetStatsText,
  getPublishSizeBreakdown,
  optimizeBlocksForPublishIfNeeded,
  refineImageCompressionPlan,
  runPublishPreflight,
  uploadImageDataUrlToSupabaseWithMetadata,
  uploadSourceUrlViaServerApiWithMetadata,
} from "./editorAssetProcessing";
import { applyEditorThemePresetToBlocks } from "./editorThemeProcessing";

test("no-op editor theme preserves the original block array", () => {
  const blocks = [
    {
      id: "common-1",
      type: "common",
      props: { title: "Original" },
    },
  ] as unknown as Block[];

  const result = applyEditorThemePresetToBlocks(blocks, "none");

  assert.equal(result.applied, false);
  assert.equal(result.blocks, blocks);
});

test("editor theme applies product and page styles without mutating source blocks", () => {
  const blocks = [
    {
      id: "product-1",
      type: "product",
      props: {
        bgImageUrl: "https://cdn.example.com/block.webp",
        pageBgImageUrl: "https://cdn.example.com/page.webp",
        productNameTypography: { fontSize: 18 },
      },
    },
  ] as unknown as Block[];
  const sourceSnapshot = structuredClone(blocks);

  const result = applyEditorThemePresetToBlocks(blocks, "cartoon");
  const props = result.blocks[0]?.props as Record<string, unknown>;
  const nameTypography = props.productNameTypography as Record<string, unknown>;

  assert.equal(result.applied, true);
  assert.notEqual(result.blocks, blocks);
  assert.deepEqual(blocks, sourceSnapshot);
  assert.equal(props.fontFamily, "Trebuchet MS, sans-serif");
  assert.equal(props.blockBorderStyle, "accent");
  assert.equal(props.bgImageOpacity, 0.88);
  assert.equal(props.pageBgImageOpacity, 0.86);
  assert.equal(props.productCardBgColor, "#ffffff");
  assert.equal(props.productTagActiveBgColor, "#fb7185");
  assert.equal(nameTypography.fontSize, 18);
  assert.equal(nameTypography.fontFamily, "Trebuchet MS, sans-serif");
  assert.equal(nameTypography.fontColor, "#1f2937");
});

test("editor theme does not add image opacity when a block has no image", () => {
  const blocks = [
    {
      id: "common-1",
      type: "common",
      props: {},
    },
  ] as unknown as Block[];

  const result = applyEditorThemePresetToBlocks(blocks, "future");
  const props = result.blocks[0]?.props as Record<string, unknown>;

  assert.equal("bgImageOpacity" in props, false);
  assert.equal("pageBgImageOpacity" in props, false);
});

test("initial image compression keeps dimensions when quality alone can meet the limit", () => {
  const plan = buildInitialImageCompressionPlan(1_000_000, 800_000);

  assert.equal(plan.scale, 1);
  assert.ok(plan.quality >= 0.68);
  assert.ok(plan.quality <= 0.92);
});

test("initial image compression reduces dimensions for a tight limit", () => {
  const plan = buildInitialImageCompressionPlan(1_000_000, 100_000);

  assert.ok(plan.scale >= 0.16);
  assert.ok(plan.scale < 1);
  assert.equal(plan.quality, 0.84);
});

test("refined image compression never enlarges the previous candidate", () => {
  const previous = { scale: 0.8, quality: 0.84 };
  const plan = refineImageCompressionPlan(previous, 600_000, 200_000);

  assert.ok(plan.scale >= 0.12);
  assert.ok(plan.scale < previous.scale);
  assert.ok(plan.quality >= 0.42);
  assert.ok(plan.quality <= previous.quality);
});

test("publish size breakdown ranks blocks and reports large string fields", () => {
  const blocks = [
    {
      id: "small",
      type: "common",
      props: { title: "small" },
    },
    {
      id: "large",
      type: "common",
      props: { title: "x".repeat(60 * 1024) },
    },
  ] as unknown as Block[];

  const breakdown = getPublishSizeBreakdown(blocks);

  assert.match(breakdown.blockTotals[0]?.path ?? "", /common:large/);
  assert.equal(breakdown.largeFields.length, 1);
  assert.match(breakdown.largeFields[0]?.path ?? "", /common:large.*props\.title/);
});

test("publish diff summary distinguishes added, changed, and removed blocks", () => {
  const previous = [
    { id: "changed", type: "common", props: { title: "before" } },
    { id: "removed", type: "common", props: { title: "removed" } },
  ] as unknown as Block[];
  const next = [
    { id: "changed", type: "common", props: { title: "after" } },
    { id: "added", type: "common", props: { title: "added" } },
  ] as unknown as Block[];

  const summary = computePublishDiffSummary(next, previous);

  assert.equal(summary.changedCount, 1);
  assert.equal(summary.addedCount, 1);
  assert.equal(summary.removedCount, 1);
  assert.equal(summary.changedPaths.length, 2);
});

test("publish preflight reports actionable block identifiers and contact risks", () => {
  const blocks = [
    { id: "gallery-empty", type: "gallery", props: { images: [] } },
    { id: "music-empty", type: "music", props: { audioUrl: "" } },
    { id: "chart-mismatch", type: "chart", props: { labels: ["a"], values: [] } },
    {
      id: "contact-invalid",
      type: "contact",
      props: { email: "invalid", instagram: "bad handle" },
    },
  ] as unknown as Block[];

  const result = runPublishPreflight(blocks, 2_000, 1_000);

  assert.ok(result.warnings.includes("相册区块为空：gallery-empty"));
  assert.ok(result.warnings.includes("音乐区块未设置音频：music-empty"));
  assert.ok(result.warnings.includes("图表标签和值数量不一致：chart-mismatch"));
  assert.ok(result.warnings.some((warning) => warning.includes("2 条联系方式")));
  assert.ok(result.warnings.some((warning) => warning.includes("发布体积接近或超过上限")));
});

test("inline asset recovery copy preserves counts and remediation steps", () => {
  const stats = {
    imageCount: 2,
    audioCount: 1,
    totalCount: 3,
    imageBytes: 2_000,
    audioBytes: 1_000,
    totalBytes: 3_000,
  };

  assert.equal(formatInlineAssetStatsText(stats), "图片 2，音频 1");
  assert.match(buildInlineAssetsRecoveryMessage(stats), /图片 2，音频 1/);
  assert.match(buildInlineAssetsRecoveryMessage(stats), /\/api\/assets\/upload/);
});

test("image upload rejects malformed data URLs without making a request", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(null, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await uploadImageDataUrlToSupabaseWithMetadata(
      "not-a-data-url",
      "merchant-1",
      "background",
    );

    assert.equal(result, null);
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image upload preserves its API contract and normalizes metadata", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({
      url: " https://cdn.example.com/image.webp ",
      thumbnailUrl: " https://cdn.example.com/image-thumb.webp ",
      bucket: " page-assets ",
      objectPath: " merchant-assets/merchant-1/image.webp ",
      thumbnailObjectPath: " merchant-assets/merchant-1/image-thumb.webp ",
    });
  }) as typeof fetch;

  try {
    const result = await uploadImageDataUrlToSupabaseWithMetadata(
      "data:image/png;base64,AA==",
      "merchant-1",
      "background",
    );

    assert.equal(capturedUrl, "/api/assets/upload");
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      dataUrl: "data:image/png;base64,AA==",
      merchantHint: "merchant-1",
      folder: "merchant-assets",
      usage: "background",
    });
    assert.deepEqual(result, {
      url: "https://cdn.example.com/image.webp",
      thumbnailUrl: "https://cdn.example.com/image-thumb.webp",
      bucket: "page-assets",
      objectPath: "merchant-assets/merchant-1/image.webp",
      thumbnailObjectPath: "merchant-assets/merchant-1/image-thumb.webp",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("source upload accepts a thumbnail-only response", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      thumbnailUrl: "https://cdn.example.com/product-thumb.webp",
      thumbnailObjectPath: "merchant-assets/merchant-1/product-thumb.webp",
    })) as typeof fetch;

  try {
    const result = await uploadSourceUrlViaServerApiWithMetadata(
      "https://source.example.com/product.jpg",
      "merchant-1",
      "merchant-assets",
      "product-image",
    );

    assert.deepEqual(result, {
      url: "",
      thumbnailUrl: "https://cdn.example.com/product-thumb.webp",
      thumbnailObjectPath: "merchant-assets/merchant-1/product-thumb.webp",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publish optimization keeps blocks untouched when there are no inline assets", async () => {
  const blocks = [
    {
      id: "common-1",
      type: "common",
      props: {
        title: "Published content",
      },
    },
  ] as unknown as Block[];

  const result = await optimizeBlocksForPublishIfNeeded(blocks, {
    merchantHint: "merchant-1",
    uploadCompressionPreset: "balanced",
  });

  assert.equal(result.blocks, blocks);
  assert.equal(result.optimized, false);
  assert.equal(result.summary, null);
});

test("publish optimization externalizes inline audio through the upload API", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input, init) => {
    requestCount += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      url: "https://cdn.example.com/audio.mp3",
    });
  }) as typeof fetch;
  const blocks = [
    {
      id: "music-1",
      type: "music",
      props: {
        audioUrl: "data:audio/mpeg;base64,AA==",
      },
    },
  ] as unknown as Block[];

  try {
    const result = await optimizeBlocksForPublishIfNeeded(blocks, {
      merchantHint: "merchant-1",
      uploadCompressionPreset: "balanced",
    });

    assert.equal(requestCount, 1);
    assert.deepEqual(requestBody, {
      dataUrl: "data:audio/mpeg;base64,AA==",
      merchantHint: "merchant-1",
      folder: "merchant-audio",
      usage: "audio",
    });
    assert.equal((result.blocks[0]?.props as { audioUrl?: string }).audioUrl, "https://cdn.example.com/audio.mp3");
    assert.equal(result.optimized, true);
    assert.match(result.summary ?? "", /外链音频 1\/1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product thumbnail backfill updates legacy products and reuses its cache", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return Response.json({
      thumbnailUrl: "https://cdn.example.com/product-thumb.webp",
    });
  }) as typeof fetch;
  const imageUrl =
    "https://faolla.com/storage/v1/object/public/page-assets/merchant-assets/merchant-1/product.jpg";
  const blocks = [
    {
      id: "product-1",
      type: "product",
      props: {
        products: [
          {
            id: "item-1",
            imageUrl,
          },
        ],
      },
    },
  ] as unknown as Block[];
  const cache = new Map<string, string | null>();

  try {
    const first = await backfillProductThumbnailsInBlocks(blocks, "merchant-1", cache);
    const second = await backfillProductThumbnailsInBlocks(blocks, "merchant-1", cache);
    const firstProduct = (
      first.blocks[0]?.props as {
        products?: Array<{ thumbnailUrl?: string }>;
      }
    ).products?.[0];

    assert.equal(requestCount, 1);
    assert.equal(first.changed, true);
    assert.equal(first.stats.generated, 1);
    assert.equal(firstProduct?.thumbnailUrl, "https://cdn.example.com/product-thumb.webp");
    assert.equal(second.changed, true);
    assert.equal(second.stats.generated, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
