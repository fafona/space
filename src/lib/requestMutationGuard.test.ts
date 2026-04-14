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
