import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  grantMerchantEnterpriseRoleWorkflowPermissions,
  loadMerchantEnterpriseWorkflowPermissionGaps,
  loadMerchantEnterpriseWorkflowRevisionDetail,
  loadMerchantEnterpriseWorkflowRevisionHistory,
  restoreMerchantEnterpriseWorkflowRevisionToDraft,
  type MerchantEnterpriseWorkflowRevisionStoreClient,
} from "@/lib/merchantEnterpriseWorkflowRevisions.server";

const owner: Extract<MerchantEnterpriseActor, { type: "owner" }> = {
  type: "owner",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Owner",
  email: "owner@example.com",
  permissions: [],
  accessScope: "all",
  allowedBoardIds: [],
};

const workflowId = "11111111-1111-4111-8111-111111111111";
const roleId = "99999999-9999-4999-8999-999999999999";
const snapshot = {
  title: "客户投诉处理",
  scenario: "客户报告商品问题",
  description: "核实后处理",
  category: "客户服务",
  tags: ["投诉"],
  steps: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "核实订单",
      instruction: "记录订单号。",
      position: 0,
    },
  ],
};

function client(
  responder: (functionName: string, input: Record<string, unknown>) => unknown,
): MerchantEnterpriseWorkflowRevisionStoreClient {
  return {
    async rpc(functionName, args) {
      return { data: responder(functionName, args), error: null };
    },
  };
}

function context() {
  return {
    id: workflowId,
    title: snapshot.title,
    status: "published",
    version: 4,
    published_version: 3,
    has_unpublished_changes: true,
  };
}

test("revision history store sends a tenant actor keyset and validates order", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await loadMerchantEnterpriseWorkflowRevisionHistory(
    client((functionName, args) => {
      calls.push({ functionName, args });
      return {
        merchantId: "10000000",
        workflow: context(),
        revisions: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            revision_no: 3,
            published_at: "2026-08-04T08:00:00Z",
            title: snapshot.title,
            scenario: snapshot.scenario,
            category: snapshot.category,
            tags: snapshot.tags,
            step_count: 1,
            is_current: true,
          },
        ],
        next_before_revision: 3,
      };
    }),
    {
      siteId: "10000000",
      workflowId,
      actor: owner,
      limit: 1,
      beforeRevision: 4,
    },
  );
  assert.equal(result.revisions[0]?.revisionNo, 3);
  assert.equal(result.nextBeforeRevision, 3);
  assert.deepEqual(calls[0], {
    functionName: "faolla_list_merchant_enterprise_workflow_revisions_v1",
    args: {
      p_input: {
        merchant_id: "10000000",
        workflow_id: workflowId,
        actor_type: "owner",
        actor_id: owner.id,
        limit: 1,
        before_revision: 4,
      },
    },
  });
});

test("revision detail store preserves selected, previous and working snapshots", async () => {
  const result = await loadMerchantEnterpriseWorkflowRevisionDetail(
    client(() => ({
      merchantId: "10000000",
      workflow: { ...context(), can_restore: true },
      revision: {
        id: "33333333-3333-4333-8333-333333333333",
        revision_no: 3,
        published_at: "2026-08-04T08:00:00Z",
        snapshot,
      },
      previous_revision: {
        id: "44444444-4444-4444-8444-444444444444",
        revision_no: 2,
        published_at: "2026-08-03T08:00:00Z",
        snapshot: { ...snapshot, description: "旧说明" },
      },
      working_draft: { ...snapshot, description: "新草稿" },
    })),
    { siteId: "10000000", workflowId, revision: 3, actor: owner },
  );
  assert.equal(result.workflow.canRestore, true);
  assert.equal(result.previousRevision?.revisionNo, 2);
  assert.equal(result.workingDraft.description, "新草稿");
});

test("revision restore store never accepts a mismatched workflow response", async () => {
  const goodWorkflow = {
    id: workflowId,
    merchant_id: "10000000",
    ...snapshot,
    status: "published",
    version: 5,
    published_version: 3,
    published_at: "2026-08-04T08:00:00Z",
    has_unpublished_changes: true,
    created_at: "2026-08-01T08:00:00Z",
    updated_at: "2026-08-04T09:00:00Z",
  };
  const restored = await restoreMerchantEnterpriseWorkflowRevisionToDraft(
    client(() => ({ workflow: goodWorkflow, restored_from_revision: 2 })),
    {
      siteId: "10000000",
      workflowId,
      revision: 2,
      version: 4,
      actor: owner,
      operationId: "revision-restore:test",
    },
  );
  assert.equal(restored.workflow.hasUnpublishedChanges, true);
  assert.equal(restored.restoredFromRevision, 2);

  await assert.rejects(
    restoreMerchantEnterpriseWorkflowRevisionToDraft(
      client(() => ({
        workflow: { ...goodWorkflow, id: "55555555-5555-4555-8555-555555555555" },
        restored_from_revision: 2,
      })),
      {
        siteId: "10000000",
        workflowId,
        revision: 2,
        version: 4,
        actor: owner,
        operationId: "revision-restore:mismatch",
      },
    ),
    /invalid_response/,
  );
});

test("permission gap and grant stores normalize only explicit workflow rights", async () => {
  const gaps = await loadMerchantEnterpriseWorkflowPermissionGaps(
    client(() => ({
      merchantId: "10000000",
      gaps: [
        {
          role_id: roleId,
          name: "管理员",
          system_key: "administrator",
          is_system: true,
          version: 3,
          permissions: ["enterprise.view"],
          recommended_workflow_permissions: [
            "workflows.view",
            "workflows.manage",
            "workflows.publish",
          ],
          missing_workflow_permissions: [
            "workflows.view",
            "workflows.manage",
            "workflows.publish",
          ],
          classification: "system_default_gap",
          employee_count: 2,
        },
      ],
    })),
    { siteId: "10000000", actor: owner },
  );
  assert.equal(gaps[0]?.employeeCount, 2);

  const granted = await grantMerchantEnterpriseRoleWorkflowPermissions(
    client(() => ({
      merchantId: "10000000",
      role: {
        id: roleId,
        name: "管理员",
        status: "active",
        is_system: true,
        version: 4,
        permissions: ["enterprise.view", "workflows.view"],
      },
      added_permissions: ["workflows.view"],
    })),
    {
      siteId: "10000000",
      roleId,
      version: 3,
      workflowPermissions: ["workflows.view"],
      actor: owner,
      operationId: "grant-workflow:view",
    },
  );
  assert.deepEqual(granted.addedPermissions, ["workflows.view"]);
  assert.equal(granted.role.permissions.includes("workflows.manage"), false);
});

test("service-role responses must echo the requested tenant before data is returned", async () => {
  const foreignSiteId = "20000000";
  await assert.rejects(
    loadMerchantEnterpriseWorkflowRevisionHistory(
      client(() => ({
        merchantId: foreignSiteId,
        workflow: context(),
        revisions: [],
        next_before_revision: null,
      })),
      { siteId: "10000000", workflowId, actor: owner },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    loadMerchantEnterpriseWorkflowRevisionDetail(
      client(() => ({
        merchantId: foreignSiteId,
        workflow: { ...context(), can_restore: true },
        revision: {
          id: "33333333-3333-4333-8333-333333333333",
          revision_no: 3,
          published_at: "2026-08-04T08:00:00Z",
          snapshot,
        },
        previous_revision: null,
        working_draft: snapshot,
      })),
      { siteId: "10000000", workflowId, revision: 3, actor: owner },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    loadMerchantEnterpriseWorkflowPermissionGaps(
      client(() => ({ merchantId: foreignSiteId, gaps: [] })),
      { siteId: "10000000", actor: owner },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    grantMerchantEnterpriseRoleWorkflowPermissions(
      client(() => ({
        merchantId: foreignSiteId,
        role: {
          id: roleId,
          name: "管理员",
          status: "active",
          is_system: true,
          version: 4,
          permissions: ["enterprise.view", "workflows.view"],
        },
        added_permissions: ["workflows.view"],
      })),
      {
        siteId: "10000000",
        roleId,
        version: 3,
        workflowPermissions: ["workflows.view"],
        actor: owner,
        operationId: "grant-workflow:view",
      },
    ),
    /invalid_response/,
  );
});

test("revision mutations reject operation IDs that would be rewritten or truncated", async () => {
  let calls = 0;
  const rejectingClient = client(() => {
    calls += 1;
    return null;
  });
  await assert.rejects(
    restoreMerchantEnterpriseWorkflowRevisionToDraft(rejectingClient, {
      siteId: "10000000",
      workflowId,
      revision: 2,
      version: 4,
      actor: owner,
      operationId: "restore history",
    }),
    { message: "invalid_operation_id" },
  );
  await assert.rejects(
    grantMerchantEnterpriseRoleWorkflowPermissions(rejectingClient, {
      siteId: "10000000",
      roleId,
      version: 3,
      workflowPermissions: ["workflows.view"],
      actor: owner,
      operationId: "g".repeat(121),
    }),
    { message: "invalid_operation_id" },
  );
  assert.equal(calls, 0);
});

test("business-bearing roles must use the exact-owner role editor for workflow grants", async () => {
  const rejectingClient: MerchantEnterpriseWorkflowRevisionStoreClient = {
    async rpc() {
      return {
        data: null,
        error: {
          code: "P0001",
          message: "business_role_workflow_grant_requires_role_editor",
        },
      };
    },
  };

  await assert.rejects(
    grantMerchantEnterpriseRoleWorkflowPermissions(rejectingClient, {
      siteId: "10000000",
      roleId,
      version: 3,
      workflowPermissions: ["workflows.view"],
      actor: owner,
      operationId: "grant-workflow:business-role",
    }),
    { message: "business_role_workflow_grant_requires_role_editor" },
  );
});
