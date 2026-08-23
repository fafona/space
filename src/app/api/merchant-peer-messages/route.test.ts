import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/api/merchant-peer-messages/route";
import { buildMerchantPeerInboxBlocks } from "@/lib/merchantPeerInbox";
import { MERCHANT_AUTH_COOKIE } from "@/lib/merchantAuthSession";

test("peer GET returns 503 without legacy email data when canonical directory page two fails", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    serverUrl: process.env.SERVER_SUPABASE_URL,
    publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.SERVER_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://peer-directory-failure.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  const currentUserId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const legacyEmail = "legacy-private@example.com";
  const legacyBlocks = buildMerchantPeerInboxBlocks({
    contacts: [
      {
        ownerMerchantId: "50010106",
        contactMerchantId: "50010105",
        contactName: legacyEmail,
        contactEmail: legacyEmail,
        savedAt: "2026-08-19T10:00:00.000Z",
      },
    ],
    threads: [
      {
        threadKey: "50010105::50010106",
        merchantAId: "50010105",
        merchantAName: legacyEmail,
        merchantAEmail: legacyEmail,
        merchantBId: "50010106",
        merchantBName: "50010106",
        merchantBEmail: "",
        updatedAt: "2026-08-19T10:00:00.000Z",
        messages: [],
      },
    ],
  });
  const firstBindingPage = Array.from({ length: 500 }, (_, index) => ({
    auth_user_id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    personal_account_id: String(50010105 + index),
    status: "active",
  }));
  let bindingPageCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: currentUserId,
          email: "current-private@example.com",
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
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010106",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/rest/v1/faolla_personal_accounts") {
      bindingPageCalls += 1;
      if (bindingPageCalls === 1) {
        return new Response(JSON.stringify(firstBindingPage), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": "0-499/501",
          },
        });
      }
      return new Response(JSON.stringify({ message: "page two unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/rest/v1/pages") {
      const decodedSearch = decodeURIComponent(url.search);
      if (decodedSearch.includes("__merchant_peer_inbox__")) {
        return new Response(JSON.stringify({ blocks: legacyBlocks }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("null", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const response = await GET(
      new Request("https://www.faolla.com/api/merchant-peer-messages", {
        headers: { cookie: `${MERCHANT_AUTH_COOKIE}=personal-access-token` },
      }),
    );
    assert.equal(response.status, 503);
    const responseText = await response.text();
    assert.match(responseText, /personal_peer_directory_unavailable/);
    assert.doesNotMatch(responseText, /legacy-private@example\.com/);
    assert.equal(bindingPageCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.serverUrl === undefined) delete process.env.SERVER_SUPABASE_URL;
    else process.env.SERVER_SUPABASE_URL = previous.serverUrl;
    if (previous.publicUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.publicUrl;
    if (previous.anonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anonKey;
    if (previous.serviceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRole;
  }
});
