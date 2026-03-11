import test from "node:test";
import assert from "node:assert/strict";
import { MERCHANT_INDUSTRY_OPTIONS } from "@/data/platformControlStore";
import { createDefaultMerchantIndustryTabs, normalizeMerchantIndustryTabs } from "./merchantIndustryTabs";

test("merchant industry options include 组织", () => {
  assert.equal(MERCHANT_INDUSTRY_OPTIONS.includes("组织"), true);
});

test("default merchant industry tabs include 组织", () => {
  const tabs = createDefaultMerchantIndustryTabs();

  assert.equal(tabs.some((item) => item.label === "组织" && item.industry === "组织"), true);
  assert.equal(tabs[0]?.label, "推荐");
  assert.equal(tabs[0]?.industry, "all");
});

test("normalizeMerchantIndustryTabs accepts 组织 as a real industry", () => {
  const tabs = normalizeMerchantIndustryTabs([
    { id: "tab-recommended", label: "推荐", industry: "all" },
    { id: "tab-organization", label: "组织", industry: "组织" },
  ]);

  assert.equal(tabs[1]?.label, "组织");
  assert.equal(tabs[1]?.industry, "组织");
});
