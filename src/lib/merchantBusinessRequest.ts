export function readUniqueMerchantBusinessSiteId(
  requestUrl: string | URL,
) {
  const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
  const values = url.searchParams.getAll("siteId");
  if (values.length !== 1) return "";
  const siteId = values[0] ?? "";
  return /^\d{8}$/.test(siteId) ? siteId : "";
}
