import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import { collectPublicSiteImageResourceHints } from "./publicSiteResourceHints";

test("collects first public background images in priority order", () => {
  const blocks = [
    {
      id: "products",
      type: "product",
      props: {
        pageBgImageUrl: "/storage/v1/object/public/page-assets/page.webp",
        bgImageUrl: "/storage/v1/object/public/page-assets/block.webp",
      },
    } as Block,
    {
      id: "gallery",
      type: "gallery",
      props: {
        heading: "Gallery",
        images: [{ url: "/storage/v1/object/public/page-assets/gallery.webp" }],
      },
    } as Block,
  ];

  const hints = collectPublicSiteImageResourceHints(blocks, {
    preferredOrigin: "https://faolla.com",
  });

  assert.deepEqual(hints.imageUrls, [
    "https://faolla.com/storage/v1/object/public/page-assets/page.webp",
    "https://faolla.com/storage/v1/object/public/page-assets/block.webp",
    "https://faolla.com/storage/v1/object/public/page-assets/gallery.webp",
  ]);
  assert.deepEqual(hints.preconnectOrigins, ["https://faolla.com"]);
});

test("skips content images from button-opened blocks", () => {
  const blocks = [
    {
      id: "hidden-products",
      type: "product",
      props: {
        blockOpenMode: "button",
        products: [
          {
            id: "p1",
            name: "Hidden",
            imageUrl: "https://example.com/hidden.webp",
          },
        ],
      },
    } as Block,
    {
      id: "gallery",
      type: "gallery",
      props: {
        heading: "Gallery",
        images: [{ url: "https://example.com/visible.webp" }],
      },
    } as Block,
  ];

  const hints = collectPublicSiteImageResourceHints(blocks);

  assert.deepEqual(hints.imageUrls, ["https://example.com/visible.webp"]);
  assert.deepEqual(hints.preconnectOrigins, ["https://example.com"]);
});

test("ignores unsafe or inline image urls", () => {
  const blocks = [
    {
      id: "gallery",
      type: "gallery",
      props: {
        heading: "Gallery",
        bgImageUrl: "javascript:alert(1)",
        images: ["data:image/png;base64,abc"],
      },
    } as Block,
  ];

  const hints = collectPublicSiteImageResourceHints(blocks);

  assert.deepEqual(hints.imageUrls, []);
  assert.deepEqual(hints.preconnectOrigins, []);
});
