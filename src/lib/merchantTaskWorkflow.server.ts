import {
  isMerchantEnterpriseSchemaMissingError,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import {
  normalizeMerchantTaskWorkflowBinding,
  normalizeMerchantTaskWorkflowChecklistItem,
  type MerchantTaskWorkflowBinding,
  type MerchantTaskWorkflowChecklistItem,
} from "@/lib/merchantTaskWorkflow";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantTaskWorkflowStoreClient = {
  // Supabase RPC responses are validated before they cross this store boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (functionName: string, args: Record<string, unknown>) => any;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function siteId(value: unknown) {
  const normalized = text(value, 80);
  if (!/^\d{8}$/.test(normalized)) throw new Error("invalid_task_workflow_request");
  return normalized;
}

function uuid(value: unknown) {
  const normalized = text(value, 80).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error("invalid_task_workflow_request");
  return normalized;
}

function actorInput(actor: MerchantEnterpriseActor) {
  if (actor.type !== "owner" && actor.type !== "employee") {
    throw new Error("invalid_task_workflow_request");
  }
  return { actor_type: actor.type, actor_id: uuid(actor.id) };
}

function positiveVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("invalid_task_workflow_request");
  }
  return Number(value);
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

function errorMessage(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000) || "unknown_error";
  return code ? `${code}:${message}` : message;
}

function missingRpc(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000);
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /could not find (?:the )?function|schema cache|does not exist/i.test(message)
  );
}

function throwRpcError(error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error) || missingRpc(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = errorMessage(error);
  for (const code of [
    "permission_denied",
    "task_not_found",
    "workflow_not_found",
    "workflow_not_published",
    "workflow_revision_changed",
    "enterprise_version_conflict",
    "enterprise_operation_in_progress",
    "enterprise_idempotency_conflict",
    "task_workflow_already_bound",
    "task_workflow_checklist_source_exists",
    "task_checklist_limit_reached",
    "invalid_task_archived",
    "invalid_task_workflow_request",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  throw new Error("enterprise_task_workflow_request_failed");
}

export async function loadMerchantTaskWorkflowBinding(
  client: MerchantTaskWorkflowStoreClient,
  input: {
    siteId: string;
    taskId: string;
    actor: MerchantEnterpriseActor;
  },
): Promise<MerchantTaskWorkflowBinding | null> {
  const normalizedSiteId = siteId(input.siteId);
  const taskId = uuid(input.taskId);
  const actor = actorInput(input.actor);
  const result = await client.rpc(
    "faolla_get_merchant_task_workflow_binding_v1",
    {
      p_input: {
        merchant_id: normalizedSiteId,
        task_id: taskId,
        ...actor,
      },
    },
  );
  if (result.error) throwRpcError(result.error);
  const response = record(result.data);
  if (
    !response ||
    response.merchantId !== normalizedSiteId ||
    !("binding" in response)
  ) {
    throw new Error("enterprise_task_workflow_request_failed");
  }
  if (response.binding === null) return null;
  const binding = normalizeMerchantTaskWorkflowBinding(response.binding);
  if (
    !binding ||
    binding.siteId !== normalizedSiteId ||
    binding.taskId !== taskId
  ) {
    throw new Error("enterprise_task_workflow_request_failed");
  }
  return binding;
}

export async function bindMerchantTaskToPublishedWorkflow(
  client: MerchantTaskWorkflowStoreClient,
  input: {
    siteId: string;
    taskId: string;
    workflowId: string;
    expectedTaskVersion: number;
    expectedRevisionId: string;
    operationId: string;
    actor: MerchantEnterpriseActor;
  },
): Promise<{
  binding: MerchantTaskWorkflowBinding;
  createdChecklistItems: MerchantTaskWorkflowChecklistItem[];
}> {
  const normalizedSiteId = siteId(input.siteId);
  const taskId = uuid(input.taskId);
  const workflowId = uuid(input.workflowId);
  const expectedRevisionId = uuid(input.expectedRevisionId);
  const expectedTaskVersion = positiveVersion(input.expectedTaskVersion);
  const normalizedOperationId = operationId(input.operationId);
  const actor = actorInput(input.actor);
  const result = await client.rpc("faolla_bind_merchant_task_workflow_v1", {
    p_input: {
      merchant_id: normalizedSiteId,
      task_id: taskId,
      workflow_id: workflowId,
      expected_task_version: expectedTaskVersion,
      expected_revision_id: expectedRevisionId,
      operation_id: normalizedOperationId,
      ...actor,
    },
  });
  if (result.error) throwRpcError(result.error);
  const response = record(result.data);
  const binding = normalizeMerchantTaskWorkflowBinding(response?.binding);
  const rows = Array.isArray(response?.created_items) ? response.created_items : null;
  const createdChecklistItems = rows?.map(
    normalizeMerchantTaskWorkflowChecklistItem,
  );
  if (
    !binding ||
    binding.siteId !== normalizedSiteId ||
    binding.taskId !== taskId ||
    binding.workflowId !== workflowId ||
    binding.revisionId !== expectedRevisionId ||
    !createdChecklistItems ||
    createdChecklistItems.some((item) => !item) ||
    createdChecklistItems.length !== binding.generatedChecklistCount ||
    new Set(createdChecklistItems.map((item) => item?.id)).size !==
      createdChecklistItems.length ||
    createdChecklistItems.some(
      (item) => item?.siteId !== normalizedSiteId || item.taskId !== taskId,
    )
  ) {
    throw new Error("enterprise_task_workflow_request_failed");
  }
  return {
    binding,
    createdChecklistItems:
      createdChecklistItems as MerchantTaskWorkflowChecklistItem[],
  };
}
