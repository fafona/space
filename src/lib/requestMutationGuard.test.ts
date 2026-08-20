import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

test("same-origin mutation requests stay allowed behind a reverse proxy when host matches browser origin", () => {
  const request = new Request("http://127.0.0.1:3000/api/super-admin/auth/request", {
    method: "POST",
    headers: {
      host: "faolla.com",
      origin: "https://faolla.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({ account: "felix" }),
  });

  assert.equal(isTrustedSameOriginMutationRequest(request), true);
});

test("trusted forwarded origin is accepted only behind a local proxy host", () => {
  const proxied = new Request("http://127.0.0.1:3000/api/super-admin/auth/request", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "https://console.faolla.com",
      "x-forwarded-host": "console.faolla.com",
      "x-forwarded-proto": "https",
    },
  });
  const spoofed = new Request("https://faolla.com/api/super-admin/auth/request", {
    method: "POST",
    headers: {
      host: "faolla.com",
      origin: "https://console.faolla.com",
      "x-forwarded-host": "console.faolla.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(isTrustedSameOriginMutationRequest(proxied), true);
  assert.equal(isTrustedSameOriginMutationRequest(spoofed), false);
});

test("cross-origin mutation requests are rejected when origin does not match trusted targets", () => {
  const request = new Request("http://127.0.0.1:3000/api/super-admin/auth/request", {
    method: "POST",
    headers: {
      host: "faolla.com",
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ account: "felix" }),
  });

  assert.equal(isTrustedSameOriginMutationRequest(request), false);
});

test("referer-origin fallback still works when origin header is omitted", () => {
  const request = new Request("http://127.0.0.1:3000/api/super-admin/auth/request", {
    method: "POST",
    headers: {
      host: "faolla.com",
      referer: "https://faolla.com/super-admin/login?next=%2Fsuper-admin",
      "content-type": "application/json",
    },
    body: JSON.stringify({ account: "felix" }),
  });

  assert.equal(isTrustedSameOriginMutationRequest(request), true);
});

test("configured portal origin is not accepted for console mutations", () => {
  const previous = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://faolla.com";
  try {
    const request = new Request("https://console.faolla.com/api/super-admin/auth/request", {
      method: "POST",
      headers: {
        host: "console.faolla.com",
        origin: "https://faolla.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ account: "felix" }),
    });
    assert.equal(isTrustedSameOriginMutationRequest(request), false);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
    else process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previous;
  }
});
