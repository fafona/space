import { NextResponse } from "next/server";
import {
  MERCHANT_TASK_PRIORITIES,
  type MerchantEnterpriseActor,
  type MerchantEnterprisePermission,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  MAX_MERCHANT_ENTERPRISE_AUTOMATION_ASSIGNEES,
  MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES,
  MERCHANT_ENTERPRISE_AUTOMATION_EVENT_TYPES,
  MERCHANT_ENTERPRISE_AUTOMATION_EDITABLE_RULE_STATUSES,
  MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_TYPES,
  hasOnlyMerchantEnterpriseAutomationTemplateTokens,
  type MerchantEnterpriseAutomationEventType,
  type MerchantEnterpriseAutomationRule,
  type MerchantEnterpriseAutomationRuleDraft,
  type MerchantEnterpriseAutomationEditableRuleStatus,
  type MerchantEnterpriseAutomationRuleUpdate,
  type MerchantEnterpriseAutomationSourceAvailabilityMap,
  type MerchantEnterpriseAutomationSourceType,
} from "@/lib/merchantEnterpriseAutomation";
import {
  archiveMerchantEnterpriseAutomationRule,
  createMerchantEnterpriseAutomationRule,
  isMerchantEnterpriseAutomationWorkerEnabled,
  loadMerchantEnterpriseAutomationRules,
  updateMerchantEnterpriseAutomationRule,
  type MerchantEnterpriseAutomationStoreClient,
  type MerchantEnterpriseAutomationStorePage,
} from "@/lib/merchantEnterpriseAutomation.server";
import { resolveMerchantBookingDualWriteConfig } from "@/lib/merchantBookingDualWrite.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { resolveMerchantOrderDualWriteConfig } from "@/lib/merchantOrderDualWrite.server";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const SOURCE_STATUSES: Record<
  MerchantEnterpriseAutomationSourceType,
  readonly string[]
> = {
  order: ["pending", "confirmed", "completed", "cancelled"],
  booking: ["active", "confirmed", "completed", "no_show", "cancelled"],
};

type AutomationBody = Record<string, unknown>;

export type MerchantEnterpriseAutomationRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  sourceAvailability: (
    siteId: string,
  ) => MerchantEnterpriseAutomationSourceAvailabilityMap;
  loadRules: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantEnterpriseAutomationStorePage>;
  createRule: (
    input: MerchantEnterpriseAutomationRuleDraft & {
      actor: MerchantEnterpriseActor;
    },
  ) => Promise<MerchantEnterpriseAutomationRule>;
  updateRule: (
    input: MerchantEnterpriseAutomationRuleUpdate & {
      actor: MerchantEnterpriseActor;
    },
  ) => Promise<MerchantEnterpriseAutomationRule>;
  archiveRule: (input: {
    siteId: string;
    ruleId: string;
    expectedVersion: number;
    operationId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantEnterpriseAutomationRule>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseAutomationStoreClient;
}

export function resolveMerchantEnterpriseAutomationSourceAvailability(
  siteId: string,
  workerEnabled = isMerchantEnterpriseAutomationWorkerEnabled(),
): MerchantEnterpriseAutomationSourceAvailabilityMap {
  const order = resolveMerchantOrderDualWriteConfig();
  const booking = resolveMerchantBookingDualWriteConfig();
  return {
    order: workerEnabled && order.mode === "shadow" ? "active" : "inactive",
    booking:
      workerEnabled &&
      booking.mode === "shadow" &&
      booking.siteIds.includes(siteId)
        ? "active"
        : "inactive",
  };
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseAutomationRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  sourceAvailability: resolveMerchantEnterpriseAutomationSourceAvailability,
  loadRules: (input) => loadMerchantEnterpriseAutomationRules(storeClient(), input),
  createRule: (input) =>
    createMerchantEnterpriseAutomationRule(storeClient(), input),
  updateRule: (input) =>
    updateMerchantEnterpriseAutomationRule(storeClient(), input),
  archiveRule: (input) =>
    archiveMerchantEnterpriseAutomationRule(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "invalid_automation_query" ||
    code === "invalid_automation_request" ||
    code === "invalid_automation_rule" ||
    code === "invalid_automation_assignees" ||
    code === "invalid_operation_id"
  ) {
    return response({ ok: false, error: code }, 400);
  }
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  if (code === "automation_rule_not_found" || code === "board_not_found") {
    return response({ ok: false, error: code }, 404);
  }
  if (
    code === "enterprise_version_conflict" ||
    code === "enterprise_operation_in_progress" ||
    code === "enterprise_operation_conflict" ||
    code === "automation_rule_archived" ||
    code === "automation_target_unavailable" ||
    code === "automation_assignee_unavailable" ||
    code === "automation_active_rule_limit_reached" ||
    code === "automation_rule_limit_reached" ||
    code === "automation_workflow_unavailable" ||
    code === "workflow_not_published" ||
    code === "workflow_revision_changed"
  ) {
    return response({ ok: false, error: code }, 409);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function parseSiteId(value: unknown, errorCode = "invalid_automation_request") {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !isMerchantNumericId(value)
  ) {
    throw new Error(errorCode);
  }
  return value;
}

function parseUuid(value: unknown) {
  if (typeof value !== "string" || value !== value.trim() || !UUID_PATTERN.test(value)) {
    throw new Error("invalid_automation_rule");
  }
  return value.toLowerCase();
}

function parseRequiredText(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error("invalid_automation_rule");
  }
  const normalized = value.trim();
  if (!normalized) throw new Error("invalid_automation_rule");
  return normalized;
}

function parseOptionalText(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error("invalid_automation_rule");
  }
  return value.trim();
}

function parseNullableStatus(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value !== value.trim() || !value) {
    throw new Error("invalid_automation_rule");
  }
  return value;
}

function parseOperationId(request: Request, body: AutomationBody) {
  const value = Object.prototype.hasOwnProperty.call(body, "operationId")
    ? body.operationId
    : request.headers.get("idempotency-key") ?? undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("invalid_operation_id");
  }
  const operationId = normalizeMutationOperationId(value);
  if (!operationId || operationId !== value.trim()) {
    throw new Error("invalid_operation_id");
  }
  return operationId;
}

function parseAssigneeIds(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_MERCHANT_ENTERPRISE_AUTOMATION_ASSIGNEES) {
    throw new Error("invalid_automation_assignees");
  }
  const ids = value.map(parseUuid);
  if (new Set(ids).size !== ids.length) {
    throw new Error("invalid_automation_assignees");
  }
  return ids.sort();
}

function assertBody(
  value: unknown,
  mode: "create" | "update",
): asserts value is AutomationBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_automation_request");
  }
  const allowed = new Set([
    "siteId",
    ...(mode === "update" ? ["ruleId", "expectedVersion"] : []),
    "name",
    "sourceType",
    "eventType",
    "fromStatus",
    "toStatus",
    "boardId",
    "columnId",
    "workflowId",
    "workflowRevisionId",
    "taskTitle",
    "taskDescription",
    "priority",
    "dueOffsetMinutes",
    "status",
    "assigneeIds",
    "operationId",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("invalid_automation_request");
  }
}

function assertArchiveBody(value: unknown): asserts value is AutomationBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_automation_request");
  }
  const body = value as AutomationBody;
  const allowed = new Set([
    "siteId",
    "action",
    "ruleId",
    "expectedVersion",
    "operationId",
  ]);
  if (
    body.action !== "archive" ||
    Object.keys(body).some((key) => !allowed.has(key))
  ) {
    throw new Error("invalid_automation_request");
  }
}

function parseExpectedVersion(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new Error("invalid_automation_rule");
  }
  return value;
}

function parseDraft(request: Request, body: AutomationBody) {
  const siteId = parseSiteId(body.siteId);
  const sourceType = body.sourceType as MerchantEnterpriseAutomationSourceType;
  const eventType = body.eventType as MerchantEnterpriseAutomationEventType;
  const status = body.status as MerchantEnterpriseAutomationEditableRuleStatus;
  const priority = body.priority as MerchantTaskPriority;
  if (!MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_TYPES.includes(sourceType)) {
    throw new Error("invalid_automation_rule");
  }
  if (!MERCHANT_ENTERPRISE_AUTOMATION_EVENT_TYPES.includes(eventType)) {
    throw new Error("invalid_automation_rule");
  }
  if (!MERCHANT_ENTERPRISE_AUTOMATION_EDITABLE_RULE_STATUSES.includes(status)) {
    throw new Error("invalid_automation_rule");
  }
  if (!MERCHANT_TASK_PRIORITIES.includes(priority)) {
    throw new Error("invalid_automation_rule");
  }
  const fromStatus = parseNullableStatus(body.fromStatus);
  const toStatus = parseNullableStatus(body.toStatus);
  if (
    (fromStatus !== null && !SOURCE_STATUSES[sourceType].includes(fromStatus)) ||
    (toStatus !== null && !SOURCE_STATUSES[sourceType].includes(toStatus)) ||
    (eventType === "created" && (fromStatus !== null || toStatus !== null)) ||
    (eventType === "status_changed" && toStatus === null)
  ) {
    throw new Error("invalid_automation_rule");
  }
  const dueOffsetMinutes = body.dueOffsetMinutes;
  if (
    dueOffsetMinutes !== null &&
    (typeof dueOffsetMinutes !== "number" ||
      !Number.isSafeInteger(dueOffsetMinutes) ||
      dueOffsetMinutes < 0 ||
      dueOffsetMinutes > MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES)
  ) {
    throw new Error("invalid_automation_rule");
  }
  const taskTitle = parseRequiredText(body.taskTitle, 240);
  const taskDescription = parseOptionalText(body.taskDescription, 10_000);
  if (
    !hasOnlyMerchantEnterpriseAutomationTemplateTokens(taskTitle) ||
    !hasOnlyMerchantEnterpriseAutomationTemplateTokens(taskDescription)
  ) {
    throw new Error("invalid_automation_rule");
  }
  return {
    siteId,
    name: parseRequiredText(body.name, 160),
    sourceType,
    eventType,
    fromStatus,
    toStatus,
    boardId: parseUuid(body.boardId),
    columnId: parseUuid(body.columnId),
    workflowId: parseUuid(body.workflowId),
    workflowRevisionId: parseUuid(body.workflowRevisionId),
    taskTitle,
    taskDescription,
    priority,
    dueOffsetMinutes,
    status,
    assigneeIds: parseAssigneeIds(body.assigneeIds),
    operationId: parseOperationId(request, body),
  } satisfies MerchantEnterpriseAutomationRuleDraft;
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    params.getAll("siteId").length !== 1 ||
    Array.from(params.keys()).some((key) => key !== "siteId")
  ) {
    throw new Error("invalid_automation_query");
  }
  return parseSiteId(params.get("siteId"), "invalid_automation_query");
}

async function authorize(
  request: Request,
  siteId: string,
  permission: MerchantEnterprisePermission,
  dependencies: MerchantEnterpriseAutomationRouteDependencies,
) {
  const actor = await dependencies.resolveActor(request, {
    siteId,
    requiredPermission: permission,
  });
  await dependencies.requireEnterpriseEntitlement(siteId);
  return actor;
}

function unavailableResponse(
  availability: MerchantEnterpriseAutomationSourceAvailabilityMap,
) {
  return response(
    {
      ok: false,
      error: "source_event_stream_unavailable",
      sourceAvailability: availability,
    },
    409,
  );
}

export async function handleMerchantEnterpriseWorkflowAutomationsGet(
  request: Request,
  overrides: Partial<MerchantEnterpriseAutomationRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const siteId = parseQuery(request);
    const actor = await authorize(
      request,
      siteId,
      "automations.view",
      dependencies,
    );
    const [page, sourceAvailability] = await Promise.all([
      dependencies.loadRules({ siteId, actor }),
      Promise.resolve(dependencies.sourceAvailability(siteId)),
    ]);
    if (page.merchantId !== siteId) {
      throw new Error("enterprise_automations_read_failed");
    }
    return response({
      ok: true,
      rules: page.rules,
      runs: page.runs,
      sourceAvailability,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleMutation(
  request: Request,
  mode: "create" | "update",
  overrides: Partial<MerchantEnterpriseAutomationRouteDependencies>,
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    if (
      mode === "update" &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.prototype.hasOwnProperty.call(body, "action")
    ) {
      assertArchiveBody(body);
      const siteId = parseSiteId(body.siteId);
      const actor = await authorize(
        request,
        siteId,
        "automations.manage",
        dependencies,
      );
      const [rule, sourceAvailability] = await Promise.all([
        dependencies.archiveRule({
          siteId,
          ruleId: parseUuid(body.ruleId),
          expectedVersion: parseExpectedVersion(body.expectedVersion),
          operationId: parseOperationId(request, body),
          actor,
        }),
        Promise.resolve(dependencies.sourceAvailability(siteId)),
      ]);
      return response({ ok: true, rule, sourceAvailability });
    }
    assertBody(body, mode);
    const draft = parseDraft(request, body);
    const actor = await authorize(
      request,
      draft.siteId,
      "automations.manage",
      dependencies,
    );
    const sourceAvailability = dependencies.sourceAvailability(draft.siteId);
    if (
      draft.status === "active" &&
      sourceAvailability[draft.sourceType] !== "active"
    ) {
      return unavailableResponse(sourceAvailability);
    }
    let rule: MerchantEnterpriseAutomationRule;
    if (mode === "create") {
      rule = await dependencies.createRule({ ...draft, actor });
    } else {
      rule = await dependencies.updateRule({
        ...draft,
        actor,
        ruleId: parseUuid(body.ruleId),
        expectedVersion: parseExpectedVersion(body.expectedVersion),
      });
    }
    return response({ ok: true, rule, sourceAvailability });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowAutomationsPost(
  request: Request,
  overrides: Partial<MerchantEnterpriseAutomationRouteDependencies> = {},
) {
  return handleMutation(request, "create", overrides);
}

export async function handleMerchantEnterpriseWorkflowAutomationsPatch(
  request: Request,
  overrides: Partial<MerchantEnterpriseAutomationRouteDependencies> = {},
) {
  return handleMutation(request, "update", overrides);
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseWorkflowAutomationsGet(request);
}

export async function POST(request: Request) {
  return handleMerchantEnterpriseWorkflowAutomationsPost(request);
}

export async function PATCH(request: Request) {
  return handleMerchantEnterpriseWorkflowAutomationsPatch(request);
}
