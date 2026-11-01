import assert from "node:assert/strict";
import test from "node:test";
import { resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { MERCHANT_AUTH_COOKIE } from "@/lib/merchantAuthSession";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenFor = (id: string, expiresIn = 300) => `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, exp: Math.floor(Date.now()/1000) + expiresIn, amr: [{ method: "password" }] })}.c3ludGhldGlj`;

async function withAuthTransport(status: number, run: () => Promise<void>, id = owner, malformed = false) {
  const previousFetch = globalThis.fetch;
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "FAOLLA_CANONICAL_PORTAL_ORIGIN"];
  const previous = names.map(name => process.env[name]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic-auth.example.test";
  delete process.env.SUPABASE_INTERNAL_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon";
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://faolla.com";
  let requests = 0;
  globalThis.fetch = (async input => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://synthetic-auth.example.test");
    assert.equal(url.pathname, "/auth/v1/user");
    requests++;
    return new Response(malformed ? "{" : JSON.stringify(status === 200 ? { id, email: "owner@example.test" } : { message: "synthetic authentication response" }),
      { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await run();
    assert(requests > 0);
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
}

const request = (id = owner, expected?: string) => new Request("https://faolla.com/api/merchant-enterprise/overview", {
  headers: { "x-merchant-access-token": tokenFor(id), ...(expected === undefined ? {} : { "x-merchant-expected-auth-user-id": expected }) },
});

for (const status of [408, 429, 500, 503]) test(`actual enterprise auth reports upstream ${status} as unavailable, not logged out`, async () => {
  await withAuthTransport(status, async () => {
    await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(request()),
      (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.code === "enterprise_auth_unavailable" && error.status === 503);
  });
});

for (const status of [400, 401, 403]) test(`actual enterprise auth still denies invalid credentials (${status})`, async () => {
  await withAuthTransport(status, async () => {
    await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(request()),
      (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.code === "unauthorized" && error.status === 401);
  });
});

test("actual signed claims, password AMR and validated user binding stay intact", async () => {
  await withAuthTransport(200, async () => {
    const context = await resolveValidatedMerchantEnterpriseAuthContext(request(owner, owner));
    assert.equal(context.user.id, owner);
    assert.deepEqual(context.authenticationMethods, ["password"]);
    for (const expected of [other, ""]) await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(request(owner, expected)),
      (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.status === 401);
  });
  await withAuthTransport(200, async () => {
    await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(request()),
      (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.status === 401);
  }, other);
});

test("an account switch after cookie renewal is rejected before any enterprise data read", async () => {
  await withAuthTransport(200, async () => {
    await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(new Request("https://faolla.com/api/merchant-enterprise/overview", {
      headers: { cookie: `${MERCHANT_AUTH_COOKIE}=${tokenFor(other)}`, "x-merchant-expected-auth-user-id": owner },
    })), (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.status === 401);
  }, other);
});

test("real SDK local JWT expiration remains 401 and can trigger cookie renewal", async () => {
  await withAuthTransport(401, async () => {
    await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(new Request("https://faolla.com/api/merchant-enterprise/overview", {
      headers: { "x-merchant-access-token": tokenFor(owner, -1) },
    })), (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.code === "unauthorized" && error.status === 401);
  });
});

test("malformed upstream identity JSON is unknown, not proof of a logged-out session", async () => {
  await withAuthTransport(200, async () => {
    await assert.rejects(() => resolveValidatedMerchantEnterpriseAuthContext(request()),
      (error: unknown) => error instanceof MerchantEnterpriseAccessError && error.code === "enterprise_auth_unavailable" && error.status === 503);
  }, owner, true);
});
