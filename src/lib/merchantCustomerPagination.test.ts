import assert from "node:assert/strict";
import test from "node:test";
import { getMerchantCustomerPageWindow, MERCHANT_CUSTOMER_PAGE_SIZE } from "./merchantCustomerPagination";

test("customer display pages contain no more than fifty rows at every boundary", () => {
  for (const total of [0, 1, 49, 50, 51, 99, 100, 101, 10000, 20001]) {
    const rows = Array.from({ length: total }, (_, id) => ({ id }));
    const seen: unknown[] = [];
    const { pageCount } = getMerchantCustomerPageWindow(total, 0);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = getMerchantCustomerPageWindow(total, pageIndex);
      const visible = rows.slice(page.start, page.end);
      assert.ok(visible.length <= MERCHANT_CUSTOMER_PAGE_SIZE);
      seen.push(...visible);
    }
    assert.deepEqual(seen, rows);
    assert.equal(rows.length, total);
    assert.equal(getMerchantCustomerPageWindow(total, 1000000).end, total);
  }
});

test("empty, shrunk and invalid page requests clamp to an existing display page", () => {
  assert.deepEqual(getMerchantCustomerPageWindow(0, 20), { pageIndex: 0, pageCount: 1, start: 0, end: 0, total: 0 });
  assert.deepEqual(getMerchantCustomerPageWindow(53, 20), { pageIndex: 1, pageCount: 2, start: 50, end: 53, total: 53 });
  for (const requested of [-1, -100, NaN, Infinity, -Infinity]) {
    assert.equal(getMerchantCustomerPageWindow(150, requested).pageIndex, 0);
  }
  assert.equal(getMerchantCustomerPageWindow(150, 1.8).pageIndex, 1);
});
