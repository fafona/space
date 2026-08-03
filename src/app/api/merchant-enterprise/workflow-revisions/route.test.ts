import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseWorkflowRevisionsGet,
  handleMerchantEnterpriseWorkflowRevisionsPost,
  type MerchantEnterpriseWorkflowRevisionRouteDependencies,
} from "@/app/api/merchant-enterprise/workflow-revisions/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseWorkflow,
} from "@/lib/merchantEnterprise";
import type {
  MerchantEnterpriseWorkflowRevisionDetail,
  MerchantEnterpriseWorkflowRevisionHistoryPage,
} from "@/lib/merchantEnterpriseWorkflowRevisions";

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Reviewer",
  email: "reviewer@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: [
    "enterprise.view",
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ],
  accessScope: "all",
  allowedBoardIds: [],
};

const snapshot = {
  title: "客户投诉处理",
  scenario: "客户反馈商品存在问题时",
  description: "先确认事实，再给出解决方案。",
  category: "客户服务",
  tags: ["投诉", "售后"],
  steps: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "记录情况",
      instruction: "记录订单号和具体问题。",
      position: 0,
    },
  ],
};

const context = {
  id: "11111111-1111-4111-8111-111111111111",
  title: snapshot.title,
  status: "published" as const,
  version: 4,
  publishedVersion: 3,
  hasUnpublishedChanges: true,
};

const page: MerchantEnterpriseWorkflowRevisionHistoryPage = {
  workflow: context,
  revisions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      revisionNo: 3,
      publishedAt: "2026-08-04T08:00:00.000Z",
      title: snapshot.title,
      scenario: snapshot.scenario,
      category: snapshot.category,
      tags: snapshot.tags,
      stepCount: 1,
      isCurrent: true,
    },
  ],
  nextBeforeRevision: 3,
};

const detail: MerchantEnterpriseWorkflowRevisionDetail = {
  workflow: { ...context, canRestore: true },
  revision: {
    id: "33333333-3333-4333-8333-333333333333",
    revisionNo: 3,
    publishedAt: "2026-08-04T08:00:00.000Z",
    snapshot,
  },
  previousRevision: {
    id: "44444444-4444-4444-8444-444444444444",
    revisionNo: 2,
    publishedAt: "2026-08-03T08:00:00.000Z",
    snapshot: { ...snapshot, description: "旧说明" },
  },
  workingDraft: { ...snapshot, description: "尚未发布的新说明" },
};

function workflow(): MerchantEnterpriseWorkflow {
  return {
    id: context.id,
    siteId: "10000000",
    ...snapshot,
    status: "published",
    version: 5,
    publishedVersion: 3,
    publishedAt: "2026-08-04T08:00:00.000Z",
    hasUnpublishedChanges: true,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-04T09:00:00.000Z",
  };
}

function dependencies(
  overrides: Partial<MerchantEnterpriseWorkflowRevisionRouteDependencies> = {},
): MerchantEnterpriseWorkflowRevisionRouteDependencies {
  return {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadHistory() {
      return page;
    },
    async loadDetail() {
      return detail;
    },
    async restoreToDraft() {
      return { workflow: workflow(), restoredFromRevision: 2 };
    },
    ...overrides,
  };
}

test("revision GET lists an opaque workflow-scoped history page", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowRevisionsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-revisions?siteId=10000000&workflowId=11111111-1111-4111-8111-111111111111&limit=20&beforeRevision=4",
    ),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async requireEnterpriseEntitlement(siteId) {
        calls.push({ entitlement: siteId });
        return {};
      },
      async loadHistory(input) {
        calls.push({ history: input });
        return page;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [
    {
      resolve: { siteId: "10000000", requiredPermission: "workflows.view" },
    },
    { entitlement: "10000000" },
    {
      history: {
        siteId: "10000000",
        workflowId: context.id,
        actor,
        limit: 20,
        beforeRevision: 4,
      },
    },
  ]);
  const payload = await response.json();
  assert.equal(payload.revisions[0].revisionNo, 3);
  assert.equal(payload.nextBeforeRevision, 3);
});

test("revision GET returns selected, previous and mutable draft snapshots for diff", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowRevisionsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-revisions?siteId=10000000&workflowId=11111111-1111-4111-8111-111111111111&revision=3",
    ),
    dependencies({
      async loadDetail(input) {
        calls.push(input);
        return detail;
      },
    }),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.revision.revisionNo, 3);
  assert.equal(payload.previousRevision.revisionNo, 2);
  assert.equal(payload.workingDraft.description, "尚未发布的新说明");
  assert.deepEqual(calls[0], {
    siteId: "10000000",
    workflowId: context.id,
    revision: 3,
    actor,
  });
});

test("revision GET rejects ambiguous or malformed queries before authorization", async () => {
  let authorized = false;
  const deps = dependencies({
    async resolveActor() {
      authorized = true;
      return actor;
    },
  });
  for (const query of [
    `siteId=10000000&workflowId=${context.id}&revision=3&limit=10`,
    `siteId=10000000&workflowId=${context.id}&revision=0`,
    `siteId=10000000&workflowId=${context.id}&beforeRevision=01`,
    `siteId=10000000&workflowId=${context.id}&limit=101`,
    `siteId=10000000&workflowId=${context.id}&workflowId=${context.id}`,
    `siteId=10000000&workflowId=${context.id}&extra=1`,
  ]) {
    const response = await handleMerchantEnterpriseWorkflowRevisionsGet(
      new Request(
        `https://www.faolla.com/api/merchant-enterprise/workflow-revisions?${query}`,
      ),
      deps,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(authorized, false);
});

test("revision POST copies one history version to a draft under manage permission", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowRevisionsPost(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-revisions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          workflowId: context.id,
          revision: 2,
          version: 4,
          action: "restore_to_draft",
          operationId: "restore-history:test",
        }),
      },
    ),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async restoreToDraft(input) {
        calls.push({ restore: input });
        return { workflow: workflow(), restoredFromRevision: 2 };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    resolve: { siteId: "10000000", requiredPermission: "workflows.manage" },
  });
  assert.deepEqual(calls[1], {
    restore: {
      siteId: "10000000",
      workflowId: context.id,
      revision: 2,
      version: 4,
      operationId: "restore-history:test",
      actor,
    },
  });
  const payload = await response.json();
  assert.equal(payload.restoredFromRevision, 2);
  assert.equal(payload.workflow.hasUnpublishedChanges, true);
});

test("revision POST rejects cross-origin, stale and action-smuggling requests", async () => {
  const crossOrigin = await handleMerchantEnterpriseWorkflowRevisionsPost(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-revisions",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: "{}",
      },
    ),
    dependencies(),
  );
  assert.equal(crossOrigin.status, 403);

  const badAction = await handleMerchantEnterpriseWorkflowRevisionsPost(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-revisions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          workflowId: context.id,
          revision: 2,
          version: 4,
          action: "publish",
          operationId: "restore-history:test",
        }),
      },
    ),
    dependencies(),
  );
  assert.equal(badAction.status, 400);

  for (const operationId of ["restore history", "r".repeat(121)]) {
    const invalidOperation = await handleMerchantEnterpriseWorkflowRevisionsPost(
      new Request(
        "https://www.faolla.com/api/merchant-enterprise/workflow-revisions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://www.faolla.com",
          },
          body: JSON.stringify({
            siteId: "10000000",
            workflowId: context.id,
            revision: 2,
            version: 4,
            action: "restore_to_draft",
            operationId,
          }),
        },
      ),
      dependencies(),
    );
    assert.equal(invalidOperation.status, 400);
    assert.equal((await invalidOperation.json()).error, "invalid_operation_id");
  }

  const stale = await handleMerchantEnterpriseWorkflowRevisionsPost(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-revisions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          workflowId: context.id,
          revision: 2,
          version: 4,
          action: "restore_to_draft",
          operationId: "restore-history:stale",
        }),
      },
    ),
    dependencies({
      async restoreToDraft() {
        throw new Error("enterprise_version_conflict");
      },
    }),
  );
  assert.equal(stale.status, 409);
});
