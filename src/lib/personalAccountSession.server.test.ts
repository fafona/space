import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  FrontendPersonalSessionProofError,
  resolvePersonalAccountSessionFromFrontendAuthProofPayload,
  resolvePersonalAccountSessionFromRequest,
  resolvePersonalAccountSessionFromRequestOrFrontendAuthProof,
} from "@/lib/personalAccountSession.server";
import { MERCHANT_AUTH_COOKIE } from "@/lib/merchantAuthSession";

const USER_ID = "66666666-6666-4666-8666-666666666666";
const LEGACY_PROOF_SECRET = "personal-proof-authority-regression-secret";

function signLegacyFrontendProof(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", LEGACY_PROOF_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withPersonalSessionBackend(
  resolverPayload: unknown,
  task: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-personal.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  const user = {
    id: USER_ID,
    email: "personal@example.com",
    user_metadata: {
      account_type: "merchant",
      merchant_id: "99999999",
      personal_id: "forged-personal",
    },
    app_metadata: { personal_id: "forged-personal" },
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") return json(user);
    if (url.pathname === `/auth/v1/admin/users/${USER_ID}`) {
      return json({ user });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return json(resolverPayload);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    await task();
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
}

test("personal session ignores forged metadata and returns only the canonical active account", async () => {
  await withPersonalSessionBackend(
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    },
    async () => {
      const session = await resolvePersonalAccountSessionFromRequest(
        new Request("https://www.faolla.com/api/personal-profile", {
          headers: {
            cookie: `${MERCHANT_AUTH_COOKIE}=personal-access-token`,
          },
        }),
      );
      assert.equal(session?.accountId, "50010105");
      assert.equal(session?.userId, USER_ID);
      assert.equal(session?.email, "personal@example.com");
    },
  );
});

test("personal session rejects merchant, disabled and unbound authoritative results", async () => {
  const denied = [
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "merchant",
      merchantIds: ["12345678"],
      personalAccountId: null,
    },
    {
      schemaVersion: 1,
      status: "disabled",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010106",
    },
    {
      schemaVersion: 1,
      status: "unbound",
      accountType: null,
      merchantIds: [],
      personalAccountId: null,
    },
  ];
  for (const [index, payload] of denied.entries()) {
    await withPersonalSessionBackend(payload, async () => {
      const session = await resolvePersonalAccountSessionFromRequest(
        new Request("https://www.faolla.com/api/personal-profile", {
          headers: {
            cookie: `${MERCHANT_AUTH_COOKIE}=denied-${index}`,
          },
        }),
      );
      assert.equal(session, null);
    });
  }
});

test("frontend proof payloads cannot establish a personal session", async () => {
  await withPersonalSessionBackend(
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    },
    async () => {
      const base = {
        accountType: "personal" as const,
        userId: USER_ID,
        email: "personal@example.com",
        iat: 1,
        exp: 4_000_000_000,
      };
      assert.equal(
        await resolvePersonalAccountSessionFromFrontendAuthProofPayload({
          ...base,
          accountId: "forged-personal",
        }),
        null,
      );
      assert.equal(
        await resolvePersonalAccountSessionFromFrontendAuthProofPayload({
          ...base,
          accountId: "50010105",
        }),
        null,
      );
    },
  );
});

test("a correctly signed legacy two-hour proof is rejected before direct-session resolution", async () => {
  const previousSecret = process.env.FRONTEND_AUTH_PROOF_SECRET;
  process.env.FRONTEND_AUTH_PROOF_SECRET = LEGACY_PROOF_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const proof = signLegacyFrontendProof({
    accountType: "personal",
    accountId: "50010105",
    userId: USER_ID,
    iat: now,
    exp: now + 2 * 60 * 60,
  });

  try {
    let directResolverCalls = 0;
    await assert.rejects(
      () =>
        resolvePersonalAccountSessionFromRequestOrFrontendAuthProof(
          new Request("https://www.faolla.com/api/orders"),
          proof,
          async () => {
            directResolverCalls += 1;
            return null;
          },
        ),
      (error: unknown) =>
        error instanceof FrontendPersonalSessionProofError &&
        error.status === 401,
    );
    assert.equal(directResolverCalls, 0);
  } finally {
    process.env.FRONTEND_AUTH_PROOF_SECRET = previousSecret;
  }
});

test("personal proof rejects shadow-only nonnumeric canonical ids", async () => {
  const accountId = "😀".repeat(128);
  await withPersonalSessionBackend(
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: accountId,
    },
    async () => {
      const session =
        await resolvePersonalAccountSessionFromFrontendAuthProofPayload({
          accountType: "personal",
          accountId,
          userId: USER_ID,
          email: "personal@example.com",
          iat: 1,
          exp: 4_000_000_000,
        });
      assert.equal(session, null);
    },
  );
});

test("an explicitly submitted empty or malformed proof never downgrades to a direct or guest session", async () => {
  await withPersonalSessionBackend(
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    },
    async () => {
      for (const proof of ["", "   ", null, "malformed-proof"]) {
        await assert.rejects(
          () =>
            resolvePersonalAccountSessionFromRequestOrFrontendAuthProof(
              new Request("https://www.faolla.com/api/orders", {
                headers: {
                  cookie:
                    `${MERCHANT_AUTH_COOKIE}=personal-access-token`,
                },
              }),
              proof,
            ),
          (error: unknown) =>
            error instanceof FrontendPersonalSessionProofError &&
            error.status === 401,
        );
      }
    },
  );
});

test("an omitted proof preserves the canonical direct-session path", async () => {
  let directResolverCalls = 0;
  const expectedSession = { marker: "canonical-direct-session" } as unknown as Awaited<
    ReturnType<typeof resolvePersonalAccountSessionFromRequestOrFrontendAuthProof>
  >;

  const session = await resolvePersonalAccountSessionFromRequestOrFrontendAuthProof(
    new Request("https://www.faolla.com/api/orders"),
    undefined,
    async () => {
      directResolverCalls += 1;
      return expectedSession;
    },
  );

  assert.equal(session, expectedSession);
  assert.equal(directResolverCalls, 1);
});

test("all API frontend proof consumers use the canonical personal-session resolver", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const apiRoot = path.join(process.cwd(), "src/app/api");
  const routeFiles: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === "route.ts") routeFiles.push(target);
    }
  };
  visit(apiRoot);

  const directProofVerifiers = routeFiles.filter((file) =>
    fs.readFileSync(file, "utf8").includes("verifyFrontendAuthProof"),
  );
  assert.deepEqual(directProofVerifiers, []);
  for (const route of ["bookings", "orders", "polls", "memberships"]) {
    const source = fs.readFileSync(
      path.join(apiRoot, route, "route.ts"),
      "utf8",
    );
    assert.match(
      source,
      /resolvePersonalAccountSessionFromRequestOrFrontendAuthProof/,
    );
  }

  for (const clientPath of [
    "src/components/MerchantMembershipEntry.tsx",
    "src/components/blocks/BookingBlock.tsx",
    "src/components/blocks/PollBlock.tsx",
    "src/components/blocks/ProductBlock.tsx",
  ]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(process.cwd(), clientPath), "utf8"),
      /frontendAuthProof/,
    );
  }
});
