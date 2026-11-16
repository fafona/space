import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createDefaultMerchantPermissionConfig,
  loadPlatformState,
  normalizeMerchantPermissionConfig,
  normalizePlatformState,
  savePlatformState,
  type PlanTemplate,
} from "./platformControlStore";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

test("built-in template optimization preserves the exact existing starter content", () => {
  const templates = normalizePlatformState({}).planTemplates;
  assert.equal(
    createHash("sha256").update(JSON.stringify(templates)).digest("hex"),
    "626d8813dbf746bea91607df855d290d31892c767591ee6b95fed1120c270a8f",
  );
});

test("warm built-in normalization copies the seed once without sharing editable objects", () => {
  const expected = normalizePlatformState({}).planTemplates;
  const originalClone = globalThis.structuredClone;
  let copies = 0;
  globalThis.structuredClone = (...args) => {
    copies += 1;
    return originalClone(...args);
  };
  try {
    const first = normalizePlatformState({ planTemplates: expected }).planTemplates;
    assert.equal(copies, 1, "stored built-in content must not be rebuilt or normalized again");
    first[0].name = "Edited label";
    (first[0].blocks[0] as { props: unknown }).props = { mutated: true };
    first[0].blocks.push({ id: "caller-only", type: "text", props: {} });
    const second = normalizePlatformState({}).planTemplates;
    assert.deepEqual(second, expected);
    assert.notEqual(second[0].blocks[0], expected[0].blocks[0]);
  } finally {
    globalThis.structuredClone = originalClone;
  }
});

test("built-in template JSON fallback also returns an independent exact snapshot", () => {
  const expected = normalizePlatformState({}).planTemplates;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
  Object.defineProperty(globalThis, "structuredClone", { configurable: true, writable: true, value: undefined });
  try {
    const first = normalizePlatformState({}).planTemplates;
    assert.deepEqual(first, expected);
    (first[0].blocks[0] as { props: unknown }).props = { mutated: true };
    assert.deepEqual(normalizePlatformState({}).planTemplates, expected);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "structuredClone", descriptor);
    else Reflect.deleteProperty(globalThis, "structuredClone");
  }
});

test("built-in metadata overrides and custom template content retain their existing policies", () => {
  const builtin = normalizePlatformState({}).planTemplates[0];
  const content = [{ id: "custom-text", type: "text", props: { text: "Customer authored content", image: "https://example.invalid/a.jpg" } }];
  const custom = {
    ...builtin,
    id: "custom-template-kept",
    name: "Custom template",
    blocks: content,
    coverImageUrl: "https://example.invalid/custom.jpg",
    createdAt: "2026-11-15T12:00:00Z",
    updatedAt: "2026-11-16T12:00:00Z",
  };
  const templates = normalizePlatformState({ planTemplates: [null, 3, {}, {
    ...builtin,
    name: "Edited built-in label",
    category: "娱乐",
    blocks: content,
    coverImageUrl: "https://example.invalid/ignored.jpg",
    createdAt: custom.createdAt,
    updatedAt: custom.updatedAt,
  }, custom] }).planTemplates;
  const restored = templates.find((row) => row.id === builtin.id);
  assert.ok(restored);
  assert.equal(restored.name, "Edited built-in label");
  assert.equal(restored.category, "娱乐");
  assert.equal(restored.createdAt, custom.createdAt);
  assert.equal(restored.updatedAt, custom.updatedAt);
  assert.deepEqual(restored.blocks, builtin.blocks);
  assert.equal(restored.coverImageUrl, builtin.coverImageUrl);
  const kept = templates.find((row) => row.id === custom.id);
  assert.ok(kept);
  assert.deepEqual(kept.blocks, content);
  assert.notEqual(kept.blocks[0], content[0]);
  assert.equal(kept.coverImageUrl, custom.coverImageUrl);
});

test("merchant permission config includes default business card background image limit", () => {
  const permission = createDefaultMerchantPermissionConfig();
  assert.equal(permission.businessCardBackgroundImageLimitKb, 200);
  assert.equal(permission.businessCardContactImageLimitKb, 200);
  assert.equal(permission.allowBusinessCardIntroVideo, true);
  assert.equal(permission.businessCardIntroVideoLimitMb, 3);
  assert.equal(permission.commonBlockImageLimitKb, 300);
  assert.equal(permission.galleryBlockImageLimitKb, 300);
  assert.equal(permission.allowBookingEmailPrefill, false);
  assert.equal(permission.allowOrderManagement, false);
  assert.equal(permission.allowEnterpriseManagement, false);
  assert.equal(permission.allowCouponModule, false);
  assert.equal(permission.allowCouponBlock, false);
  assert.equal(permission.allowMembershipManagement, false);
  assert.equal(permission.allowPointsRedemption, false);
});

test("merchant permission config keeps order management disabled for legacy product-only configs", () => {
  const permission = normalizeMerchantPermissionConfig({
    allowProductBlock: true,
  });
  assert.equal(permission.allowProductBlock, true);
  assert.equal(permission.allowOrderManagement, false);
});

test("merchant enterprise management permission is independent and defaults closed for legacy configs", () => {
  assert.equal(normalizeMerchantPermissionConfig({}).allowEnterpriseManagement, false);
  assert.equal(
    normalizeMerchantPermissionConfig({
      allowEnterpriseManagement: true,
      allowProductBlock: false,
      allowOrderManagement: false,
    }).allowEnterpriseManagement,
    true,
  );
});

test("merchant permission config keeps coupon block disabled without coupon module", () => {
  const permission = normalizeMerchantPermissionConfig({
    allowCouponBlock: true,
  });
  assert.equal(permission.allowCouponModule, false);
  assert.equal(permission.allowCouponBlock, false);

  const enabled = normalizeMerchantPermissionConfig({
    allowCouponModule: true,
    allowCouponBlock: true,
  });
  assert.equal(enabled.allowCouponModule, true);
  assert.equal(enabled.allowCouponBlock, true);
});

test("merchant permission config keeps points redemption disabled without membership management", () => {
  const permission = normalizeMerchantPermissionConfig({
    allowPointsRedemption: true,
  });
  assert.equal(permission.allowMembershipManagement, false);
  assert.equal(permission.allowPointsRedemption, false);

  const enabled = normalizeMerchantPermissionConfig({
    allowMembershipManagement: true,
    allowPointsRedemption: true,
  });
  assert.equal(enabled.allowMembershipManagement, true);
  assert.equal(enabled.allowPointsRedemption, true);
});

test("merchant config history keeps full entries and persists details outside main state payload", () => {
  const globalTarget = globalThis as typeof globalThis & {
    localStorage?: Storage;
    window?: Window & typeof globalThis;
  };
  const previousWindow = globalTarget.window;
  const previousLocalStorage = globalTarget.localStorage;
  const localStorage = createMemoryStorage();
  const mockWindow = {
    ...globalThis,
    dispatchEvent() {
      return true;
    },
  } as unknown as Window & typeof globalThis;

  globalTarget.localStorage = localStorage;
  globalTarget.window = mockWindow;

  try {
    const state = loadPlatformState();
    const nextHistory = Array.from({ length: 35 }, (_, index) => ({
      id: `history-${index + 1}`,
      at: new Date(Date.UTC(2026, 3, 1, 0, 0, 35 - index)).toISOString(),
      operator: "platform-admin",
      summary: `config update ${index + 1}`,
      changes: [`field ${index + 1}: before -> after`],
      before: {
        serviceExpiresAt: null,
        permissionConfig: createDefaultMerchantPermissionConfig(),
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        chatAvatarImageUrl: "",
        contactVisibility: {
          phoneHidden: false,
          emailHidden: false,
          businessCardHidden: false,
        },
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
      },
      after: {
        serviceExpiresAt: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        permissionConfig: {
          ...createDefaultMerchantPermissionConfig(),
          planLimit: index + 1,
          allowEnterpriseManagement: index === 0,
          allowEmployeeAttendance: index === 0,
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        chatAvatarImageUrl: "",
        contactVisibility: {
          phoneHidden: false,
          emailHidden: false,
          businessCardHidden: false,
        },
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
      },
    }));
    const nextState = {
      ...state,
      sites: state.sites.map((site, index) =>
        index === 0
          ? {
              ...site,
              configHistory: nextHistory,
            }
          : site,
      ),
    };

    assert.equal(savePlatformState(nextState), true);

    const reloaded = loadPlatformState();
    assert.equal(reloaded.sites[0]?.configHistory?.length, 35);
    assert.deepEqual(reloaded.sites[0]?.configHistory?.[0]?.changes, ["field 1: before -> after"]);
    assert.equal(
      reloaded.sites[0]?.configHistory?.[0]?.after.permissionConfig.allowEnterpriseManagement,
      true,
    );
    assert.equal(reloaded.sites[0]?.configHistory?.[0]?.after.permissionConfig.allowEmployeeAttendance, true);
    assert.equal(reloaded.sites[0]?.configHistory?.[1]?.after.permissionConfig.allowEmployeeAttendance, false);

    const primaryStateRaw = localStorage.getItem("merchant-space:platform-control-center:v1");
    assert.ok(primaryStateRaw);
    const primaryState = JSON.parse(primaryStateRaw ?? "{}") as { sites?: Array<{ configHistory?: unknown[] }> };
    assert.equal(Array.isArray(primaryState.sites?.[0]?.configHistory), true);
    assert.equal(primaryState.sites?.[0]?.configHistory?.length ?? 0, 0);

    const storageKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    assert.ok(storageKeys.some((key) => (key ?? "").includes("merchant-config-history")));
  } finally {
    if (previousLocalStorage === undefined) {
      Reflect.deleteProperty(globalTarget, "localStorage");
    } else {
      globalTarget.localStorage = previousLocalStorage;
    }
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalTarget, "window");
    } else {
      globalTarget.window = previousWindow;
    }
  }
});

test("platform state seeds built-in starter templates within new-merchant permissions", () => {
  const globalTarget = globalThis as typeof globalThis & {
    localStorage?: Storage;
    window?: Window & typeof globalThis;
  };
  const previousWindow = globalTarget.window;
  const previousLocalStorage = globalTarget.localStorage;
  const localStorage = createMemoryStorage();
  const mockWindow = {
    ...globalThis,
    dispatchEvent() {
      return true;
    },
  } as unknown as Window & typeof globalThis;

  globalTarget.localStorage = localStorage;
  globalTarget.window = mockWindow;

  try {
    const state = loadPlatformState();

    const serviceBuiltin = state.planTemplates.find((item) => item.id === "builtin-template-new-merchant-service-starter");
    assert.ok(serviceBuiltin);
    assert.equal(serviceBuiltin?.category, "服务");
    const serviceConfig = getPagePlanConfigFromBlocks((serviceBuiltin?.blocks ?? []) as never);
    assert.deepEqual(serviceConfig.plans.map((plan) => plan.id), ["plan-1", "plan-2", "plan-3"]);

    const restaurantBuiltin = state.planTemplates.find((item) => item.id === "builtin-template-restaurant-signature-starter");
    assert.ok(restaurantBuiltin);
    assert.equal(restaurantBuiltin?.category, "餐饮");
    const restaurantConfig = getPagePlanConfigFromBlocks((restaurantBuiltin?.blocks ?? []) as never);
    assert.deepEqual(restaurantConfig.plans.map((plan) => plan.id), ["plan-1", "plan-2", "plan-3"]);

    const organizationBuiltin = state.planTemplates.find((item) => item.id === "builtin-template-organization-network-starter");
    assert.ok(organizationBuiltin);
    assert.equal(organizationBuiltin?.category, "组织");
    const organizationConfig = getPagePlanConfigFromBlocks((organizationBuiltin?.blocks ?? []) as never);
    assert.deepEqual(organizationConfig.plans.map((plan) => plan.id), ["plan-1", "plan-2", "plan-3"]);

    const blockTypes = new Set(
      [...serviceConfig.plans, ...restaurantConfig.plans, ...organizationConfig.plans].flatMap((plan) =>
        plan.pages.flatMap((page) =>
          page.blocks.map((block) => block?.type).filter(Boolean),
        ),
      ),
    );
    assert.deepEqual([...blockTypes].sort(), ["chart", "common", "contact", "hero", "list", "nav", "text"].sort());
  } finally {
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalTarget, "window");
    } else {
      globalTarget.window = previousWindow;
    }
    if (typeof previousLocalStorage === "undefined") {
      Reflect.deleteProperty(globalTarget, "localStorage");
    } else {
      globalTarget.localStorage = previousLocalStorage;
    }
  }
});

test("plan templates are ordered by createdAt descending instead of updatedAt", () => {
  const globalTarget = globalThis as typeof globalThis & {
    localStorage?: Storage;
    window?: Window & typeof globalThis;
  };
  const previousWindow = globalTarget.window;
  const previousLocalStorage = globalTarget.localStorage;
  const localStorage = createMemoryStorage();
  const mockWindow = {
    ...globalThis,
    dispatchEvent() {
      return true;
    },
  } as unknown as Window & typeof globalThis;

  globalTarget.localStorage = localStorage;
  globalTarget.window = mockWindow;

  try {
    const state = loadPlatformState();
    const current = new Date("2026-04-15T06:00:00.000Z").toISOString();
    const olderCreatedAt = new Date("2026-04-10T06:00:00.000Z").toISOString();
    const newerCreatedAt = new Date("2026-04-14T06:00:00.000Z").toISOString();

    const customTemplates: PlanTemplate[] = [
      {
        id: "template-older",
        name: "Older template",
        category: "服务",
        sourceSiteId: "site:older",
        sourceSiteName: "Older source",
        sourceSiteDomain: "older.example",
        sourceIndustry: "服务",
        coverImageUrl: "",
        previewImageUrl: "",
        planPreviewImageUrls: {},
        previewVariant: "",
        blocks: [],
        createdAt: olderCreatedAt,
        updatedAt: current,
      },
      {
        id: "template-newer",
        name: "Newer template",
        category: "服务",
        sourceSiteId: "site:newer",
        sourceSiteName: "Newer source",
        sourceSiteDomain: "newer.example",
        sourceIndustry: "服务",
        coverImageUrl: "",
        previewImageUrl: "",
        planPreviewImageUrls: {},
        previewVariant: "",
        blocks: [],
        createdAt: newerCreatedAt,
        updatedAt: olderCreatedAt,
      },
    ];

    savePlatformState({
      ...state,
      planTemplates: [...state.planTemplates, ...customTemplates],
    });

    const reloaded = loadPlatformState();
    const olderIndex = reloaded.planTemplates.findIndex((item) => item.id === "template-older");
    const newerIndex = reloaded.planTemplates.findIndex((item) => item.id === "template-newer");

    assert.notEqual(olderIndex, -1);
    assert.notEqual(newerIndex, -1);
    assert.ok(newerIndex < olderIndex);
  } finally {
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalTarget, "window");
    } else {
      globalTarget.window = previousWindow;
    }
    if (typeof previousLocalStorage === "undefined") {
      Reflect.deleteProperty(globalTarget, "localStorage");
    } else {
      globalTarget.localStorage = previousLocalStorage;
    }
  }
});
