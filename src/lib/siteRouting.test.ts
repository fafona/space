import assert from "node:assert/strict";
import test from "node:test";
import { buildMerchantFrontendHref, extractMerchantPrefixFromHost } from "./siteRouting";

type WindowStub = {
  location: {
    host: string;
    protocol: string;
  };
};

test("buildMerchantFrontendHref prefers runtime host over mismatched env base domain", () => {
  const previousWindow = globalThis.window;
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;

  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "www.fafona.com";
  Object.assign(globalThis, {
    window: {
      location: {
        host: "faolla.com",
        protocol: "https:",
      },
    } satisfies WindowStub,
  });

  try {
    assert.equal(buildMerchantFrontendHref("10000000", "demo"), "https://demo.faolla.com");
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("extractMerchantPrefixFromHost still resolves prefix when configured base domain is stale", () => {
  assert.equal(extractMerchantPrefixFromHost("demo.faolla.com", "www.fafona.com"), "demo");
});

test("buildMerchantFrontendHref never turns internal storage slugs into subdomains", () => {
  const previousWindow = globalThis.window;
  Object.assign(globalThis, {
    window: {
      location: {
        host: "faolla.com",
        protocol: "https:",
      },
    } satisfies WindowStub,
  });

  try {
    assert.equal(
      buildMerchantFrontendHref("10000000", "__merchant_orders__:10000000:chunk:0"),
      "/site/10000000",
    );
  } finally {
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});
