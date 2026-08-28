import { buildBackendFaollaHref } from "@/lib/faollaEntry";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

type AccountWorkspaceNavigationInput = {
  accountType: "personal" | "merchant";
  merchantId?: unknown;
  sourceUrl?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildAccountWorkspaceHref({
  accountType,
  merchantId,
  sourceUrl,
}: AccountWorkspaceNavigationInput) {
  if (accountType === "personal") {
    const returnUrl = text(sourceUrl);
    return returnUrl ? buildBackendFaollaHref("/me", returnUrl) : "/me";
  }

  const normalizedMerchantId = text(merchantId);
  return isMerchantNumericId(normalizedMerchantId)
    ? buildMerchantBackendHref(normalizedMerchantId)
    : "/admin";
}
