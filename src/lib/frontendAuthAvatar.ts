import type { MerchantCookieSessionPayload } from "@/lib/authSessionRecovery";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function pushUnique(list: string[], value: unknown) {
  const trimmed = trimText(value);
  if (!trimmed || list.includes(trimmed)) return;
  list.push(trimmed);
}

export function readFrontendAuthMerchantIds(
  payload: Pick<MerchantCookieSessionPayload, "accountType" | "accountId" | "merchantId" | "merchantIds"> | null | undefined,
) {
  const merchantIds: string[] = [];
  pushUnique(merchantIds, payload?.merchantId);
  if (Array.isArray(payload?.merchantIds)) {
    payload.merchantIds.forEach((item) => pushUnique(merchantIds, item));
  }
  if (payload?.accountType === "merchant") {
    pushUnique(merchantIds, payload.accountId);
  }
  return merchantIds;
}

export function resolveFrontendAuthAvatarUrl(input: {
  accountType?: unknown;
  sessionAvatarUrl?: unknown;
  merchantPreviewAvatarUrl?: unknown;
  currentMerchantAvatarUrl?: unknown;
  merchantPreviewApplies?: boolean;
  currentSiteBelongsToSession?: boolean;
}) {
  const sessionAvatarUrl = trimText(input.sessionAvatarUrl);
  const merchantContextAvatarUrl =
    (input.merchantPreviewApplies ? trimText(input.merchantPreviewAvatarUrl) : "") ||
    (input.currentSiteBelongsToSession ? trimText(input.currentMerchantAvatarUrl) : "");

  if (input.accountType === "merchant") {
    return merchantContextAvatarUrl || sessionAvatarUrl;
  }
  return sessionAvatarUrl || merchantContextAvatarUrl;
}
