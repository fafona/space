import assert from "node:assert/strict";
import test from "node:test";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";

test("business requests require one exact numeric site id", () => {
  assert.equal(
    readUniqueMerchantBusinessSiteId(
      "https://www.faolla.com/api/orders?siteId=10000000",
    ),
    "10000000",
  );

  for (const requestUrl of [
    "https://www.faolla.com/api/orders",
    "https://www.faolla.com/api/orders?siteId=10000000&siteId=10000001",
    "https://www.faolla.com/api/orders?siteId=%2010000000",
    "https://www.faolla.com/api/orders?siteId=1000000",
    "https://www.faolla.com/api/orders?siteId=100000000",
    "https://www.faolla.com/api/orders?siteId=abcdefgh",
  ]) {
    assert.equal(readUniqueMerchantBusinessSiteId(requestUrl), "");
  }
});
