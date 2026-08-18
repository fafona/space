export type MerchantEnterpriseMembership = {
  siteId: string;
  siteName: string;
  employeeId: string;
  displayName: string;
  roleId: string;
  roleName: string;
  status: string;
  enterable: boolean;
  reason?: string;
};

const ENTERPRISE_SITE_ID_PATTERN = /^\d{8}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBERSHIP_STATUSES = new Set(["invited", "active", "disabled"]);
const MEMBERSHIP_REASONS = new Set([
  "employee_account_disabled",
  "employee_invitation_pending",
  "enterprise_management_disabled",
  "role_disabled",
  "merchant_access_denied",
]);

const INVALID_MEMBERSHIP_DATA_MESSAGE =
  "企业身份数据无法验证，请重新加载或联系企业负责人。";

function membershipStateIsConsistent(
  status: string,
  enterable: boolean,
  reason: string,
  reasonWasProvided: boolean,
) {
  if (enterable) {
    return status === "active" && !reasonWasProvided;
  }
  if (!reasonWasProvided || !reason) return false;
  if (status === "disabled") return reason === "employee_account_disabled";
  if (status === "invited") return reason === "employee_invitation_pending";
  if (status !== "active") return false;
  return (
    reason === "enterprise_management_disabled" ||
    reason === "role_disabled" ||
    reason === "merchant_access_denied"
  );
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function buildMerchantEnterpriseSitePath(siteIdValue: unknown) {
  const siteId = text(siteIdValue, 32);
  if (!ENTERPRISE_SITE_ID_PATTERN.test(siteId)) return null;
  return `/enterprise/${encodeURIComponent(siteId)}`;
}

function normalizeMembership(value: unknown): MerchantEnterpriseMembership | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.siteId !== "string" ||
    typeof record.siteName !== "string" ||
    typeof record.employeeId !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.roleId !== "string" ||
    typeof record.roleName !== "string" ||
    typeof record.status !== "string" ||
    typeof record.enterable !== "boolean" ||
    (record.reason !== undefined && typeof record.reason !== "string")
  ) {
    return null;
  }
  const siteId = text(record.siteId, 32);
  const siteName = text(record.siteName, 160);
  const employeeId = text(record.employeeId, 120);
  const displayName = text(record.displayName, 120);
  const roleId = text(record.roleId, 120);
  const roleName = text(record.roleName, 120);
  const status = text(record.status, 32).toLowerCase();
  const reason = text(record.reason, 160);
  const reasonWasProvided = record.reason !== undefined;
  const fieldsWithinBounds =
    record.siteId.trim().length <= 32 &&
    record.siteName.trim().length <= 160 &&
    record.employeeId.trim().length <= 120 &&
    record.displayName.trim().length <= 120 &&
    record.roleId.trim().length <= 120 &&
    record.roleName.trim().length <= 120 &&
    record.status.trim().length <= 32 &&
    (record.reason === undefined || record.reason.trim().length <= 160);
  if (
    !fieldsWithinBounds ||
    !ENTERPRISE_SITE_ID_PATTERN.test(siteId) ||
    !siteName ||
    !UUID_PATTERN.test(employeeId) ||
    !displayName ||
    (roleId && !UUID_PATTERN.test(roleId)) ||
    !MEMBERSHIP_STATUSES.has(status) ||
    (reason && !MEMBERSHIP_REASONS.has(reason)) ||
    !membershipStateIsConsistent(status, record.enterable, reason, reasonWasProvided) ||
    (record.enterable && (!roleId || !roleName))
  ) {
    return null;
  }

  return {
    siteId,
    siteName,
    employeeId,
    displayName,
    roleId,
    roleName: roleName || "未分配角色",
    status,
    enterable: record.enterable,
    ...(reason ? { reason } : {}),
  };
}

export function normalizeMerchantEnterpriseMemberships(value: unknown) {
  if (!Array.isArray(value)) throw new Error(INVALID_MEMBERSHIP_DATA_MESSAGE);

  const memberships = new Map<string, MerchantEnterpriseMembership>();
  for (const candidate of value) {
    const membership = normalizeMembership(candidate);
    if (!membership || memberships.has(membership.siteId)) {
      throw new Error(INVALID_MEMBERSHIP_DATA_MESSAGE);
    }
    memberships.set(membership.siteId, membership);
  }

  return [...memberships.values()].sort((left, right) => {
    if (left.enterable !== right.enterable) return left.enterable ? -1 : 1;
    const byName = left.siteName.localeCompare(right.siteName, "zh-CN");
    return byName || left.siteId.localeCompare(right.siteId);
  });
}

export function normalizeMerchantEnterpriseMembershipPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(INVALID_MEMBERSHIP_DATA_MESSAGE);
  }
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || !Array.isArray(payload.memberships)) {
    throw new Error(INVALID_MEMBERSHIP_DATA_MESSAGE);
  }
  return normalizeMerchantEnterpriseMemberships(payload.memberships);
}

export function describeMerchantEnterpriseMembershipAvailability(
  membership: MerchantEnterpriseMembership,
) {
  if (membership.enterable) return "可以进入";
  if (membership.status === "disabled" || membership.reason === "employee_account_disabled") {
    return "员工账号已停用，请联系企业负责人。";
  }
  if (membership.status === "invited") {
    return "邀请尚未确认，请从最新的邀请邮件进入。";
  }
  if (
    membership.reason === "merchant_access_denied" ||
    membership.reason === "role_disabled"
  ) {
    return "当前角色不可用，请联系企业负责人。";
  }
  if (membership.reason === "enterprise_management_disabled") {
    return "该企业尚未开通企业管理。";
  }
  return "暂时无法进入，请联系企业负责人。";
}
