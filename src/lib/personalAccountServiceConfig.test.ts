import assert from "node:assert/strict";
import test from "node:test";
import {
  readPersonalAccountServiceConfigFromMetadata,
} from "@/lib/personalAccountServiceConfig";

test("mutable user metadata cannot unpause or expand personal service permissions", () => {
  assert.deepEqual(
    readPersonalAccountServiceConfigFromMetadata({
      id: "10000000-0000-4000-8000-000000000001",
      user_metadata: {
        personal_service_config: {
          servicePaused: false,
          businessCardLimit: 100,
          allowBusinessCardLinkMode: true,
          businessCardBackgroundImageLimitKb: 5000,
          businessCardContactImageLimitKb: 5000,
        },
      },
      app_metadata: {
        personal_service_config: {
          servicePaused: true,
          businessCardLimit: 2,
          allowBusinessCardLinkMode: false,
          businessCardBackgroundImageLimitKb: 120,
          businessCardContactImageLimitKb: 240,
        },
      },
    }),
    {
      servicePaused: true,
      businessCardLimit: 2,
      allowBusinessCardLinkMode: false,
      businessCardBackgroundImageLimitKb: 120,
      businessCardContactImageLimitKb: 240,
    },
  );
});

test("user-only service metadata falls back to bounded default permissions", () => {
  assert.deepEqual(
    readPersonalAccountServiceConfigFromMetadata({
      id: "10000000-0000-4000-8000-000000000001",
      user_metadata: {
        personal_service_paused: true,
        personal_business_card_limit: 100,
        personal_allow_business_card_link_mode: true,
      },
      app_metadata: {},
    }),
    {
      servicePaused: false,
      businessCardLimit: 1,
      allowBusinessCardLinkMode: false,
      businessCardBackgroundImageLimitKb: 100,
      businessCardContactImageLimitKb: 200,
    },
  );
});
