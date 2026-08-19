import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildPeerWriteDecoration,
  buildPersonalPeerDecoration,
  loadCompletePersonalPeerBindingDirectory,
  redactPersonalPeerIdentityData,
  sanitizePeerDisplayName,
} from "@/lib/merchantPeerPrivacy";

test("personal peer session uses canonical ID when no non-email public name exists", () => {
  assert.deepEqual(
    buildPersonalPeerDecoration({
      accountId: "50010105",
      publicName: "private-login@example.com",
      privateEmail: "private-login@example.com",
    }),
    {
      accountType: "personal",
      merchantId: "50010105",
      merchantName: "50010105",
      merchantEmail: "",
    },
  );
  assert.equal(
    buildPersonalPeerDecoration({
      accountId: "50010105",
      publicName: "Public nickname",
      privateEmail: "private-login@example.com",
    }).merchantName,
    "Public nickname",
  );
});

test("peer display surfaces never use an email-shaped participant name", () => {
  assert.equal(
    sanitizePeerDisplayName("private-login@example.com", "50010105"),
    "50010105",
  );
  assert.equal(
    sanitizePeerDisplayName("Public nickname", "50010105"),
    "Public nickname",
  );
});

test("personal peer directory rejects a second-page failure without returning a partial snapshot", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => ({
    auth_user_id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    personal_account_id: String(50010105 + index),
    status: "active",
  }));
  let calls = 0;
  await assert.rejects(
    loadCompletePersonalPeerBindingDirectory(async () => {
      calls += 1;
      return calls === 1
        ? { data: firstPage, error: null, count: 501 }
        : {
            data: null,
            error: new Error("page two unavailable"),
            count: null,
          };
    }),
    /personal_peer_directory_unavailable/,
  );
  assert.equal(calls, 2);
});

test("personal peer directory rejects malformed and duplicate canonical rows", async () => {
  const valid = {
    auth_user_id: "11111111-1111-4111-8111-111111111111",
    personal_account_id: "50010105",
    status: "active",
  };
  for (const data of [
    null,
    [valid, { ...valid, auth_user_id: "22222222-2222-4222-8222-222222222222" }],
    [{ ...valid, personal_account_id: "50010104" }],
    [{ ...valid, status: "unknown" }],
  ]) {
    await assert.rejects(
      loadCompletePersonalPeerBindingDirectory(async () => ({
        data,
        error: null,
        count: Array.isArray(data) ? data.length : null,
      })),
      /personal_peer_directory_(unavailable|invalid)/,
    );
  }
});

test("personal peer directory rejects a short page before the exact count", async () => {
  await assert.rejects(
    loadCompletePersonalPeerBindingDirectory(async () => ({
      data: [
        {
          auth_user_id: "11111111-1111-4111-8111-111111111111",
          personal_account_id: "50010105",
          status: "active",
        },
      ],
      error: null,
      count: 2,
    })),
    /personal_peer_directory_incomplete/,
  );
});

test("peer GET returns 503 before serializing either list or direct-thread legacy data when the directory fails", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/merchant-peer-messages/route.ts",
    ),
    "utf8",
  );
  const getHandler = source.slice(
    source.indexOf("export async function GET"),
    source.indexOf("export async function POST"),
  );
  assert.match(getHandler, /inboxResponse = await buildInboxResponse\(/);
  assert.match(
    getHandler,
    /personal_peer_directory_unavailable[\s\S]*status: 503/,
  );
  assert.match(getHandler, /const fullThread = inboxResponse\.threads\.find\(/);
  assert.doesNotMatch(
    getHandler,
    /findMerchantPeerThreadForMerchants\(payload/,
  );
  assert.match(
    source,
    /\.order\("personal_account_id", \{ ascending: true \}\)\s*\.range\(from, to\)/,
  );
});

test("ensure_contact and send ignore request-supplied personal email decoration", () => {
  const personal = buildPersonalPeerDecoration({ accountId: "50010105" });
  for (const decoration of [
    buildPeerWriteDecoration(
      personal,
      "private-login@example.com",
      "private-login@example.com",
    ),
    buildPeerWriteDecoration(personal),
  ]) {
    assert.equal(decoration.merchantName, "50010105");
    assert.equal(decoration.merchantEmail, "");
  }
});

test("personal email redaction clears legacy contact and thread persistence", () => {
  const redacted = redactPersonalPeerIdentityData(
    {
      contacts: [
        {
          ownerMerchantId: "12345678",
          contactMerchantId: "50010105",
          contactName: "private-login@example.com",
          contactEmail: "private-login@example.com",
          savedAt: "2026-08-19T10:00:00.000Z",
        },
      ],
      threads: [
        {
          threadKey: "12345678::50010105",
          merchantAId: "12345678",
          merchantAName: "Merchant",
          merchantAEmail: "merchant@example.com",
          merchantBId: "50010105",
          merchantBName: "private-login@example.com",
          merchantBEmail: "private-login@example.com",
          updatedAt: "2026-08-19T10:00:00.000Z",
          messages: [],
        },
      ],
    },
    ["50010105"],
  );
  assert.equal(redacted.contacts[0].contactName, "50010105");
  assert.equal(redacted.contacts[0].contactEmail, "");
  assert.equal(redacted.threads[0].merchantBName, "50010105");
  assert.equal(redacted.threads[0].merchantBEmail, "");
  assert.equal(redacted.threads[0].merchantAEmail, "merchant@example.com");
  assert.doesNotMatch(JSON.stringify(redacted), /private-login@example\.com/);
});
