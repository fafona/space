import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersonalAccountPermissionConfig,
  buildPersonalAccountServiceMetadataPatch,
  createDefaultPersonalAccountServiceConfig,
  normalizePersonalAccountServiceConfig,
  readPersonalAccountServiceConfigFromMetadata,
  type PersonalAccountServiceConfig,
} from "./personalAccountServiceConfig";

const restricted: PersonalAccountServiceConfig = {
  servicePaused: true,
  businessCardLimit: 2,
  allowBusinessCardLinkMode: false,
  businessCardBackgroundImageLimitKb: 100,
  businessCardContactImageLimitKb: 200,
};

const forged: PersonalAccountServiceConfig = {
  servicePaused: false,
  businessCardLimit: 100,
  allowBusinessCardLinkMode: true,
  businessCardBackgroundImageLimitKb: 5000,
  businessCardContactImageLimitKb: 5000,
};

const forgedMetadataVariants = {
  nestedSnake: { personal_service_config: forged },
  nestedCamel: { personalServiceConfig: forged },
  flatSnake: {
    personal_service_paused: false,
    personal_business_card_limit: 100,
    personal_allow_business_card_link_mode: true,
    personal_business_card_background_image_limit_kb: 5000,
    personal_business_card_contact_image_limit_kb: 5000,
  },
  flatCamel: {
    personalServicePaused: false,
    personalBusinessCardLimit: 100,
    personalAllowBusinessCardLinkMode: true,
    personalBusinessCardBackgroundImageLimitKb: 5000,
    personalBusinessCardContactImageLimitKb: 5000,
  },
};

for (const [variant, userMetadata] of Object.entries(forgedMetadataVariants)) {
  test(`user-editable ${variant} cannot override administrator service restrictions`, () => {
    assert.deepEqual(
      readPersonalAccountServiceConfigFromMetadata({
        user_metadata: userMetadata,
        app_metadata: { personal_service_config: restricted },
      }),
      restricted,
    );
  });

  test(`untrusted-only ${variant} never grants a legacy custom entitlement`, () => {
    assert.deepEqual(
      readPersonalAccountServiceConfigFromMetadata({ user_metadata: userMetadata }),
      createDefaultPersonalAccountServiceConfig(),
    );
  });
}

test("missing metadata retains the established basic personal service defaults", () => {
  for (const user of [undefined, null, {}, { app_metadata: null, user_metadata: null }]) {
    assert.deepEqual(readPersonalAccountServiceConfigFromMetadata(user), createDefaultPersonalAccountServiceConfig());
  }
});

test("both trusted nested record names retain their supported field aliases", () => {
  for (const recordName of ["personal_service_config", "personalServiceConfig"]) {
    for (const record of [restricted, {
      service_paused: true,
      business_card_limit: "2",
      allow_business_card_link_mode: false,
      business_card_background_image_limit_kb: "100",
      business_card_contact_image_limit_kb: "200",
    }]) {
      assert.deepEqual(
        readPersonalAccountServiceConfigFromMetadata({
          app_metadata: { [recordName]: record },
          user_metadata: { personal_service_config: forged },
        }),
        restricted,
      );
    }
  }
});

test("trusted flat snake and camel aliases remain compatible", () => {
  for (const appMetadata of [forgedMetadataVariants.flatSnake, forgedMetadataVariants.flatCamel]) {
    assert.deepEqual(readPersonalAccountServiceConfigFromMetadata({ app_metadata: appMetadata }), forged);
  }
});

test("partial trusted records fall back only to trusted flat fields or basic defaults", () => {
  assert.deepEqual(
    readPersonalAccountServiceConfigFromMetadata({
      app_metadata: {
        personal_service_config: { servicePaused: false, allowBusinessCardLinkMode: false },
        personal_service_paused: true,
        personal_allow_business_card_link_mode: true,
        personal_business_card_limit: "3",
      },
      user_metadata: { personal_service_config: forged },
    }),
    { ...createDefaultPersonalAccountServiceConfig(), businessCardLimit: 3 },
  );
});

test("malformed trusted metadata cannot fall back to user-supplied entitlements", () => {
  for (const record of [null, "invalid", [], {
    servicePaused: "false",
    businessCardLimit: "not-a-number",
    allowBusinessCardLinkMode: "true",
    businessCardBackgroundImageLimitKb: Infinity,
    businessCardContactImageLimitKb: NaN,
  }]) {
    assert.deepEqual(
      readPersonalAccountServiceConfigFromMetadata({
        app_metadata: { personal_service_config: record },
        user_metadata: { personal_service_config: forged },
      }),
      createDefaultPersonalAccountServiceConfig(),
    );
  }
});

test("trusted zero quotas clamp to the existing minimum and false never falls through", () => {
  assert.deepEqual(
    readPersonalAccountServiceConfigFromMetadata({
      app_metadata: {
        personal_service_config: {
          servicePaused: false,
          businessCardLimit: 0,
          allowBusinessCardLinkMode: false,
          businessCardBackgroundImageLimitKb: "0",
          businessCardContactImageLimitKb: 0,
        },
        personal_service_paused: true,
        personal_business_card_limit: 20,
        personal_allow_business_card_link_mode: true,
      },
      user_metadata: { personal_service_config: forged },
    }),
    {
      servicePaused: false,
      businessCardLimit: 1,
      allowBusinessCardLinkMode: false,
      businessCardBackgroundImageLimitKb: 50,
      businessCardContactImageLimitKb: 50,
    },
  );
});

test("non-finite and blank trusted quota values use defaults instead of mutable metadata", () => {
  for (const invalid of [NaN, Infinity, -Infinity, "", "   ", "NaN", "Infinity", false]) {
    assert.deepEqual(
      readPersonalAccountServiceConfigFromMetadata({
        app_metadata: {
          personal_service_config: {
            businessCardLimit: invalid,
            businessCardBackgroundImageLimitKb: invalid,
            businessCardContactImageLimitKb: invalid,
          },
        },
        user_metadata: { personal_service_config: forged },
      }),
      createDefaultPersonalAccountServiceConfig(),
    );
  }
});

test("blank trusted aliases can only fall through to another trusted alias", () => {
  assert.deepEqual(
    readPersonalAccountServiceConfigFromMetadata({
      app_metadata: {
        personal_business_card_limit: " ",
        personalBusinessCardLimit: " 4 ",
        personal_business_card_background_image_limit_kb: "",
        personalBusinessCardBackgroundImageLimitKb: "150",
      },
      user_metadata: { personal_service_config: forged },
    }),
    { ...createDefaultPersonalAccountServiceConfig(), businessCardLimit: 4, businessCardBackgroundImageLimitKb: 150 },
  );
});

test("administrator-created defaults round-trip without writing mutable entitlement copies", () => {
  const identity = {
    user_metadata: { account_type: "personal", account_id: "80000001", manual_user: true },
    app_metadata: { account_type: "personal", account_id: "80000001", manual_user: true },
  };
  const patch = buildPersonalAccountServiceMetadataPatch(identity, createDefaultPersonalAccountServiceConfig());
  assert.deepEqual(patch.user_metadata, identity.user_metadata);
  assert.equal(patch.app_metadata.account_id, "80000001");
  assert.deepEqual(readPersonalAccountServiceConfigFromMetadata(patch), createDefaultPersonalAccountServiceConfig());
});

test("administrator saves preserve profile and identity while making the new app config authoritative", () => {
  const user = {
    user_metadata: {
      display_name: "Example",
      personal_profile: { favoriteSites: ["10000000"] },
      personal_service_config: forged,
    },
    app_metadata: {
      account_type: "personal",
      account_id: "80000001",
      provider: "email",
      personal_service_config: forged,
    },
  };
  const original = structuredClone(user);
  const patch = buildPersonalAccountServiceMetadataPatch(user, restricted);

  assert.deepEqual(user, original, "building the update must not mutate its source");
  assert.deepEqual(patch.user_metadata, user.user_metadata);
  assert.equal(patch.app_metadata.account_type, "personal");
  assert.equal(patch.app_metadata.account_id, "80000001");
  assert.equal(patch.app_metadata.provider, "email");
  assert.deepEqual(readPersonalAccountServiceConfigFromMetadata(patch), restricted);

  const trustedAliasesOnly = { ...patch.app_metadata };
  delete trustedAliasesOnly.personal_service_config;
  delete trustedAliasesOnly.personalServiceConfig;
  assert.deepEqual(readPersonalAccountServiceConfigFromMetadata({ app_metadata: trustedAliasesOnly }), restricted);
});

test("an administrator partial update does not promote pre-existing user tampering into app metadata", () => {
  const user = {
    user_metadata: { personal_service_config: forged },
    app_metadata: { personal_service_config: restricted },
  };
  const current = readPersonalAccountServiceConfigFromMetadata(user);
  const next = normalizePersonalAccountServiceConfig({ ...current, servicePaused: false });
  const patch = buildPersonalAccountServiceMetadataPatch(user, next);
  assert.deepEqual(readPersonalAccountServiceConfigFromMetadata(patch), { ...restricted, servicePaused: false });

  const permissions = buildPersonalAccountPermissionConfig(readPersonalAccountServiceConfigFromMetadata(patch));
  assert.equal(permissions.businessCardLimit, restricted.businessCardLimit);
  assert.equal(permissions.allowBusinessCardLinkMode, restricted.allowBusinessCardLinkMode);
  assert.equal(permissions.businessCardBackgroundImageLimitKb, restricted.businessCardBackgroundImageLimitKb);
  assert.equal(permissions.businessCardContactImageLimitKb, restricted.businessCardContactImageLimitKb);
});
