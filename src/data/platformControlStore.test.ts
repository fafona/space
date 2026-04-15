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
      operator: "平台管理员",
      summary: `配置更新 ${index + 1}`,
      changes: [`字段 ${index + 1}：旧值 -> 新值`],
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
    assert.deepEqual(reloaded.sites[0]?.configHistory?.[0]?.changes, ["字段 1：旧值 -> 新值"]);

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

test("platform state seeds a built-in starter template within new-merchant permissions", () => {
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
    const builtin = state.planTemplates.find((item) => item.id === "builtin-template-new-merchant-service-starter");
    assert.ok(builtin);
    assert.equal(builtin?.category, "服务");
    const config = getPagePlanConfigFromBlocks((builtin?.blocks ?? []) as never);
    const blockTypes = new Set(
      config.plans.flatMap((plan) =>
        plan.pages.flatMap((page) =>
          page.blocks.map((block) => block?.type).filter((type): type is string => Boolean(type)),
        ),
      ),
    );
    assert.deepEqual(
      [...blockTypes].sort(),
      ["chart", "contact", "hero", "list", "nav", "text"].sort(),
    );
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
