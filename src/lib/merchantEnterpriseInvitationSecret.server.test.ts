import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMerchantEnterpriseInvitationToken,
  hashMerchantEnterpriseInvitationToken,
  merchantEnterpriseInvitationTokenMatchesHash,
  resolveMerchantEnterpriseInvitationSecretKeyring,
} from "@/lib/merchantEnterpriseInvitationSecret.server";

const eventId = "123e4567-e89b-42d3-a456-426614174000";
const employeeId = "923e4567-e89b-42d3-a456-426614174000";
const keyA = Buffer.alloc(32, 17).toString("base64url");
const keyB = Buffer.alloc(32, 23).toString("base64");

function keyring() {
  return resolveMerchantEnterpriseInvitationSecretKeyring({
    MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON: JSON.stringify({
      k1: keyA,
      k2: keyB,
    }),
    MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID: "k2",
  });
}

test("invitation token derivation is deterministic and binds every generation field", () => {
  const ring = keyring();
  const input = {
    eventId,
    siteId: "10000000",
    employeeId,
    invitationVersion: 7,
  };
  const first = deriveMerchantEnterpriseInvitationToken(input, ring);
  const second = deriveMerchantEnterpriseInvitationToken(input, ring);
  assert.deepEqual(first, second);
  assert.equal(first.keyId, "k2");
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.tokenHash, hashMerchantEnterpriseInvitationToken(first.token));
  assert.equal(
    merchantEnterpriseInvitationTokenMatchesHash(first.token, first.tokenHash),
    true,
  );

  for (const changed of [
    { ...input, eventId: "223e4567-e89b-42d3-a456-426614174000" },
    { ...input, siteId: "10000001" },
    { ...input, employeeId: "823e4567-e89b-42d3-a456-426614174000" },
    { ...input, invitationVersion: 8 },
  ]) {
    assert.notEqual(
      deriveMerchantEnterpriseInvitationToken(changed, ring).token,
      first.token,
    );
  }
});

test("invitation key rotation can reproduce an older generation by key id", () => {
  const ring = keyring();
  const input = {
    eventId,
    siteId: "10000000",
    employeeId,
    invitationVersion: 2,
    keyId: "k1",
  };
  const oldToken = deriveMerchantEnterpriseInvitationToken(input, ring);
  assert.equal(oldToken.keyId, "k1");
  assert.notEqual(
    oldToken.token,
    deriveMerchantEnterpriseInvitationToken({ ...input, keyId: "k2" }, ring)
      .token,
  );
});

test("invitation keyring validation fails closed without echoing key material", () => {
  const secret = Buffer.alloc(16, 1).toString("base64url");
  assert.throws(
    () =>
      resolveMerchantEnterpriseInvitationSecretKeyring({
        MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON: JSON.stringify({
          k1: secret,
        }),
        MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID: "k1",
      }),
    (error: unknown) => {
      assert.equal(String(error).includes(secret), false);
      return /invitation_hmac_keyring_invalid/.test(String(error));
    },
  );
  assert.throws(
    () =>
      resolveMerchantEnterpriseInvitationSecretKeyring({
        MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON: JSON.stringify({
          k1: keyA,
        }),
        MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID: "missing",
      }),
    /invitation_hmac_active_key_missing/,
  );
});

test("token comparison rejects malformed or different credentials", () => {
  const derived = deriveMerchantEnterpriseInvitationToken(
    { eventId, siteId: "10000000", employeeId, invitationVersion: 1 },
    keyring(),
  );
  assert.equal(
    merchantEnterpriseInvitationTokenMatchesHash(
      `${derived.token.slice(0, -1)}A`,
      derived.tokenHash,
    ),
    false,
  );
  assert.equal(merchantEnterpriseInvitationTokenMatchesHash("bad", derived.tokenHash), false);
  assert.equal(merchantEnterpriseInvitationTokenMatchesHash(derived.token, "bad"), false);
});
