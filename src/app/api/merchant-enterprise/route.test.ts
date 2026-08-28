import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisibleMerchantEnterpriseSnapshot,
  GET as getOverview,
  getMerchantEnterpriseOverviewMutationErrorResponse,
  POST as bootstrapOverview,
} from "@/app/api/merchant-enterprise/overview/route";
import {
  getMerchantTaskBoardErrorResponse,
  PATCH as updateBoard,
  POST as createBoard,
} from "@/app/api/merchant-enterprise/boards/route";
import {
  getMerchantTaskColumnErrorResponse,
  PATCH as updateColumn,
  POST as createColumn,
} from "@/app/api/merchant-enterprise/columns/route";
import {
  createEmployeeInvitationCooldownResponse,
  createEmployeeInvitationResendResponse,
  getMerchantEnterpriseEmployeeMutationActor,
  getMerchantEnterpriseEmployeeMutationErrorResponse,
  getMerchantEnterpriseEmployeeRoleTransitionValidation,
  getMerchantEnterpriseEmployeeStatusTransitionError,
  getEmployeeInvitationRetryAfterSeconds,
  parseMerchantEnterpriseEmployeeOffboarding,
  parseMerchantEnterpriseEmployeeRoleTransition,
  PATCH as updateEmployee,
  POST as createEmployee,
  reserveEmployeeInvitationResend,
  toPublicMerchantEnterpriseEmployee,
} from "@/app/api/merchant-enterprise/employees/route";
import { POST as acceptEmployee } from "@/app/api/merchant-enterprise/employees/accept/route";
import {
  canMerchantEnterpriseActorManageRoleBusinessPermissions,
  canMerchantEnterpriseRoleRetainBusinessPermissions,
  isMerchantEnterpriseBusinessPermissionStrip,
  merchantEnterpriseBusinessPermissionStripChangesOtherFields,
  getMerchantEnterpriseRoleMutationActor,
  getMerchantEnterpriseRoleActivationConflict,
  getMerchantEnterpriseRoleArchiveConflict,
  getMerchantEnterpriseRoleMutationErrorResponse,
  PATCH as updateRole,
  POST as createRole,
} from "@/app/api/merchant-enterprise/roles/route";
import {
  getMerchantTaskErrorResponse,
  getMerchantTaskPatchRequiredPermissions,
  PATCH as updateTask,
  POST as createTask,
} from "@/app/api/merchant-enterprise/tasks/route";
import {
  handleMerchantOrderTaskPost,
  parseMerchantOrderTaskInput,
  type MerchantOrderTaskRouteDependencies,
} from "@/app/api/merchant-enterprise/order-tasks/route";
import {
  handleMerchantOrderSourceGet,
  type MerchantOrderSourceRouteDependencies,
} from "@/app/api/merchant-enterprise/order-sources/route";
import {
  GET as getTaskEvents,
  getMerchantTaskEventErrorResponse,
  POST as createTaskComment,
  toPublicMerchantTaskEvent,
} from "@/app/api/merchant-enterprise/task-events/route";
import {
  GET as getTaskChecklist,
  PATCH as updateTaskChecklistItem,
  POST as createTaskChecklistItem,
  getMerchantTaskChecklistErrorResponse,
} from "@/app/api/merchant-enterprise/task-checklist/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseEmployee,
  MerchantEnterpriseSnapshot,
  MerchantTask,
  MerchantTaskEvent,
} from "@/lib/merchantEnterprise";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

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

const ownerInvitationMutationActor = {
  actorType: "owner",
  actorId: "88888888-8888-4888-8888-888888888888",
} as const;

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
    await reserveEmployeeInvitationResend(
      store,
      employee,
      ownerInvitationMutationActor,
      nowMs,
    ),
    { status: "cooldown", employee, retryAfterSeconds: 31 },
  );
  const response = createEmployeeInvitationCooldownResponse(employee, 31);
  const publicEmployee = toPublicMerchantEnterpriseEmployee(employee);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "31");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "employee_invitation_cooldown",
    employee: publicEmployee,
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

  const result = await reserveEmployeeInvitationResend(
    store,
    employee,
    ownerInvitationMutationActor,
    nowMs,
  );

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
  assert.equal(rpcInput.actor_type, "owner");
  assert.equal(rpcInput.actor_id, ownerInvitationMutationActor.actorId);
  assert.match(String(rpcInput.token_hash), /^[a-f0-9]{64}$/);

  const response = createEmployeeInvitationResendResponse({
    employee: result.employee,
    invitation: { status: "failed", error: "invite_unavailable" },
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    employee: toPublicMerchantEnterpriseEmployee(result.employee),
    invitation: { status: "failed", error: "invite_unavailable" },
  });
});

test("employee mutation responses never expose the Supabase auth user id", () => {
  const employee = pendingEmployee("2026-07-31T09:58:59.999Z");
  const publicEmployee = toPublicMerchantEnterpriseEmployee(employee);
  assert.equal("authUserId" in publicEmployee, false);
  assert.equal(publicEmployee.email, employee.email);
  assert.equal(publicEmployee.id, employee.id);
});

test("employee and role mutation actor payloads preserve owner and employee identities", () => {
  const shared = {
    siteId: "10000000",
    displayName: "Actor",
    email: "actor@example.com",
    permissions: ["enterprise.view"] as MerchantEnterpriseActor["permissions"],
    accessScope: "all" as const,
    allowedBoardIds: [],
  };
  const owner: MerchantEnterpriseActor = {
    ...shared,
    type: "owner",
    id: "88888888-8888-4888-8888-888888888888",
  };
  const employee: MerchantEnterpriseActor = {
    ...shared,
    type: "employee",
    id: "77777777-7777-4777-8777-777777777777",
    roleId: "99999999-9999-4999-8999-999999999999",
  };
  assert.deepEqual(getMerchantEnterpriseEmployeeMutationActor(owner), {
    actorType: "owner",
    actorId: owner.id,
  });
  assert.deepEqual(getMerchantEnterpriseEmployeeMutationActor(employee), {
    actorType: "employee",
    actorId: employee.id,
  });
  assert.deepEqual(getMerchantEnterpriseRoleMutationActor(owner), {
    actorType: "owner",
    actorId: owner.id,
  });
  assert.deepEqual(getMerchantEnterpriseRoleMutationActor(employee), {
    actorType: "employee",
    actorId: employee.id,
  });

  assert.equal(
    canMerchantEnterpriseActorManageRoleBusinessPermissions(
      owner,
      [],
      ["orders.view"],
    ),
    true,
  );
  assert.equal(
    canMerchantEnterpriseActorManageRoleBusinessPermissions(
      employee,
      [],
      ["orders.view"],
    ),
    false,
  );
  assert.equal(
    canMerchantEnterpriseActorManageRoleBusinessPermissions(
      employee,
      ["orders.view"],
      undefined,
    ),
    false,
  );
  assert.equal(
    canMerchantEnterpriseActorManageRoleBusinessPermissions(
      employee,
      ["enterprise.view"],
      ["enterprise.view"],
    ),
    true,
  );

  assert.equal(
    canMerchantEnterpriseRoleRetainBusinessPermissions(
      [],
      ["orders.view"],
      false,
    ),
    false,
  );
  assert.equal(
    canMerchantEnterpriseRoleRetainBusinessPermissions(
      ["orders.view"],
      undefined,
      false,
    ),
    false,
  );
  assert.equal(
    canMerchantEnterpriseRoleRetainBusinessPermissions(
      ["orders.view"],
      ["enterprise.view"],
      false,
    ),
    true,
  );
  assert.equal(
    canMerchantEnterpriseRoleRetainBusinessPermissions(
      ["orders.view"],
      ["orders.view"],
      true,
    ),
    true,
  );

  assert.equal(
    isMerchantEnterpriseBusinessPermissionStrip(
      ["enterprise.view", "orders.view"],
      ["enterprise.view"],
    ),
    true,
  );
  assert.equal(
    isMerchantEnterpriseBusinessPermissionStrip(
      ["enterprise.view", "orders.view"],
      ["enterprise.view", "orders.view"],
    ),
    false,
  );
  const businessRole = {
    name: "业务员工",
    description: "限定权限",
    status: "active" as const,
    accessScope: "restricted" as const,
    allowedBoardIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  };
  assert.equal(
    merchantEnterpriseBusinessPermissionStripChangesOtherFields(
      businessRole,
      {
        name: "业务员工",
        description: "限定权限",
        status: "active",
        accessScope: "restricted",
        allowedBoardIds: [...businessRole.allowedBoardIds].reverse(),
      },
      {
        accessScope: "restricted",
        allowedBoardIds: [...businessRole.allowedBoardIds].reverse(),
      },
    ),
    false,
  );
  assert.equal(
    merchantEnterpriseBusinessPermissionStripChangesOtherFields(
      businessRole,
      { name: "同时改名" },
      undefined,
    ),
    true,
  );
});

test("employee lifecycle RPC errors have stable API statuses", () => {
  for (const code of [
    "employee_open_tasks_require_resolution",
    "employee_offboarding_replacement_invalid",
    "employee_role_transition_required",
    "employee_role_transition_replacement_invalid",
    "enterprise_version_conflict",
    "employee_board_access_in_use",
    "employee_email_in_use",
    "employee_invitation_not_pending",
    "employee_invitation_renew_required",
    "employee_invitation_renew_not_required",
    "enterprise_idempotency_conflict",
    "invitation_delivery_cooldown",
  ]) {
    assert.deepEqual(
      getMerchantEnterpriseEmployeeMutationErrorResponse(new Error(code)),
      { status: 409, body: { ok: false, error: code } },
    );
  }
  for (const code of [
    "employee_offboarding_scope_denied",
    "employee_role_transition_scope_denied",
    "permission_escalation_denied",
    "permission_denied",
  ]) {
    assert.deepEqual(
      getMerchantEnterpriseEmployeeMutationErrorResponse(new Error(code)),
      { status: 403, body: { ok: false, error: code } },
    );
  }
  assert.equal(
    getMerchantEnterpriseEmployeeMutationErrorResponse(new Error("unknown_error")),
    null,
  );
});

test("role RPC authorization errors have stable API statuses", () => {
  for (const code of ["permission_escalation_denied", "permission_denied"]) {
    assert.deepEqual(
      getMerchantEnterpriseRoleMutationErrorResponse(new Error(code)),
      { status: 403, body: { ok: false, error: code } },
    );
  }
  for (const code of ["role_board_access_in_use", "role_name_conflict"]) {
    assert.deepEqual(
      getMerchantEnterpriseRoleMutationErrorResponse(new Error(code)),
      { status: 409, body: { ok: false, error: code } },
    );
  }
  assert.deepEqual(
    getMerchantEnterpriseRoleMutationErrorResponse(
      new Error("enterprise_role_create_failed:23505"),
    ),
    { status: 409, body: { ok: false, error: "role_name_conflict" } },
  );
  assert.equal(
    getMerchantEnterpriseRoleMutationErrorResponse(new Error("unknown_error")),
    null,
  );
});

test("workspace RPC authorization errors have non-disclosing API statuses", async () => {
  const responders = [
    getMerchantEnterpriseOverviewMutationErrorResponse,
    getMerchantTaskBoardErrorResponse,
    getMerchantTaskColumnErrorResponse,
  ];
  for (const respond of responders) {
    for (const internalCode of [
      "permission_denied",
      "merchant_access_denied",
      "employee_not_found",
      "employee_account_disabled",
      "role_not_found",
      "role_inactive",
      "merchant_role_invalid",
    ]) {
      const response = respond(new Error(internalCode));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "permission_denied",
      });
    }
    for (const notFoundCode of ["board_not_found", "column_not_found"]) {
      const response = respond(new Error(notFoundCode));
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: notFoundCode,
      });
    }
    const invalidActorResponse = respond(new Error("invalid_enterprise_actor"));
    assert.equal(invalidActorResponse.status, 400);
    assert.deepEqual(await invalidActorResponse.json(), {
      ok: false,
      error: "invalid_enterprise_actor",
    });
  }
});

test("employee offboarding parser only accepts valid disable resolution payloads", () => {
  const employeeId = "77777777-7777-4777-8777-777777777777";
  const replacementEmployeeId = "66666666-6666-4666-8666-666666666666";
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeOffboarding({
      employeeId,
      status: "disabled",
      offboardingMode: "unassign",
    }),
    { ok: true, payload: { offboardingMode: "unassign" } },
  );
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeOffboarding({
      employeeId,
      status: "disabled",
      offboardingMode: "reassign",
      replacementEmployeeId,
    }),
    {
      ok: true,
      payload: { offboardingMode: "reassign", replacementEmployeeId },
    },
  );
  for (const payload of [
    { status: "active", offboardingMode: "unassign" },
    { status: "disabled", offboardingMode: "reassign" },
    {
      status: "disabled",
      offboardingMode: "unassign",
      replacementEmployeeId,
    },
    { status: "disabled", replacementEmployeeId },
  ]) {
    assert.deepEqual(
      parseMerchantEnterpriseEmployeeOffboarding({ employeeId, ...payload }),
      { ok: false, error: "invalid_employee_offboarding", status: 400 },
    );
  }
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeOffboarding({
      employeeId,
      status: "disabled",
      offboardingMode: "reassign",
      replacementEmployeeId: employeeId,
    }),
    {
      ok: false,
      error: "employee_offboarding_replacement_invalid",
      status: 409,
    },
  );
});

test("employee role transition parser requires target-role CAS and one resolution mode", () => {
  const employeeId = "77777777-7777-4777-8777-777777777777";
  const roleId = "44444444-4444-4444-8444-444444444444";
  const replacementEmployeeId = "66666666-6666-4666-8666-666666666666";
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeRoleTransition({
      employeeId,
      roleId,
      roleVersion: 3,
    }),
    { ok: true, payload: { roleVersion: 3 } },
  );
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeRoleTransition({
      employeeId,
      roleId,
      roleVersion: 3,
      roleTransitionMode: "unassign",
    }),
    {
      ok: true,
      payload: { roleVersion: 3, roleTransitionMode: "unassign" },
    },
  );
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeRoleTransition({
      employeeId,
      roleId,
      roleVersion: 3,
      roleTransitionMode: "reassign",
      replacementEmployeeId,
    }),
    {
      ok: true,
      payload: {
        roleVersion: 3,
        roleTransitionMode: "reassign",
        replacementEmployeeId,
      },
    },
  );
  for (const payload of [
    { roleId },
    { roleVersion: 3 },
    { roleId, roleVersion: 0 },
    { roleId, roleVersion: 3, roleTransitionMode: "reassign" },
    { roleId, roleVersion: 3, roleTransitionMode: "unassign", replacementEmployeeId },
    {
      roleId,
      roleVersion: 3,
      roleTransitionMode: "unassign",
      offboardingMode: "unassign",
    },
  ]) {
    assert.deepEqual(
      parseMerchantEnterpriseEmployeeRoleTransition({ employeeId, ...payload }),
      { ok: false, error: "invalid_employee_role_transition", status: 400 },
    );
  }
  assert.deepEqual(
    parseMerchantEnterpriseEmployeeRoleTransition({
      employeeId,
      roleId,
      roleVersion: 3,
      roleTransitionMode: "reassign",
      replacementEmployeeId: employeeId,
    }),
    {
      ok: false,
      error: "employee_role_transition_replacement_invalid",
      status: 409,
    },
  );
});

test("employee role transition validation checks role version, delegation and replacement activity", () => {
  const currentEmployee = {
    ...pendingEmployee("2026-07-31T09:58:59.999Z"),
    status: "active" as const,
    roleId: "99999999-9999-4999-8999-999999999999",
  };
  const replacement = {
    ...currentEmployee,
    id: "66666666-6666-4666-8666-666666666666",
    email: "replacement@example.com",
  };
  const requestedRole = {
    id: "44444444-4444-4444-8444-444444444444",
    siteId: "10000000",
    name: "Operator",
    description: "",
    permissions: ["enterprise.view", "tasks.view"] as const,
    accessScope: "all" as const,
    allowedBoardIds: [],
    status: "active" as const,
    isSystem: false,
    version: 3,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  };
  const snapshot = {
    roles: [requestedRole],
    employees: [currentEmployee, replacement],
    boards: [],
    columns: [],
    tasks: [],
  } as unknown as MerchantEnterpriseSnapshot;
  const owner: MerchantEnterpriseActor = {
    type: "owner",
    id: "88888888-8888-4888-8888-888888888888",
    siteId: "10000000",
    displayName: "Owner",
    email: "owner@example.com",
    permissions: [],
    accessScope: "all",
    allowedBoardIds: [],
  };
  const base = {
    actor: owner,
    snapshot,
    currentEmployee,
    requestedRoleId: requestedRole.id,
    roleVersion: requestedRole.version,
    roleTransitionMode: "reassign" as const,
    replacementEmployeeId: replacement.id,
  };
  assert.deepEqual(
    getMerchantEnterpriseEmployeeRoleTransitionValidation(base),
    { ok: true, roleChanged: true },
  );
  assert.deepEqual(
    getMerchantEnterpriseEmployeeRoleTransitionValidation({ ...base, roleVersion: 2 }),
    { ok: false, error: "enterprise_version_conflict", status: 409 },
  );
  assert.deepEqual(
    getMerchantEnterpriseEmployeeRoleTransitionValidation({
      ...base,
      snapshot: {
        ...snapshot,
        employees: [currentEmployee, { ...replacement, status: "disabled" }],
      },
    }),
    {
      ok: false,
      error: "employee_role_transition_replacement_invalid",
      status: 409,
    },
  );
  const restrictedActor: MerchantEnterpriseActor = {
    ...owner,
    type: "employee",
    roleId: currentEmployee.roleId,
    permissions: ["enterprise.view"],
  };
  assert.deepEqual(
    getMerchantEnterpriseEmployeeRoleTransitionValidation({
      ...base,
      actor: restrictedActor,
    }),
    { ok: false, error: "permission_escalation_denied", status: 403 },
  );
});

test("employee creation rejects malformed emails before authentication", async () => {
  for (const email of ["missing-domain@", "two words@example.com", "x".repeat(255)]) {
    const response = await createEmployee(
      new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          displayName: "Staff",
          email,
          roleId: "99999999-9999-4999-8999-999999999999",
        }),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_employee_email",
    });
  }
});

test("employee email cannot be changed through the generic update path", async () => {
  const response = await updateEmployee(
    new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        siteId: "10000000",
        employeeId: "77777777-7777-4777-8777-777777777777",
        version: 7,
        email: "replacement@example.com",
      }),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "employee_email_change_requires_reinvite",
  });
});

test("malformed employee offboarding payloads are rejected before authorization", async () => {
  const base = {
    siteId: "10000000",
    employeeId: "77777777-7777-4777-8777-777777777777",
    version: 7,
  };
  for (const [payload, status, error] of [
    [{ status: "active", offboardingMode: "unassign" }, 400, "invalid_employee_offboarding"],
    [{ status: "disabled", offboardingMode: "reassign" }, 400, "invalid_employee_offboarding"],
    [
      {
        status: "disabled",
        offboardingMode: "unassign",
        replacementEmployeeId: "66666666-6666-4666-8666-666666666666",
      },
      400,
      "invalid_employee_offboarding",
    ],
    [
      {
        status: "disabled",
        offboardingMode: "reassign",
        replacementEmployeeId: base.employeeId,
      },
      409,
      "employee_offboarding_replacement_invalid",
    ],
  ] as const) {
    const response = await updateEmployee(
      new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({ ...base, ...payload }),
      }),
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
});

test("malformed employee role transitions are rejected before authorization", async () => {
  const base = {
    siteId: "10000000",
    employeeId: "77777777-7777-4777-8777-777777777777",
    version: 7,
  };
  const roleId = "44444444-4444-4444-8444-444444444444";
  for (const [payload, status, error] of [
    [{ roleId }, 400, "invalid_employee_role_transition"],
    [{ roleVersion: 3 }, 400, "invalid_employee_role_transition"],
    [
      {
        roleId,
        roleVersion: 3,
        roleTransitionMode: "reassign",
      },
      400,
      "invalid_employee_role_transition",
    ],
    [
      {
        roleId,
        roleVersion: 3,
        roleTransitionMode: "unassign",
        offboardingMode: "unassign",
        status: "disabled",
      },
      400,
      "invalid_employee_role_transition",
    ],
    [
      {
        roleId,
        roleVersion: 3,
        roleTransitionMode: "reassign",
        replacementEmployeeId: base.employeeId,
      },
      409,
      "employee_role_transition_replacement_invalid",
    ],
  ] as const) {
    const response = await updateEmployee(
      new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({ ...base, ...payload }),
      }),
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
});

test("pending invitation removal is a recognized, isolated employee action", async () => {
  const base = {
    siteId: "10000000",
    employeeId: "77777777-7777-4777-8777-777777777777",
    version: 7,
    action: "remove_invite",
  };
  const recognized = await updateEmployee(
    new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify(base),
    }),
  );
  assert.equal(recognized.status, 401);
  assert.deepEqual(await recognized.json(), { ok: false, error: "unauthorized" });

  const mixed = await updateEmployee(
    new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({ ...base, displayName: "Unexpected edit" }),
    }),
  );
  assert.equal(mixed.status, 400);
  assert.deepEqual(await mixed.json(), {
    ok: false,
    error: "invalid_employee_action",
  });

  const mixedOffboarding = await updateEmployee(
    new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({ ...base, offboardingMode: "unassign" }),
    }),
  );
  assert.equal(mixedOffboarding.status, 400);
  assert.deepEqual(await mixedOffboarding.json(), {
    ok: false,
    error: "invalid_employee_action",
  });

  const mixedRoleTransition = await updateEmployee(
    new Request("https://www.faolla.com/api/merchant-enterprise/employees", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        ...base,
        roleVersion: 3,
        roleTransitionMode: "unassign",
      }),
    }),
  );
  assert.equal(mixedRoleTransition.status, 400);
  assert.deepEqual(await mixedRoleTransition.json(), {
    ok: false,
    error: "invalid_employee_action",
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
    [
      createTaskComment,
      "/api/merchant-enterprise/task-events",
      {
        taskId: "11111111-1111-4111-8111-111111111111",
        text: "Ready for review",
      },
    ],
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

test("role board access payloads are strict while legacy creates default safely", async () => {
  const requests = [
    {
      method: "POST",
      body: {
        siteId: "10000000",
        name: "Invalid all scope",
        permissions: ["enterprise.view"],
        accessScope: "all",
        allowedBoardIds: ["11111111-1111-4111-8111-111111111111"],
      },
    },
    {
      method: "POST",
      body: {
        siteId: "10000000",
        name: "Duplicate restricted scope",
        permissions: ["enterprise.view"],
        accessScope: "restricted",
        allowedBoardIds: [
          "11111111-1111-4111-8111-111111111111",
          "11111111-1111-4111-8111-111111111111",
        ],
      },
    },
    {
      method: "PATCH",
      body: {
        siteId: "10000000",
        roleId: "22222222-2222-4222-8222-222222222222",
        version: 1,
        accessScope: "restricted",
      },
    },
  ] as const;

  for (const request of requests) {
    const handler = request.method === "POST" ? createRole : updateRole;
    const response = await handler(
      new Request("https://www.faolla.com/api/merchant-enterprise/roles", {
        method: request.method,
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify(request.body),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_role_board_access",
    });
  }

  const legacyResponse = await createRole(
    new Request("https://www.faolla.com/api/merchant-enterprise/roles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        siteId: "10000000",
        name: "Legacy role",
        permissions: ["enterprise.view"],
      }),
    }),
  );
  assert.equal(legacyResponse.status, 401);
  assert.deepEqual(await legacyResponse.json(), { ok: false, error: "unauthorized" });
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
    accessScope: "all",
    allowedBoardIds: [],
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

test("restricted role managers receive only scoped board metadata", () => {
  const allowedBoardId = "11111111-1111-4111-8111-111111111111";
  const deniedBoardId = "22222222-2222-4222-8222-222222222222";
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "33333333-3333-4333-8333-333333333333",
    siteId: "10000000",
    displayName: "区域主管",
    email: "manager@example.com",
    roleId: "44444444-4444-4444-8444-444444444444",
    permissions: ["enterprise.view", "roles.view", "roles.manage"],
    accessScope: "restricted",
    allowedBoardIds: [allowedBoardId],
  };
  const snapshot = {
    roles: [],
    employees: [],
    boards: [{ id: allowedBoardId }, { id: deniedBoardId }],
    columns: [
      { id: "column-allowed", boardId: allowedBoardId },
      { id: "column-denied", boardId: deniedBoardId },
    ],
    tasks: [
      { id: "task-allowed", boardId: allowedBoardId, assigneeIds: [] },
      { id: "task-denied", boardId: deniedBoardId, assigneeIds: [] },
    ],
  } as unknown as MerchantEnterpriseSnapshot;

  const visible = buildVisibleMerchantEnterpriseSnapshot(actor, snapshot);
  assert.deepEqual(visible.boards.map((board) => board.id), [allowedBoardId]);
  assert.deepEqual(visible.columns, []);
  assert.deepEqual(visible.tasks, []);
});

const ORDER_TASK_SITE_ID = "10000000";
const ORDER_TASK_BOARD_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_TASK_COLUMN_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_TASK_ORDER_ID = "O10000000202608010001";

function merchantOrderTaskRequestBody() {
  return {
    siteId: ORDER_TASK_SITE_ID,
    orderId: ORDER_TASK_ORDER_ID,
    boardId: ORDER_TASK_BOARD_ID,
    columnId: ORDER_TASK_COLUMN_ID,
    title: `Order ${ORDER_TASK_ORDER_ID}`,
    description: "2 items · EUR 24.00",
    priority: "high" as const,
    dueAt: "2026-08-02T18:00:00.000Z",
    assigneeIds: ["33333333-3333-4333-8333-333333333333"],
    operationId: "enterprise-order-task:create:1",
  };
}

function merchantOrderTaskRecord(): MerchantTask {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    siteId: ORDER_TASK_SITE_ID,
    boardId: ORDER_TASK_BOARD_ID,
    columnId: ORDER_TASK_COLUMN_ID,
    title: `Order ${ORDER_TASK_ORDER_ID}`,
    description: "2 items · EUR 24.00",
    priority: "high",
    dueAt: "2026-08-02T18:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    position: 0,
    sourceType: "order",
    sourceId: ORDER_TASK_ORDER_ID,
    createdByEmployeeId: "",
    assigneeIds: ["33333333-3333-4333-8333-333333333333"],
    version: 1,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

function merchantOrderTaskOwner(): MerchantEnterpriseActor {
  return {
    type: "owner",
    id: "55555555-5555-4555-8555-555555555555",
    siteId: ORDER_TASK_SITE_ID,
    displayName: "Owner",
    email: "owner@example.com",
    permissions: [],
    accessScope: "all",
    allowedBoardIds: [],
  };
}

function merchantSourceOrder(
  overrides: Partial<MerchantOrderRecord> = {},
): MerchantOrderRecord {
  return {
    id: ORDER_TASK_ORDER_ID,
    siteId: ORDER_TASK_SITE_ID,
    siteName: "fafona",
    blockId: "products",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    status: "confirmed",
    customer: {
      name: "Private Customer",
      phone: "+34 600 123 456",
      email: "private@example.com",
      note: "Private delivery note",
    },
    items: [],
    totalQuantity: 2,
    totalAmount: 24,
    pricePrefix: "€",
    confirmedAt: "2026-08-01T10:05:00.000Z",
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

test("order task input parsing is strict and normalizes bounded task fields", () => {
  assert.deepEqual(parseMerchantOrderTaskInput(merchantOrderTaskRequestBody()), {
    ...merchantOrderTaskRequestBody(),
    dueAt: "2026-08-02T18:00:00.000Z",
  });
  const headerOperationBody = {
    ...merchantOrderTaskRequestBody(),
    priority: undefined,
    dueAt: "",
    description: undefined,
    assigneeIds: [
      "33333333-3333-4333-8333-333333333333",
      "33333333-3333-4333-8333-333333333333",
    ],
  } as Record<string, unknown>;
  delete headerOperationBody.operationId;
  assert.deepEqual(
    parseMerchantOrderTaskInput(
      headerOperationBody,
      "enterprise-order-task:create:header",
    ),
    {
      ...merchantOrderTaskRequestBody(),
      priority: "normal",
      dueAt: null,
      description: "",
      assigneeIds: ["33333333-3333-4333-8333-333333333333"],
      operationId: "enterprise-order-task:create:header",
    },
  );

  const cases: Array<[unknown, string]> = [
    [null, "invalid_order_task_request"],
    [{ ...merchantOrderTaskRequestBody(), customerEmail: "private@example.com" }, "invalid_order_task_request"],
    [{ ...merchantOrderTaskRequestBody(), siteId: 10000000 }, "invalid_site_id"],
    [{ ...merchantOrderTaskRequestBody(), orderId: "../other-order" }, "invalid_order_id"],
    [{ ...merchantOrderTaskRequestBody(), boardId: "board-1" }, "invalid_task_board"],
    [{ ...merchantOrderTaskRequestBody(), columnId: "column-1" }, "invalid_task_column"],
    [{ ...merchantOrderTaskRequestBody(), title: "   " }, "invalid_task_title"],
    [{ ...merchantOrderTaskRequestBody(), description: 42 }, "invalid_task_description"],
    [{ ...merchantOrderTaskRequestBody(), priority: "critical" }, "invalid_task_priority"],
    [{ ...merchantOrderTaskRequestBody(), dueAt: "tomorrow" }, "invalid_task_due_at"],
    [{ ...merchantOrderTaskRequestBody(), assigneeIds: "employee-1" }, "invalid_task_assignees"],
    [{ ...merchantOrderTaskRequestBody(), assigneeIds: ["employee-1"] }, "invalid_task_assignees"],
    [{ ...merchantOrderTaskRequestBody(), operationId: "bad operation" }, "invalid_operation_id"],
    [{ ...merchantOrderTaskRequestBody(), operationId: "" }, "invalid_operation_id"],
  ];
  for (const [input, error] of cases) {
    assert.throws(() => parseMerchantOrderTaskInput(input), { message: error });
  }
});

test("generic task mutations reject every client-supplied source field", async () => {
  const sourceFields = [
    { sourceType: "order" },
    { sourceId: ORDER_TASK_ORDER_ID },
    { sourceType: "" },
    { sourceId: "" },
  ];
  for (const sourceField of sourceFields) {
    const createResponse = await createTask(
      new Request("https://www.faolla.com/api/merchant-enterprise/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: ORDER_TASK_SITE_ID,
          boardId: ORDER_TASK_BOARD_ID,
          columnId: ORDER_TASK_COLUMN_ID,
          title: "Forged source",
          ...sourceField,
        }),
      }),
    );
    assert.equal(createResponse.status, 400);
    assert.deepEqual(await createResponse.json(), {
      ok: false,
      error: "invalid_task_source",
    });

    const updateResponse = await updateTask(
      new Request("https://www.faolla.com/api/merchant-enterprise/tasks", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: ORDER_TASK_SITE_ID,
          taskId: "44444444-4444-4444-8444-444444444444",
          version: 1,
          title: "Forged source update",
          ...sourceField,
        }),
      }),
    );
    assert.equal(updateResponse.status, 400);
    assert.deepEqual(await updateResponse.json(), {
      ok: false,
      error: "invalid_task_source",
    });
  }
});

test("merchant owners create or reuse an authoritative order task without copying customer PII", async () => {
  const actor = merchantOrderTaskOwner();
  const task = merchantOrderTaskRecord();
  const store = {} as MerchantEnterpriseStoreClient;
  const calls = {
    enterpriseEntitlement: 0,
    orderLookup: 0,
    create: 0,
  };
  let capturedInput: Parameters<MerchantOrderTaskRouteDependencies["createOrGetTask"]>[1] | null = null;
  const dependencies: MerchantOrderTaskRouteDependencies = {
    async resolveActor(_request, input) {
      assert.deepEqual(input, {
        siteId: ORDER_TASK_SITE_ID,
        requiredPermission: "tasks.create",
      });
      return actor;
    },
    async requireEnterpriseEntitlement(siteId) {
      calls.enterpriseEntitlement += 1;
      assert.equal(siteId, ORDER_TASK_SITE_ID);
      return {
        permissionConfig: {
          allowProductBlock: true,
          allowOrderManagement: true,
        },
      };
    },
    async listOrders(siteId) {
      calls.orderLookup += 1;
      assert.equal(siteId, ORDER_TASK_SITE_ID);
      return [
        {
          id: ORDER_TASK_ORDER_ID,
          siteId: ORDER_TASK_SITE_ID,
          customer: {
            name: "Private Customer",
            email: "private@example.com",
            phone: "+34 600 000 000",
          },
        },
      ];
    },
    async createOrGetTask(client, input) {
      calls.create += 1;
      assert.equal(client, store);
      capturedInput = input;
      return { task, created: true };
    },
    createStoreClient() {
      return store;
    },
  };
  const response = await handleMerchantOrderTaskPost(
    new Request("https://www.faolla.com/api/merchant-enterprise/order-tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify(merchantOrderTaskRequestBody()),
    }),
    dependencies,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, task, created: true });
  assert.deepEqual(calls, {
    enterpriseEntitlement: 1,
    orderLookup: 1,
    create: 1,
  });
  assert.deepEqual(capturedInput, {
    siteId: ORDER_TASK_SITE_ID,
    orderId: ORDER_TASK_ORDER_ID,
    boardId: ORDER_TASK_BOARD_ID,
    columnId: ORDER_TASK_COLUMN_ID,
    title: `Order ${ORDER_TASK_ORDER_ID}`,
    description: "2 items · EUR 24.00",
    priority: "high",
    dueAt: "2026-08-02T18:00:00.000Z",
    createdByEmployeeId: "",
    assigneeIds: ["33333333-3333-4333-8333-333333333333"],
    actorType: "owner",
    actorId: actor.id,
    operationId: "enterprise-order-task:create:1",
  });
  assert.doesNotMatch(JSON.stringify(capturedInput), /Private Customer|private@example|600 000/);
});

test("order task creation rejects employees before reading orders", async () => {
  let downstreamCalls = 0;
  const dependencies: MerchantOrderTaskRouteDependencies = {
    async resolveActor() {
      return {
        type: "employee",
        id: "66666666-6666-4666-8666-666666666666",
        siteId: ORDER_TASK_SITE_ID,
        displayName: "Employee",
        email: "employee@example.com",
        roleId: "77777777-7777-4777-8777-777777777777",
        permissions: ["enterprise.view", "tasks.view", "tasks.create", "tasks.assign"],
        accessScope: "all",
        allowedBoardIds: [],
      };
    },
    async requireEnterpriseEntitlement() {
      downstreamCalls += 1;
      return null;
    },
    async listOrders() {
      downstreamCalls += 1;
      return [];
    },
    async createOrGetTask() {
      downstreamCalls += 1;
      return { task: merchantOrderTaskRecord(), created: true };
    },
    createStoreClient() {
      downstreamCalls += 1;
      return {} as MerchantEnterpriseStoreClient;
    },
  };
  const response = await handleMerchantOrderTaskPost(
    new Request("https://www.faolla.com/api/merchant-enterprise/order-tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify(merchantOrderTaskRequestBody()),
    }),
    dependencies,
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "permission_denied" });
  assert.equal(downstreamCalls, 0);
});

test("order task creation preserves atomic owner and board authorization failures", async () => {
  const store = {} as MerchantEnterpriseStoreClient;
  const baseDependencies: MerchantOrderTaskRouteDependencies = {
    async resolveActor() {
      return merchantOrderTaskOwner();
    },
    async requireEnterpriseEntitlement() {
      return {
        permissionConfig: {
          allowProductBlock: true,
          allowOrderManagement: true,
        },
      };
    },
    async listOrders() {
      return [{ id: ORDER_TASK_ORDER_ID, siteId: ORDER_TASK_SITE_ID }];
    },
    async createOrGetTask() {
      throw new Error("unexpected_order_task_error");
    },
    createStoreClient() {
      return store;
    },
  };
  const request = () =>
    new Request("https://www.faolla.com/api/merchant-enterprise/order-tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify(merchantOrderTaskRequestBody()),
    });

  for (const [error, status] of [
    ["permission_denied", 403],
    ["board_not_found", 404],
  ] as const) {
    const response = await handleMerchantOrderTaskPost(request(), {
      ...baseDependencies,
      async createOrGetTask(client) {
        assert.equal(client, store);
        throw new Error(error);
      },
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
});

test("order task creation requires order management and an authoritative matching order", async () => {
  const actor = merchantOrderTaskOwner();
  const baseDependencies: MerchantOrderTaskRouteDependencies = {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {
        permissionConfig: {
          allowProductBlock: false,
          allowOrderManagement: true,
        },
      };
    },
    async listOrders() {
      return [];
    },
    async createOrGetTask() {
      throw new Error("must not create without an authoritative order");
    },
    createStoreClient() {
      throw new Error("must not create a store client before order validation");
    },
  };
  const request = () =>
    new Request("https://www.faolla.com/api/merchant-enterprise/order-tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify(merchantOrderTaskRequestBody()),
    });

  const disabledResponse = await handleMerchantOrderTaskPost(request(), baseDependencies);
  assert.equal(disabledResponse.status, 403);
  assert.deepEqual(await disabledResponse.json(), {
    ok: false,
    error: "order_management_disabled",
  });

  const missingResponse = await handleMerchantOrderTaskPost(request(), {
    ...baseDependencies,
    async requireEnterpriseEntitlement() {
      return {
        permissionConfig: {
          allowProductBlock: true,
          allowOrderManagement: true,
        },
      };
    },
  });
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), {
    ok: false,
    error: "order_not_found",
  });

  const unavailableResponse = await handleMerchantOrderTaskPost(request(), {
    ...baseDependencies,
    async requireEnterpriseEntitlement() {
      throw new MerchantEnterpriseAccessError("enterprise_entitlement_unavailable", 503);
    },
  });
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), {
    ok: false,
    error: "enterprise_entitlement_unavailable",
  });
});

test("order task creation rejects untrusted cross-origin requests before parsing", async () => {
  const response = await handleMerchantOrderTaskPost(
    new Request("https://www.faolla.com/api/merchant-enterprise/order-tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.invalid",
      },
      body: JSON.stringify(merchantOrderTaskRequestBody()),
    }),
  );
  assert.equal(response.status, 403);
});

function merchantOrderSourceRequest(query = {
  siteId: ORDER_TASK_SITE_ID,
  orderId: ORDER_TASK_ORDER_ID,
}) {
  const searchParams = new URLSearchParams(query);
  return new Request(
    `https://www.faolla.com/api/merchant-enterprise/order-sources?${searchParams.toString()}`,
  );
}

test("source order lookup strictly validates one siteId and orderId before authorization", async () => {
  let authorizationCalls = 0;
  const invalidUrls = [
    "https://www.faolla.com/api/merchant-enterprise/order-sources",
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=${ORDER_TASK_SITE_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?orderId=${ORDER_TASK_ORDER_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=${ORDER_TASK_SITE_ID}&siteId=${ORDER_TASK_SITE_ID}&orderId=${ORDER_TASK_ORDER_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=${ORDER_TASK_SITE_ID}&orderId=${ORDER_TASK_ORDER_ID}&orderId=${ORDER_TASK_ORDER_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=${ORDER_TASK_SITE_ID}&orderId=${ORDER_TASK_ORDER_ID}&extra=1`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=not-a-site&orderId=${ORDER_TASK_ORDER_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=${ORDER_TASK_SITE_ID}&orderId=..%2Fother-order`,
    `https://www.faolla.com/api/merchant-enterprise/order-sources?siteId=%20${ORDER_TASK_SITE_ID}%20&orderId=${ORDER_TASK_ORDER_ID}`,
  ];

  for (const url of invalidUrls) {
    const response = await handleMerchantOrderSourceGet(new Request(url), {
      async resolveActor() {
        authorizationCalls += 1;
        return merchantOrderTaskOwner();
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_source_order_request",
    });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(authorizationCalls, 0);
});

test("source order lookup returns one exact owner-scoped record with private no-store", async () => {
  const order = merchantSourceOrder();
  const calls: Array<{ operation: string; values: unknown[] }> = [];
  const dependencies: MerchantOrderSourceRouteDependencies = {
    async resolveActor(_request, input) {
      calls.push({ operation: "resolveActor", values: [input] });
      return merchantOrderTaskOwner();
    },
    async requireEnterpriseEntitlement(siteId) {
      calls.push({ operation: "requireEnterpriseEntitlement", values: [siteId] });
      return {
        permissionConfig: {
          allowProductBlock: true,
          allowOrderManagement: true,
        },
      };
    },
    async getOrder(siteId, orderId) {
      calls.push({ operation: "getOrder", values: [siteId, orderId] });
      return order;
    },
  };

  const response = await handleMerchantOrderSourceGet(
    merchantOrderSourceRequest(),
    dependencies,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, order });
  assert.deepEqual(calls, [
    {
      operation: "resolveActor",
      values: [
        {
          siteId: ORDER_TASK_SITE_ID,
          requiredPermission: "enterprise.view",
        },
      ],
    },
    {
      operation: "requireEnterpriseEntitlement",
      values: [ORDER_TASK_SITE_ID],
    },
    {
      operation: "getOrder",
      values: [ORDER_TASK_SITE_ID, ORDER_TASK_ORDER_ID],
    },
  ]);
});

test("source order lookup rejects employees before entitlement or order reads", async () => {
  let downstreamCalls = 0;
  const employee: MerchantEnterpriseActor = {
    type: "employee",
    id: "66666666-6666-4666-8666-666666666666",
    siteId: ORDER_TASK_SITE_ID,
    displayName: "Employee",
    email: "employee@example.com",
    roleId: "77777777-7777-4777-8777-777777777777",
    permissions: ["enterprise.view", "tasks.view"],
    accessScope: "all",
    allowedBoardIds: [],
  };
  const response = await handleMerchantOrderSourceGet(
    merchantOrderSourceRequest(),
    {
      async resolveActor() {
        return employee;
      },
      async requireEnterpriseEntitlement() {
        downstreamCalls += 1;
        return null;
      },
      async getOrder() {
        downstreamCalls += 1;
        return merchantSourceOrder();
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "permission_denied" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(downstreamCalls, 0);
});

test("source order lookup preserves anonymous 401 before entitlement or order reads", async () => {
  let downstreamCalls = 0;
  const response = await handleMerchantOrderSourceGet(
    merchantOrderSourceRequest(),
    {
      async resolveActor() {
        throw new MerchantEnterpriseAccessError("unauthorized", 401);
      },
      async requireEnterpriseEntitlement() {
        downstreamCalls += 1;
        return null;
      },
      async getOrder() {
        downstreamCalls += 1;
        return merchantSourceOrder();
      },
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(downstreamCalls, 0);
});

test("source order lookup requires both authoritative order entitlements and fails closed", async () => {
  let orderReads = 0;
  const entitlementCases = [
    { allowProductBlock: false, allowOrderManagement: true },
    { allowProductBlock: true, allowOrderManagement: false },
  ];

  for (const permissionConfig of entitlementCases) {
    const response = await handleMerchantOrderSourceGet(
      merchantOrderSourceRequest(),
      {
        async resolveActor() {
          return merchantOrderTaskOwner();
        },
        async requireEnterpriseEntitlement() {
          return { permissionConfig };
        },
        async getOrder() {
          orderReads += 1;
          return merchantSourceOrder();
        },
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "order_management_disabled",
    });
  }

  const unavailableResponse = await handleMerchantOrderSourceGet(
    merchantOrderSourceRequest(),
    {
      async resolveActor() {
        return merchantOrderTaskOwner();
      },
      async requireEnterpriseEntitlement() {
        throw new MerchantEnterpriseAccessError(
          "enterprise_entitlement_unavailable",
          503,
        );
      },
      async getOrder() {
        orderReads += 1;
        return merchantSourceOrder();
      },
    },
  );
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), {
    ok: false,
    error: "enterprise_entitlement_unavailable",
  });
  assert.equal(orderReads, 0);
});

test("source order lookup returns 404 for missing or cross-tenant records", async () => {
  const exactReads: Array<[string, string]> = [];
  const candidates: Array<MerchantOrderRecord | null> = [
    null,
    merchantSourceOrder({ siteId: "20000000" }),
    merchantSourceOrder({ id: "O10000000202608010002" }),
  ];

  for (const candidate of candidates) {
    const response = await handleMerchantOrderSourceGet(
      merchantOrderSourceRequest(),
      {
        async resolveActor() {
          return merchantOrderTaskOwner();
        },
        async requireEnterpriseEntitlement() {
          return {
            permissionConfig: {
              allowProductBlock: true,
              allowOrderManagement: true,
            },
          };
        },
        async getOrder(siteId, orderId) {
          exactReads.push([siteId, orderId]);
          return candidate;
        },
      },
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "order_not_found" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }

  assert.deepEqual(exactReads, [
    [ORDER_TASK_SITE_ID, ORDER_TASK_ORDER_ID],
    [ORDER_TASK_SITE_ID, ORDER_TASK_ORDER_ID],
    [ORDER_TASK_SITE_ID, ORDER_TASK_ORDER_ID],
  ]);
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
  assert.deepEqual(
    getMerchantTaskPatchRequiredPermissions({
      columnId: "33333333-3333-4333-8333-333333333333",
      targetIndex: 2,
    }),
    ["tasks.update"],
  );
});

test("task reorder rejects invalid target indices before authorization", async () => {
  for (const targetIndex of [-1, 1.5, "1", 10_001]) {
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
          columnId: "33333333-3333-4333-8333-333333333333",
          targetIndex,
        }),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_task_target_index",
    });
  }
});

test("valid task reorder requires an authenticated tasks updater", async () => {
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
        columnId: "33333333-3333-4333-8333-333333333333",
        targetIndex: 0,
        operationId: "task-reorder-unauthorized",
      }),
    }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
});

test("task moves must use the atomic target-index shape", async () => {
  const cases = [
    {
      columnId: "33333333-3333-4333-8333-333333333333",
    },
    {
      position: 2,
    },
    {
      columnId: "33333333-3333-4333-8333-333333333333",
      targetIndex: 0,
      title: "Mixed move and edit",
    },
  ];

  for (const fields of cases) {
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
          ...fields,
        }),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_task_move" });
  }
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

test("task event routes validate site, task, comment and operation ids before auth", async () => {
  for (const url of [
    "https://www.faolla.com/api/merchant-enterprise/task-events?siteId=bad&taskId=11111111-1111-4111-8111-111111111111",
    "https://www.faolla.com/api/merchant-enterprise/task-events?siteId=10000000&taskId=bad",
  ]) {
    const response = await getTaskEvents(new Request(url));
    assert.equal(response.status, 400);
  }

  const invalidBodies = [
    {
      siteId: "10000000",
      taskId: "not-a-task",
      text: "Comment",
      operationId: "task-comment-1",
    },
    {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      text: "   ",
      operationId: "task-comment-1",
    },
    {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      text: "x".repeat(2001),
      operationId: "task-comment-1",
    },
    {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      text: "Comment",
      operationId: "task comment with spaces",
    },
  ];
  for (const body of invalidBodies) {
    const response = await createTaskComment(
      new Request("https://www.faolla.com/api/merchant-enterprise/task-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 400);
  }
});

test("task checklist reads validate site and task ids before authorization", async () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  for (const [url, error] of [
    [
      `https://www.faolla.com/api/merchant-enterprise/task-checklist?siteId=bad&taskId=${taskId}`,
      "invalid_site_id",
    ],
    [
      "https://www.faolla.com/api/merchant-enterprise/task-checklist?siteId=10000000&taskId=bad",
      "invalid_task_id",
    ],
  ] as const) {
    const response = await getTaskChecklist(new Request(url));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
});

test("task checklist creation validates ids, text and operation id before authorization", async () => {
  const validBody = {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    text: "Confirm delivery address",
    operationId: "task-checklist-create-1",
  };
  const cases = [
    [{ ...validBody, siteId: "bad" }, "invalid_site_id"],
    [{ ...validBody, taskId: "bad" }, "invalid_task_id"],
    [{ ...validBody, text: "   " }, "invalid_task_checklist_text"],
    [{ ...validBody, text: 42 }, "invalid_task_checklist_text"],
    [{ ...validBody, text: "x".repeat(501) }, "invalid_task_checklist_text"],
    [{ ...validBody, operationId: "not valid" }, "invalid_operation_id"],
    [
      { ...validBody, completed: true },
      "invalid_task_checklist_create",
    ],
  ] as const;

  for (const [body, error] of cases) {
    const response = await createTaskChecklistItem(
      new Request("https://www.faolla.com/api/merchant-enterprise/task-checklist", {
        method: "POST",
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

test("task checklist updates require one validated field and optimistic version", async () => {
  const validBody = {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    itemId: "22222222-2222-4222-8222-222222222222",
    version: 1,
    operationId: "task-checklist-update-1",
  };
  const cases = [
    [{ ...validBody, siteId: "bad", completed: true }, "invalid_site_id"],
    [{ ...validBody, taskId: "bad", completed: true }, "invalid_task_id"],
    [
      { ...validBody, itemId: "bad", completed: true },
      "invalid_task_checklist_item_id",
    ],
    [
      { ...validBody, version: 0, completed: true },
      "invalid_task_checklist_version",
    ],
    [
      { ...validBody, version: "1", completed: true },
      "invalid_task_checklist_version",
    ],
    [
      { ...validBody, version: 1.5, completed: true },
      "invalid_task_checklist_version",
    ],
    [validBody, "invalid_task_checklist_update"],
    [
      { ...validBody, text: "Renamed", completed: true },
      "invalid_task_checklist_update",
    ],
    [
      { ...validBody, completed: true, unexpected: "field" },
      "invalid_task_checklist_update",
    ],
    [{ ...validBody, text: "   " }, "invalid_task_checklist_text"],
    [
      { ...validBody, completed: "yes" },
      "invalid_task_checklist_completed",
    ],
    [
      { ...validBody, archived: "yes" },
      "invalid_task_checklist_archived",
    ],
    [
      { ...validBody, completed: true, operationId: "not valid" },
      "invalid_operation_id",
    ],
  ] as const;

  for (const [body, error] of cases) {
    const response = await updateTaskChecklistItem(
      new Request("https://www.faolla.com/api/merchant-enterprise/task-checklist", {
        method: "PATCH",
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

test("task checklist mutations reject untrusted cross-origin requests", async () => {
  const baseBody = {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    operationId: "task-checklist-cross-origin",
  };
  for (const [handler, method, body] of [
    [createTaskChecklistItem, "POST", { ...baseBody, text: "Checklist item" }],
    [
      updateTaskChecklistItem,
      "PATCH",
      {
        ...baseBody,
        itemId: "22222222-2222-4222-8222-222222222222",
        version: 1,
        completed: true,
      },
    ],
  ] as const) {
    const response = await handler(
      new Request("https://www.faolla.com/api/merchant-enterprise/task-checklist", {
        method,
        headers: {
          "content-type": "application/json",
          origin: "https://example.invalid",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 403);
  }
});

test("valid task checklist operations require their enterprise permissions", async () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const itemId = "22222222-2222-4222-8222-222222222222";
  const getResponse = await getTaskChecklist(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/task-checklist?siteId=10000000&taskId=${taskId}`,
    ),
  );
  assert.equal(getResponse.status, 401);
  assert.deepEqual(await getResponse.json(), { ok: false, error: "unauthorized" });

  const createResponse = await createTaskChecklistItem(
    new Request("https://www.faolla.com/api/merchant-enterprise/task-checklist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        siteId: "10000000",
        taskId,
        text: "Confirm delivery address",
        operationId: "task-checklist-create-unauthorized",
      }),
    }),
  );
  assert.equal(createResponse.status, 401);
  assert.deepEqual(await createResponse.json(), { ok: false, error: "unauthorized" });

  for (const change of [
    { text: "Confirm the final delivery address" },
    { completed: true },
    { archived: true },
  ]) {
    const response = await updateTaskChecklistItem(
      new Request("https://www.faolla.com/api/merchant-enterprise/task-checklist", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          taskId,
          itemId,
          version: 1,
          operationId: "task-checklist-update-unauthorized",
          ...change,
        }),
      }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  }
});

test("task checklist route preserves known service error statuses", async () => {
  for (const error of ["task_not_found", "task_checklist_item_not_found"]) {
    const response = getMerchantTaskChecklistErrorResponse(new Error(error));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
  for (const error of [
    "enterprise_version_conflict",
    "enterprise_operation_in_progress",
    "task_checklist_limit_reached",
    "invalid_task_archived",
  ]) {
    const response = getMerchantTaskChecklistErrorResponse(new Error(error));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, error });
  }
  const permissionResponse = getMerchantTaskChecklistErrorResponse(
    new Error("permission_denied"),
  );
  assert.equal(permissionResponse.status, 403);
  assert.deepEqual(await permissionResponse.json(), {
    ok: false,
    error: "permission_denied",
  });
  const response = getMerchantTaskChecklistErrorResponse(new Error("store_failed"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "enterprise_request_failed",
  });
});

test("task routes preserve atomic authorization failures without leaking inaccessible tasks", async () => {
  for (const getResponse of [
    getMerchantTaskErrorResponse,
    getMerchantTaskEventErrorResponse,
  ]) {
    const permissionResponse = getResponse(new Error("permission_denied"));
    assert.equal(permissionResponse.status, 403);
    assert.deepEqual(await permissionResponse.json(), {
      ok: false,
      error: "permission_denied",
    });

    const hiddenTaskResponse = getResponse(new Error("task_not_found"));
    assert.equal(hiddenTaskResponse.status, 404);
    assert.deepEqual(await hiddenTaskResponse.json(), {
      ok: false,
      error: "task_not_found",
    });
  }

  const hiddenBoardResponse = getMerchantTaskErrorResponse(
    new Error("board_not_found"),
  );
  assert.equal(hiddenBoardResponse.status, 404);
  assert.deepEqual(await hiddenBoardResponse.json(), {
    ok: false,
    error: "board_not_found",
  });
});

test("valid task activity reads and comments require their enterprise permissions", async () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const getResponse = await getTaskEvents(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/task-events?siteId=10000000&taskId=${taskId}`,
    ),
  );
  assert.equal(getResponse.status, 401);
  assert.deepEqual(await getResponse.json(), { ok: false, error: "unauthorized" });

  const postResponse = await createTaskComment(
    new Request("https://www.faolla.com/api/merchant-enterprise/task-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        siteId: "10000000",
        taskId,
        text: "Ready for review",
        operationId: "task-comment-unauthorized",
      }),
    }),
  );
  assert.equal(postResponse.status, 401);
  assert.deepEqual(await postResponse.json(), { ok: false, error: "unauthorized" });
});

test("task activity responses hide owner auth ids but retain employee ids", () => {
  const baseEvent: MerchantTaskEvent = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    eventType: "updated",
    actorType: "owner",
    actorId: "44444444-4444-4444-8444-444444444444",
    payload: { fields: ["title"] },
    createdAt: "2026-07-31T10:00:00.000Z",
  };
  assert.equal(toPublicMerchantTaskEvent(baseEvent).actorId, "");
  assert.equal(baseEvent.actorId, "44444444-4444-4444-8444-444444444444");
  assert.equal(
    toPublicMerchantTaskEvent({
      ...baseEvent,
      actorType: "employee",
      actorId: "55555555-5555-4555-8555-555555555555",
    }).actorId,
    "55555555-5555-4555-8555-555555555555",
  );
});
