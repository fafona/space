const NON_STORAGE_PUBLISH_ERROR_CODES = new Set([
  "unauthorized",
  "invalid_merchant_scope",
  "merchant_service_paused",
]);

function isPermissionOrLimitErrorCode(code: string) {
  return (
    NON_STORAGE_PUBLISH_ERROR_CODES.has(code) ||
    code.endsWith("_not_allowed") ||
    code.endsWith("_limit_exceeded")
  );
}

export function shouldOfferCompressionPresetForPublishError(message: string, code = "") {
  const normalizedCode = String(code ?? "").trim().toLowerCase();
  if (normalizedCode && isPermissionOrLimitErrorCode(normalizedCode)) return false;

  const normalized = String(message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("service_role_key")) return false;
  if (normalized.includes("发布通道未配置")) return false;
  if (normalized.includes("登录会话")) return false;
  if (normalized.includes("重新登录")) return false;
  if (normalized.includes("未授权")) return false;
  if (normalized.includes("有效商户站点")) return false;
  if (normalized.includes("会话")) return false;
  if (normalized.includes("权限")) return false;
  if (normalized.includes("仅允许")) return false;
  if (normalized.includes("未开通")) return false;
  if (normalized.includes("服务到期")) return false;
  if (normalized.includes("auth")) return false;
  if (normalized.includes("unauthorized")) return false;
  if (normalized.includes("invalid_merchant_scope")) return false;
  if (normalized.includes("permission")) return false;
  if (normalized.includes("not allowed")) return false;
  if (normalized.includes("limit exceeded")) return false;
  return true;
}
