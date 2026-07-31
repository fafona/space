import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisibleMerchantEnterpriseSnapshot,
  GET as getOverview,
  POST as bootstrapOverview,
} from "@/app/api/merchant-enterprise/overview/route";
import {
  createEmployeeInvitationCooldownResponse,
  createEmployeeInvitationResendResponse,
  getEmployeeInvitationRetryAfterSeconds,
  PATCH as updateEmployee,
  POST as createEmployee,
  reserveEmployeeInvitationResend,
} from "@/app/api/merchant-enterprise/employees/route";
import { POST as acceptEmployee } from "@/app/api/merchant-enterprise/employees/accept/route";
import {
  PATCH as updateRole,
  POST as createRole,
} from "@/app/api/merchant-enterprise/roles/route";
import {
  getMerchantTaskPatchRequiredPermissions,
  PATCH as updateTask,
  POST as createTask,
} from "@/app/api/merchant-enterprise/tasks/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseEmployee,
  MerchantEnterpriseSnapshot,
} from "@/lib/merchantEnterprise";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";

function pendingEmployee(
  invitedAt: string | null,
  version = 7,
): MerchantEnterpriseEmployee {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    siteId: "10000000",
    authUserId: "88888888-8888-4888-8888-888888888888",
    email: "staff@example.com",
    displayName: "Staff",
    roleId: "99999999-9999-4999-8999-999999999999",
    status: "invited",
    invitedAt,
    acceptedAt: null,
    lastActiveAt: null,
    version,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  };
}

test("employee invitation resend enforces a 60-second cooldown without reserving", async () => {
  const nowMs = Date.parse("2026-07-31T10:00:00.000Z");
  const employee = pendingEmployee("2026-07-31T09:59:30.250Z");
  const store = {
    from() {
      throw new Error("cooldown must stop before the CAS write");
    },
    async rpc() {
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  assert.equal(
    getEmployeeInvitationRetryAfterSeconds(employee.invitedAt, nowMs),
    31,
  );
  assert.deepEqual(
    await reserveEmployeeInvitationResend(store, employee, nowMs),
    { status: "cooldown", employee, retryAfterSeconds: 31 },
  );
  const response = createEmployeeInvitationCooldownResponse(employee, 31);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "31");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "employee_invitation_cooldown",
    employee,
    retryAfterSeconds: 31,
  });
});

test("eligible employee invitation resend reserves a new version before email delivery", async () => {
  const nowMs = Date.parse("2026-07-31T10:00:00.000Z");
  const employee = pendingEmployee("2026-07-31T09:58:59.999Z");
  const filters: Array<[string, unknown]> = [];
  let patch: Record<string, unknown> | null = null;
  const store = {
    from(table: string) {
      assert.equal(table, "merchant_enterprise_employees");
      const builder = {
        update(value: Record<string, unknown>) {
          patch = value;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        select() {
          return builder;
        },
        async maybeSingle() {
          return {
            data: {
              id: employee.id,
              merchant_id: employee.siteId,
              auth_user_id: employee.authUserId,
              email: employee.email,
              display_name: employee.displayName,
              role_id: employee.roleId,
              status: employee.status,
              invited_at: "2026-07-31T10:00:00.000Z",
              accepted_at: null,
              last_active_at: null,
              version: 8,
              created_at: employee.createdAt,
              updated_at: "2026-07-31T10:00:00.000Z",
            },
            error: null,
          };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const result = await reserveEmployeeInvitationResend(store, employee, nowMs);

  assert.equal(result.status, "reserved");
  assert.equal(result.employee.version, 8);
  assert.deepEqual(patch, { invited_at: "2026-07-31T10:00:00.000Z" });
  assert.deepEqual(filters, [
    ["merchant_id", employee.siteId],
    ["id", employee.id],
    ["version", 7],
  ]);

  const response = createEmployeeInvitationResendResponse({
    employee: result.employee,
    invitation: { status: "failed", error: "invite_unavailable" },
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    employee: result.employee,
    invitation: { status: "failed", error: "invite_unavailable" },
  });
});

test("enterprise overview rejects invalid merchant ids before authentication", async () => {
  const response = await getOverview(
    new Request("https://www.faolla.com/api/merchant-enterprise/overview?siteId=invalid"),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_site_id" });
});

test("enterprise overview does not expose data without a validated auth token", async () => {
  const response = await getOverview(
    new Request("https://www.faolla.com/api/merchant-enterprise/overview?siteId=10000000"),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
});

test("enterprise mutations reject untrusted cross-origin requests", async () => {
  const requests = [
    [bootstrapOverview, "/api/merchant-enterprise/overview", {}],
    [createEmployee, "/api/merchant-enterprise/employees", { email: "staff@example.com" }],
    [acceptEmployee, "/api/merchant-enterprise/employees/accept", {}],
    [createRole, "/api/merchant-enterprise/roles", { name: "Staff" }],
    [createTask, "/api/merchant-enterprise/tasks", { title: "Task" }],
  ] as const;
  for (const [handler, path, body] of requests) {
    const response = await handler(
      new Request(`https://www.faolla.com${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.invalid",
        },
        body: JSON.stringify({ siteId: "10000000", ...body }),
      }),
    );
    assert.equal(response.status, 403);
  }
});

test("employee and role updates reject missing optimistic-lock versions before authorization", async () => {
  for (const [handler, path, body] of [
    [
      updateEmployee,
      "/api/merchant-enterprise/employees",
      { employeeId: "employee-1", status: "disabled" },
    ],
    [
      updateRole,
      "/api/merchant-enterprise/roles",
      { roleId: "role-1", permissions: ["enterprise.view"] },
    ],
  ] as const) {
    const response = await handler(
      new Request(`https://www.faolla.com${path}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({ siteId: "10000000", ...body }),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_version" });
  }
});

test("overview returns only the assignee directory when employee viewing is denied", () => {
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "Staff",
    email: "staff@example.com",
    roleId: "role-1",
    permissions: ["enterprise.view", "tasks.view"],
  };
  const employeeBase = {
    siteId: "10000000",
    authUserId: "auth-user",
    email: "private@example.com",
    roleId: "role-1",
    status: "active" as const,
    invitedAt: null,
    acceptedAt: null,
    lastActiveAt: null,
    version: 4,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  };
  const snapshot = {
    roles: [],
    employees: [
      { ...employeeBase, id: "employee-1", displayName: "Assigned Staff" },
      { ...employeeBase, id: "employee-2", displayName: "Hidden Staff" },
    ],
    boards: [],
    columns: [],
    tasks: [
      {
        id: "task-1",
        siteId: "10000000",
        boardId: "board-1",
        columnId: "column-1",
        title: "Task",
        description: "",
        priority: "normal" as const,
        dueAt: null,
        completedAt: null,
        archivedAt: null,
        position: 0,
        sourceType: "",
        sourceId: "",
        createdByEmployeeId: "",
        assigneeIds: ["employee-1"],
        version: 1,
        createdAt: "2026-07-31T08:00:00.000Z",
        updatedAt: "2026-07-31T08:00:00.000Z",
      },
    ],
  } satisfies MerchantEnterpriseSnapshot;
  const visible = buildVisibleMerchantEnterpriseSnapshot(actor, snapshot);
  assert.equal(visible.employees.length, 1);
  assert.equal(visible.employees[0]?.displayName, "Assigned Staff");
  assert.equal(visible.employees[0]?.email, "");
  assert.equal(visible.employees[0]?.authUserId, "");
});

test("task patch permissions are derived from every mutated field", () => {
  assert.deepEqual(
    getMerchantTaskPatchRequiredPermissions({
      title: "Updated",
      archived: true,
      assigneeIds: [],
    }),
    ["tasks.update", "tasks.archive", "tasks.assign"],
  );
  assert.deepEqual(
    getMerchantTaskPatchRequiredPermissions({ archived: false }),
    ["tasks.archive"],
  );
  assert.deepEqual(
    getMerchantTaskPatchRequiredPermissions({ assigneeIds: [] }),
    ["tasks.assign"],
  );
});

test("task patch requires a positive optimistic-lock version before authorization", async () => {
  for (const version of [undefined, "1", 0, 1.5]) {
    const response = await updateTask(
      new Request("https://www.faolla.com/api/merchant-enterprise/tasks", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          taskId: "task-1",
          title: "Updated",
          ...(version !== undefined ? { version } : {}),
        }),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_task_version" });
  }
});

test("task patch rejects malformed assignee replacement instead of clearing it", async () => {
  const response = await updateTask(
    new Request("https://www.faolla.com/api/merchant-enterprise/tasks", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        siteId: "10000000",
        taskId: "task-1",
        version: 1,
        assigneeIds: "employee-1",
      }),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_task_assignees" });
});
