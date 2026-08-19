import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantEnterpriseInvitationEntryUrl,
  MerchantEnterpriseInvitationEmailError,
  resolveMerchantEnterpriseInvitationEmailConfig,
  sendMerchantEnterpriseInvitationEmail,
} from "@/lib/merchantEnterpriseInvitationEmail.server";

const eventId = "123e4567-e89b-42d3-a456-426614174000";
const employeeId = "923e4567-e89b-42d3-a456-426614174000";
const invitationToken = "A".repeat(43);
const config = {
  apiKey: "re_test_key",
  from: "FAOLLA <invite@faolla.example>",
  replyTo: "support@faolla.example",
  publicOrigin: "https://faolla.example",
};

test("stable invitation URL keeps every credential in the fragment", () => {
  const value = buildMerchantEnterpriseInvitationEntryUrl(
    {
      siteId: "10000000",
      employeeId,
      invitationVersion: 9,
      invitationToken,
    },
    config.publicOrigin,
  );
  const url = new URL(value);
  assert.equal(url.origin, "https://faolla.example");
  assert.equal(url.pathname, "/enterprise/10000000");
  assert.equal(url.search, "");
  assert.equal(url.hash, `#iv=9&it=${invitationToken}`);
  assert.equal(value.includes(employeeId), false);
});

test("Resend delivery uses a stable idempotency key and escaped fragment link", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await sendMerchantEnterpriseInvitationEmail(
    {
      eventId,
      replayCount: 4,
      siteId: "10000000",
      employeeId,
      invitationVersion: 9,
      invitationToken,
      recipientEmail: " Staff@Example.com ",
      employeeDisplayName: "<员工>",
      merchantDisplayName: "示例 & 商户",
    },
    {
      config,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: "message_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    },
  );
  assert.deepEqual(result, { provider: "resend", messageId: "message_123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("idempotency-key"), `enterprise-invite/${eventId}/4`);
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.deepEqual(body.to, ["staff@example.com"]);
  assert.equal(body.html.includes("&lt;员工&gt;"), false);
  assert.equal(body.html.includes("员工"), true);
  assert.equal(body.html.includes("示例 &amp; 商户"), true);
  assert.equal(body.html.includes("?t="), false);
  assert.equal(body.html.includes(`#iv=9&amp;it=${invitationToken}`), true);
  assert.equal(body.html.includes(employeeId), false);
});

test("Resend failures return safe retry decisions without provider text", async () => {
  const cases = [
    {
      status: 409,
      body: { name: "concurrent_idempotent_requests", message: "secret@example.com" },
      code: "invitation_email_provider_temporarily_unavailable",
      retryable: true,
    },
    {
      status: 409,
      body: { name: "invalid_idempotent_request", message: "secret@example.com" },
      code: "invitation_email_idempotency_conflict",
      retryable: false,
    },
    {
      status: 422,
      body: { name: "validation_error", message: "secret@example.com" },
      code: "invitation_email_provider_rejected",
      retryable: false,
    },
  ];
  for (const item of cases) {
    await assert.rejects(
      sendMerchantEnterpriseInvitationEmail(
        {
          eventId,
          replayCount: 0,
          siteId: "10000000",
          employeeId,
          invitationVersion: 1,
          invitationToken,
          recipientEmail: "staff@example.com",
        },
        {
          config,
          fetchImpl: (async () =>
            new Response(JSON.stringify(item.body), {
              status: item.status,
              headers: { "retry-after": "12" },
            })) as typeof fetch,
        },
      ),
      (error: unknown) => {
        assert.equal(error instanceof MerchantEnterpriseInvitationEmailError, true);
        const invitationError = error as MerchantEnterpriseInvitationEmailError;
        assert.equal(invitationError.code, item.code);
        assert.equal(invitationError.retryable, item.retryable);
        assert.equal(String(error).includes("secret@example.com"), false);
        return true;
      },
    );
  }
});

test("Resend idempotency is stable for retries and rotates only for explicit replay", async () => {
  const keys: string[] = [];
  const deliver = (replayCount: number) =>
    sendMerchantEnterpriseInvitationEmail(
      {
        eventId,
        replayCount,
        siteId: "10000000",
        employeeId,
        invitationVersion: 9,
        invitationToken,
        recipientEmail: "staff@example.com",
      },
      {
        config,
        fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
          keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
          return new Response(JSON.stringify({ id: `message_${keys.length}` }), {
            status: 200,
          });
        }) as typeof fetch,
      },
    );
  await deliver(2);
  await deliver(2);
  await deliver(3);
  assert.deepEqual(keys, [
    `enterprise-invite/${eventId}/2`,
    `enterprise-invite/${eventId}/2`,
    `enterprise-invite/${eventId}/3`,
  ]);
});

test("email configuration is explicit and rejects insecure public origins", () => {
  assert.deepEqual(
    resolveMerchantEnterpriseInvitationEmailConfig({
      RESEND_API_KEY: "re_key",
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM: "invite@faolla.example",
      MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN: "https://faolla.example",
    }),
    {
      apiKey: "re_key",
      from: "invite@faolla.example",
      publicOrigin: "https://faolla.example",
    },
  );
  assert.throws(
    () =>
      resolveMerchantEnterpriseInvitationEmailConfig({
        RESEND_API_KEY: "re_key",
        MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM: "invite@faolla.example",
        MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN: "http://faolla.example",
      }),
    /invitation_public_origin_invalid/,
  );
});
