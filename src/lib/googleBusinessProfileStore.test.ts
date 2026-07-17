import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGoogleBusinessProfileIntegration } from "./googleBusinessProfileStore";

const encryptedToken = {
  version: 1,
  algorithm: "aes-256-gcm",
  iv: "iv-value",
  authTag: "auth-tag-value",
  ciphertext: "ciphertext-value",
} as const;

test("normalizes encrypted integration data and never accepts plaintext tokens", () => {
  const normalized = normalizeGoogleBusinessProfileIntegration("10000000", {
    version: 1,
    siteId: "10000000",
    tokens: {
      accessToken: encryptedToken,
      refreshToken: encryptedToken,
      expiresAt: "2026-07-18T10:00:00.000Z",
      tokenType: "Bearer",
      scope: "https://www.googleapis.com/auth/business.manage",
    },
    accounts: [{ name: "accounts/123", displayName: "Faolla", type: "PERSONAL", role: "OWNER" }],
    locations: [{
      accountName: "accounts/123",
      name: "locations/456",
      title: "Faolla Madrid",
      address: "Madrid",
      mapsUri: "https://maps.google.com/example",
      newReviewUri: "https://search.google.com/local/writereview?placeid=example",
      websiteUri: "https://www.faolla.com",
    }],
    selectedAccountName: "accounts/123",
    selectedLocationName: "locations/456",
    snapshot: {
      reviews: [{ id: "review-1", reviewerName: "Ana", rating: 5, comment: "Muy bien" }],
      averageRating: 5,
      totalReviewCount: 1,
      syncedAt: "2026-07-18T09:00:00.000Z",
    },
    connectedAt: "2026-07-18T08:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
  });

  assert.equal(normalized?.selectedLocationName, "locations/456");
  assert.equal(normalized?.snapshot?.reviews[0]?.comment, "Muy bien");
  assert.equal(normalized?.tokens.accessToken.ciphertext, "ciphertext-value");

  assert.equal(normalizeGoogleBusinessProfileIntegration("10000000", {
    tokens: { accessToken: "plaintext-token" },
  }), null);
});
