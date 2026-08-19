import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/merchant-chat-business-card/route";
import { buildMerchantPeerInboxBlocks } from "@/lib/merchantPeerInbox";

test("business-card GET permits an established peer read while POST remains owner-only", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://unit-test-business-card-peer.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const unrelatedUserId = "33333333-3333-4333-8333-333333333333";
  const peerBlocks = buildMerchantPeerInboxBlocks({
    contacts: [
      {
        ownerMerchantId: "11111111",
        contactMerchantId: "22222222",
        contactName: "Peer",
        contactEmail: "",
        savedAt: "2026-08-19T00:00:00.000Z",
      },
    ],
    threads: [],
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      const authorization = new Headers(init?.headers).get("authorization");
      const userId = authorization === "Bearer unrelated-token"
        ? unrelatedUserId
        : ownerUserId;
      return new Response(
        JSON.stringify({
          id: userId,
          email: `${userId === ownerUserId ? "owner" : "unrelated"}@example.com`,
          user_metadata: {},
          app_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        p_auth_user_id?: string;
      };
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds:
            body.p_auth_user_id === unrelatedUserId
              ? ["33333333"]
              : ["11111111"],
          personalAccountId: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/rest/v1/pages") {
      const slug = url.searchParams.get("slug") ?? "";
      return new Response(
        JSON.stringify(
          slug.includes("__merchant_peer_inbox__")
            ? { blocks: peerBlocks }
            : {},
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const ownerPeerRead = await GET(
      new Request(
        "https://faolla.com/api/merchant-chat-business-card?merchantId=22222222",
        {
          headers: { cookie: "merchant-space-merchant-auth=owner-token" },
        },
      ),
    );
    assert.equal(ownerPeerRead.status, 200);
    assert.equal((await ownerPeerRead.json()).merchantId, "22222222");

    const unrelatedRead = await GET(
      new Request(
        "https://faolla.com/api/merchant-chat-business-card?merchantId=22222222",
        {
          headers: {
            cookie: "merchant-space-merchant-auth=unrelated-token",
          },
        },
      ),
    );
    assert.equal(unrelatedRead.status, 401);

    const peerWrite = await POST(
      new Request("https://faolla.com/api/merchant-chat-business-card", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
          cookie: "merchant-space-merchant-auth=owner-token",
        },
        body: JSON.stringify({
          merchantId: "22222222",
          businessCards: [],
        }),
      }),
    );
    assert.equal(peerWrite.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});
