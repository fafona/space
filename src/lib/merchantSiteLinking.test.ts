import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultMerchantPermissionConfig,
  createDefaultMerchantSortConfig,
  type PlatformUser,
  type Site,
} from "@/data/platformControlStore";
import { buildMerchantSiteLinker } from "./merchantSiteLinking";

function makeSite(input: Partial<Site> & Pick<Site, "id">): Site {
  return {
    id: input.id,
    tenantId: "tenant-1",
    merchantName: input.merchantName ?? "",
    domainPrefix: input.domainPrefix ?? "",
    domainSuffix: input.domainSuffix ?? "",
    contactAddress: "",
    contactName: "",
    contactPhone: "",
    contactEmail: input.contactEmail ?? "",
    name: input.name ?? "",
    domain: input.domain ?? "",
    categoryId: "cat",
    category: "分类",
    industry: input.industry ?? "",
    status: input.status ?? "online",
    publishedVersion: 1,
    lastPublishedAt: null,
    features: {},
    location: {
      countryCode: "",
      country: "",
      provinceCode: "",
      province: "",
      city: "",
    },
    serviceExpiresAt: null,
    permissionConfig: createDefaultMerchantPermissionConfig(),
    merchantCardImageUrl: "",
    sortConfig: createDefaultMerchantSortConfig(),
    configHistory: [],
    createdAt: input.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-03-01T00:00:00.000Z",
  };
}

function makeUser(input: Partial<PlatformUser> & Pick<PlatformUser, "id" | "email" | "siteIds">): PlatformUser {
  return {
    id: input.id,
    name: input.name ?? "",
    email: input.email,
    department: "",
    tenantIds: [],
    siteIds: input.siteIds,
    roleIds: [],
    status: input.status ?? "active",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

test("matches exact merchant id first", () => {
  const site = makeSite({ id: "10000000", domainPrefix: "fafona", contactEmail: "caimin00x@gmail.com" });
  const link = buildMerchantSiteLinker([site], []);
  assert.equal(link({ merchantId: "10000000", email: "other@example.com", siteSlug: "other" })?.id, "10000000");
});

test("matches unique email when exact merchant id site is absent", () => {
  const site = makeSite({ id: "site-merchant-a", contactEmail: "caimin00x@gmail.com", domainPrefix: "fafona" });
  const link = buildMerchantSiteLinker([site], []);
  assert.equal(link({ merchantId: "10000000", email: "caimin00x@gmail.com", siteSlug: "" })?.id, "site-merchant-a");
});

test("matches unique prefix when email is absent", () => {
  const site = makeSite({ id: "site-merchant-a", domainPrefix: "fafona" });
  const link = buildMerchantSiteLinker([site], []);
  assert.equal(link({ merchantId: "10000000", email: "", siteSlug: "fafona" })?.id, "site-merchant-a");
});

test("matches unique site name when prefix is absent", () => {
  const site = makeSite({ id: "site-merchant-a", name: "20889576" });
  const link = buildMerchantSiteLinker([site], []);
  assert.equal(link({ merchantId: "10000001", email: "", siteSlug: "", merchantName: "20889576" })?.id, "site-merchant-a");
});

test("uses owner email from linked platform user", () => {
  const site = makeSite({ id: "site-merchant-a", domainPrefix: "fafona" });
  const user = makeUser({ id: "u-1", email: "owner@example.com", siteIds: ["site-merchant-a"] });
  const link = buildMerchantSiteLinker([site], [user]);
  assert.equal(link({ merchantId: "10000000", email: "owner@example.com", siteSlug: "" })?.id, "site-merchant-a");
});

test("rejects ambiguous email matches", () => {
  const first = makeSite({ id: "site-a", contactEmail: "dup@example.com", domainPrefix: "a" });
  const second = makeSite({ id: "site-b", contactEmail: "dup@example.com", domainPrefix: "b" });
  const link = buildMerchantSiteLinker([first, second], []);
  assert.equal(link({ merchantId: "10000000", email: "dup@example.com", siteSlug: "" }), null);
});

test("rejects ambiguous site name matches", () => {
  const first = makeSite({ id: "site-a", name: "shared-name" });
  const second = makeSite({ id: "site-b", merchantName: "shared-name" });
  const link = buildMerchantSiteLinker([first, second], []);
  assert.equal(link({ merchantId: "10000000", email: "", siteSlug: "", merchantName: "shared-name" }), null);
});

test("ignores site-main for merchant matching", () => {
  const siteMain = makeSite({ id: "site-main", contactEmail: "caimin00x@gmail.com", domainPrefix: "fafona" });
  const link = buildMerchantSiteLinker([siteMain], []);
  assert.equal(link({ merchantId: "10000000", email: "caimin00x@gmail.com", siteSlug: "fafona" }), null);
});
