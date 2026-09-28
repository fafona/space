import type {
  MerchantCustomerProfile,
  MerchantCustomerSource,
  MerchantCustomerStatus,
} from "@/lib/merchantCustomers";

export type MerchantCustomerSearchFilter = {
  query?: string;
  source?: MerchantCustomerSource | "all";
  status?: MerchantCustomerStatus | "all";
};

// Bounds retained derived strings, not the already-loaded directory or total
// JavaScript heap. Overflow rows are still searched in full, without caching.
export const MERCHANT_CUSTOMER_SEARCH_CACHE_CODE_UNITS = 4 * 1024 * 1024;

function normalize(value: unknown) {
  // Exact legacy order: trim and UTF-16 slice BEFORE NFKC expansion/case fold.
  return (typeof value === "string" ? value.trim().slice(0, 320) : "")
    .normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
}

function searchText(customer: MerchantCustomerProfile) {
  return [
    customer.referenceCode,
    customer.memberNo,
    customer.displayName,
    customer.phone,
    customer.email,
    customer.address.country,
    customer.address.province,
    customer.address.city,
    customer.address.postalCode,
    customer.address.line1,
    customer.address.line2,
    customer.tax.name,
    customer.tax.number,
    customer.tax.address,
    customer.notes,
    customer.tags.join(" "),
    Object.entries(customer.customFields).map(([key, value]) => `${key} ${value}`).join(" "),
  ].map(normalize).join(" ");
}

/**
 * Component-owned search corpus for one immutable loaded-directory snapshot.
 * A new response array must create a new corpus; never mutate its rows in place.
 * The manager edits cloned drafts and replaces its array after reads. Nothing
 * is cached globally, by customer ID, across sites or in browser storage.
 *
 * Keep original object references and occurrence order (including duplicate
 * IDs/references). Only an eligible row's first nonempty search builds text;
 * opening the directory, paging, or clearing search does not build haystacks.
 */
export function compileMerchantCustomerSearch<T extends MerchantCustomerProfile>(customers: readonly T[]) {
  const rows = customers.slice();
  const haystacks = new Map<number, string>();
  let cachedCodeUnits = 0;
  return Object.freeze({
    filter(input: MerchantCustomerSearchFilter = {}): T[] {
      const query = normalize(input.query);
      return rows.filter((customer, ordinal) => {
        if (input.source && input.source !== "all" && !customer.sources.includes(input.source)) return false;
        if (input.status && input.status !== "all" && customer.status !== input.status) return false;
        if (!query) return true;
        let haystack = haystacks.get(ordinal);
        if (haystack === undefined) {
          haystack = searchText(customer);
          if (cachedCodeUnits + haystack.length <= MERCHANT_CUSTOMER_SEARCH_CACHE_CODE_UNITS) {
            haystacks.set(ordinal, haystack);
            cachedCodeUnits += haystack.length;
          }
        }
        return haystack.includes(query);
      });
    },
  });
}
