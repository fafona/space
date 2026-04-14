import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import type { Block } from "@/data/homeBlocks";
import { normalizeMerchantBusinessCards } from "@/lib/merchantBusinessCards";
import { buildPersistedBlocksFromPlanConfig, type PagePlanConfig } from "@/lib/pagePlans";
import {
  getMerchantBusinessCardPermissionViolation,
  getMerchantPublishPermissionViolation,
} from "@/lib/merchantPermissionGuards";

function createPlanConfig(planBlocks: Array<Block[]>, pageCount = 1): PagePlanConfig {
  const normalizedPlanBlocks =
    planBlocks.length > 0 ? planBlocks : [[{ id: "nav-1", type: "nav", props: {} as never } as Block]];
  return {
    activePlanId: "plan-1",
    plans: ["plan-1", "plan-2", "plan-3"].map((planId, index) => {
      const blocks = normalizedPlanBlocks[Math.min(index, normalizedPlanBlocks.length - 1)] ?? normalizedPlanBlocks[0];
      const pages = Array.from({ length: pageCount }, (_, pageIndex) => ({
        id: `page-${pageIndex + 1}`,
        name: `页面${pageIndex + 1}`,
        blocks,
      }));
      return {
        id: planId as "plan-1" | "plan-2" | "plan-3",
        name: `方案${index + 1}`,
        blocks,
        pages,
        activePageId: "page-1",
      };
    }),
  };
}

test("getMerchantPublishPermissionViolation blocks disallowed booking blocks", () => {
  const permission = {
    ...createDefaultMerchantPermissionConfig(),
    planLimit: 3,
  };
  const blocks = buildPersistedBlocksFromPlanConfig(
    createPlanConfig([
      [
        { id: "nav-1", type: "nav", props: {} as never } as Block,
        { id: "booking-1", type: "booking", props: {} as never } as Block,
      ],
    ]),
  );

  const violation = getMerchantPublishPermissionViolation(permission, blocks);

  assert.equal(violation?.code, "booking_block_not_allowed");
});

test("getMerchantPublishPermissionViolation allows duplicated extra plans inside the plan limit guard", () => {
  const permission = {
    ...createDefaultMerchantPermissionConfig(),
    planLimit: 1,
  };
  const repeatedBlocks = [
    { id: "nav-1", type: "nav", props: {} as never } as Block,
    { id: "text-1", type: "text", props: { heading: "A", text: "B" } as never } as Block,
  ];
  const blocks = buildPersistedBlocksFromPlanConfig(
    createPlanConfig([repeatedBlocks, repeatedBlocks, repeatedBlocks]),
  );

  const violation = getMerchantPublishPermissionViolation(permission, blocks);

  assert.equal(violation, null);
});

test("getMerchantPublishPermissionViolation blocks distinct extra plans beyond the allowed plan limit", () => {
  const permission = {
    ...createDefaultMerchantPermissionConfig(),
    planLimit: 1,
    allowButtonBlock: true,
  };
  const blocks = buildPersistedBlocksFromPlanConfig(
    createPlanConfig([
      [{ id: "nav-1", type: "nav", props: {} as never } as Block],
      [
        { id: "nav-2", type: "nav", props: {} as never } as Block,
        { id: "button-1", type: "button", props: { buttonText: "Go" } as never } as Block,
      ],
    ]),
  );

  const violation = getMerchantPublishPermissionViolation(permission, blocks);

  assert.equal(violation?.code, "plan_limit_exceeded");
});

test("getMerchantPublishPermissionViolation blocks plans that exceed the page limit", () => {
  const permission = {
    ...createDefaultMerchantPermissionConfig(),
    planLimit: 3,
    pageLimit: 1,
  };
  const blocks = buildPersistedBlocksFromPlanConfig(
    createPlanConfig([[{ id: "nav-1", type: "nav", props: {} as never } as Block]], 2),
  );

  const violation = getMerchantPublishPermissionViolation(permission, blocks);

  assert.equal(violation?.code, "page_limit_exceeded");
});

test("getMerchantPublishPermissionViolation blocks inserted page backgrounds without permission", () => {
  const permission = {
    ...createDefaultMerchantPermissionConfig(),
    planLimit: 3,
  };
  const blocks = buildPersistedBlocksFromPlanConfig(
    createPlanConfig([
      [
        {
          id: "nav-1",
          type: "nav",
          props: {
            pageBgImageUrl: "https://example.com/bg.webp",
          } as never,
        } as Block,
      ],
    ]),
  );

  const violation = getMerchantPublishPermissionViolation(permission, blocks);

  assert.equal(violation?.code, "insert_background_not_allowed");
});

test("getMerchantBusinessCardPermissionViolation blocks over-limit or link-mode cards", () => {
  const cards = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-04-14T00:00:00.000Z",
      mode: "link",
      name: "fafona",
      imageUrl: "https://example.com/card.webp",
      targetUrl: "https://example.com",
    },
    {
      id: "card-2",
      createdAt: "2026-04-14T00:00:00.000Z",
      mode: "image",
      name: "fafona",
      imageUrl: "https://example.com/card-2.webp",
      targetUrl: "",
    },
  ]);
  const limitViolation = getMerchantBusinessCardPermissionViolation(
    {
      ...createDefaultMerchantPermissionConfig(),
      businessCardLimit: 1,
      allowBusinessCardLinkMode: true,
    },
    cards,
  );
  const linkViolation = getMerchantBusinessCardPermissionViolation(
    {
      ...createDefaultMerchantPermissionConfig(),
      businessCardLimit: 5,
      allowBusinessCardLinkMode: false,
    },
    cards.slice(0, 1),
  );

  assert.equal(limitViolation?.code, "business_card_limit_exceeded");
  assert.equal(linkViolation?.code, "business_card_link_mode_not_allowed");
});
