import assert from "node:assert/strict";
import test from "node:test";
import { getMerchantServiceState, isMerchantServiceExpired } from "./merchantServiceStatus";

test("missing service expiry is treated as expired", () => {
  assert.equal(isMerchantServiceExpired(null, Date.parse("2026-03-31T10:00:00.000Z")), true);
});

test("online merchant with future expiry stays active", () => {
  const state = getMerchantServiceState("online", "2026-04-30T00:00:00.000Z", Date.parse("2026-03-31T10:00:00.000Z"));
  assert.equal(state.maintenance, false);
  assert.equal(state.reason, null);
});

test("maintenance status or expired time both force maintenance mode", () => {
  const paused = getMerchantServiceState("maintenance", "2026-04-30T00:00:00.000Z", Date.parse("2026-03-31T10:00:00.000Z"));
  assert.equal(paused.maintenance, true);
  assert.equal(paused.reason, "paused");

  const expired = getMerchantServiceState("online", "2026-03-01T00:00:00.000Z", Date.parse("2026-03-31T10:00:00.000Z"));
  assert.equal(expired.maintenance, true);
  assert.equal(expired.reason, "expired");
});
