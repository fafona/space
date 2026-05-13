import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import {
  buildMerchantLocalBusinessJsonLd,
  buildMerchantSeoCanonicalUrl,
  buildMerchantSeoDescription,
  buildMerchantSitemapEntry,
  getMerchantSeoReadiness,
  isMerchantSeoIndexable,
  type MerchantSeoProfile,
} from "./merchantSeo";

const completeProfile: MerchantSeoProfile = {
  id: "10000001",
  merchantName: "ABC",
  industry: "餐饮",
  location: {
    countryCode: "ES",
    country: "Spain",
    province: "Sevilla",
    city: "Sevilla",
  },
  contactAddress: "Calle 1",
  contactPhone: "+34 600000000",
  contactEmail: "abc@example.com",
  signature: "ABC restaurant in Sevilla.",
  status: "online",
  serviceExpiresAt: "2099-01-01T00:00:00.000Z",
};

test("reports merchant SEO readiness from required public profile fields", () => {
  const readiness = getMerchantSeoReadiness(completeProfile);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.requiredCompleteCount, readiness.requiredTotal);

  const missingPhone = getMerchantSeoReadiness({ ...completeProfile, contactPhone: "" });
  assert.equal(missingPhone.ready, false);
  assert.equal(missingPhone.required.find((item) => item.key === "phone")?.complete, false);
});

test("builds canonical URLs and indexable sitemap entries for complete online merchants", () => {
  assert.equal(buildMerchantSeoCanonicalUrl(completeProfile, "https://www.faolla.com"), "https://www.faolla.com/site/10000001");
  assert.equal(
    buildMerchantSeoCanonicalUrl({ ...completeProfile, domainPrefix: "abc" }, "https://www.faolla.com"),
    "https://abc.faolla.com",
  );
  assert.equal(isMerchantSeoIndexable(completeProfile), true);

  const entry = buildMerchantSitemapEntry(
    {
      ...completeProfile,
      id: "10000001",
      name: "ABC",
      domainPrefix: "abc",
      domain: "abc.faolla.com",
      category: "餐饮",
      industry: "餐饮",
      sortConfig: createDefaultMerchantSortConfig(),
      createdAt: "2026-05-01T00:00:00.000Z",
    },
    "https://www.faolla.com",
  );
  assert.equal(entry?.url, "https://abc.faolla.com");
  assert.equal(entry?.changeFrequency, "weekly");
});

test("builds local business JSON-LD without hidden contact fields", () => {
  const jsonLd = buildMerchantLocalBusinessJsonLd(
    {
      ...completeProfile,
      contactVisibility: {
        phoneHidden: true,
        emailHidden: true,
        businessCardHidden: false,
      },
    },
    "https://www.faolla.com",
  );

  assert.equal(jsonLd?.["@type"], "Restaurant");
  assert.equal(jsonLd?.telephone, undefined);
  assert.equal(jsonLd?.email, undefined);
  assert.equal((jsonLd?.contactPoint as Record<string, unknown> | undefined)?.telephone, undefined);
  assert.equal((jsonLd?.contactPoint as Record<string, unknown> | undefined)?.email, undefined);
});

test("adds Google local business fields when precise location and hours are available", () => {
  const jsonLd = buildMerchantLocalBusinessJsonLd(
    {
      ...completeProfile,
      industry: "restaurant",
      domainPrefix: "abc",
      latitude: "37.389092",
      longitude: "-5.984459",
      priceRange: "$$",
      sameAs: ["https://www.instagram.com/abc/", "not-a-url", "https://www.instagram.com/abc/"],
      openingHoursSpecification: [
        {
          dayOfWeek: ["Monday", "https://schema.org/Tuesday"],
          opens: "9:00",
          closes: "18:30",
        },
      ],
    },
    "https://www.faolla.com",
  );

  assert.equal(jsonLd?.["@type"], "Restaurant");
  assert.deepEqual(jsonLd?.geo, {
    "@type": "GeoCoordinates",
    latitude: 37.389092,
    longitude: -5.984459,
  });
  assert.equal(jsonLd?.hasMap, "https://www.google.com/maps/search/?api=1&query=37.389092%2C-5.984459");
  assert.deepEqual(jsonLd?.openingHoursSpecification, [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday"],
      opens: "09:00",
      closes: "18:30",
    },
  ]);
  assert.equal(jsonLd?.priceRange, "$$");
  assert.deepEqual(jsonLd?.sameAs, ["https://www.instagram.com/abc/"]);
});

test("uses merchant location and industry in default SEO descriptions", () => {
  assert.equal(
    buildMerchantSeoDescription({ ...completeProfile, signature: "" }),
    "ABC，餐饮，Spain / Sevilla / Sevilla。通过 Faolla 查看商户信息、联系方式和服务。",
  );
});
