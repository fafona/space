import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisibleMerchantEnterpriseSnapshot,
  GET as getOverview,
  POST as bootstrapOverview,
} from "@/app/api/merchant-enterprise/overview/route";
import {
  PATCH as updateBoard,
  POST as createBoard,
} from "@/app/api/merchant-enterprise/boards/route";
import {
  PATCH as updateColumn,
  POST as createColumn,
} from "@/app/api/merchant-enterprise/columns/route";
import {
  createEmployeeInvitationCooldownResponse,
  createEmployeeInvitationResendResponse,
  getMerchantEnterpriseEmployeeStatusTransitionError,
  getEmployeeInvitationRetryAfterSeconds,
  PATCH as updateEmployee,
  POST as createEmployee,
  reserveEmployeeInvitationResend,
} from "@/app/api/merchant-enterprise/employees/route";
import { POST as acceptEmployee } from "@/app/api/merchant-enterprise/employees/accept/route";
import {
  getMerchantEnterpriseRoleActivationConflict,
  getMerchantEnterpriseRoleArchiveConflict,
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
    invitationVersion: 1,
    invitationExpiresAt: "2026-08-07T10:00:00.000Z",
    invitationRevokedAt: null,
    invitationSentAt: invitedAt,
    invitationDeliveryStatus: "sent",
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
  const rpcInputs: Record<string, unknown>[] = [];
  const store = {
    from() {
      throw new Error("reservation must use the transaction RPC");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      assert.equal(functionName, "faolla_reserve_merchant_employee_invitation_v1");
      rpcInputs.push(args.p_input as Record<string, unknown>);
      return {
        data: {
          employee: {
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
            invitation_version: 2,
            invitation_expires_at: "2026-08-07T10:00:00.000Z",
            invitation_revoked_at: null,
            invitation_sent_at: null,
            invitation_delivery_status: "sending",
            version: 8,
            created_at: employee.createdAt,
            updated_at: "2026-07-31T10:00:00.000Z",
          },
          invitation_version: 2,
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const result = await reserveEmployeeInvitationResend(store, employee, nowMs);

  assert.equal(result.status, "reserved");
  assert.equal(result.employee.version, 8);
  assert.equal(result.invitationVersion, 2);
  assert.match(result.invitationToken, /^[A-Za-z0-9_-]{43}$/);
  const rpcInput = rpcInputs[0];
  assert.ok(rpcInput);
  assert.equal(rpcInput.merchant_id, employee.siteId);
  assert.equal(rpcInput.employee_id, employee.id);
  assert.equal(rpcInput.expected_version, 7);
  assert.equal(rpcInput.expires_at, "2026-08-07T10:00:00.000Z");
  assert.match(String(rpcInput.token_hash), /^[a-f0-9]{64}$/);

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
    [createBoard, "/api/merchant-enterprise/boards", { name: "Operations" }],
    [
      updateBoard,
      "/api/merchant-enterprise/boards",
      {
        boardId: "22222222-2222-4222-8222-222222222222",
        version: 1,
        status: "archived",
      },
    ],
    [
      createColumn,
      "/api/merchant-enterprise/columns",
      {
        boardId: "22222222-2222-4222-8222-222222222222",
        name: "To do",
      },
    ],
    [
      updateColumn,
      "/api/merchant-enterprise/columns",
      {
        boardId: "22222222-2222-4222-8222-222222222222",
        columnId: "33333333-3333-4333-8333-333333333333",
        version: 1,
        status: "archived",
      },
    ],
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

test("employee activation requires a previously accepted invitation", () => {
  assert.equal(
    getMerchantEnterpriseEmployeeStatusTransitionError(
      { status: "invited", acceptedAt: null },
      "active",
    ),
    "employee_invitation_not_accepted",
  );
  assert.equal(
    getMerchantEnterpriseEmployeeStatusTransitionError(
      { status: "disabled", acceptedAt: null },
      "active",
    ),
    "employee_invitation_not_accepted",
  );
  assert.equal(
    getMerchantEnterpriseEmployeeStatusTransitionError(
      { status: "disabled", acceptedAt: "2026-07-31T10:00:00.000Z" },
      "active",
    ),
    null,
  );
  assert.equal(
    getMerchantEnterpriseEmployeeStatusTransitionError(
      { status: "active", acceptedAt: "2026-07-31T10:00:00.000Z" },
      "invited",
    ),
    "invalid_employee_status_transition",
  );
});

test("role permission dependencies are rejected before authorization", async () => {
  const invalidPermissions = ["employees.manage"];
  const requests = [
    [
      createRole,
      "POST",
      {
        siteId: "10000000",
        name: "Unsupported role",
        permissions: invalidPermissions,
      },
    ],
    [
      updateRole,
      "PATCH",
      {
        siteId: "10000000",
        roleId: "role-1",
        version: 1,
        permissions: invalidPermissions,
      },
    ],
  ] as const;

  for (const [handler, method, body] of requests) {
    const response = await handler(
      new Request("https://www.faolla.com/api/merchant-enterprise/roles", {
        method,
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_permission_dependencies",
      missingPermissions: ["enterprise.view", "employees.view", "roles.view"],
    });
  }
});

test("role archive conflicts protect system roles and every assigned employee status", () => {
  const customRole = { id: "role-1", isSystem: false };
  const systemRole = { id: "system-role", isSystem: true };

  assert.equal(
    getMerchantEnterpriseRoleArchiveConflict(systemRole, [], "archived"),
    "system_role_protected",
  );

  for (const status of ["invited", "active", "disabled"] as const) {
    assert.equal(
      getMerchantEnterpriseRoleArchiveConflict(
        customRole,
        [{ roleId: customRole.id, status }],
        "archived",
      ),
      "role_in_use",
    );
  }

  assert.equal(
    getMerchantEnterpriseRoleArchiveConflict(
      customRole,
      [{ roleId: "another-role", status: "active" }],
      "archived",
    ),
    null,
  );
  assert.equal(
    getMerchantEnterpriseRoleArchiveConflict(
      customRole,
      [{ roleId: customRole.id, status: "active" }],
      "active",
    ),
    null,
  );
});

test("restoring a role detects an active role with the same name", () => {
  const archivedRole = {
    id: "role-1",
    name: "仓库主管",
    status: "archived" as const,
  };
  assert.equal(
    getMerchantEnterpriseRoleActivationConflict(
      archivedRole,
      [
        archivedRole,
        { id: "role-2", name: " 仓库主管 ", status: "active" },
      ],
      "active",
    ),
    "role_name_conflict",
  );
  assert.equal(
    getMerchantEnterpriseRoleActivationConflict(
      archivedRole,
      [
        archivedRole,
        { id: "role-2", name: "客服主管", status: "active" },
      ],
      "active",
    ),
    null,
  );
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
    invitationVersion: 0,
    invitationExpiresAt: null,
    invitationRevokedAt: null,
    invitationSentAt: null,
    invitationDeliveryStatus: "none" as const,
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

  const assigningActor: MerchantEnterpriseActor = {
    ...actor,
    permissions: ["enterprise.view", "tasks.view", "tasks.assign"],
  };
  const assigningVisible = buildVisibleMerchantEnterpriseSnapshot(
    assigningActor,
    snapshot,
  );
  assert.deepEqual(
    assigningVisible.employees.map((employee) => employee.displayName),
    ["Assigned Staff", "Hidden Staff"],
  );
  assigningVisible.employees.forEach((employee) => {
    assert.equal(employee.email, "");
    assert.equal(employee.authUserId, "");
  });

  const employeeViewingActor: MerchantEnterpriseActor = {
    ...actor,
    permissions: ["enterprise.view", "tasks.view", "employees.view"],
  };
  const employeeViewingSnapshot = buildVisibleMerchantEnterpriseSnapshot(
    employeeViewingActor,
    snapshot,
  );
  assert.equal(employeeViewingSnapshot.employees[0]?.email, "private@example.com");
  employeeViewingSnapshot.employees.forEach((employee) => {
    assert.equal(employee.authUserId, "");
  });
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

test("task assignment rejects an unbounded employee list before authorization", async () => {
  const assigneeIds = Array.from(
    { length: 51 },
    (_, index) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  );
  const response = await updateTask(
    new Request("https://www.faolla.com/api/merchant-enterprise/tasks", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        siteId: "10000000",
        taskId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        assigneeIds,
      }),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "invalid_task_assignees",
  });
});

test("board routes strictly validate ids, versions, positions and updates before authorization", async () => {
  const cases = [
    [
      createBoard,
      "POST",
      { siteId: "10000000", name: "Operations", position: 1.5 },
      "invalid_board_position",
    ],
    [
      createBoard,
      "POST",
      { siteId: "10000000", name: "Operations", position: 1_000_001 },
      "invalid_board_position",
    ],
    [
      updateBoard,
      "PATCH",
      {
        siteId: "10000000",
        boardId: "not-a-uuid",
        version: 1,
        name: "Operations",
      },
      "invalid_board_id",
    ],
    [
      updateBoard,
      "PATCH",
      {
        siteId: "10000000",
        boardId: "22222222-2222-4222-8222-222222222222",
        version: 0,
        name: "Operations",
      },
      "invalid_board_version",
    ],
    [
      updateBoard,
      "PATCH",
      {
        siteId: "10000000",
        boardId: "22222222-2222-4222-8222-222222222222",
        version: 1,
      },
      "invalid_board_update",
    ],
  ] as const;

  for (const [handler, method, body, error] of cases) {
    const response = await handler(
      new Request("https://www.faolla.com/api/merchant-enterprise/boards", {
        method,
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
});

test("column routes strictly validate UUID, color, boolean, position and update shape", async () => {
  const base = {
    siteId: "10000000",
    boardId: "22222222-2222-4222-8222-222222222222",
  };
  const cases = [
    [
      createColumn,
      "POST",
      { ...base, name: "To do", color: "blue" },
      "invalid_column_color",
    ],
    [
      createColumn,
      "POST",
      { ...base, name: "To do", isDone: "yes" },
      "invalid_column_is_done",
    ],
    [
      createColumn,
      "POST",
      { ...base, name: "To do", position: 1_000_001 },
      "invalid_column_position",
    ],
    [
      updateColumn,
      "PATCH",
      {
        ...base,
        columnId: "not-a-uuid",
        version: 1,
        name: "Doing",
      },
      "invalid_column_id",
    ],
    [
      updateColumn,
      "PATCH",
      {
        ...base,
        columnId: "33333333-3333-4333-8333-333333333333",
        version: 1,
      },
      "invalid_column_update",
    ],
  ] as const;

  for (const [handler, method, body, error] of cases) {
    const response = await handler(
      new Request("https://www.faolla.com/api/merchant-enterprise/columns", {
        method,
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
});

test("valid board and column mutations require an authenticated boards manager", async () => {
  const requests = [
    [
      createBoard,
      "/api/merchant-enterprise/boards",
      {
        siteId: "10000000",
        name: "Operations",
        operationId: "board-create-unauthorized",
      },
    ],
    [
      createColumn,
      "/api/merchant-enterprise/columns",
      {
        siteId: "10000000",
        boardId: "22222222-2222-4222-8222-222222222222",
        name: "To do",
        operationId: "column-create-unauthorized",
      },
    ],
  ] as const;

  for (const [handler, path, body] of requests) {
    const response = await handler(
      new Request(`https://www.faolla.com${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  }
});
