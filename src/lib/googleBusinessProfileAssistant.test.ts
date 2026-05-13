import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleBusinessProfileReadiness,
  buildGoogleBusinessProfileSearchUrl,
  buildGoogleBusinessProfileWebsiteUrl,
  buildGoogleBusinessProfileWorksheet,
} from "./googleBusinessProfileAssistant";
import type { MerchantSeoProfile } from "./merchantSeo";

const completeProfile: MerchantSeoProfile = {
  id: "10000001",
  merchantName: "ABC Restaurant",
  domainPrefix: "abc",
  industry: "餐饮",
  location: {
    countryCode: "ES",
    country: "Spain",
    province: "Sevilla",
    city: "Sevilla",
  },
  contactAddress: "Calle 1",
  contactName: "Felix",
  contactPhone: "+34 600000000",
  contactEmail: "abc@example.com",
};

test("builds Google Business Profile readiness from merchant data", () => {
  const readiness = buildGoogleBusinessProfileReadiness(completeProfile, "https://abc.faolla.com");

  assert.equal(readiness.ready, true);
  assert.equal(readiness.requiredCompleteCount, readiness.requiredTotal);
  assert.equal(readiness.recommendedCompleteCount, readiness.recommendedTotal);

  const missingPhone = buildGoogleBusinessProfileReadiness({ ...completeProfile, contactPhone: "" }, "https://abc.faolla.com");
  assert.equal(missingPhone.ready, false);
  assert.equal(missingPhone.required.find((item) => item.key === "phone")?.complete, false);
});

test("builds stable Google Business Profile helper URLs and worksheet copy", () => {
  assert.equal(buildGoogleBusinessProfileWebsiteUrl(completeProfile, "https://www.faolla.com"), "https://abc.faolla.com");
  assert.equal(
    buildGoogleBusinessProfileSearchUrl(completeProfile),
    "https://www.google.com/search?q=ABC%20Restaurant%20Sevilla%20Spain",
  );

  const worksheet = buildGoogleBusinessProfileWorksheet(completeProfile, "https://www.faolla.com");
  assert.match(worksheet, /商户名称: ABC Restaurant/);
  assert.match(worksheet, /详细地址: Calle 1, Sevilla, Sevilla, Spain/);
  assert.match(worksheet, /商户网站: https:\/\/abc\.faolla\.com/);
  assert.match(worksheet, /Faolla 商户ID: 10000001/);
});
