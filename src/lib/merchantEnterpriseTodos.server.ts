import {
  isMerchantEnterpriseSchemaMissingError,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";
import {
  MAX_MERCHANT_ENTERPRISE_TODO_PAGE_SIZE,
  MERCHANT_ENTERPRISE_TODO_CATEGORIES,
  normalizeMerchantEnterpriseTodoCursor,
  normalizeMerchantEnterpriseTodoStorePage,
  type MerchantEnterpriseTodo,
  type MerchantEnterpriseTodoCategory,
  type MerchantEnterpriseTodoCursor,
  type MerchantEnterpriseTodoStorePage,
} from "@/lib/merchantEnterpriseTodos";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterpriseTodoStoreClient = {
  // Supabase RPC responses are untrusted until normalized below.
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

function isMissingTodoRpc(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000);
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /could not find (?:the )?function|schema cache|does not exist/i.test(message)
  );
}

function throwTodoReadError(error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error) || isMissingTodoRpc(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const source = record(error);
  const message = `${text(source?.code, 40)}:${text(source?.message, 1000)}`;
  if (message.includes("permission_denied")) throw new Error("permission_denied");
  if (message.includes("invalid_enterprise_todo_query")) {
    throw new Error("invalid_enterprise_todo_query");
  }
  throw new Error("enterprise_todos_read_failed");
}

function normalizeSiteId(value: unknown) {
  const siteId = text(value, 80);
  if (!/^\d{8}$/.test(siteId)) throw new Error("invalid_enterprise_todo_query");
  return siteId;
}

function normalizeActor(actor: MerchantEnterpriseActor) {
  const actorId = text(actor.id, 80).toLowerCase();
  if (
    (actor.type !== "owner" && actor.type !== "employee") ||
    !UUID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_enterprise_todo_query");
  }
  return { actor_type: actor.type, actor_id: actorId };
}

function normalizeCategory(value: unknown): MerchantEnterpriseTodoCategory {
  if (
    typeof value !== "string" ||
    !MERCHANT_ENTERPRISE_TODO_CATEGORIES.includes(
      value as MerchantEnterpriseTodoCategory,
    )
  ) {
    throw new Error("invalid_enterprise_todo_query");
  }
  return value as MerchantEnterpriseTodoCategory;
}

function normalizeCursor(
  value: MerchantEnterpriseTodoCursor | null | undefined,
  category: MerchantEnterpriseTodoCategory,
) {
  if (value === null || value === undefined) return null;
  const cursor = normalizeMerchantEnterpriseTodoCursor(value);
  if (!cursor || cursor.category !== category) {
    throw new Error("invalid_enterprise_todo_cursor");
  }
  return cursor;
}

function entityId(item: MerchantEnterpriseTodo) {
  return item.kind === "task"
    ? item.taskId
    : item.kind === "workflow_acknowledgement"
      ? item.workflowId
      : item.executionId;
}

function expectedBucket(item: MerchantEnterpriseTodo) {
  if (item.kind === "task") {
    return item.urgency === "overdue" ? 0 : item.urgency === "due_soon" ? 1 : 5;
  }
  if (item.kind === "workflow_feedback") return 2;
  if (item.kind === "workflow_acknowledgement") return 3;
  return 4;
}

export async function loadMerchantEnterpriseTodos(
  client: MerchantEnterpriseTodoStoreClient,
  input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    category?: MerchantEnterpriseTodoCategory;
    limit?: number;
    cursor?: MerchantEnterpriseTodoCursor | null;
  },
): Promise<MerchantEnterpriseTodoStorePage> {
  const siteId = normalizeSiteId(input.siteId);
  const actor = normalizeActor(input.actor);
  const category = normalizeCategory(input.category ?? "all");
  const limit = input.limit ?? 20;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MERCHANT_ENTERPRISE_TODO_PAGE_SIZE
  ) {
    throw new Error("invalid_enterprise_todo_query");
  }
  const cursor = normalizeCursor(input.cursor, category);
  const result = await client.rpc("faolla_list_merchant_enterprise_todos_v1", {
    p_input: {
      merchant_id: siteId,
      ...actor,
      category,
      limit,
      cursor_bucket: cursor?.bucket ?? null,
      cursor_sort_at: cursor?.sortAt ?? null,
      cursor_kind: cursor?.kind ?? null,
      cursor_id: cursor?.entityId ?? null,
    },
  });
  if (result.error) throwTodoReadError(result.error);

  const page = normalizeMerchantEnterpriseTodoStorePage(result.data);
  if (
    !page ||
    page.merchantId !== siteId ||
    page.items.length > limit ||
    (category === "tasks" && page.items.some((item) => item.kind !== "task")) ||
    (category === "workflows" && page.items.some((item) => item.kind === "task")) ||
    (page.nextCursor !== null &&
      (page.nextCursor.category !== category ||
        page.items.length !== limit ||
        page.nextCursor.kind !== page.items.at(-1)?.kind ||
        page.nextCursor.entityId !== entityId(page.items.at(-1)!) ||
        page.nextCursor.bucket !== expectedBucket(page.items.at(-1)!) ||
        page.nextCursor.sortAt !== page.items.at(-1)?.attentionAt))
  ) {
    throw new Error("enterprise_todos_read_failed");
  }
  return page;
}
