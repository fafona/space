import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseWorkflowExecutionsGet,
  handleMerchantEnterpriseWorkflowExecutionsPatch,
  handleMerchantEnterpriseWorkflowExecutionsPost,
  type MerchantEnterpriseWorkflowExecutionRouteDependencies,
} from "@/app/api/merchant-enterprise/workflow-executions/route";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import type {
  MerchantEnterpriseWorkflowAcknowledgement,
  MerchantEnterpriseWorkflowExecution,
  MerchantEnterpriseWorkflowExecutionStats,
  MerchantEnterpriseWorkflowFeedbackResolution,
} from "@/lib/merchantEnterpriseWorkflowExecution";

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const EXECUTION_ID = "44444444-4444-4444-8444-444444444444";
const STEP_ID = "55555555-5555-4555-8555-555555555555";
const TASK_ID = "66666666-6666-4666-8666-666666666666";

const employeeActor: MerchantEnterpriseActor = {
  type: "employee",
  id: EMPLOYEE_ID,
  siteId: "10000000",
  displayName: "执行员工",
  email: "employee@example.com",
  roleId: "77777777-7777-4777-8777-777777777777",
  permissions: ["enterprise.view", "workflows.view", "tasks.view", "tasks.update"],
  accessScope: "all",
  allowedBoardIds: [],
};

const ownerActor: MerchantEnterpriseActor = {
  type: "owner",
  id: "88888888-8888-4888-8888-888888888888",
  siteId: "10000000",
  displayName: "负责人",
  email: "owner@example.com",
  permissions: [],
  accessScope: "all",
  allowedBoardIds: [],
};

function acknowledgement(): MerchantEnterpriseWorkflowAcknowledgement {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    siteId: "10000000",
    workflowId: WORKFLOW_ID,
    revisionId: REVISION_ID,
    revisionNo: 3,
    employeeId: EMPLOYEE_ID,
    acknowledgedAt: "2026-08-04T10:00:00.000Z",
  };
}

function execution(overrides: Partial<MerchantEnterpriseWorkflowExecution> = {}): MerchantEnterpriseWorkflowExecution {
  return {
    id: EXECUTION_ID,
    siteId: "10000000",
    workflowId: WORKFLOW_ID,
    revisionId: REVISION_ID,
    revisionNo: 3,
    employeeId: EMPLOYEE_ID,
    taskId: null,
    subject: "客诉 2026-08-04",
    status: "in_progress",
    workflowSnapshot: {
      title: "客诉处理",
      scenario: "收到客户投诉",
      description: "",
      category: "服务",
      tags: ["客诉"],
      steps: [{ id: STEP_ID, title: "记录问题", instruction: "记录事实。", position: 0 }],
    },
    steps: [{
      stepId: STEP_ID,
      title: "记录问题",
      instruction: "记录事实。",
      position: 0,
      completedAt: null,
      note: "",
      evidence: [],
    }],
    completedSteps: 0,
    totalSteps: 1,
    feedbackRating: null,
    feedbackText: "",
    feedbackStatus: "none",
    feedbackSubmittedAt: null,
    feedbackResolutionNote: "",
    feedbackResolvedAt: null,
    feedbackResolverType: null,
    feedbackResolverId: null,
    generatedChecklistCount: 0,
    startedAt: "2026-08-04T10:01:00.000Z",
    completedAt: null,
    version: 1,
    createdAt: "2026-08-04T10:01:00.000Z",
    updatedAt: "2026-08-04T10:01:00.000Z",
    ...overrides,
  };
}

function stats(): MerchantEnterpriseWorkflowExecutionStats {
  return {
    merchantId: "10000000",
    workflowId: WORKFLOW_ID,
    currentRevisionNo: 3,
    eligibleEmployeeCount: 4,
    acknowledgedEmployeeCount: 2,
    executionCount: 2,
    inProgressCount: 1,
    completedCount: 1,
    taskLinkedExecutionCount: 1,
    generatedChecklistCount: 1,
    feedbackCount: 0,
    openFeedbackCount: 1,
    averageRating: 4,
    participants: [],
    recentFeedback: [{
      executionId: EXECUTION_ID,
      executionVersion: 4,
      employeeId: EMPLOYEE_ID,
      employeeName: "执行员工",
      revisionNo: 2,
      rating: 4,
      text: "说明清楚",
      status: "open",
      submittedAt: "2026-08-04T10:05:00.000Z",
      resolutionNote: "",
      resolvedAt: null,
      resolverType: null,
      resolverId: null,
    }],
  };
}

function dependencies(
  actor: MerchantEnterpriseActor = employeeActor,
): MerchantEnterpriseWorkflowExecutionRouteDependencies {
  return {
    async resolveActor() { return actor; },
    async requireEnterpriseEntitlement() {},
    async loadEmployeeState() {
      return { currentRevisionNo: 3, acknowledgement: acknowledgement(), executions: [execution()] };
    },
    async loadExecution() { return execution(); },
    async loadStats() { return stats(); },
    async acknowledge() { return acknowledgement(); },
    async startExecution() { return { execution: execution(), generatedChecklistCount: 0 }; },
    async updateStep() { return execution({ version: 2 }); },
    async submitFeedback() { return execution({ version: 2 }); },
    async resolveFeedback(): Promise<MerchantEnterpriseWorkflowFeedbackResolution> {
      return {
        executionId: EXECUTION_ID,
        version: 5,
        feedbackStatus: "resolved",
        resolvedAt: "2026-08-04T10:10:00.000Z",
        resolverType: "owner",
      };
    },
  };
}

function mutation(method: "POST" | "PATCH", body: Record<string, unknown>, origin = "https://www.faolla.com") {
  return new Request("https://www.faolla.com/api/merchant-enterprise/workflow-executions", {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

test("employee GET returns acknowledgement and own immutable-revision executions", async () => {
  let resolved: unknown;
  const base = dependencies();
  const result = await handleMerchantEnterpriseWorkflowExecutionsGet(
    new Request(`https://www.faolla.com/api/merchant-enterprise/workflow-executions?siteId=10000000&scope=mine&workflowId=${WORKFLOW_ID}`),
    {
      ...base,
      async resolveActor(_request, input) {
        resolved = input;
        return employeeActor;
      },
    },
  );
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.currentRevisionNo, 3);
  assert.equal(payload.executions[0].revisionId, REVISION_ID);
  assert.deepEqual(resolved, { siteId: "10000000", requiredPermission: "workflows.view" });
});

test("owner cannot read an employee execution, while owner can read manager stats", async () => {
  const base = dependencies(ownerActor);
  const exact = await handleMerchantEnterpriseWorkflowExecutionsGet(
    new Request(`https://www.faolla.com/api/merchant-enterprise/workflow-executions?siteId=10000000&scope=execution&executionId=${EXECUTION_ID}`),
    base,
  );
  assert.equal(exact.status, 403);
  assert.equal((await exact.json()).error, "employee_actor_required");
  const summary = await handleMerchantEnterpriseWorkflowExecutionsGet(
    new Request(`https://www.faolla.com/api/merchant-enterprise/workflow-executions?siteId=10000000&scope=stats&workflowId=${WORKFLOW_ID}`),
    base,
  );
  assert.equal(summary.status, 200);
  const summaryPayload = await summary.json();
  assert.equal(summaryPayload.stats.merchantId, "10000000");
  assert.equal(summaryPayload.stats.currentRevisionNo, 3);
  assert.equal(summaryPayload.stats.feedbackCount, 0);
  assert.equal(summaryPayload.stats.recentFeedback[0].executionVersion, 4);
  assert.equal(summaryPayload.stats.recentFeedback[0].revisionNo, 2);
  assert.equal(summaryPayload.stats.openFeedbackCount, 1);
});

test("GET rejects repeated, mixed and unknown query parameters", async () => {
  for (const query of [
    `siteId=10000000&siteId=10000000&scope=mine&workflowId=${WORKFLOW_ID}`,
    `siteId=10000000&scope=mine&workflowId=${WORKFLOW_ID}&executionId=${EXECUTION_ID}`,
    `siteId=10000000&scope=stats&workflowId=${WORKFLOW_ID}&extra=1`,
  ]) {
    const result = await handleMerchantEnterpriseWorkflowExecutionsGet(
      new Request(`https://www.faolla.com/api/merchant-enterprise/workflow-executions?${query}`),
      dependencies(),
    );
    assert.equal(result.status, 400);
  }
});

test("POST acknowledges the exact published revision", async () => {
  let received: unknown;
  const base = dependencies();
  const result = await handleMerchantEnterpriseWorkflowExecutionsPost(
    mutation("POST", {
      siteId: "10000000",
      action: "acknowledge",
      workflowId: WORKFLOW_ID,
      publishedVersion: 3,
      operationId: "ack:test",
    }),
    { ...base, async acknowledge(input) { received = input; return acknowledgement(); } },
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).acknowledgement.revisionNo, 3);
  assert.equal((received as { operationId: string }).operationId, "ack:test");
});

test("POST starts a task-linked execution and requests atomic checklist generation", async () => {
  let received: unknown;
  const base = dependencies();
  const linked = execution({ taskId: TASK_ID, generatedChecklistCount: 1 });
  const result = await handleMerchantEnterpriseWorkflowExecutionsPost(
    mutation("POST", {
      siteId: "10000000",
      action: "start",
      workflowId: WORKFLOW_ID,
      publishedVersion: 3,
      subject: "订单 42",
      taskId: TASK_ID,
      generateChecklist: true,
    }),
    {
      ...base,
      async startExecution(input) {
        received = input;
        return { execution: linked, generatedChecklistCount: 1 };
      },
    },
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).generatedChecklistCount, 1);
  assert.equal((received as { taskId: string }).taskId, TASK_ID);
  assert.equal((received as { generateChecklist: boolean }).generateChecklist, true);
});

test("POST rejects checklist generation without a task and rejects cross-origin writes", async () => {
  const body = {
    siteId: "10000000",
    action: "start",
    workflowId: WORKFLOW_ID,
    publishedVersion: 3,
    generateChecklist: true,
  };
  const invalid = await handleMerchantEnterpriseWorkflowExecutionsPost(
    mutation("POST", body),
    dependencies(),
  );
  assert.equal(invalid.status, 400);
  const crossOrigin = await handleMerchantEnterpriseWorkflowExecutionsPost(
    mutation("POST", body, "https://evil.example"),
    dependencies(),
  );
  assert.equal(crossOrigin.status, 403);
});

test("PATCH updates one execution step with note and evidence metadata", async () => {
  let received: unknown;
  const base = dependencies();
  const result = await handleMerchantEnterpriseWorkflowExecutionsPatch(
    mutation("PATCH", {
      siteId: "10000000",
      action: "step",
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      version: 1,
      completed: true,
      note: "已电话确认",
      evidence: [{
        kind: "link",
        label: "处理记录",
        reference: "https://example.com/evidence/42",
        mediaType: "text/html",
        sizeBytes: null,
      }],
    }),
    { ...base, async updateStep(input) { received = input; return execution({ version: 2 }); } },
  );
  assert.equal(result.status, 200);
  assert.equal((received as { evidence: unknown[] }).evidence.length, 1);
});

test("PATCH submits employee feedback and lets a manager resolve it with CAS version", async () => {
  const feedback = await handleMerchantEnterpriseWorkflowExecutionsPatch(
    mutation("PATCH", {
      siteId: "10000000",
      action: "feedback",
      executionId: EXECUTION_ID,
      version: 2,
      rating: 4,
      text: "需要补一个示例",
    }),
    dependencies(),
  );
  assert.equal(feedback.status, 200);
  let resolved: unknown;
  const base = dependencies(ownerActor);
  const resolution = await handleMerchantEnterpriseWorkflowExecutionsPatch(
    mutation("PATCH", {
      siteId: "10000000",
      action: "resolve_feedback",
      executionId: EXECUTION_ID,
      version: 4,
      resolutionNote: "示例已加入下一版",
    }),
    { ...base, async resolveFeedback(input) { resolved = input; return base.resolveFeedback(input); } },
  );
  assert.equal(resolution.status, 200);
  assert.equal((resolved as { actor: MerchantEnterpriseActor }).actor.type, "owner");
  const payload = await resolution.json();
  assert.deepEqual(payload.resolution, {
    executionId: EXECUTION_ID,
    version: 5,
    feedbackStatus: "resolved",
    resolvedAt: "2026-08-04T10:10:00.000Z",
    resolverType: "owner",
  });
  assert.equal("execution" in payload, false);
  assert.equal(JSON.stringify(payload).includes(ownerActor.id), false);
});

test("workflow execution conflicts and authorization errors are not collapsed to 500", async () => {
  const conflict = await handleMerchantEnterpriseWorkflowExecutionsPost(
    mutation("POST", {
      siteId: "10000000",
      action: "start",
      workflowId: WORKFLOW_ID,
      publishedVersion: 3,
    }),
    {
      ...dependencies(),
      async startExecution() { throw new Error("workflow_acknowledgement_required"); },
    },
  );
  assert.equal(conflict.status, 409);
  const sourceConflict = await handleMerchantEnterpriseWorkflowExecutionsPost(
    mutation("POST", {
      siteId: "10000000",
      action: "start",
      workflowId: WORKFLOW_ID,
      publishedVersion: 3,
    }),
    {
      ...dependencies(),
      async startExecution() {
        throw new Error("task_workflow_checklist_source_exists");
      },
    },
  );
  assert.equal(sourceConflict.status, 409);
  assert.deepEqual(await sourceConflict.json(), {
    ok: false,
    error: "task_workflow_checklist_source_exists",
  });
  const denied = await handleMerchantEnterpriseWorkflowExecutionsGet(
    new Request(`https://www.faolla.com/api/merchant-enterprise/workflow-executions?siteId=10000000&scope=stats&workflowId=${WORKFLOW_ID}`),
    { ...dependencies(), async loadStats() { throw new Error("permission_denied"); } },
  );
  assert.equal(denied.status, 403);
});
