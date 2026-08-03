import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  loadMerchantEnterprisePublishedWorkflowChoices,
  type MerchantEnterprisePublishedWorkflowStoreClient,
} from "@/lib/merchantEnterprisePublishedWorkflows.server";

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Operator",
  email: "operator@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: ["enterprise.view", "workflows.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const choiceRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Customer complaint",
  scenario: "A customer reports a damaged product",
  revision_id: "22222222-2222-4222-8222-222222222222",
  revision_no: 3,
  step_count: 4,
};

test("published workflow store sends a tenant-scoped actor RPC request and sanitizes rows", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantEnterprisePublishedWorkflowStoreClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: {
          merchantId: "10000000",
          choices: [
            {
              ...choiceRow,
              description: "unpublished draft description",
              steps: [{ instruction: "must not leave the store" }],
              has_unpublished_changes: true,
            },
          ],
        },
        error: null,
      };
    },
  };

  const result = await loadMerchantEnterprisePublishedWorkflowChoices(client, {
    siteId: "10000000",
    actor,
  });

  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_published_workflow_choices_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          actor_type: "employee",
          actor_id: actor.id,
        },
      },
    },
  ]);
  assert.deepEqual(result, [
    {
      id: choiceRow.id,
      title: choiceRow.title,
      scenario: choiceRow.scenario,
      revisionId: choiceRow.revision_id,
      revisionNo: 3,
      stepCount: 4,
    },
  ]);
  assert.deepEqual(Object.keys(result[0]!).sort(), [
    "id",
    "revisionId",
    "revisionNo",
    "scenario",
    "stepCount",
    "title",
  ]);
});

test("published workflow store rejects malformed, duplicate, and oversized responses", async () => {
  async function rejects(choices: unknown[]) {
    const client: MerchantEnterprisePublishedWorkflowStoreClient = {
      async rpc() {
        return { data: { merchantId: "10000000", choices }, error: null };
      },
    };
    await assert.rejects(
      loadMerchantEnterprisePublishedWorkflowChoices(client, {
        siteId: "10000000",
        actor,
      }),
      /enterprise_published_workflows_read_failed/,
    );
  }

  await rejects([{ ...choiceRow, revision_id: "not-a-revision" }]);
  await rejects([{ ...choiceRow, step_count: 51 }]);
  await rejects([choiceRow, { ...choiceRow, revision_no: 4 }]);
  await rejects(Array.from({ length: 201 }, () => choiceRow));

  const missingArray: MerchantEnterprisePublishedWorkflowStoreClient = {
    async rpc() {
      return {
        data: { merchantId: "10000000", workflows: [choiceRow] },
        error: null,
      };
    },
  };
  await assert.rejects(
    loadMerchantEnterprisePublishedWorkflowChoices(missingArray, {
      siteId: "10000000",
      actor,
    }),
    /enterprise_published_workflows_read_failed/,
  );
});

test("published workflow store accepts an empty choice list", async () => {
  const client: MerchantEnterprisePublishedWorkflowStoreClient = {
    async rpc() {
      return { data: { merchantId: "10000000", choices: [] }, error: null };
    },
  };
  assert.deepEqual(
    await loadMerchantEnterprisePublishedWorkflowChoices(client, {
      siteId: "10000000",
      actor,
    }),
    [],
  );
});

test("published workflow store rejects a missing or cross-tenant marker", async () => {
  for (const data of [
    { choices: [choiceRow] },
    { merchantId: "20000000", choices: [choiceRow] },
  ]) {
    const client: MerchantEnterprisePublishedWorkflowStoreClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    await assert.rejects(
      loadMerchantEnterprisePublishedWorkflowChoices(client, {
        siteId: "10000000",
        actor,
      }),
      /enterprise_published_workflows_read_failed/,
    );
  }
});

test("published workflow store validates caller scope before RPC", async () => {
  let calls = 0;
  const client: MerchantEnterprisePublishedWorkflowStoreClient = {
    async rpc() {
      calls += 1;
      return { data: { choices: [] }, error: null };
    },
  };
  await assert.rejects(
    loadMerchantEnterprisePublishedWorkflowChoices(client, {
      siteId: "another-tenant",
      actor,
    }),
    /invalid_published_workflow_choice_query/,
  );
  await assert.rejects(
    loadMerchantEnterprisePublishedWorkflowChoices(client, {
      siteId: "10000000",
      actor: { ...actor, id: "not-an-actor" },
    }),
    /invalid_published_workflow_choice_query/,
  );
  assert.equal(calls, 0);
});

test("published workflow store maps authorization and missing migration errors", async () => {
  const permissionClient: MerchantEnterprisePublishedWorkflowStoreClient = {
    async rpc() {
      return { data: null, error: { code: "P0001", message: "permission_denied" } };
    },
  };
  await assert.rejects(
    loadMerchantEnterprisePublishedWorkflowChoices(permissionClient, {
      siteId: "10000000",
      actor,
    }),
    /permission_denied/,
  );

  const missingClient: MerchantEnterprisePublishedWorkflowStoreClient = {
    async rpc() {
      return {
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.faolla_list_merchant_enterprise_published_workflow_choices_v1 in the schema cache",
        },
      };
    },
  };
  await assert.rejects(
    loadMerchantEnterprisePublishedWorkflowChoices(missingClient, {
      siteId: "10000000",
      actor,
    }),
    /enterprise_schema_unavailable/,
  );
});
