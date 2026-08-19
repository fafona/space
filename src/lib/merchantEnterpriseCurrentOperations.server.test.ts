import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  loadMerchantEnterpriseCurrentOperations,
  type MerchantEnterpriseCurrentOperationsStoreClient,
} from "@/lib/merchantEnterpriseCurrentOperations.server";

const SITE_ID = "10000000";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000002";
const OTHER_EMPLOYEE_ID = "30000000-0000-4000-8000-000000000003";
const BOARD_ID = "40000000-0000-4000-8000-000000000004";
const COLUMN_ID = "50000000-0000-4000-8000-000000000005";
const TASK_ID = "60000000-0000-4000-8000-000000000006";

const owner: Extract<MerchantEnterpriseActor, { type: "owner" }> = {
  type: "owner",
  id: OWNER_ID,
  siteId: SITE_ID,
  displayName: "Owner",
  email: "owner@example.test",
  permissions: ["enterprise.view", "tasks.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const employee: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: EMPLOYEE_ID,
  siteId: SITE_ID,
  displayName: "Employee",
  email: "employee@example.test",
  roleId: "70000000-0000-4000-8000-000000000007",
  permissions: ["enterprise.view", "tasks.view", "employees.view", "roles.view"],
  accessScope: "restricted",
  allowedBoardIds: [BOARD_ID],
};

function rpcPayload(input: {
  scope?: "enterprise" | "employee";
  employeeId?: string | null;
  scopeRestricted?: boolean;
} = {}) {
  const scope = input.scope ?? "enterprise";
  return {
    asOf: "2026-08-19T10:00:00.000Z",
    scope,
    employeeId:
      input.employeeId === undefined
        ? scope === "employee"
          ? EMPLOYEE_ID
          : null
        : input.employeeId,
    scopeRestricted: input.scopeRestricted ?? false,
    boardSummaryTotalCount: 1,
    boardsTruncated: false,
    summary: {
      openTaskCount: 1,
      overdueTaskCount: 0,
      dueSoonTaskCount: 1,
      unassignedTaskCount: scope === "enterprise" ? 0 : null,
      involvedBoardCount: 1,
      sharedAssignmentTaskCount: scope === "employee" ? 1 : null,
    },
    boards: [
      {
        boardId: BOARD_ID,
        boardName: "Operations",
        openTaskCount: 1,
        overdueTaskCount: 0,
        dueSoonTaskCount: 1,
      },
    ],
    priorityTasks: [
      {
        id: TASK_ID,
        boardId: BOARD_ID,
        boardName: "Operations",
        columnId: COLUMN_ID,
        columnName: "In progress",
        title: "Confirm shipment",
        priority: "high",
        dueAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-19T09:00:00.000Z",
        assigneeCount: scope === "employee" ? 2 : 1,
      },
    ],
  };
}

function client(
  handler: (
    functionName: string,
    args: Record<string, unknown>,
  ) => unknown,
): MerchantEnterpriseCurrentOperationsStoreClient {
  return {
    async rpc(functionName, args) {
      return handler(functionName, args);
    },
  };
}

test("owner current operations requests enterprise scope without an employee id", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await loadMerchantEnterpriseCurrentOperations(
    client((functionName, args) => {
      calls.push({ functionName, args });
      return { data: rpcPayload(), error: null };
    }),
    { siteId: SITE_ID, actor: owner },
  );

  assert.equal(result.ok, true);
  assert.equal(result.scope, "enterprise");
  assert.equal(result.employeeId, null);
  assert.deepEqual(calls, [
    {
      functionName: "faolla_get_merchant_enterprise_current_operations_v1",
      args: {
        p_input: {
          merchant_id: SITE_ID,
          actor_type: "owner",
          actor_id: OWNER_ID,
        },
      },
    },
  ]);
});

test("employee defaults to self and forwards an explicit target without changing caller scope", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const rpcClient = client((_functionName, args) => {
    calls.push(args);
    const rpcInput = args.p_input as Record<string, unknown>;
    const target = (rpcInput.employee_id as string | undefined) ?? EMPLOYEE_ID;
    return {
      data: rpcPayload({
        scope: "employee",
        employeeId: target,
        scopeRestricted: true,
      }),
      error: null,
    };
  });

  const self = await loadMerchantEnterpriseCurrentOperations(rpcClient, {
    siteId: SITE_ID,
    actor: employee,
  });
  const other = await loadMerchantEnterpriseCurrentOperations(rpcClient, {
    siteId: SITE_ID,
    actor: employee,
    employeeId: OTHER_EMPLOYEE_ID,
  });

  assert.equal(self.employeeId, EMPLOYEE_ID);
  assert.equal(other.employeeId, OTHER_EMPLOYEE_ID);
  assert.equal(self.scopeRestricted, true);
  assert.deepEqual(calls, [
    {
      p_input: {
        merchant_id: SITE_ID,
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
    {
      p_input: {
        merchant_id: SITE_ID,
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
        employee_id: OTHER_EMPLOYEE_ID,
      },
    },
  ]);
});

test("store boundary rejects scope, employee and board-scope marker mismatches", async () => {
  for (const data of [
    rpcPayload({ scope: "employee", employeeId: EMPLOYEE_ID }),
    rpcPayload({ scopeRestricted: true }),
    rpcPayload({ employeeId: OTHER_EMPLOYEE_ID }),
  ]) {
    await assert.rejects(
      loadMerchantEnterpriseCurrentOperations(
        client(() => ({ data, error: null })),
        { siteId: SITE_ID, actor: owner },
      ),
      /enterprise_current_operations_read_failed/,
    );
  }
});

test("store boundary rejects malformed caller inputs before RPC", async () => {
  let calls = 0;
  const rpcClient = client(() => {
    calls += 1;
    return { data: rpcPayload(), error: null };
  });
  await assert.rejects(
    loadMerchantEnterpriseCurrentOperations(rpcClient, {
      siteId: "bad",
      actor: owner,
    }),
    /invalid_current_operations_query/,
  );
  await assert.rejects(
    loadMerchantEnterpriseCurrentOperations(rpcClient, {
      siteId: ` ${SITE_ID}`,
      actor: owner,
    }),
    /invalid_current_operations_query/,
  );
  await assert.rejects(
    loadMerchantEnterpriseCurrentOperations(rpcClient, {
      siteId: SITE_ID,
      actor: { ...owner, id: ` ${OWNER_ID}` },
    }),
    /invalid_current_operations_query/,
  );
  await assert.rejects(
    loadMerchantEnterpriseCurrentOperations(rpcClient, {
      siteId: SITE_ID,
      actor: owner,
      employeeId: "not-a-uuid",
    }),
    /invalid_current_operations_query/,
  );
  assert.equal(calls, 0);
});

test("store boundary rejects a malformed RPC envelope", async () => {
  await assert.rejects(
    loadMerchantEnterpriseCurrentOperations(
      client(() => null),
      { siteId: SITE_ID, actor: owner },
    ),
    /enterprise_current_operations_read_failed/,
  );
});

test("store boundary maps schema, authorization, target and invalid-query failures", async () => {
  const cases = [
    [
      {
        code: "PGRST202",
        message:
          "Could not find the function public.faolla_get_merchant_enterprise_current_operations_v1 in the schema cache",
      },
      "enterprise_schema_unavailable",
    ],
    [
      {
        code: "42883",
        message:
          "function public.faolla_get_merchant_enterprise_current_operations_v1(jsonb) does not exist",
      },
      "enterprise_schema_unavailable",
    ],
    [
      {
        code: "PGRST202",
        message: "Could not find an unrelated function in the schema cache",
      },
      "enterprise_current_operations_read_failed",
    ],
    [
      {
        code: "42P01",
        message: "relation merchant_tasks does not exist",
      },
      "enterprise_current_operations_read_failed",
    ],
    [{ code: "P0001", message: "permission_denied" }, "permission_denied"],
    [{ code: "P0001", message: "employee_not_found" }, "employee_not_found"],
    [{ code: "P0001", message: "invalid_current_operations_query" }, "invalid_current_operations_query"],
    [{ code: "XX000", message: "unexpected" }, "enterprise_current_operations_read_failed"],
  ] as const;
  for (const [error, expected] of cases) {
    await assert.rejects(
      loadMerchantEnterpriseCurrentOperations(
        client(() => ({ data: null, error })),
        { siteId: SITE_ID, actor: owner },
      ),
      new RegExp(expected),
    );
  }
});
