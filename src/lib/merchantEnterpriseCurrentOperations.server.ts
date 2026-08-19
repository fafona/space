import {
  isMerchantEnterpriseSchemaMissingError,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";
import {
  normalizeMerchantEnterpriseCurrentOperations,
  type MerchantEnterpriseCurrentOperations,
} from "@/lib/merchantEnterpriseCurrentOperations";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterpriseCurrentOperationsStoreClient = {
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

function isMissingCurrentOperationsRpc(error: unknown) {
  const source = record(error);
  const code = text(source?.code, 40);
  const message = text(source?.message, 1000);
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /could not find (?:the )?function|schema cache|does not exist/i.test(message)
  );
}

function throwCurrentOperationsReadError(error: unknown): never {
  if (
    isMerchantEnterpriseSchemaMissingError(error) ||
    isMissingCurrentOperationsRpc(error)
  ) {
    throw new Error("enterprise_schema_unavailable");
  }
  const source = record(error);
  const message = `${text(source?.code, 40)}:${text(source?.message, 1000)}`;
  if (message.includes("permission_denied")) {
    throw new Error("permission_denied");
  }
  if (message.includes("employee_not_found")) {
    throw new Error("employee_not_found");
  }
  if (message.includes("invalid_current_operations_query")) {
    throw new Error("invalid_current_operations_query");
  }
  throw new Error("enterprise_current_operations_read_failed");
}

function normalizeSiteId(value: unknown) {
  if (typeof value !== "string" || value !== value.trim() || value.length > 80) {
    throw new Error("invalid_current_operations_query");
  }
  if (!/^\d{8}$/.test(value)) {
    throw new Error("invalid_current_operations_query");
  }
  return value;
}

function normalizeActor(actor: MerchantEnterpriseActor) {
  const rawActorId = actor.id;
  const actorId =
    typeof rawActorId === "string" &&
    rawActorId === rawActorId.trim() &&
    rawActorId.length <= 80
      ? rawActorId.toLowerCase()
      : "";
  if (
    (actor.type !== "owner" && actor.type !== "employee") ||
    !UUID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_current_operations_query");
  }
  return {
    actorType: actor.type,
    actorId,
    scopeRestricted:
      actor.type === "employee" && actor.accessScope === "restricted",
  } as const;
}

function normalizeEmployeeId(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value !== value.trim() || !UUID_PATTERN.test(value)) {
    throw new Error("invalid_current_operations_query");
  }
  return value.toLowerCase();
}

export async function loadMerchantEnterpriseCurrentOperations(
  client: MerchantEnterpriseCurrentOperationsStoreClient,
  input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    employeeId?: string | null;
  },
): Promise<MerchantEnterpriseCurrentOperations> {
  const siteId = normalizeSiteId(input.siteId);
  const actor = normalizeActor(input.actor);
  const requestedEmployeeId = normalizeEmployeeId(input.employeeId);
  const expectedScope =
    actor.actorType === "owner" && requestedEmployeeId === null
      ? "enterprise"
      : "employee";
  const expectedEmployeeId =
    expectedScope === "enterprise"
      ? null
      : requestedEmployeeId ?? actor.actorId;

  const result = await client.rpc(
    "faolla_get_merchant_enterprise_current_operations_v1",
    {
      p_input: {
        merchant_id: siteId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        ...(requestedEmployeeId ? { employee_id: requestedEmployeeId } : {}),
      },
    },
  );
  const rpcResult = record(result);
  if (!rpcResult) {
    throw new Error("enterprise_current_operations_read_failed");
  }
  if (rpcResult.error) throwCurrentOperationsReadError(rpcResult.error);

  const raw = record(rpcResult.data);
  const normalized = normalizeMerchantEnterpriseCurrentOperations(
    raw ? { ok: true, ...raw } : null,
  );
  if (
    !normalized ||
    normalized.scope !== expectedScope ||
    normalized.employeeId !== expectedEmployeeId ||
    normalized.scopeRestricted !== actor.scopeRestricted
  ) {
    throw new Error("enterprise_current_operations_read_failed");
  }
  return normalized;
}
