import {
  getMissingMerchantEnterprisePermissionDependencies,
  isMerchantEnterpriseSchemaMissingError,
  normalizeMerchantEnterpriseRole,
  type MerchantEnterpriseEmployeeStatus,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRoleStatus,
} from "@/lib/merchantEnterprise";
import { isMerchantNumericId } from "@/lib/merchantIdentity";

const MEMBERSHIP_PAGE_SIZE = 500;
const MAX_MEMBERSHIP_PAGES = 200;
const ROLE_QUERY_BATCH_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMPLOYEE_DIRECTORY_COLUMNS =
  "id,merchant_id,display_name,role_id,status";
const ROLE_DIRECTORY_COLUMNS =
  "id,merchant_id,name,permissions,access_scope,status";

export type MerchantEnterpriseMembershipDirectoryClient = {
  // Supabase builders are intentionally treated as runtime clients in this isolated reader.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type MerchantEnterpriseMembershipRoleRecord = {
  id: string;
  name: string;
  status: MerchantEnterpriseRoleStatus;
  permissions: MerchantEnterprisePermission[];
};

export type MerchantEnterpriseMembershipRecord = {
  siteId: string;
  employeeId: string;
  employeeDisplayName: string;
  employeeStatus: MerchantEnterpriseEmployeeStatus;
  role: MerchantEnterpriseMembershipRoleRecord | null;
};

export type MerchantEnterpriseMembershipSiteSource = {
  id?: unknown;
  name?: unknown;
  merchantName?: unknown;
  permissionConfig?: {
    allowEnterpriseManagement?: unknown;
  } | null;
};

export type MerchantEnterpriseMembershipListItem = {
  siteId: string;
  siteName: string;
  employeeId: string;
  displayName: string;
  roleId: string;
  roleName: string;
  status: MerchantEnterpriseEmployeeStatus;
  enterable: boolean;
  reason?:
    | "employee_account_disabled"
    | "employee_invitation_pending"
    | "enterprise_management_disabled"
    | "role_disabled"
    | "merchant_access_denied";
};

function text(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function directoryReadError(error: unknown) {
  return new Error(
    isMerchantEnterpriseSchemaMissingError(error)
      ? "enterprise_schema_unavailable"
      : "enterprise_memberships_read_failed",
  );
}

function normalizeEmployeeStatus(
  value: unknown,
): MerchantEnterpriseEmployeeStatus | null {
  return value === "invited" || value === "active" || value === "disabled"
    ? value
    : null;
}

function normalizeEmployeeDirectoryRow(value: unknown) {
  const source = record(value);
  const employeeId = text(source.id, 80);
  const siteId = text(source.merchant_id, 80);
  const employeeDisplayName = text(source.display_name, 120);
  const roleId = text(source.role_id, 80);
  const employeeStatus = normalizeEmployeeStatus(source.status);
  if (
    !UUID_PATTERN.test(employeeId) ||
    !isMerchantNumericId(siteId) ||
    !employeeDisplayName ||
    (roleId && !UUID_PATTERN.test(roleId)) ||
    !employeeStatus
  ) {
    return null;
  }
  return {
    siteId,
    employeeId,
    employeeDisplayName,
    employeeStatus,
    roleId,
  };
}

async function loadEmployeeDirectoryRows(
  client: MerchantEnterpriseMembershipDirectoryClient,
  authUserId: string,
) {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_MEMBERSHIP_PAGES; page += 1) {
    const from = page * MEMBERSHIP_PAGE_SIZE;
    const result = await client
      .from("merchant_enterprise_employees")
      .select(EMPLOYEE_DIRECTORY_COLUMNS)
      .eq("auth_user_id", authUserId)
      .order("merchant_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + MEMBERSHIP_PAGE_SIZE - 1);
    if (result.error) throw directoryReadError(result.error);
    const pageRows = Array.isArray(result.data) ? result.data : [];
    rows.push(...pageRows);
    if (pageRows.length < MEMBERSHIP_PAGE_SIZE) return rows;
  }
  throw new Error("enterprise_membership_limit_exceeded");
}

async function loadRoleDirectoryRows(
  client: MerchantEnterpriseMembershipDirectoryClient,
  roleIds: readonly string[],
) {
  const rows: unknown[] = [];
  for (let start = 0; start < roleIds.length; start += ROLE_QUERY_BATCH_SIZE) {
    const batch = roleIds.slice(start, start + ROLE_QUERY_BATCH_SIZE);
    const result = await client
      .from("merchant_enterprise_roles")
      .select(ROLE_DIRECTORY_COLUMNS)
      .in("id", batch);
    if (result.error) throw directoryReadError(result.error);
    if (Array.isArray(result.data)) rows.push(...result.data);
  }
  return rows;
}

export async function loadMerchantEnterpriseMembershipRecords(
  client: MerchantEnterpriseMembershipDirectoryClient,
  authUserId: string,
): Promise<MerchantEnterpriseMembershipRecord[]> {
  const normalizedAuthUserId = text(authUserId, 80);
  if (!UUID_PATTERN.test(normalizedAuthUserId)) {
    throw new Error("invalid_enterprise_auth_user");
  }

  const employeeRows = await loadEmployeeDirectoryRows(
    client,
    normalizedAuthUserId,
  );
  const normalizedEmployees = employeeRows.map(normalizeEmployeeDirectoryRow);
  if (normalizedEmployees.some((employee) => !employee)) {
    throw new Error("enterprise_memberships_read_failed");
  }
  const employees = normalizedEmployees as Array<
    NonNullable<ReturnType<typeof normalizeEmployeeDirectoryRow>>
  >;
  const roleIds = Array.from(
    new Set(employees.map((employee) => employee.roleId).filter(Boolean)),
  );
  const roleRows = await loadRoleDirectoryRows(client, roleIds);
  const roleBySiteAndId = new Map<string, MerchantEnterpriseMembershipRoleRecord>();
  for (const roleRow of roleRows) {
    const source = record(roleRow);
    if (source.status !== "active" && source.status !== "archived") continue;
    const role = normalizeMerchantEnterpriseRole(source);
    if (!role || !UUID_PATTERN.test(role.id) || !isMerchantNumericId(role.siteId)) {
      continue;
    }
    roleBySiteAndId.set(`${role.siteId}:${role.id}`, {
      id: role.id,
      name: role.name,
      status: role.status,
      permissions: role.permissions,
    });
  }

  return employees.map((employee) => ({
    siteId: employee.siteId,
    employeeId: employee.employeeId,
    employeeDisplayName: employee.employeeDisplayName,
    employeeStatus: employee.employeeStatus,
    role: employee.roleId
      ? roleBySiteAndId.get(`${employee.siteId}:${employee.roleId}`) ?? null
      : null,
  }));
}

export function buildMerchantEnterpriseMembershipList(
  memberships: readonly MerchantEnterpriseMembershipRecord[],
  sites: readonly MerchantEnterpriseMembershipSiteSource[],
): MerchantEnterpriseMembershipListItem[] {
  const siteById = new Map<
    string,
    { name: string; enterpriseManagementEnabled: boolean }
  >();
  for (const site of sites) {
    const siteId = text(site.id, 80);
    if (!isMerchantNumericId(siteId)) continue;
    if (siteById.has(siteId)) {
      throw new Error("enterprise_snapshot_ambiguous");
    }
    const siteName =
      text(site.merchantName, 160) || text(site.name, 160) || siteId;
    siteById.set(siteId, {
      name: siteName,
      enterpriseManagementEnabled:
        site.permissionConfig?.allowEnterpriseManagement === true,
    });
  }

  return memberships
    .map((membership) => {
      const site = siteById.get(membership.siteId);
      const roleIsValid = Boolean(
        membership.role &&
          membership.role.status === "active" &&
          membership.role.permissions.includes("enterprise.view") &&
          getMissingMerchantEnterprisePermissionDependencies(
            membership.role.permissions,
          ).length === 0,
      );
      const enterable =
        site?.enterpriseManagementEnabled === true &&
        membership.employeeStatus === "active" &&
        roleIsValid;
      const reason = enterable
        ? null
        : membership.employeeStatus === "disabled"
          ? ("employee_account_disabled" as const)
          : membership.employeeStatus === "invited"
            ? ("employee_invitation_pending" as const)
            : site?.enterpriseManagementEnabled !== true
              ? ("enterprise_management_disabled" as const)
              : membership.role?.status === "archived"
                ? ("role_disabled" as const)
                : ("merchant_access_denied" as const);
      return {
        siteId: membership.siteId,
        siteName: site?.name ?? membership.siteId,
        employeeId: membership.employeeId,
        displayName: membership.employeeDisplayName,
        roleId: membership.role?.id ?? "",
        roleName: membership.role?.name ?? "",
        status: membership.employeeStatus,
        enterable,
        ...(reason ? { reason } : {}),
      } satisfies MerchantEnterpriseMembershipListItem;
    })
    .sort(
      (left, right) =>
        left.siteId.localeCompare(right.siteId) ||
        left.employeeId.localeCompare(right.employeeId),
    );
}
