import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeMerchantEnterpriseWorkflow,
  loadMerchantEnterpriseWorkflowEmployeeState,
  loadMerchantEnterpriseWorkflowExecution,
  loadMerchantEnterpriseWorkflowExecutionStats,
  resolveMerchantEnterpriseWorkflowExecutionFeedback,
  startMerchantEnterpriseWorkflowExecution,
  submitMerchantEnterpriseWorkflowExecutionFeedback,
  updateMerchantEnterpriseWorkflowExecutionStep,
  type MerchantEnterpriseWorkflowExecutionStoreClient,
} from "@/lib/merchantEnterpriseWorkflowExecution.server";
import {
  normalizeMerchantEnterpriseWorkflowExecution,
  normalizeMerchantEnterpriseWorkflowExecutionStats,
} from "@/lib/merchantEnterpriseWorkflowExecution";

const SITE_ID = "10000000";
const FOREIGN_SITE_ID = "20000000";
const EMPLOYEE_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_EMPLOYEE_ID = "66666666-6666-4666-8666-666666666666";
const OWNER_ID = "88888888-8888-4888-8888-888888888888";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const EXECUTION_ID = "33333333-3333-4333-8333-333333333333";
const STEP_ID = "44444444-4444-4444-8444-444444444444";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const ACKNOWLEDGEMENT_ID = "99999999-9999-4999-8999-999999999999";
const NOW = "2026-08-04T10:00:00.000Z";

const employeeActor = {
  actorType: "employee" as const,
  actorId: EMPLOYEE_ID,
};
const ownerActor = {
  actorType: "owner" as const,
  actorId: OWNER_ID,
};

function acknowledgementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACKNOWLEDGEMENT_ID,
    merchant_id: SITE_ID,
    workflow_id: WORKFLOW_ID,
    revision_id: REVISION_ID,
    revision_no: 3,
    employee_id: EMPLOYEE_ID,
    acknowledged_at: NOW,
    ...overrides,
  };
}

function executionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXECUTION_ID,
    merchant_id: SITE_ID,
    workflow_id: WORKFLOW_ID,
    revision_id: REVISION_ID,
    revision_no: 3,
    employee_id: EMPLOYEE_ID,
    task_id: TASK_ID,
    subject: "Handle damaged order",
    status: "in_progress",
    workflow_snapshot: {
      title: "Damaged order",
      scenario: "A customer reports a damaged product",
      description: "Follow the published support policy.",
      category: "Support",
      tags: ["returns"],
      steps: [{
        id: STEP_ID,
        title: "Verify order",
        instruction: "Confirm the order and supporting evidence.",
        position: 0,
      }],
    },
    steps: [{
      step_id: STEP_ID,
      title: "Verify order",
      instruction: "Confirm the order and supporting evidence.",
      position: 0,
      completed_at: null,
      note: "",
      evidence: [],
    }],
    completed_steps: 0,
    total_steps: 1,
    feedback_rating: null,
    feedback_text: "",
    feedback_status: "none",
    feedback_submitted_at: null,
    feedback_resolution_note: "",
    feedback_resolved_at: null,
    feedback_resolver_type: null,
    feedback_resolver_id: null,
    generated_checklist_count: 1,
    started_at: NOW,
    completed_at: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function statsRow(overrides: Record<string, unknown> = {}) {
  return {
    merchant_id: SITE_ID,
    workflow_id: WORKFLOW_ID,
    current_revision_no: 3,
    eligible_employee_count: 1,
    acknowledged_employee_count: 1,
    execution_count: 1,
    in_progress_count: 1,
    completed_count: 0,
    task_linked_execution_count: 1,
    generated_checklist_count: 1,
    feedback_count: 0,
    open_feedback_count: 0,
    average_rating: null,
    participants: [{
      employee_id: EMPLOYEE_ID,
      employee_name: "Operator",
      acknowledged_at: NOW,
      execution_count: 1,
      completed_count: 0,
      last_activity_at: NOW,
    }],
    recent_feedback: [],
    ...overrides,
  };
}

function storeClient(
  responder: (
    functionName: string,
    input: Record<string, unknown>,
  ) => { data: unknown; error: unknown },
): MerchantEnterpriseWorkflowExecutionStoreClient {
  return {
    async rpc(functionName, args) {
      return responder(functionName, args.p_input);
    },
  };
}

test("camelCase API payloads preserve explicit nulls during a second normalization", () => {
  const ownerResolved = normalizeMerchantEnterpriseWorkflowExecution(executionRow({
    status: "completed",
    completed_steps: 1,
    completed_at: NOW,
    feedback_rating: 4,
    feedback_text: "Useful",
    feedback_status: "resolved",
    feedback_submitted_at: NOW,
    feedback_resolution_note: "Resolved by the owner",
    feedback_resolved_at: NOW,
    feedback_resolver_type: "owner",
    feedback_resolver_id: null,
  }));
  assert.ok(ownerResolved);
  const normalizedAgain = normalizeMerchantEnterpriseWorkflowExecution(ownerResolved);
  assert.ok(normalizedAgain);
  assert.equal(normalizedAgain.taskId, TASK_ID);
  assert.equal(normalizedAgain.feedbackResolverType, "owner");
  assert.equal(normalizedAgain.feedbackResolverId, null);
  assert.equal(normalizeMerchantEnterpriseWorkflowExecution(executionRow({
    status: "completed",
    completed_steps: 1,
    completed_at: NOW,
    feedback_rating: 4,
    feedback_text: "Useful",
    feedback_status: "resolved",
    feedback_submitted_at: NOW,
    feedback_resolution_note: "Resolved by the owner",
    feedback_resolved_at: NOW,
    feedback_resolver_type: "owner",
    feedback_resolver_id: OWNER_ID,
  })), null);

  const employeeResolvedStats = normalizeMerchantEnterpriseWorkflowExecutionStats(statsRow({
    feedback_count: 1,
    recent_feedback: [{
      execution_id: EXECUTION_ID,
      execution_version: 4,
      employee_id: EMPLOYEE_ID,
      employee_name: "Operator",
      revision_no: 3,
      rating: 4,
      text: "Useful",
      status: "resolved",
      submitted_at: NOW,
      resolution_note: "Handled",
      resolved_at: NOW,
      resolver_type: "employee",
      resolver_id: OTHER_EMPLOYEE_ID,
    }],
  }));
  assert.ok(employeeResolvedStats);
  assert.equal(employeeResolvedStats.recentFeedback[0]?.resolverId, OTHER_EMPLOYEE_ID);
  assert.ok(normalizeMerchantEnterpriseWorkflowExecutionStats(employeeResolvedStats));
});

test("stats keep current-version totals while accepting older unresolved feedback", () => {
  const normalized = normalizeMerchantEnterpriseWorkflowExecutionStats(statsRow({
    feedback_count: 0,
    open_feedback_count: 1,
    recent_feedback: [{
      execution_id: EXECUTION_ID,
      execution_version: 4,
      employee_id: EMPLOYEE_ID,
      employee_name: "Operator",
      revision_no: 2,
      rating: 3,
      text: "The previous procedure still needs clarification.",
      status: "open",
      submitted_at: NOW,
      resolution_note: "",
      resolved_at: null,
      resolver_type: null,
      resolver_id: null,
    }],
  }));

  assert.ok(normalized);
  assert.equal(normalized.merchantId, SITE_ID);
  assert.equal(normalized.currentRevisionNo, 3);
  assert.equal(normalized.feedbackCount, 0);
  assert.equal(normalized.openFeedbackCount, 1);
  assert.equal(normalized.recentFeedback[0]?.revisionNo, 2);
  assert.equal(normalized.recentFeedback[0]?.status, "open");
});

test("acknowledgement and start wrappers send exact tenant, actor, revision and task inputs", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = storeClient((name, input) => {
    calls.push({ name, input });
    if (name === "faolla_acknowledge_merchant_enterprise_workflow_v1") {
      return { data: { acknowledgement: acknowledgementRow() }, error: null };
    }
    return {
      data: {
        execution: executionRow(),
        generatedChecklistCount: 1,
      },
      error: null,
    };
  });

  const acknowledgement = await acknowledgeMerchantEnterpriseWorkflow(client, {
    siteId: SITE_ID,
    workflowId: WORKFLOW_ID,
    publishedVersion: 3,
    operationId: "workflow-ack:test",
    ...employeeActor,
  });
  const started = await startMerchantEnterpriseWorkflowExecution(client, {
    siteId: SITE_ID,
    workflowId: WORKFLOW_ID,
    publishedVersion: 3,
    subject: " Handle damaged order ",
    taskId: TASK_ID,
    generateChecklist: true,
    operationId: "workflow-start:test",
    ...employeeActor,
  });

  assert.equal(acknowledgement.employeeId, EMPLOYEE_ID);
  assert.equal(started.execution.id, EXECUTION_ID);
  assert.equal(started.generatedChecklistCount, 1);
  assert.deepEqual(calls, [
    {
      name: "faolla_acknowledge_merchant_enterprise_workflow_v1",
      input: {
        merchant_id: SITE_ID,
        workflow_id: WORKFLOW_ID,
        expected_revision_no: 3,
        operation_id: "workflow-ack:test",
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
    {
      name: "faolla_start_merchant_enterprise_workflow_execution_v1",
      input: {
        merchant_id: SITE_ID,
        workflow_id: WORKFLOW_ID,
        expected_revision_no: 3,
        subject: "Handle damaged order",
        task_id: TASK_ID,
        generate_checklist: true,
        operation_id: "workflow-start:test",
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
  ]);
});

test("employee state, exact execution and manager stats wrappers use isolated read RPCs", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = storeClient((name, input) => {
    calls.push({ name, input });
    if (name === "faolla_get_merchant_enterprise_workflow_employee_state_v1") {
      return {
        data: {
          current_revision_no: 3,
          acknowledgement: acknowledgementRow(),
          executions: [executionRow()],
        },
        error: null,
      };
    }
    if (name === "faolla_get_merchant_enterprise_workflow_execution_v1") {
      return { data: { execution: executionRow() }, error: null };
    }
    return { data: { stats: statsRow() }, error: null };
  });

  const state = await loadMerchantEnterpriseWorkflowEmployeeState(client, {
    siteId: SITE_ID,
    workflowId: WORKFLOW_ID,
    ...employeeActor,
  });
  const execution = await loadMerchantEnterpriseWorkflowExecution(client, {
    siteId: SITE_ID,
    executionId: EXECUTION_ID,
    ...employeeActor,
  });
  const stats = await loadMerchantEnterpriseWorkflowExecutionStats(client, {
    siteId: SITE_ID,
    workflowId: WORKFLOW_ID,
    ...ownerActor,
  });

  assert.equal(state.acknowledgement?.id, ACKNOWLEDGEMENT_ID);
  assert.equal(execution.employeeId, EMPLOYEE_ID);
  assert.equal(stats.participants[0]?.employeeId, EMPLOYEE_ID);
  assert.deepEqual(calls, [
    {
      name: "faolla_get_merchant_enterprise_workflow_employee_state_v1",
      input: {
        merchant_id: SITE_ID,
        workflow_id: WORKFLOW_ID,
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
    {
      name: "faolla_get_merchant_enterprise_workflow_execution_v1",
      input: {
        merchant_id: SITE_ID,
        execution_id: EXECUTION_ID,
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
    {
      name: "faolla_get_merchant_enterprise_workflow_execution_stats_v1",
      input: {
        merchant_id: SITE_ID,
        workflow_id: WORKFLOW_ID,
        actor_type: "owner",
        actor_id: OWNER_ID,
      },
    },
  ]);
});

test("step, feedback and resolution wrappers preserve CAS versions and bounded metadata", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = storeClient((name, input) => {
    calls.push({ name, input });
    if (name === "faolla_update_merchant_enterprise_workflow_execution_step_v1") {
      return { data: { execution: executionRow({ version: 2 }) }, error: null };
    }
    if (name === "faolla_submit_merchant_enterprise_workflow_feedback_v1") {
      return { data: { execution: executionRow({ version: 3 }) }, error: null };
    }
    return {
      data: {
        resolution: {
          executionId: EXECUTION_ID,
          version: 4,
          feedbackStatus: "resolved",
          resolvedAt: NOW,
          resolverType: "owner",
          resolverId: OWNER_ID,
          execution: executionRow(),
        },
      },
      error: null,
    };
  });
  const evidence = [{
    kind: "link" as const,
    label: "CRM case",
    reference: "https://example.test/case/42",
    mediaType: "text/html",
    sizeBytes: null,
  }];

  await updateMerchantEnterpriseWorkflowExecutionStep(client, {
    siteId: SITE_ID,
    executionId: EXECUTION_ID,
    stepId: STEP_ID,
    version: 1,
    completed: true,
    note: " Verified ",
    evidence,
    operationId: "workflow-step:test",
    ...employeeActor,
  });
  await submitMerchantEnterpriseWorkflowExecutionFeedback(client, {
    siteId: SITE_ID,
    executionId: EXECUTION_ID,
    version: 2,
    rating: 4,
    text: " Useful ",
    operationId: "workflow-feedback:test",
    ...employeeActor,
  });
  const resolution = await resolveMerchantEnterpriseWorkflowExecutionFeedback(client, {
    siteId: SITE_ID,
    executionId: EXECUTION_ID,
    version: 3,
    resolutionNote: " Included in the next revision ",
    operationId: "workflow-feedback-resolve:test",
    ...ownerActor,
  });

  assert.deepEqual(resolution, {
    executionId: EXECUTION_ID,
    version: 4,
    feedbackStatus: "resolved",
    resolvedAt: NOW,
    resolverType: "owner",
  });
  assert.equal(JSON.stringify(resolution).includes(OWNER_ID), false);

  assert.deepEqual(calls, [
    {
      name: "faolla_update_merchant_enterprise_workflow_execution_step_v1",
      input: {
        merchant_id: SITE_ID,
        execution_id: EXECUTION_ID,
        step_id: STEP_ID,
        expected_version: 1,
        completed: true,
        note: "Verified",
        evidence,
        operation_id: "workflow-step:test",
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
    {
      name: "faolla_submit_merchant_enterprise_workflow_feedback_v1",
      input: {
        merchant_id: SITE_ID,
        execution_id: EXECUTION_ID,
        expected_version: 2,
        rating: 4,
        text: "Useful",
        operation_id: "workflow-feedback:test",
        actor_type: "employee",
        actor_id: EMPLOYEE_ID,
      },
    },
    {
      name: "faolla_resolve_merchant_enterprise_workflow_feedback_v1",
      input: {
        merchant_id: SITE_ID,
        execution_id: EXECUTION_ID,
        expected_version: 3,
        resolution_note: "Included in the next revision",
        operation_id: "workflow-feedback-resolve:test",
        actor_type: "owner",
        actor_id: OWNER_ID,
      },
    },
  ]);
});

test("employee-only wrappers reject owner actors before persistence", async () => {
  let calls = 0;
  const client = storeClient(() => {
    calls += 1;
    return { data: null, error: null };
  });
  await assert.rejects(
    acknowledgeMerchantEnterpriseWorkflow(client, {
      siteId: SITE_ID,
      workflowId: WORKFLOW_ID,
      publishedVersion: 3,
      ...ownerActor,
    }),
    { message: "invalid_workflow_execution_actor" },
  );
  await assert.rejects(
    loadMerchantEnterpriseWorkflowExecution(client, {
      siteId: SITE_ID,
      executionId: EXECUTION_ID,
      ...ownerActor,
    }),
    { message: "invalid_workflow_execution_actor" },
  );
  assert.equal(calls, 0);
});

test("wrappers reject forged employee, tenant, object and resolver responses", async () => {
  async function rejectsAcknowledgement(overrides: Record<string, unknown>) {
    await assert.rejects(
      acknowledgeMerchantEnterpriseWorkflow(
        storeClient(() => ({
          data: { acknowledgement: acknowledgementRow(overrides) },
          error: null,
        })),
        {
          siteId: SITE_ID,
          workflowId: WORKFLOW_ID,
          publishedVersion: 3,
          operationId: "forged-ack:test",
          ...employeeActor,
        },
      ),
      /invalid_response/,
    );
  }
  await rejectsAcknowledgement({ merchant_id: FOREIGN_SITE_ID });
  await rejectsAcknowledgement({ employee_id: OTHER_EMPLOYEE_ID });

  await assert.rejects(
    loadMerchantEnterpriseWorkflowEmployeeState(
      storeClient(() => ({
        data: {
          currentRevisionNo: 3,
          acknowledgement: acknowledgementRow(),
          executions: [executionRow({ employee_id: OTHER_EMPLOYEE_ID })],
        },
        error: null,
      })),
      { siteId: SITE_ID, workflowId: WORKFLOW_ID, ...employeeActor },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    loadMerchantEnterpriseWorkflowExecution(
      storeClient(() => ({
        data: { execution: executionRow({ merchant_id: FOREIGN_SITE_ID }) },
        error: null,
      })),
      { siteId: SITE_ID, executionId: EXECUTION_ID, ...employeeActor },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    startMerchantEnterpriseWorkflowExecution(
      storeClient(() => ({
        data: {
          execution: executionRow({ employee_id: OTHER_EMPLOYEE_ID }),
          generatedChecklistCount: 1,
        },
        error: null,
      })),
      {
        siteId: SITE_ID,
        workflowId: WORKFLOW_ID,
        publishedVersion: 3,
        taskId: TASK_ID,
        generateChecklist: true,
        ...employeeActor,
      },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    resolveMerchantEnterpriseWorkflowExecutionFeedback(
      storeClient(() => ({
        data: {
          resolution: {
            executionId: EXECUTION_ID,
            version: 2,
            feedbackStatus: "resolved",
            resolvedAt: NOW,
            resolverType: "employee",
          },
        },
        error: null,
      })),
      {
        siteId: SITE_ID,
        executionId: EXECUTION_ID,
        version: 1,
        ...ownerActor,
      },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    loadMerchantEnterpriseWorkflowExecutionStats(
      storeClient(() => ({
        data: { stats: statsRow({ merchant_id: FOREIGN_SITE_ID }) },
        error: null,
      })),
      { siteId: SITE_ID, workflowId: WORKFLOW_ID, ...ownerActor },
    ),
    /invalid_response/,
  );
  await assert.rejects(
    loadMerchantEnterpriseWorkflowExecutionStats(
      storeClient(() => ({
        data: { stats: statsRow({ workflow_id: OTHER_WORKFLOW_ID }) },
        error: null,
      })),
      { siteId: SITE_ID, workflowId: WORKFLOW_ID, ...ownerActor },
    ),
    /invalid_response/,
  );
});

test("known database errors remain actionable and unknown errors retain operation context", async () => {
  const knownErrors = [
    "permission_denied",
    "employee_actor_required",
    "workflow_not_found",
    "workflow_execution_not_found",
    "workflow_execution_step_not_found",
    "workflow_revision_changed",
    "workflow_acknowledgement_required",
    "workflow_execution_incomplete",
    "workflow_feedback_not_open",
    "workflow_execution_limit_reached",
    "workflow_task_execution_exists",
    "task_workflow_checklist_source_exists",
    "workflow_execution_snapshot_invalid",
    "task_not_found",
    "task_assignment_required",
    "invalid_task_archived",
    "invalid_task_board",
    "task_checklist_limit_reached",
    "enterprise_version_conflict",
    "enterprise_idempotency_conflict",
    "enterprise_operation_in_progress",
    "invalid_workflow_execution_request",
    "invalid_workflow_execution_action",
    "invalid_workflow_execution_version",
    "invalid_workflow_execution_step_update",
    "invalid_workflow_execution_feedback",
    "invalid_workflow_evidence",
  ];
  for (const errorCode of knownErrors) {
    await assert.rejects(
      loadMerchantEnterpriseWorkflowEmployeeState(
        storeClient(() => ({
          data: null,
          error: { message: `database rejected request: ${errorCode}` },
        })),
        { siteId: SITE_ID, workflowId: WORKFLOW_ID, ...employeeActor },
      ),
      { message: errorCode },
    );
  }

  await assert.rejects(
    loadMerchantEnterpriseWorkflowEmployeeState(
      storeClient(() => ({
        data: null,
        error: { message: "database exploded" },
      })),
      { siteId: SITE_ID, workflowId: WORKFLOW_ID, ...employeeActor },
    ),
    { message: "enterprise_workflow_employee_state_failed:database exploded" },
  );
});
