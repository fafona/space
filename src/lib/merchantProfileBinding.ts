import { normalizeDomainPrefix } from "@/lib/merchantIdentity";

export type MerchantProfileBindingPayload = {
  merchantId: string;
  domainPrefix: string;
  merchantName: string;
};

type MerchantProfileBindingInput = {
  merchantId?: unknown;
  domainPrefix?: unknown;
  merchantName?: unknown;
};

type MerchantProfileFields = {
  merchantName?: string | null;
  domainPrefix?: string | null;
};

type PublishedMerchantProfileFields = {
  merchantName?: string | null;
  slug?: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeMerchantProfileBindingPayload(
  input: MerchantProfileBindingInput | null | undefined,
): MerchantProfileBindingPayload | null {
  const merchantId = normalizeText(input?.merchantId);
  const domainPrefix = normalizeDomainPrefix(normalizeText(input?.domainPrefix));
  if (!merchantId || !domainPrefix) return null;
  return {
    merchantId,
    domainPrefix,
    merchantName: normalizeText(input?.merchantName),
  };
}

export function buildPublishedMerchantProfilePatch(
  local: MerchantProfileFields | null | undefined,
  published: PublishedMerchantProfileFields | null | undefined,
) {
  const localMerchantName = normalizeText(local?.merchantName);
  const localDomainPrefix = normalizeDomainPrefix(normalizeText(local?.domainPrefix));
  const publishedMerchantName = normalizeText(published?.merchantName);
  const publishedDomainPrefix = normalizeDomainPrefix(normalizeText(published?.slug));

  return {
    merchantName: localMerchantName ? undefined : publishedMerchantName || undefined,
    domainPrefix: localDomainPrefix ? undefined : publishedDomainPrefix || undefined,
  };
}
