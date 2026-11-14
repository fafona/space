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

test("launch stays reserved for the canonical app bootstrap", () => {
  assert.equal(extractMerchantPrefixFromHost("launch.faolla.com", "www.faolla.com"), "");
  assert.equal(buildMerchantFrontendHref("10000000", "launch", "www.faolla.com"), "/site/10000000");
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

test("merchant website links use the Faolla root, never nest under the current merchant subdomain", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "www.fafona.com";
  try {
    for (const host of ["faolla.com", "www.faolla.com", "launch.faolla.com", "cyberspace.faolla.com", "other.cyberspace.faolla.com"]) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { host, protocol: "https:" } } });
      assert.equal(buildMerchantFrontendHref("99990002", "haoyouduo"), "https://haoyouduo.faolla.com", host);
      assert.equal(buildMerchantFrontendHref("99990001", "cyberspace"), "https://cyberspace.faolla.com", "self navigation must not duplicate its prefix");
      assert.equal(buildMerchantFrontendHref("99990002", "__internal__"), "/site/99990002");
      assert.equal(buildMerchantFrontendHref("99990002", "launch"), "/site/99990002");
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { host: "cyberspace.faolla.com:8443", protocol: "https:" } } });
    assert.equal(buildMerchantFrontendHref("99990002", "haoyouduo"), "https://haoyouduo.faolla.com:8443");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { host: "portal.example.co.uk", protocol: "https:" } } });
    assert.equal(buildMerchantFrontendHref("99990002", "shop"), "https://shop.example.co.uk", "non-Faolla platform suffix handling is unchanged");
    Reflect.deleteProperty(globalThis, "window");
    assert.equal(buildMerchantFrontendHref("99990002", "haoyouduo", "cyberspace.faolla.com"), "https://haoyouduo.faolla.com", "explicit server bases cannot create nested Faolla merchant domains either");
    assert.equal(buildMerchantFrontendHref("99990002", "shop", "localhost:3000"), "/shop");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousBaseDomain === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN; else process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});
