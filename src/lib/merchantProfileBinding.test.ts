import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublishedMerchantProfilePatch,
  normalizeMerchantProfileBindingPayload,
} from "@/lib/merchantProfileBinding";

test("buildPublishedMerchantProfilePatch only backfills empty local fields", () => {
  assert.deepEqual(
    buildPublishedMerchantProfilePatch(
      { merchantName: "本地商户名", domainPrefix: "local-prefix" },
      { merchantName: "线上旧名字", slug: "remote-prefix" },
    ),
    { merchantName: undefined, domainPrefix: undefined },
  );

  assert.deepEqual(
    buildPublishedMerchantProfilePatch(
      { merchantName: "", domainPrefix: "" },
      { merchantName: "线上商户名", slug: "Remote-Prefix" },
    ),
    { merchantName: "线上商户名", domainPrefix: "remote-prefix" },
  );
});

test("normalizeMerchantProfileBindingPayload trims merchant name and normalizes prefix", () => {
  assert.deepEqual(
    normalizeMerchantProfileBindingPayload({
      merchantId: " 10000000 ",
      merchantName: "  Faolla 商户 ",
      domainPrefix: " Faolla-Shop ",
    }),
    {
      merchantId: "10000000",
      merchantName: "Faolla 商户",
      domainPrefix: "faolla-shop",
    },
  );
});

test("normalizeMerchantProfileBindingPayload rejects missing merchant id or prefix", () => {
  assert.equal(
    normalizeMerchantProfileBindingPayload({ merchantId: "10000000", merchantName: "Faolla", domainPrefix: "" }),
    null,
  );
  assert.equal(
    normalizeMerchantProfileBindingPayload({ merchantId: "", merchantName: "Faolla", domainPrefix: "faolla" }),
    null,
  );
});
