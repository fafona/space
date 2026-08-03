import {
  isMerchantEnterpriseSchemaMissingError,
  normalizeMerchantEnterpriseWorkflow,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseWorkflow,
} from "@/lib/merchantEnterprise";
import {
  normalizeMerchantEnterpriseWorkflowPermissionGap,
  normalizeMerchantEnterpriseWorkflowPermissionGrantResult,
  normalizeMerchantEnterpriseWorkflowRevision,
  normalizeMerchantEnterpriseWorkflowRevisionContext,
  normalizeMerchantEnterpriseWorkflowRevisionSnapshot,
  normalizeMerchantEnterpriseWorkflowRevisionSummary,
  parseMerchantEnterpriseWorkflowPermissionsStrict,
  type MerchantEnterpriseWorkflowPermission,
  type MerchantEnterpriseWorkflowPermissionGap,
  type MerchantEnterpriseWorkflowPermissionGrantResult,
  type MerchantEnterpriseWorkflowRevisionDetail,
  type MerchantEnterpriseWorkflowRevisionHistoryPage,
  type MerchantEnterpriseWorkflowRevisionRestoreResult,
} from "@/lib/merchantEnterpriseWorkflowRevisions";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_REVISION_PAGE_SIZE = 100;

export type MerchantEnterpriseWorkflowRevisionStoreClient = {
  // Supabase RPC is normalized at this boundary before values reach routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (functionName: string, args: Record<string, unknown>) => any;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function responseSiteId(response: Record<string, unknown> | null) {
  const value = response?.merchantId ?? response?.merchant_id;
  return typeof value === "string" && /^\d{8}$/.test(value) ? value : "";
}

function text(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function siteId(value: unknown) {
  const normalized = text(value, 80);
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error("invalid_workflow_revision_request");
  }
  return normalized;
}

function uuid(value: unknown, errorCode = "invalid_workflow_revision_request") {
  const normalized = text(value, 80);
  if (!UUID_PATTERN.test(normalized)) throw new Error(errorCode);
  return normalized.toLowerCase();
}

function positiveInteger(
  value: unknown,
  errorCode = "invalid_workflow_revision_request",
) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(errorCode);
  }
  return normalized;
}

function actorInput(actor: MerchantEnterpriseActor) {
  return {
    actor_type: actor.type,
    actor_id: uuid(actor.id),
  };
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "unknown_error";
  const source = error as { code?: unknown; message?: unknown };
  const code = text(source.code, 40);
  const message = text(source.message, 1000) || "unknown_error";
  return code ? `${code}:${message}` : message;
}

function throwRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = errorMessage(error);
  for (const code of [
    "permission_denied",
    "workflow_not_found",
    "workflow_revision_not_found",
    "workflow_revision_invalid",
    "workflow_archived",
    "role_not_found",
    "enterprise_version_conflict",
    "enterprise_operation_in_progress",
    "invalid_permission_dependencies",
    "invalid_workflow_revision_query",
    "invalid_workflow_revision_restore",
    "invalid_workflow_permission_gap_query",
    "invalid_workflow_permission_grant",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  if (message.includes("enterprise_idempotency_conflict")) {
    throw new Error("invalid_operation_id");
  }
  throw new Error(`${operation}:${message}`);
}

function operationId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("invalid_operation_id");
  }
  const normalized = normalizeMutationOperationId(value);
  if (!normalized || normalized !== value.trim()) {
    throw new Error("invalid_operation_id");
  }
  return normalized;
}

export async function loadMerchantEnterpriseWorkflowRevisionHistory(
  client: MerchantEnterpriseWorkflowRevisionStoreClient,
  input: {
    siteId: string;
    workflowId: string;
    actor: MerchantEnterpriseActor;
    limit?: number;
    beforeRevision?: number | null;
  },
): Promise<MerchantEnterpriseWorkflowRevisionHistoryPage> {
  const normalizedSiteId = siteId(input.siteId);
  const workflowId = uuid(input.workflowId);
  const limit = input.limit ?? 50;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MERCHANT_ENTERPRISE_WORKFLOW_REVISION_PAGE_SIZE
  ) {
    throw new Error("invalid_workflow_revision_query");
  }
  const beforeRevision =
    input.beforeRevision === null || input.beforeRevision === undefined
      ? null
      : positiveInteger(input.beforeRevision, "invalid_workflow_revision_query");
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_workflow_revisions_v1",
    {
      p_input: {
        merchant_id: normalizedSiteId,
        workflow_id: workflowId,
        ...actorInput(input.actor),
        limit,
        ...(beforeRevision ? { before_revision: beforeRevision } : {}),
      },
    },
  );
  if (result.error) {
    throwRpcError("enterprise_workflow_revisions_read_failed", result.error);
  }
  const response = record(result.data);
  const workflow = normalizeMerchantEnterpriseWorkflowRevisionContext(
    response?.workflow,
  );
  const rows = Array.isArray(response?.revisions) ? response.revisions : null;
  const revisions = rows?.map(normalizeMerchantEnterpriseWorkflowRevisionSummary);
  const nextRaw = response?.next_before_revision ?? response?.nextBeforeRevision;
  const nextBeforeRevision =
    nextRaw === null || nextRaw === undefined
      ? null
      : Number.isSafeInteger(Number(nextRaw)) && Number(nextRaw) > 0
        ? Number(nextRaw)
        : NaN;
  if (
    responseSiteId(response) !== normalizedSiteId ||
    !workflow ||
    workflow.id !== workflowId ||
    !revisions ||
    revisions.length > limit ||
    revisions.some((revision) => !revision) ||
    !Number.isFinite(nextBeforeRevision === null ? 0 : nextBeforeRevision)
  ) {
    throw new Error("enterprise_workflow_revisions_read_failed:invalid_response");
  }
  const normalized = revisions as NonNullable<
    ReturnType<typeof normalizeMerchantEnterpriseWorkflowRevisionSummary>
  >[];
  if (
    new Set(normalized.map((revision) => revision.revisionNo)).size !==
      normalized.length ||
    new Set(normalized.map((revision) => revision.id)).size !== normalized.length ||
    normalized.some(
      (revision, index) =>
        index > 0 && revision.revisionNo >= normalized[index - 1]!.revisionNo,
    ) ||
    normalized.some(
      (revision) =>
        revision.revisionNo > workflow.publishedVersion ||
        (revision.isCurrent && revision.revisionNo !== workflow.publishedVersion),
    ) ||
    normalized.filter((revision) => revision.isCurrent).length > 1 ||
    (beforeRevision !== null &&
      normalized.some((revision) => revision.revisionNo >= beforeRevision)) ||
    (nextBeforeRevision !== null &&
      (normalized.length !== limit ||
        normalized.at(-1)?.revisionNo !== nextBeforeRevision))
  ) {
    throw new Error("enterprise_workflow_revisions_read_failed:invalid_response");
  }
  return { workflow, revisions: normalized, nextBeforeRevision };
}

export async function loadMerchantEnterpriseWorkflowRevisionDetail(
  client: MerchantEnterpriseWorkflowRevisionStoreClient,
  input: {
    siteId: string;
    workflowId: string;
    revision: number;
    actor: MerchantEnterpriseActor;
  },
): Promise<MerchantEnterpriseWorkflowRevisionDetail> {
  const normalizedSiteId = siteId(input.siteId);
  const workflowId = uuid(input.workflowId);
  const revisionNo = positiveInteger(
    input.revision,
    "invalid_workflow_revision_query",
  );
  const result = await client.rpc(
    "faolla_get_merchant_enterprise_workflow_revision_v1",
    {
      p_input: {
        merchant_id: normalizedSiteId,
        workflow_id: workflowId,
        revision_no: revisionNo,
        ...actorInput(input.actor),
      },
    },
  );
  if (result.error) {
    throwRpcError("enterprise_workflow_revision_read_failed", result.error);
  }
  const response = record(result.data);
  const context = normalizeMerchantEnterpriseWorkflowRevisionContext(
    response?.workflow,
  );
  const rawContext = record(response?.workflow);
  const canRestore = rawContext?.can_restore ?? rawContext?.canRestore;
  const revision = normalizeMerchantEnterpriseWorkflowRevision(response?.revision);
  const previousRevision =
    response?.previous_revision === null || response?.previousRevision === null
      ? null
      : normalizeMerchantEnterpriseWorkflowRevision(
          response?.previous_revision ?? response?.previousRevision,
        );
  const workingDraft = normalizeMerchantEnterpriseWorkflowRevisionSnapshot(
    response?.working_draft ?? response?.workingDraft,
  );
  if (
    responseSiteId(response) !== normalizedSiteId ||
    !context ||
    context.id !== workflowId ||
    typeof canRestore !== "boolean" ||
    !revision ||
    revision.revisionNo !== revisionNo ||
    (response?.previous_revision !== null &&
      response?.previousRevision !== null &&
      !previousRevision) ||
    (previousRevision && previousRevision.revisionNo >= revisionNo) ||
    !workingDraft
  ) {
    throw new Error("enterprise_workflow_revision_read_failed:invalid_response");
  }
  return {
    workflow: { ...context, canRestore },
    revision,
    previousRevision,
    workingDraft,
  };
}

export async function restoreMerchantEnterpriseWorkflowRevisionToDraft(
  client: MerchantEnterpriseWorkflowRevisionStoreClient,
  input: {
    siteId: string;
    workflowId: string;
    revision: number;
    version: number;
    actor: MerchantEnterpriseActor;
    operationId: string;
  },
): Promise<MerchantEnterpriseWorkflowRevisionRestoreResult> {
  const normalizedSiteId = siteId(input.siteId);
  const workflowId = uuid(input.workflowId);
  const revision = positiveInteger(
    input.revision,
    "invalid_workflow_revision_restore",
  );
  const version = positiveInteger(
    input.version,
    "invalid_workflow_revision_restore",
  );
  const result = await client.rpc(
    "faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1",
    {
      p_input: {
        merchant_id: normalizedSiteId,
        workflow_id: workflowId,
        revision_no: revision,
        expected_version: version,
        operation_id: operationId(input.operationId),
        ...actorInput(input.actor),
      },
    },
  );
  if (result.error) {
    throwRpcError("enterprise_workflow_revision_restore_failed", result.error);
  }
  const response = record(result.data);
  const workflow = normalizeMerchantEnterpriseWorkflow(response?.workflow);
  const restoredFromRevision = Number(
    response?.restored_from_revision ?? response?.restoredFromRevision,
  );
  if (
    !workflow ||
    workflow.siteId !== normalizedSiteId ||
    workflow.id !== workflowId ||
    workflow.status === "archived" ||
    !workflow.hasUnpublishedChanges ||
    workflow.publishedVersion < revision ||
    !Number.isSafeInteger(restoredFromRevision) ||
    restoredFromRevision !== revision
  ) {
    throw new Error("enterprise_workflow_revision_restore_failed:invalid_response");
  }
  return { workflow, restoredFromRevision };
}

export async function loadMerchantEnterpriseWorkflowPermissionGaps(
  client: MerchantEnterpriseWorkflowRevisionStoreClient,
  input: { siteId: string; actor: MerchantEnterpriseActor },
): Promise<MerchantEnterpriseWorkflowPermissionGap[]> {
  const normalizedSiteId = siteId(input.siteId);
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_workflow_permission_gaps_v1",
    {
      p_input: {
        merchant_id: normalizedSiteId,
        ...actorInput(input.actor),
      },
    },
  );
  if (result.error) {
    throwRpcError("enterprise_workflow_permission_gaps_read_failed", result.error);
  }
  const response = record(result.data);
  const rows = Array.isArray(response?.gaps) ? response.gaps : null;
  const gaps = rows?.map(normalizeMerchantEnterpriseWorkflowPermissionGap);
  if (
    responseSiteId(response) !== normalizedSiteId ||
    !gaps ||
    gaps.length > 200 ||
    gaps.some((gap) => !gap) ||
    new Set(gaps.map((gap) => gap?.roleId)).size !== gaps.length
  ) {
    throw new Error("enterprise_workflow_permission_gaps_read_failed:invalid_response");
  }
  return gaps as MerchantEnterpriseWorkflowPermissionGap[];
}

export async function grantMerchantEnterpriseRoleWorkflowPermissions(
  client: MerchantEnterpriseWorkflowRevisionStoreClient,
  input: {
    siteId: string;
    roleId: string;
    version: number;
    workflowPermissions: MerchantEnterpriseWorkflowPermission[];
    actor: MerchantEnterpriseActor;
    operationId: string;
  },
): Promise<MerchantEnterpriseWorkflowPermissionGrantResult> {
  const normalizedSiteId = siteId(input.siteId);
  const roleId = uuid(input.roleId, "invalid_workflow_permission_grant");
  const version = positiveInteger(
    input.version,
    "invalid_workflow_permission_grant",
  );
  const workflowPermissions = parseMerchantEnterpriseWorkflowPermissionsStrict(
    input.workflowPermissions,
  );
  if (!workflowPermissions) throw new Error("invalid_workflow_permission_grant");
  const result = await client.rpc(
    "faolla_grant_merchant_enterprise_role_workflow_permissions_v1",
    {
      p_input: {
        merchant_id: normalizedSiteId,
        role_id: roleId,
        expected_version: version,
        workflow_permissions: workflowPermissions,
        operation_id: operationId(input.operationId),
        ...actorInput(input.actor),
      },
    },
  );
  if (result.error) {
    throwRpcError("enterprise_workflow_permission_grant_failed", result.error);
  }
  const response = record(result.data);
  const normalized = normalizeMerchantEnterpriseWorkflowPermissionGrantResult(
    response,
  );
  if (
    responseSiteId(response) !== normalizedSiteId ||
    !normalized ||
    normalized.role.id !== roleId ||
    workflowPermissions.some(
      (permission) => !normalized.role.permissions.includes(permission),
    ) ||
    normalized.addedPermissions.some(
      (permission) => !workflowPermissions.includes(permission),
    )
  ) {
    throw new Error("enterprise_workflow_permission_grant_failed:invalid_response");
  }
  return normalized;
}

export type { MerchantEnterpriseWorkflow };
