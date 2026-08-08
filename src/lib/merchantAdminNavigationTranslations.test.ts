import assert from "node:assert/strict";
import test from "node:test";

import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import {
  getMerchantAdminCompactNavigationLabel,
  MERCHANT_ADMIN_COMPACT_NAVIGATION_TRANSLATIONS,
  MERCHANT_ADMIN_NAVIGATION_LOCALES,
} from "@/lib/merchantAdminNavigationTranslations";

test("compact merchant navigation translations cover every selectable language", () => {
  const selectableLocales = LANGUAGE_OPTIONS.map((item) => {
    const normalized = item.code.toLowerCase();
    return normalized === "zh-cn" || normalized === "zh-tw"
      ? normalized
      : normalized.split("-")[0];
  }).sort();
  const translatedLocales = [...MERCHANT_ADMIN_NAVIGATION_LOCALES].sort();

  assert.deepEqual(translatedLocales, selectableLocales);
  Object.values(MERCHANT_ADMIN_COMPACT_NAVIGATION_TRANSLATIONS).forEach((translations) => {
    assert.deepEqual(Object.keys(translations).sort(), selectableLocales);
    Object.values(translations).forEach((translation) => {
      assert.ok(translation.trim().length > 0);
      assert.equal(/[\r\n]/.test(translation), false);
      assert.ok([...translation].length <= 24, `navigation label is too long: ${translation}`);
    });
  });
});

test("compact merchant navigation labels use short menu terminology", () => {
  assert.equal(getMerchantAdminCompactNavigationLabel("预约管理", "en-GB"), "Bookings");
  assert.equal(getMerchantAdminCompactNavigationLabel("项目分类", "en-US"), "Categories");
  assert.equal(getMerchantAdminCompactNavigationLabel("经营中心", "es-ES"), "Operaciones");
  assert.equal(getMerchantAdminCompactNavigationLabel("订单管理", "zh-CN"), "订单管理");
});
