import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantMembershipRecord } from "@/lib/merchantMemberships";
import {
  loadStoredMerchantMemberships,
  mergeStoredMerchantMembershipRows,
  saveStoredMerchantMemberships,
  type MerchantMembershipsStoreClient,
} from "@/lib/merchantMembershipsStore";

function createReadClient(result: { data: unknown; error: unknown }): MerchantMembershipsStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

function createMembership(updatedAt: string, nickname: string) {
  const membership = normalizeMerchantMembershipRecord({
    id: "membership-1",
    siteId: "10000000",
    siteName: "Test merchant",
    memberNo: "10000000000001",
    serial: 1,
    accountId: "account-1",
    nickname,
    joinedAt: "2026-07-01T00:00:00.000Z",
    updatedAt,
    status: "active",
  });
  assert.ok(membership);
  return membership;
}

test("membership store merges the newest copy of each member", () => {
  const merged = mergeStoredMerchantMembershipRows("10000000", [
    {
      id: "old-row",
      slug: "__merchant_memberships__:10000000",
      blocks: [createMembership("2026-07-01T00:00:00.000Z", "Old")],
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "new-row",
      slug: "__merchant_memberships__:10000000",
      blocks: [createMembership("2026-07-02T00:00:00.000Z", "Updated")],
      updated_at: "2026-07-02T00:00:00.000Z",
    },
  ]);

  assert.ok(merged);
  assert.equal(merged?.memberships.length, 1);
  assert.equal(merged?.memberships[0]?.nickname, "Updated");
  assert.equal(merged?.updatedAt, "2026-07-02T00:00:00.000Z");
});

test("membership store propagates unexpected read failures instead of reporting empty data", async () => {
  const client = createReadClient({ data: null, error: { message: "upstream timeout" } });
  await assert.rejects(
    () => loadStoredMerchantMemberships(client, "10000000"),
    /merchant_memberships_read_failed:upstream timeout/,
  );
});

test("membership store still treats a known legacy schema without slug as empty", async () => {
  const client = createReadClient({ data: null, error: { message: "column pages.slug does not exist" } });
  assert.equal(await loadStoredMerchantMemberships(client, "10000000"), null);
});

const STORE_VERSION = "2026-07-01T00:00:00.000Z";
const COMMIT_VERSION = "2026-09-08T10:00:00.001Z";

function createTransactionalClient(input: {
  existing?: ReturnType<typeof createMembership>[];
  version?: string | null;
  result?: { data?: unknown; error?: unknown };
  onRpc?: (name: string, args: Record<string, unknown>) => void;
} = {}) {
  const calls: string[] = [];
  const rows = input.existing ? [{
    id: "row-1", slug: "__merchant_memberships__:10000000",
    blocks: input.existing, updated_at: input.version ?? STORE_VERSION,
  }] : [];
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      if (column === "slug") assert.equal(value, "__merchant_memberships__:10000000");
      return query;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    update() { throw new Error("direct_update_forbidden"); },
    insert() { throw new Error("direct_insert_forbidden"); },
    delete() { throw new Error("direct_delete_forbidden"); },
  };
  const client: MerchantMembershipsStoreClient = {
    from(table) { assert.equal(table, "pages"); calls.push("read"); return query; },
    async rpc(name, args) {
      calls.push(name);
      input.onRpc?.(name, args);
      return name === "faolla_commit_order_membership_v1"
        ? input.result ?? { data: { updatedAt: COMMIT_VERSION }, error: null }
        : { data: {}, error: null };
    },
  };
  return { client, calls };
}

test("membership writes require an explicit version before accessing the store", async () => {
  const client: MerchantMembershipsStoreClient = {
    from() { throw new Error("read_before_version_check"); },
    async rpc() { throw new Error("write_before_version_check"); },
  };
  for (const version of [{}, { expectedUpdatedAt: undefined }, { expectedUpdatedAt: "" }, { expectedUpdatedAt: "   " }]) {
    const result = await saveStoredMerchantMemberships(client, {
      siteId: "10000000", memberships: [], ...version,
    } as Parameters<typeof saveStoredMerchantMemberships>[1]);
    assert.deepEqual(result, { error: "merchant_memberships_expected_version_required" });
  }
});

test("membership writes submit only a scoped normalized mutation to the atomic RPC", async () => {
  const current = createMembership(STORE_VERSION, "Before");
  const next = { ...current, nickname: "After" };
  const foreign = { ...next, id: "foreign", siteId: "20000000" };
  const { client, calls } = createTransactionalClient({
    existing: [current],
    onRpc(name, args) {
      assert.equal(name, "faolla_commit_order_membership_v1");
      assert.deepEqual(args, {
        p_site_id: "10000000",
        p_mutation: { memberships: { expectedUpdatedAt: STORE_VERSION, next: [next] } },
      });
    },
  });
  assert.deepEqual(await saveStoredMerchantMemberships(client, {
    siteId: " 10000000 ", memberships: [next, foreign], expectedUpdatedAt: STORE_VERSION,
  }), { error: null });
  assert.deepEqual(calls, ["read", "faolla_commit_order_membership_v1"]);
});

test("membership first creation explicitly sends a null expected version", async () => {
  const next = createMembership(STORE_VERSION, "New member");
  const { client } = createTransactionalClient({ onRpc(_name, args) {
    assert.deepEqual(args.p_mutation, { memberships: { expectedUpdatedAt: null, next: [next] } });
  } });
  assert.deepEqual(await saveStoredMerchantMemberships(client, {
    siteId: "10000000", memberships: [next], expectedUpdatedAt: null,
  }), { error: null });
});

test("membership stale version refuses before RPC and database CAS conflicts propagate", async () => {
  const member = createMembership(STORE_VERSION, "Member");
  const stale = createTransactionalClient({ existing: [member] });
  assert.deepEqual(await saveStoredMerchantMemberships(stale.client, {
    siteId: "10000000", memberships: [member], expectedUpdatedAt: "2026-06-01T00:00:00.000Z",
  }), { error: "merchant_memberships_conflict" });
  assert.deepEqual(stale.calls, ["read"]);
  const raced = createTransactionalClient({ existing: [member], result: {
    error: { message: "merchant_memberships_conflict" },
  } });
  assert.deepEqual(await saveStoredMerchantMemberships(raced.client, {
    siteId: "10000000", memberships: [member], expectedUpdatedAt: STORE_VERSION,
  }), { error: "merchant_memberships_conflict" });
  assert.deepEqual(raced.calls, ["read", "faolla_commit_order_membership_v1"]);
});

test("membership missing RPC, schema errors and ambiguous failures never fall back to direct writes", async () => {
  const member = createMembership(STORE_VERSION, "Member");
  for (const error of [
    { code: "PGRST202", message: "missing RPC" },
    { code: "42501", message: "permission denied" },
    { message: "column pages.updated_at does not exist" },
    { message: "internal database detail" },
  ]) {
    const { client, calls } = createTransactionalClient({ existing: [member], result: { error } });
    assert.deepEqual(await saveStoredMerchantMemberships(client, {
      siteId: "10000000", memberships: [member], expectedUpdatedAt: STORE_VERSION,
    }), { error: "merchant_transaction_unavailable" });
    assert.deepEqual(calls, ["read", "faolla_commit_order_membership_v1"]);
  }
  const missing = createTransactionalClient({ existing: [member] });
  delete missing.client.rpc;
  assert.deepEqual(await saveStoredMerchantMemberships(missing.client, {
    siteId: "10000000", memberships: [member], expectedUpdatedAt: STORE_VERSION,
  }), { error: "merchant_transaction_unavailable" });
  const transport = createTransactionalClient({ existing: [member] });
  transport.client.rpc = async () => { throw new Error("response_lost_after_commit"); };
  assert.deepEqual(await saveStoredMerchantMemberships(transport.client, {
    siteId: "10000000", memberships: [member], expectedUpdatedAt: STORE_VERSION,
  }), { error: "merchant_transaction_unavailable" });
});

test("membership ledger mirroring occurs only after a confirmed transaction commit", async () => {
  const envKeys = ["MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_MODE", "MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_SITE_IDS"] as const;
  const original = envKeys.map((key) => process.env[key]);
  process.env[envKeys[0]] = "shadow";
  process.env[envKeys[1]] = "10000000";
  try {
    const current = createMembership(STORE_VERSION, "Before");
    const next = { ...current, pointBalance: 100 };
    for (const succeeds of [false, true]) {
      const { client, calls } = createTransactionalClient({
        existing: [current],
        result: succeeds ? { data: { updatedAt: COMMIT_VERSION } } : { error: { message: "merchant_memberships_conflict" } },
      });
      await saveStoredMerchantMemberships(client, {
        siteId: "10000000", memberships: [next], expectedUpdatedAt: STORE_VERSION,
      });
      assert.deepEqual(calls, [
        "read", "faolla_commit_order_membership_v1",
        ...(succeeds ? ["faolla_upsert_merchant_membership_ledger_v1"] : []),
      ]);
    }
  } finally {
    envKeys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
});
