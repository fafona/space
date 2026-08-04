import {
  isMerchantEnterpriseSchemaMissingError,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";
import {
  MAX_MERCHANT_ENTERPRISE_AUTOMATION_RULES,
  MAX_MERCHANT_ENTERPRISE_AUTOMATION_RUNS,
  normalizeMerchantEnterpriseAutomationRule,
  normalizeMerchantEnterpriseAutomationRun,
  type MerchantEnterpriseAutomationRule,
  type MerchantEnterpriseAutomationRuleDraft,
  type MerchantEnterpriseAutomationRuleUpdate,
  type MerchantEnterpriseAutomationRun,
} from "@/lib/merchantEnterpriseAutomation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MERCHANT_ENTERPRISE_AUTOMATION_OUTBOX_EVENT_TYPE =
  "enterprise.workflow_automation.process";

export function isMerchantEnterpriseAutomationWorkerEnabled(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED
      ?.trim()
      .toLowerCase() === "true"
  );
}

export type MerchantEnterpriseAutomationStoreClient = {
  // Supabase results cross a trust boundary and are normalized below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (functionName: string, args: Record<string, unknown>) => any;
};

export type MerchantEnterpriseAutomationStorePage = {
  merchantId: string;
  rules: MerchantEnterpriseAutomationRule[];
  runs: MerchantEnterpriseAutomationRun[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeSiteId(value: unknown) {
  const siteId = text(value, 80);
  if (!/^\d{8}$/.test(siteId)) throw new Error("invalid_automation_query");
  return siteId;
}

function normalizeActor(actor: MerchantEnterpriseActor) {
  const actorId = text(actor.id, 80).toLowerCase();
  if (
    (actor.type !== "owner" && actor.type !== "employee") ||
    !UUID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_automation_query");
  }
  return { actor_type: actor.type, actor_id: actorId };
}

function isMissingAutomationRpc(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000);
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /could not find (?:the )?function|schema cache|does not exist/i.test(message)
  );
}

const KNOWN_ERRORS = [
  "permission_denied",
  "invalid_automation_query",
  "invalid_automation_rule",
  "invalid_automation_assignees",
  "automation_rule_not_found",
  "automation_rule_archived",
  "automation_target_unavailable",
  "automation_assignee_unavailable",
  "automation_active_rule_limit_reached",
  "automation_rule_limit_reached",
  "automation_workflow_unavailable",
  "workflow_not_published",
  "workflow_revision_changed",
  "enterprise_version_conflict",
  "enterprise_operation_in_progress",
  "enterprise_operation_conflict",
  "board_not_found",
] as const;

function throwAutomationError(error: unknown, fallback: string): never {
  if (
    isMerchantEnterpriseSchemaMissingError(error) ||
    isMissingAutomationRpc(error)
  ) {
    throw new Error("enterprise_schema_unavailable");
  }
  const source = record(error);
  const message = `${text(source?.code, 40)}:${text(source?.message, 1000)}`;
  const known = KNOWN_ERRORS.find((code) => message.includes(code));
  if (known) throw new Error(known);
  throw new Error(fallback);
}

function assertUniqueIds(values: readonly { id: string }[]) {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function normalizePage(
  value: unknown,
  expectedSiteId: string,
): MerchantEnterpriseAutomationStorePage | null {
  const source = record(value);
  const merchantId = text(source?.merchantId ?? source?.merchant_id, 80);
  const rawRules = source?.rules;
  const rawRuns = source?.runs;
  if (
    merchantId !== expectedSiteId ||
    !Array.isArray(rawRules) ||
    rawRules.length > MAX_MERCHANT_ENTERPRISE_AUTOMATION_RULES ||
    !Array.isArray(rawRuns) ||
    rawRuns.length > MAX_MERCHANT_ENTERPRISE_AUTOMATION_RUNS
  ) {
    return null;
  }
  const rules = rawRules.map(normalizeMerchantEnterpriseAutomationRule);
  const runs = rawRuns.map(normalizeMerchantEnterpriseAutomationRun);
  if (
    rules.some((rule) => !rule || rule.siteId !== expectedSiteId) ||
    runs.some((run) => !run || run.siteId !== expectedSiteId)
  ) {
    return null;
  }
  const normalizedRules = rules as MerchantEnterpriseAutomationRule[];
  const normalizedRuns = runs as MerchantEnterpriseAutomationRun[];
  if (!assertUniqueIds(normalizedRules) || !assertUniqueIds(normalizedRuns)) {
    return null;
  }
  return { merchantId, rules: normalizedRules, runs: normalizedRuns };
}

function payload(
  draft: MerchantEnterpriseAutomationRuleDraft,
  actor: MerchantEnterpriseActor,
) {
  return {
    merchant_id: draft.siteId,
    ...normalizeActor(actor),
    name: draft.name,
    source_type: draft.sourceType,
    event_type: draft.eventType,
    from_status: draft.fromStatus,
    to_status: draft.toStatus,
    board_id: draft.boardId,
    column_id: draft.columnId,
    workflow_id: draft.workflowId,
    workflow_revision_id: draft.workflowRevisionId,
    task_title: draft.taskTitle,
    task_description: draft.taskDescription,
    priority: draft.priority,
    due_offset_minutes: draft.dueOffsetMinutes,
    status: draft.status,
    assignee_ids: draft.assigneeIds,
    operation_id: draft.operationId,
  };
}

function normalizeMutationResponse(
  value: unknown,
  expectedSiteId: string,
  expectedRuleId?: string,
) {
  const source = record(value);
  const merchantId = text(source?.merchantId ?? source?.merchant_id, 80);
  const rule = normalizeMerchantEnterpriseAutomationRule(source?.rule);
  if (
    merchantId !== expectedSiteId ||
    !rule ||
    rule.siteId !== expectedSiteId ||
    (expectedRuleId !== undefined && rule.id !== expectedRuleId)
  ) {
    throw new Error("enterprise_automation_write_failed");
  }
  return rule;
}

export async function loadMerchantEnterpriseAutomationRules(
  client: MerchantEnterpriseAutomationStoreClient,
  input: { siteId: string; actor: MerchantEnterpriseActor },
): Promise<MerchantEnterpriseAutomationStorePage> {
  const siteId = normalizeSiteId(input.siteId);
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_automation_rules_v1",
    {
      p_input: { merchant_id: siteId, ...normalizeActor(input.actor) },
    },
  );
  if (result.error) {
    throwAutomationError(result.error, "enterprise_automations_read_failed");
  }
  const page = normalizePage(result.data, siteId);
  if (!page) throw new Error("enterprise_automations_read_failed");
  return page;
}

export async function createMerchantEnterpriseAutomationRule(
  client: MerchantEnterpriseAutomationStoreClient,
  input: MerchantEnterpriseAutomationRuleDraft & {
    actor: MerchantEnterpriseActor;
  },
): Promise<MerchantEnterpriseAutomationRule> {
  const siteId = normalizeSiteId(input.siteId);
  const result = await client.rpc(
    "faolla_create_merchant_enterprise_automation_rule_v1",
    { p_input: payload({ ...input, siteId }, input.actor) },
  );
  if (result.error) {
    throwAutomationError(result.error, "enterprise_automation_write_failed");
  }
  return normalizeMutationResponse(result.data, siteId);
}

export async function updateMerchantEnterpriseAutomationRule(
  client: MerchantEnterpriseAutomationStoreClient,
  input: MerchantEnterpriseAutomationRuleUpdate & {
    actor: MerchantEnterpriseActor;
  },
): Promise<MerchantEnterpriseAutomationRule> {
  const siteId = normalizeSiteId(input.siteId);
  if (!UUID_PATTERN.test(input.ruleId) || input.ruleId !== input.ruleId.toLowerCase()) {
    throw new Error("invalid_automation_rule");
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error("invalid_automation_rule");
  }
  const result = await client.rpc(
    "faolla_update_merchant_enterprise_automation_rule_v1",
    {
      p_input: {
        ...payload({ ...input, siteId }, input.actor),
        rule_id: input.ruleId,
        expected_version: input.expectedVersion,
      },
    },
  );
  if (result.error) {
    throwAutomationError(result.error, "enterprise_automation_write_failed");
  }
  return normalizeMutationResponse(result.data, siteId, input.ruleId);
}

export async function archiveMerchantEnterpriseAutomationRule(
  client: MerchantEnterpriseAutomationStoreClient,
  input: {
    siteId: string;
    ruleId: string;
    expectedVersion: number;
    operationId: string;
    actor: MerchantEnterpriseActor;
  },
): Promise<MerchantEnterpriseAutomationRule> {
  const siteId = normalizeSiteId(input.siteId);
  if (!UUID_PATTERN.test(input.ruleId) || input.ruleId !== input.ruleId.toLowerCase()) {
    throw new Error("invalid_automation_rule");
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error("invalid_automation_rule");
  }
  const result = await client.rpc(
    "faolla_archive_merchant_enterprise_automation_rule_v1",
    {
      p_input: {
        merchant_id: siteId,
        ...normalizeActor(input.actor),
        rule_id: input.ruleId,
        expected_version: input.expectedVersion,
        operation_id: input.operationId,
      },
    },
  );
  if (result.error) {
    throwAutomationError(result.error, "enterprise_automation_write_failed");
  }
  return normalizeMutationResponse(result.data, siteId, input.ruleId);
}
