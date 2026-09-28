import type {
  MerchantCustomerActivity,
  MerchantCustomerDirectoryItem,
} from "@/lib/merchantCustomers";

export type MerchantCustomerListItem = Omit<MerchantCustomerDirectoryItem, "activity"> & {
  activity: Pick<
    MerchantCustomerActivity,
    "orderCount" | "bookingCount" | "orderTotals" | "lastActivityAt"
  >;
};

/**
 * Opt-in manager response only: preserve every profile field used by search and
 * whole-profile editing. This shallow projection does not change its input or
 * reduce source reads/aggregation; nested profile values remain shared.
 */
export function toMerchantCustomerListItem(
  customer: MerchantCustomerDirectoryItem,
): MerchantCustomerListItem {
  return {
    ...customer,
    activity: {
      orderCount: customer.activity.orderCount,
      bookingCount: customer.activity.bookingCount,
      orderTotals: customer.activity.orderTotals,
      lastActivityAt: customer.activity.lastActivityAt,
    },
  };
}
