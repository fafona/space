import {
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH,
  normalizeMerchantEnterprisePermissions,
  parseMerchantEnterprisePermissionsStrict,
  parseMerchantEnterpriseWorkflowStepsStrict,
  parseMerchantEnterpriseWorkflowTagsStrict,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseWorkflow,
  type MerchantEnterpriseWorkflowStatus,
  type MerchantEnterpriseWorkflowStep,
} from "@/lib/merchantEnterprise";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MERCHANT_ENTERPRISE_WORKFLOW_PERMISSIONS = [
  "workflows.view",
  "workflows.manage",
  "workflows.publish",
] as const satisfies readonly MerchantEnterprisePermission[];

export type MerchantEnterpriseWorkflowPermission =
  (typeof MERCHANT_ENTERPRISE_WORKFLOW_PERMISSIONS)[number];

export type MerchantEnterpriseWorkflowRevisionSnapshot = {
  title: string;
  scenario: string;
  description: string;
  category: string;
  tags: string[];
  steps: MerchantEnterpriseWorkflowStep[];
};

export type MerchantEnterpriseWorkflowRevisionSummary = {
  id: string;
  revisionNo: number;
  publishedAt: string;
  title: string;
  scenario: string;
  category: string;
  tags: string[];
  stepCount: number;
  isCurrent: boolean;
};

export type MerchantEnterpriseWorkflowRevision = {
  id: string;
  revisionNo: number;
  publishedAt: string;
  snapshot: MerchantEnterpriseWorkflowRevisionSnapshot;
};

export type MerchantEnterpriseWorkflowRevisionContext = {
  id: string;
  title: string;
  status: MerchantEnterpriseWorkflowStatus;
  version: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
};

export type MerchantEnterpriseWorkflowRevisionHistoryPage = {
  workflow: MerchantEnterpriseWorkflowRevisionContext;
  revisions: MerchantEnterpriseWorkflowRevisionSummary[];
  nextBeforeRevision: number | null;
};

export type MerchantEnterpriseWorkflowRevisionDetail = {
  workflow: MerchantEnterpriseWorkflowRevisionContext & { canRestore: boolean };
  revision: MerchantEnterpriseWorkflowRevision;
  previousRevision: MerchantEnterpriseWorkflowRevision | null;
  workingDraft: MerchantEnterpriseWorkflowRevisionSnapshot;
};

export type MerchantEnterpriseWorkflowRevisionRestoreResult = {
  workflow: MerchantEnterpriseWorkflow;
  restoredFromRevision: number;
};

export type MerchantEnterpriseWorkflowPermissionGap = {
  roleId: string;
  name: string;
  systemKey: "administrator" | "supervisor" | "employee" | null;
  isSystem: boolean;
  version: number;
  permissions: MerchantEnterprisePermission[];
  recommendedWorkflowPermissions: MerchantEnterpriseWorkflowPermission[];
  missingWorkflowPermissions: MerchantEnterpriseWorkflowPermission[];
  classification: "system_default_gap" | "custom_role_review";
  employeeCount: number;
};

export type MerchantEnterpriseWorkflowPermissionGrantResult = {
  role: {
    id: string;
    name: string;
    status: "active" | "archived";
    isSystem: boolean;
    version: number;
    permissions: MerchantEnterprisePermission[];
  };
  addedPermissions: MerchantEnterpriseWorkflowPermission[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function read(
  source: Record<string, unknown>,
  camel: string,
  snake: string,
) {
  return source[camel] ?? source[snake];
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function workflowPermissions(
  value: unknown,
): MerchantEnterpriseWorkflowPermission[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(MERCHANT_ENTERPRISE_WORKFLOW_PERMISSIONS);
  const values = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (
    values.some((permission) => !allowed.has(permission)) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return values as MerchantEnterpriseWorkflowPermission[];
}

export function parseMerchantEnterpriseWorkflowPermissionsStrict(
  value: unknown,
) {
  const permissions = workflowPermissions(value);
  return permissions && permissions.length > 0 ? permissions : null;
}

export function normalizeMerchantEnterpriseWorkflowRevisionSnapshot(
  value: unknown,
): MerchantEnterpriseWorkflowRevisionSnapshot | null {
  const source = record(value);
  if (!source) return null;
  const title = text(source.title, MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH);
  const scenario = text(
    source.scenario,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  );
  const description = text(
    source.description,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
  );
  const category = text(
    source.category,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
  );
  const tags = parseMerchantEnterpriseWorkflowTagsStrict(source.tags);
  const steps = parseMerchantEnterpriseWorkflowStepsStrict(source.steps);
  if (!title || !scenario || !tags || !steps) return null;
  return { title, scenario, description, category, tags, steps };
}

export function normalizeMerchantEnterpriseWorkflowRevisionContext(
  value: unknown,
): MerchantEnterpriseWorkflowRevisionContext | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, 80);
  const title = text(source.title, MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH);
  const status = text(source.status, 20) as MerchantEnterpriseWorkflowStatus;
  const version = positiveInteger(source.version);
  const publishedVersion = nonnegativeInteger(
    read(source, "publishedVersion", "published_version"),
  );
  const hasUnpublishedChanges = read(
    source,
    "hasUnpublishedChanges",
    "has_unpublished_changes",
  );
  if (
    !UUID_PATTERN.test(id) ||
    !title ||
    !["draft", "published", "archived"].includes(status) ||
    version === null ||
    publishedVersion === null ||
    typeof hasUnpublishedChanges !== "boolean"
  ) {
    return null;
  }
  return {
    id: id.toLowerCase(),
    title,
    status,
    version,
    publishedVersion,
    hasUnpublishedChanges,
  };
}

export function normalizeMerchantEnterpriseWorkflowRevisionSummary(
  value: unknown,
): MerchantEnterpriseWorkflowRevisionSummary | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, 80);
  const revisionNo = positiveInteger(read(source, "revisionNo", "revision_no"));
  const publishedAt = timestamp(read(source, "publishedAt", "published_at"));
  const title = text(source.title, MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH);
  const scenario = text(
    source.scenario,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  );
  const category = text(
    source.category,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
  );
  const tags = parseMerchantEnterpriseWorkflowTagsStrict(source.tags);
  const stepCount = nonnegativeInteger(read(source, "stepCount", "step_count"));
  const isCurrent = read(source, "isCurrent", "is_current");
  if (
    !UUID_PATTERN.test(id) ||
    revisionNo === null ||
    !publishedAt ||
    !title ||
    !scenario ||
    !tags ||
    stepCount === null ||
    typeof isCurrent !== "boolean"
  ) {
    return null;
  }
  return {
    id: id.toLowerCase(),
    revisionNo,
    publishedAt,
    title,
    scenario,
    category,
    tags,
    stepCount,
    isCurrent,
  };
}

export function normalizeMerchantEnterpriseWorkflowRevision(
  value: unknown,
): MerchantEnterpriseWorkflowRevision | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, 80);
  const revisionNo = positiveInteger(read(source, "revisionNo", "revision_no"));
  const publishedAt = timestamp(read(source, "publishedAt", "published_at"));
  const snapshot = normalizeMerchantEnterpriseWorkflowRevisionSnapshot(source.snapshot);
  if (!UUID_PATTERN.test(id) || revisionNo === null || !publishedAt || !snapshot) {
    return null;
  }
  return { id: id.toLowerCase(), revisionNo, publishedAt, snapshot };
}

export function normalizeMerchantEnterpriseWorkflowPermissionGap(
  value: unknown,
): MerchantEnterpriseWorkflowPermissionGap | null {
  const source = record(value);
  if (!source) return null;
  const roleId = text(read(source, "roleId", "role_id"), 80);
  const name = text(source.name, 80);
  const rawSystemKey = read(source, "systemKey", "system_key");
  const systemKey =
    rawSystemKey === null || rawSystemKey === undefined || rawSystemKey === ""
      ? null
      : text(rawSystemKey, 40);
  const isSystem = read(source, "isSystem", "is_system");
  const version = positiveInteger(source.version);
  const permissions = parseMerchantEnterprisePermissionsStrict(source.permissions);
  const recommended = workflowPermissions(
    read(
      source,
      "recommendedWorkflowPermissions",
      "recommended_workflow_permissions",
    ),
  );
  const missing = workflowPermissions(
    read(source, "missingWorkflowPermissions", "missing_workflow_permissions"),
  );
  const classification = source.classification;
  const employeeCount = nonnegativeInteger(
    read(source, "employeeCount", "employee_count"),
  );
  if (
    !UUID_PATTERN.test(roleId) ||
    !name ||
    (systemKey !== null &&
      !["administrator", "supervisor", "employee"].includes(systemKey)) ||
    typeof isSystem !== "boolean" ||
    version === null ||
    !permissions ||
    !recommended ||
    !missing ||
    missing.length === 0 ||
    missing.some(
      (permission) =>
        !recommended.includes(permission) || permissions.includes(permission),
    ) ||
    !["system_default_gap", "custom_role_review"].includes(
      String(classification),
    ) ||
    employeeCount === null
  ) {
    return null;
  }
  return {
    roleId: roleId.toLowerCase(),
    name,
    systemKey: systemKey as MerchantEnterpriseWorkflowPermissionGap["systemKey"],
    isSystem,
    version,
    permissions,
    recommendedWorkflowPermissions: recommended,
    missingWorkflowPermissions: missing,
    classification:
      classification as MerchantEnterpriseWorkflowPermissionGap["classification"],
    employeeCount,
  };
}

export function normalizeMerchantEnterpriseWorkflowPermissionGrantResult(
  value: unknown,
): MerchantEnterpriseWorkflowPermissionGrantResult | null {
  const source = record(value);
  const role = record(source?.role);
  if (!source || !role) return null;
  const id = text(role.id, 80);
  const name = text(role.name, 80);
  const status = role.status;
  const isSystem = read(role, "isSystem", "is_system");
  const version = positiveInteger(role.version);
  const permissions = parseMerchantEnterprisePermissionsStrict(role.permissions);
  const addedPermissions = workflowPermissions(
    read(source, "addedPermissions", "added_permissions"),
  );
  if (
    !UUID_PATTERN.test(id) ||
    !name ||
    (status !== "active" && status !== "archived") ||
    typeof isSystem !== "boolean" ||
    version === null ||
    !permissions ||
    !addedPermissions ||
    addedPermissions.some((permission) => !permissions.includes(permission))
  ) {
    return null;
  }
  return {
    role: {
      id: id.toLowerCase(),
      name,
      status,
      isSystem,
      version,
      permissions: normalizeMerchantEnterprisePermissions(permissions),
    },
    addedPermissions,
  };
}
