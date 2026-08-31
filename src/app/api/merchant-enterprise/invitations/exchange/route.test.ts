import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { User } from "@supabase/supabase-js";
import {
  createMerchantEnterpriseInvitationExchangeHandler,
  resolveMerchantEnterpriseInvitationExchangeConfig,
  type MerchantEnterpriseInvitationExchangeDependencies,
} from "@/app/api/merchant-enterprise/invitations/exchange/route";

const siteId = "10000000";
const employeeId = "923e4567-e89b-42d3-a456-426614174000";
const authUserId = "823e4567-e89b-42d3-a456-426614174000";
const issuanceId = "123e4567-e89b-42d3-a456-426614174000";
const invitationToken = "A".repeat(43);
const email = "staff@example.com";
const emailHash = createHash("sha256").update(email).digest("hex");
const redirectTo =
  `https://faolla.example/enterprise/${siteId}?onboarding=initial-password`;

function user(overrides: Partial<User> = {}): User {
  return {
    id: authUserId,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: undefined,
    phone: "",
    confirmed_at: undefined,
    last_sign_in_at: undefined,
    app_metadata: {
      principal_type: "merchant_staff",
      merchant_staff_email_hash: emailHash,
    },
    user_metadata: {},
    identities: [],
    created_at: "2026-08-19T10:00:00.000Z",
    updated_at: "2026-08-19T10:00:00.000Z",
    is_anonymous: false,
    ...overrides,
  };
}

function generated(type: "invite" | "magiclink", generatedUser = user()) {
  const hashedToken = `hashed-${type}`;
  const action = new URL("https://project.supabase.co/auth/v1/verify");
  action.searchParams.set("token", hashedToken);
  action.searchParams.set("type", type);
  action.searchParams.set("redirect_to", redirectTo);
  return {
    data: {
      user: generatedUser,
      properties: {
        action_link: action.toString(),
        hashed_token: hashedToken,
        redirect_to: redirectTo,
        verification_type: type,
      },
    },
    error: null,
  };
}

function request(overrides: Record<string, string> = {}, headers: HeadersInit = {}) {
  const form = new URLSearchParams({
    siteId,
    invitationVersion: "7",
    invitationToken,
    attemptId: issuanceId,
    ...overrides,
  });
  return new Request(
    "https://faolla.example/api/merchant-enterprise/invitations/exchange",
    {
      method: "POST",
      headers: {
        Origin: "https://faolla.example",
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: form.toString(),
    },
  );
}

function dependencies(options: {
  currentUser?: User;
  generate?: MerchantEnterpriseInvitationExchangeDependencies["authAdmin"]["generateLink"];
  calls?: string[];
} = {}): MerchantEnterpriseInvitationExchangeDependencies {
  const calls = options.calls ?? [];
  return {
    config: {
      publicOrigin: "https://faolla.example",
      publicSupabaseOrigin: "https://project.supabase.co",
      issuanceLeaseSeconds: 3900,
    },
    rpcClient: {
      rpc: async (name, args) => {
        calls.push(name);
        if (name.includes("begin")) {
          return {
            data: {
              allowed: true,
              duplicate_attempt: false,
              issuance_id: issuanceId,
              lease_until: "2026-08-19T11:05:00.000Z",
              retry_after_seconds: 0,
              merchant_id: siteId,
              employee_id: employeeId,
              employee_version: 3,
              invitation_version: 7,
              auth_user_id: authUserId,
              email,
              email_hash: emailHash,
            },
            error: null,
          };
        }
        if (name.includes("mark")) {
          return {
            data: { issued: true, issuance_id: issuanceId },
            error: null,
          };
        }
        if (name.includes("recheck")) {
          return {
            data: { valid: true, issuance_id: issuanceId },
            error: null,
          };
        }
        if (name.includes("release")) {
          const input = (args as { p_input?: Record<string, unknown> }).p_input;
          assert.equal("token_hash" in (input ?? {}), false);
          return { data: { released: true, issuance_id: issuanceId }, error: null };
        }
        throw new Error(`unexpected_rpc:${name}`);
      },
    },
    authAdmin: {
      getUserById: async () => ({
        data: { user: options.currentUser ?? user() },
        error: null,
      }),
      generateLink:
        options.generate ??
        (async ({ type }) => {
          calls.push(`generate:${type}`);
          return generated(type);
        }),
    },
  };
}

test("unconfirmed staff receives a validated invite action link before mark and recheck", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInvitationExchangeHandler(
    dependencies({ calls }),
  )(request());
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /type=invite/);
  assert.equal((response.headers.get("location") ?? "").includes(invitationToken), false);
  assert.deepEqual(calls, [
    "faolla_begin_merchant_employee_invitation_exchange_v1",
    "generate:invite",
    "faolla_mark_merchant_employee_invitation_exchange_issued_v1",
    "faolla_recheck_merchant_employee_invitation_exchange_v1",
  ]);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("confirmed staff uses magiclink", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInvitationExchangeHandler(
    dependencies({
      calls,
      currentUser: user({ email_confirmed_at: "2026-08-19T10:00:00.000Z" }),
    }),
  )(request());
  assert.equal(response.status, 303);
  assert.equal(calls.includes("generate:magiclink"), true);
});

test("pre-generation identity mismatch releases the claimed issuance", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInvitationExchangeHandler(
    dependencies({ calls, currentUser: user({ email: "other@example.com" }) }),
  )(request());
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `/enterprise/${siteId}?invitation_error=unavailable&retry_after=0`,
  );
  assert.equal(
    calls.includes("faolla_release_merchant_employee_invitation_exchange_v1"),
    true,
  );
  assert.equal(calls.some((call) => call.startsWith("generate:")), false);
});

test("a failure after generateLink starts never releases the issuance", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInvitationExchangeHandler(
    dependencies({
      calls,
      generate: async ({ type }) => {
        calls.push(`generate:${type}`);
        return { data: { user: null, properties: null }, error: new Error("down") };
      },
    }),
  )(request());
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /invitation_error=unavailable/);
  assert.equal(
    calls.includes("faolla_release_merchant_employee_invitation_exchange_v1"),
    false,
  );
});

test("an untrusted generated action URL is never marked and keeps the issuance lease", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInvitationExchangeHandler(
    dependencies({
      calls,
      generate: async ({ type }) => {
        calls.push(`generate:${type}`);
        const value = generated(type);
        value.data.properties.action_link = value.data.properties.action_link.replace(
          "https://project.supabase.co",
          "https://evil.example",
        );
        return value;
      },
    }),
  )(request());
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /invitation_error=unavailable/);
  assert.equal(calls.some((call) => call.includes("mark_merchant")), false);
  assert.equal(calls.some((call) => call.includes("release_merchant")), false);
});

test("invite email-exists race refetches the same UUID before one magiclink fallback", async () => {
  const calls: string[] = [];
  let gets = 0;
  const deps = dependencies({ calls });
  deps.authAdmin.getUserById = async (id) => {
    assert.equal(id, authUserId);
    gets += 1;
    return {
      data: {
        user: user(
          gets === 1
            ? {}
            : { email_confirmed_at: "2026-08-19T10:00:01.000Z" },
        ),
      },
      error: null,
    };
  };
  deps.authAdmin.generateLink = async ({ type }) => {
    calls.push(`generate:${type}`);
    return type === "invite"
      ? {
          data: { user: null, properties: null },
          error: { code: "email_exists", message: "already registered" },
        }
      : generated("magiclink", user({ email_confirmed_at: "2026-08-19T10:00:01.000Z" }));
  };
  const response = await createMerchantEnterpriseInvitationExchangeHandler(deps)(
    request(),
  );
  assert.equal(response.status, 303);
  assert.equal(gets, 2);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("generate:")),
    ["generate:invite", "generate:magiclink"],
  );
});

test("cooldown is a no-store portal 303 with Retry-After and does not touch Auth", async () => {
  let authCalls = 0;
  const deps = dependencies();
  deps.rpcClient.rpc = async () => ({
    data: {
      allowed: false,
      reason: "issuance_cooldown",
      retry_after_seconds: 119,
    },
    error: null,
  });
  deps.authAdmin.getUserById = async () => {
    authCalls += 1;
    return { data: { user: null }, error: null };
  };
  const response = await createMerchantEnterpriseInvitationExchangeHandler(deps)(
    request(),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("retry-after"), "119");
  assert.equal(
    response.headers.get("location"),
    `/enterprise/${siteId}?invitation_error=rate_limited&retry_after=119`,
  );
  assert.equal(authCalls, 0);
});

test("cross-origin and non-native forms fail before database access", async () => {
  let rpcCalls = 0;
  const deps = dependencies();
  deps.rpcClient.rpc = async () => {
    rpcCalls += 1;
    return { data: null, error: null };
  };
  const handler = createMerchantEnterpriseInvitationExchangeHandler(deps);
  assert.equal(
    (await handler(request({}, { Origin: "https://evil.example" }))).status,
    403,
  );
  const jsonRequest = new Request(
    "https://faolla.example/api/merchant-enterprise/invitations/exchange",
    {
      method: "POST",
      headers: { Origin: "https://faolla.example", "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const invalidResponse = await handler(jsonRequest);
  assert.equal(invalidResponse.status, 303);
  assert.equal(
    invalidResponse.headers.get("location"),
    "/enterprise?invitation_error=invalid&retry_after=0",
  );
  assert.equal(rpcCalls, 0);
});

test("malformed credentials with a valid site redirect only to that fixed site", async () => {
  let rpcCalls = 0;
  const deps = dependencies();
  deps.rpcClient.rpc = async () => {
    rpcCalls += 1;
    return { data: null, error: null };
  };
  const response = await createMerchantEnterpriseInvitationExchangeHandler(deps)(
    request({ invitationToken: "bad" }),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `/enterprise/${siteId}?invitation_error=invalid&retry_after=0`,
  );
  assert.equal(rpcCalls, 0);
});

test("exchange config requires lease TTL to cover Auth link TTL plus skew", () => {
  assert.throws(() =>
    resolveMerchantEnterpriseInvitationExchangeConfig({
      MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN: "https://faolla.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS: "3600",
      MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS: "3899",
    }),
  );
  assert.equal(
    resolveMerchantEnterpriseInvitationExchangeConfig({
      MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN: "https://faolla.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    }).issuanceLeaseSeconds,
    3900,
  );
});
