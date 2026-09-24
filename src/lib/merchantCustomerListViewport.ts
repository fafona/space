// Match Tailwind's default lg breakpoint. Keep snapshots primitive and stable
// so useSyncExternalStore can select one list without hydration mismatches.
export const MERCHANT_CUSTOMER_DESKTOP_QUERY = "(min-width: 64rem)";

export function getMerchantCustomerDesktopSnapshot() {
  if (typeof window === "undefined") return false;
  return typeof window.matchMedia === "function"
    ? window.matchMedia(MERCHANT_CUSTOMER_DESKTOP_QUERY).matches
    : window.innerWidth >= 1024;
}

export function getMerchantCustomerServerSnapshot() {
  return false;
}

export function subscribeMerchantCustomerViewport(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  if (typeof window.matchMedia !== "function") {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }
  const query = window.matchMedia(MERCHANT_CUSTOMER_DESKTOP_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  // Older embedded browsers expose only the legacy media-query listener API.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}
