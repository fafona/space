import test from "node:test";
import assert from "node:assert/strict";
import {
  findCardImageUrlInSnapshotSites,
  normalizeCardImageRedirectUrl,
} from "@/app/card/[card]/image/route";
import { createDefaultMerchantBusinessCardDraft, type MerchantBusinessCardAsset } from "./merchantBusinessCards";

function createCard(input: {
  id: string;
  shareKey: string;
  imageUrl?: string;
  shareImageUrl?: string;
}): MerchantBusinessCardAsset {
  return {
    ...createDefaultMerchantBusinessCardDraft({}),
    id: input.id,
    createdAt: "2026-07-18T00:00:00.000Z",
    shareKey: input.shareKey,
    imageUrl: input.imageUrl ?? "",
    ...(input.shareImageUrl ? { shareImageUrl: input.shareImageUrl } : {}),
  };
}

test("card image snapshot lookup prefers the public share image", () => {
  assert.equal(
    findCardImageUrlInSnapshotSites(
      [
        {
          businessCards: [
            createCard({
              id: "card-1",
              shareKey: "card-share-1",
              imageUrl: "https://example.com/editor-image.png",
              shareImageUrl: "https://example.com/public-image.png",
            }),
          ],
        },
      ],
      "CARD-SHARE-1",
    ),
    "https://example.com/public-image.png",
  );
});

test("card image snapshot lookup falls back to the saved image", () => {
  assert.equal(
    findCardImageUrlInSnapshotSites(
      [
        {
          businessCards: [
            createCard({
              id: "card-2",
              shareKey: "card-share-2",
              imageUrl: "https://example.com/saved-image.png",
            }),
          ],
        },
      ],
      "card-share-2",
    ),
    "https://example.com/saved-image.png",
  );
});

test("card image snapshot lookup rejects invalid or unmatched keys", () => {
  const sites = [
    {
      businessCards: [
        createCard({
          id: "card-3",
          shareKey: "card-share-3",
          imageUrl: "https://example.com/card.png",
        }),
      ],
    },
  ];
  assert.equal(findCardImageUrlInSnapshotSites(sites, "invalid key"), "");
  assert.equal(findCardImageUrlInSnapshotSites(sites, "card-share-4"), "");
});

test("card image redirects preserve an already public absolute storage URL", () => {
  assert.equal(
    normalizeCardImageRedirectUrl(
      "https://faolla.com/storage/v1/object/public/page-assets/card.png",
      "https://merchant.example.com",
    ),
    "https://faolla.com/storage/v1/object/public/page-assets/card.png",
  );
});
