import assert from "node:assert/strict";
import test from "node:test";

import {
  addMerchantEnterpriseInitialPasswordOnboarding,
  hasMerchantEnterpriseInitialPasswordOnboarding,
  MERCHANT_ENTERPRISE_INITIAL_PASSWORD_ONBOARDING,
  MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY,
} from "@/lib/merchantEnterpriseInvitationOnboarding";

test("initial-password onboarding preserves the exact enterprise callback target", () => {
  const redirect = new URL(
    addMerchantEnterpriseInitialPasswordOnboarding(
      "https://launch.faolla.com/enterprise/10000000?iv=7&it=credential",
    ),
  );

  assert.equal(redirect.origin, "https://launch.faolla.com");
  assert.equal(redirect.pathname, "/enterprise/10000000");
  assert.equal(redirect.searchParams.get("iv"), "7");
  assert.equal(redirect.searchParams.get("it"), "credential");
  assert.equal(
    redirect.searchParams.get(MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY),
    MERCHANT_ENTERPRISE_INITIAL_PASSWORD_ONBOARDING,
  );
  assert.equal(hasMerchantEnterpriseInitialPasswordOnboarding(redirect.searchParams), true);
});

test("initial-password onboarding requires one exact marker", () => {
  assert.equal(
    hasMerchantEnterpriseInitialPasswordOnboarding(
      new URLSearchParams("onboarding=initial-password&onboarding=initial-password"),
    ),
    false,
  );
  assert.equal(
    hasMerchantEnterpriseInitialPasswordOnboarding(
      new URLSearchParams("onboarding=reset-password"),
    ),
    false,
  );
  assert.equal(hasMerchantEnterpriseInitialPasswordOnboarding(new URLSearchParams()), false);
});
