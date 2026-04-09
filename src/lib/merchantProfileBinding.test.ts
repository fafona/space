import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublishedMerchantProfilePatch,
  getMerchantProfileContactNameError,
  getMerchantProfileDomainPrefixError,
  getMerchantProfileMerchantNameError,
  getUtf8ByteLength,
  normalizeMerchantProfileBindingPayload,
  normalizeMerchantProfileDomainPrefixInput,
  truncateUtf8ByBytes,
  validateMerchantProfileBindingPayload,
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
      domainPrefix: " FaollaShop01 ",
    }),
    {
      merchantId: "10000000",
      merchantName: "Faolla 商户",
      domainPrefix: "faollashop01",
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

test("utf8 byte helpers count and truncate multibyte text safely", () => {
  assert.equal(getUtf8ByteLength("abc"), 3);
  assert.equal(getUtf8ByteLength("商户"), 6);
  assert.equal(truncateUtf8ByBytes("商户A", 6), "商户");
  assert.equal(truncateUtf8ByBytes("商户A", 7), "商户A");
});

test("merchant profile field validators enforce new byte limits", () => {
  assert.equal(getMerchantProfileMerchantNameError("a".repeat(26)), "");
  assert.equal(getMerchantProfileMerchantNameError("商户商户商户商户商户"), "名称最多 26 字节");

  assert.equal(getMerchantProfileContactNameError("联络人"), "");
  assert.equal(getMerchantProfileContactNameError("联".repeat(14)), "联系人最多 40 字节");

  assert.equal(getMerchantProfileDomainPrefixError("shop01"), "");
  assert.equal(
    getMerchantProfileDomainPrefixError("shop-01"),
    "请输入有效前缀（仅支持字母和数字，最多 12 字节）",
  );
  assert.equal(
    getMerchantProfileDomainPrefixError("abcdefghijklmn"),
    "前缀最多 12 字节（仅支持字母和数字）",
  );
});

test("merchant profile prefix input normalization keeps alnum only and clips at 12 bytes", () => {
  assert.equal(normalizeMerchantProfileDomainPrefixInput(" Shop-01_ABC/ "), "shop01abc");
  assert.equal(normalizeMerchantProfileDomainPrefixInput("abcdefghijklmn"), "abcdefghijkl");
});

test("validateMerchantProfileBindingPayload returns field-specific errors", () => {
  assert.deepEqual(
    validateMerchantProfileBindingPayload({
      merchantId: "10000000",
      merchantName: "Faolla",
      domainPrefix: "Shop01",
    }),
    {
      ok: true,
      payload: {
        merchantId: "10000000",
        merchantName: "Faolla",
        domainPrefix: "shop01",
      },
    },
  );

  assert.deepEqual(validateMerchantProfileBindingPayload({
    merchantId: "10000000",
    merchantName: "Faolla",
    domainPrefix: "shop-01",
  }), {
    ok: false,
    message: "请输入有效前缀（仅支持字母和数字，最多 12 字节）",
  });

  assert.deepEqual(validateMerchantProfileBindingPayload({
    merchantId: "10000000",
    merchantName: "联".repeat(9),
    domainPrefix: "shop01",
  }), {
    ok: false,
    message: "名称最多 26 字节",
  });
});
