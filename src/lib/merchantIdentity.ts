import { MERCHANT_ID_REGEX } from "@/lib/merchantIdRules";

export function isMerchantNumericId(value: string | null | undefined) {
  return MERCHANT_ID_REGEX.test(String(value ?? "").trim());
}

export function normalizeDomainPrefix(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

export function normalizeDomainSuffix(value: string | null | undefined) {
  return normalizeDomainPrefix(value);
}
