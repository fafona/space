import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPersonalCustomerProfileIdentity,
  readPersonalCustomerProfileFromSession,
} from "@/lib/personalCustomerProfile";

test("readPersonalCustomerProfileFromSession ignores merchant sessions", () => {
  const profile = readPersonalCustomerProfileFromSession({
    authenticated: true,
    accountType: "merchant",
    accountId: "10000000",
    user: {
      id: "merchant-user-1",
      email: "owner@example.com",
      user_metadata: {
        personal_profile: {
          displayName: "Merchant Owner",
          phone: "123",
          email: "owner-contact@example.com",
        },
      },
      app_metadata: {},
    },
  });

  assert.deepEqual(profile, {
    accountId: "",
    userId: "",
    name: "",
    phone: "",
    email: "",
    loginEmail: "",
  });
  assert.equal(hasPersonalCustomerProfileIdentity(profile), false);
});

test("readPersonalCustomerProfileFromSession reads personal sessions", () => {
  const profile = readPersonalCustomerProfileFromSession({
    authenticated: true,
    accountType: "personal",
    accountId: "50010105",
    user: {
      id: "personal-user-1",
      email: "PERSONAL@EXAMPLE.COM",
      user_metadata: {
        personal_profile: {
          displayName: "Nana",
          phone: "600100200",
          email: "nana@example.com",
        },
      },
      app_metadata: {},
    },
  });

  assert.deepEqual(profile, {
    accountId: "50010105",
    userId: "personal-user-1",
    name: "Nana",
    phone: "600100200",
    email: "nana@example.com",
    loginEmail: "personal@example.com",
  });
  assert.equal(hasPersonalCustomerProfileIdentity(profile), true);
});
