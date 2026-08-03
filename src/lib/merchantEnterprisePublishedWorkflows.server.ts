import {
  isMerchantEnterpriseSchemaMissingError,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";
import {
  MAX_MERCHANT_ENTERPRISE_PUBLISHED_WORKFLOW_CHOICES,
  normalizeMerchantEnterprisePublishedWorkflowChoice,
  type MerchantEnterprisePublishedWorkflowChoice,
} from "@/lib/merchantEnterprisePublishedWorkflows";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterprisePublishedWorkflowStoreClient = {
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

function errorMessage(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000) || "unknown_error";
  return code ? `${code}:${message}` : message;
}

function isMissingPublishedWorkflowRpc(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000);
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /could not find (?:the )?function|schema cache|does not exist/i.test(message)
  );
}

function throwReadError(error: unknown): never {
  if (
    isMerchantEnterpriseSchemaMissingError(error) ||
    isMissingPublishedWorkflowRpc(error)
  ) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = errorMessage(error);
  if (message.includes("permission_denied")) {
    throw new Error("permission_denied");
  }
  if (message.includes("invalid_published_workflow_choice_query")) {
    throw new Error("invalid_published_workflow_choice_query");
  }
  if (message.includes("workflow_revision_invalid")) {
    throw new Error("enterprise_published_workflows_read_failed");
  }
  throw new Error("enterprise_published_workflows_read_failed");
}

function normalizedSiteId(value: unknown) {
  const normalized = text(value, 80);
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error("invalid_published_workflow_choice_query");
  }
  return normalized;
}

function normalizedActor(actor: MerchantEnterpriseActor) {
  const actorId = text(actor.id, 80).toLowerCase();
  if (
    (actor.type !== "owner" && actor.type !== "employee") ||
    !UUID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_published_workflow_choice_query");
  }
  return { actor_type: actor.type, actor_id: actorId };
}

export async function loadMerchantEnterprisePublishedWorkflowChoices(
  client: MerchantEnterprisePublishedWorkflowStoreClient,
  input: { siteId: string; actor: MerchantEnterpriseActor },
): Promise<MerchantEnterprisePublishedWorkflowChoice[]> {
  const siteId = normalizedSiteId(input.siteId);
  const actor = normalizedActor(input.actor);
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_published_workflow_choices_v1",
    {
      p_input: {
        merchant_id: siteId,
        ...actor,
      },
    },
  );
  if (result.error) throwReadError(result.error);

  const response = record(result.data);
  if (!response || response.merchantId !== siteId) {
    throw new Error("enterprise_published_workflows_read_failed");
  }
  const rows = response && Array.isArray(response.choices) ? response.choices : null;
  if (!rows || rows.length > MAX_MERCHANT_ENTERPRISE_PUBLISHED_WORKFLOW_CHOICES) {
    throw new Error("enterprise_published_workflows_read_failed");
  }
  const choices = rows.map(normalizeMerchantEnterprisePublishedWorkflowChoice);
  if (
    choices.some((choice) => !choice) ||
    new Set(choices.map((choice) => choice?.id)).size !== choices.length ||
    new Set(choices.map((choice) => choice?.revisionId)).size !== choices.length
  ) {
    throw new Error("enterprise_published_workflows_read_failed");
  }
  return choices as MerchantEnterprisePublishedWorkflowChoice[];
}
