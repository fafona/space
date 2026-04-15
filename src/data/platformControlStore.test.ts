import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantPermissionConfig, loadPlatformState, savePlatformState } from "./platformControlStore";
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

test("merchant permission config includes default business card background image limit", () => {
  const permission = createDefaultMerchantPermissionConfig();
  assert.equal(permission.businessCardBackgroundImageLimitKb, 200);
  assert.equal(permission.businessCardContactImageLimitKb, 200);
  assert.equal(permission.commonBlockImageLimitKb, 300);
  assert.equal(permission.galleryBlockImageLimitKb, 300);
  assert.equal(permission.allowBookingEmailPrefill, false);
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

    const primaryStateRaw = localStorage.getItem("merchant-space:platform-control-center:v1");
    assert.ok(primaryStateRaw);
    const primaryState = JSON.parse(primaryStateRaw ?? "{}") as { sites?: Array<{ configHistory?: unknown[] }> };
    assert.equal(Array.isArray(primaryState.sites?.[0]?.configHistory), true);
    assert.equal(primaryState.sites?.[0]?.configHistory?.length ?? 0, 0);

    const storageKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    assert.ok(storageKeys.some((key) => (key ?? "").includes("merchant-config-history")));
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalTarget.localStorage;
    } else {
      globalTarget.localStorage = previousLocalStorage;
    }
    if (previousWindow === undefined) {
      delete globalTarget.window;
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
          page.blocks.map((block) => block?.type).filter((type): type is string => Boolean(type)),
        ),
      ),
    );
    assert.deepEqual([...blockTypes].sort(), ["chart", "common", "contact", "hero", "list", "nav", "text"].sort());
  } finally {
    if (typeof previousWindow === "undefined") {
      delete globalTarget.window;
    } else {
      globalTarget.window = previousWindow;
    }
    if (typeof previousLocalStorage === "undefined") {
      delete globalTarget.localStorage;
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

    const customTemplates = [
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
      delete globalTarget.window;
    } else {
      globalTarget.window = previousWindow;
    }
    if (typeof previousLocalStorage === "undefined") {
      delete globalTarget.localStorage;
    } else {
      globalTarget.localStorage = previousLocalStorage;
    }
  }
});
