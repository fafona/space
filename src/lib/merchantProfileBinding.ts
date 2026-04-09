import { normalizeDomainPrefix } from "@/lib/merchantIdentity";

export type MerchantProfileBindingPayload = {
  merchantId: string;
  domainPrefix: string;
  merchantName: string;
};

export const MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES = 26;
export const MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES = 12;
export const MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES = 40;

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

type MerchantProfileBindingValidationResult =
  | {
      ok: true;
      payload: MerchantProfileBindingPayload;
    }
  | {
      ok: false;
      message: string;
    };

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function getUtf8ByteLength(value: string | null | undefined) {
  return new TextEncoder().encode(String(value ?? "")).length;
}

export function truncateUtf8ByBytes(value: string | null | undefined, maxBytes: number) {
  const safeValue = String(value ?? "");
  const safeMaxBytes = Math.max(0, Math.floor(maxBytes));
  if (safeMaxBytes <= 0 || !safeValue) return "";

  let result = "";
  let usedBytes = 0;
  for (const char of safeValue) {
    const charBytes = getUtf8ByteLength(char);
    if (usedBytes + charBytes > safeMaxBytes) break;
    result += char;
    usedBytes += charBytes;
  }
  return result;
}

export function normalizeMerchantProfileDomainPrefixInput(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES);
}

function normalizeMerchantProfileDomainPrefixForValidation(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

export function getMerchantProfileMerchantNameError(value: string | null | undefined) {
  if (getUtf8ByteLength(normalizeText(value)) > MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES) {
    return `名称最多 ${MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES} 字节`;
  }
  return "";
}

export function getMerchantProfileDomainPrefixError(value: string | null | undefined) {
  const normalized = normalizeMerchantProfileDomainPrefixForValidation(value);
  if (!normalized) {
    return `请输入有效前缀（仅支持字母和数字，最多 ${MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES} 字节）`;
  }
  if (!/^[a-z0-9]+$/.test(normalized)) {
    return `请输入有效前缀（仅支持字母和数字，最多 ${MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES} 字节）`;
  }
  if (getUtf8ByteLength(normalized) > MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES) {
    return `前缀最多 ${MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES} 字节（仅支持字母和数字）`;
  }
  if (/^\d{8}$/.test(normalized)) {
    return "前缀不能使用 8 位纯数字（该格式保留给后台地址）";
  }
  return "";
}

export function getMerchantProfileContactNameError(value: string | null | undefined) {
  if (getUtf8ByteLength(normalizeText(value)) > MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES) {
    return `联系人最多 ${MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES} 字节`;
  }
  return "";
}

export function validateMerchantProfileBindingPayload(
  input: MerchantProfileBindingInput | null | undefined,
): MerchantProfileBindingValidationResult {
  const merchantId = normalizeText(input?.merchantId);
  const merchantName = normalizeText(input?.merchantName);
  const normalizedDomainPrefix = normalizeMerchantProfileDomainPrefixForValidation(input?.domainPrefix);

  if (!merchantId) {
    return { ok: false, message: "商户 ID 无效" };
  }

  const domainPrefixError = getMerchantProfileDomainPrefixError(normalizedDomainPrefix);
  if (domainPrefixError) {
    return { ok: false, message: domainPrefixError };
  }

  const merchantNameError = getMerchantProfileMerchantNameError(merchantName);
  if (merchantNameError) {
    return { ok: false, message: merchantNameError };
  }

  return {
    ok: true,
    payload: {
      merchantId,
      domainPrefix: normalizeDomainPrefix(normalizedDomainPrefix),
      merchantName,
    },
  };
}

export function normalizeMerchantProfileBindingPayload(
  input: MerchantProfileBindingInput | null | undefined,
): MerchantProfileBindingPayload | null {
  const result = validateMerchantProfileBindingPayload(input);
  return result.ok ? result.payload : null;
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
