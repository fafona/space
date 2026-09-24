/** Display-only paging. The full directory remains the search/stat/edit source. */
export const MERCHANT_CUSTOMER_PAGE_SIZE = 50;

export function getMerchantCustomerPageWindow(totalCount: number, requestedPage: number) {
  const total = Number.isSafeInteger(totalCount) && totalCount > 0 ? totalCount : 0;
  const pageCount = Math.max(1, Math.ceil(total / MERCHANT_CUSTOMER_PAGE_SIZE));
  const requested = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0;
  const pageIndex = Math.max(0, Math.min(requested, pageCount - 1));
  const start = pageIndex * MERCHANT_CUSTOMER_PAGE_SIZE;
  const end = Math.min(total, start + MERCHANT_CUSTOMER_PAGE_SIZE);
  return { pageIndex, pageCount, start, end, total };
}
