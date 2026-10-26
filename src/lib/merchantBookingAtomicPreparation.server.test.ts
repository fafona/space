import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingAtomicCommandIdentity, executeAtomicBookingCommand,
  type BookingAtomicPlan, type BookingAtomicRpc,
} from "./merchantBookingAtomicPreparation.server";

const identity = {
  siteId: "shop", principalScope: "customer:123",
  nonce: "647e0a78-2eb8-4874-a9d6-ced4f5878450", semanticInput: { operation: "create", time: "2030-01-01T12:00" },
};
const snapshot = { replayed: false, generation: "test-generation", revision: "0", rows: [] };
const plan: BookingAtomicPlan = { next: { version: 1, records: [] }, result: { bookingId: "one" }, mailJobs: [] };

test("command identity is stable across JSON key order but bound to site, principal, nonce and input", () => {
  const first = bookingAtomicCommandIdentity(identity);
  const reordered = bookingAtomicCommandIdentity({ ...identity, semanticInput: { time: "2030-01-01T12:00", operation: "create" } });
  assert.deepEqual(first, reordered);
  for (const change of [{ siteId: "another" }, { principalScope: "customer:456" }, { nonce: "647e0a78-2eb8-4874-a9d6-ced4f5878451" }]) {
    assert.notEqual(bookingAtomicCommandIdentity({ ...identity, ...change }).p_command_key, first.p_command_key);
  }
  assert.notEqual(bookingAtomicCommandIdentity({ ...identity, semanticInput: { operation: "cancel" } }).p_request_hash, first.p_request_hash);
  assert.throws(() => bookingAtomicCommandIdentity({ ...identity, nonce: "client-counter-1" }), /invalid_command/);
  assert.throws(() => bookingAtomicCommandIdentity({ ...identity, semanticInput: { invalid: Number.NaN } }), /invalid_input/);
});

test("CAS conflict reauthorizes and replans from a fresh snapshot, without altering expected rows", async () => {
  const seen: string[] = [];
  let reads = 0;
  const rpc: BookingAtomicRpc = async (name, args) => {
    if (name.includes("snapshot")) {
      reads++;
      return { data: { ...snapshot, revision: String(reads) }, error: null };
    }
    const mutation = args.p_mutation as Record<string, unknown>;
    assert.equal(mutation.replayed, undefined);
    assert.deepEqual(mutation.rows, []);
    assert.equal(mutation.revision, String(reads));
    return reads === 1 ? { data: null, error: { message: "booking_atomic_conflict" } }
      : { data: { replayed: false, result: plan.result }, error: null };
  };
  const result = await executeAtomicBookingCommand({ rpc, identity,
    authorize: async () => { seen.push("authorize"); },
    plan: async (current) => { seen.push(`plan:${current.revision}`); current.rows.push({ id: "mutated", slug: "x", blocks: null, updated_at: null }); return plan; },
  });
  assert.deepEqual(seen, ["authorize", "plan:1", "authorize", "plan:2"]);
  assert.deepEqual(result.result, plan.result);
});

test("idempotent replay still authorizes, and never replans an already completed booking", async () => {
  let authorized = 0;
  let calls = 0;
  const result = await executeAtomicBookingCommand({ identity,
    authorize: async () => { authorized++; },
    rpc: async () => { calls++; return { data: { replayed: true, result: plan.result }, error: null }; },
    plan: async () => { throw new Error("must_not_replan_full_slot"); },
  });
  assert.equal(authorized, 1);
  assert.equal(calls, 1);
  assert.equal(result.replayed, true);
  await assert.rejects(executeAtomicBookingCommand({ identity,
    authorize: async () => { throw new Error("access_revoked"); },
    rpc: async () => { throw new Error("must_not_lookup"); }, plan: async () => plan,
  }), /access_revoked/);
});

test("unknown commit outcome fails closed with no retry or legacy fallback; same identity can recover later", async () => {
  let calls = 0;
  await assert.rejects(executeAtomicBookingCommand({ identity, authorize: async () => {}, plan: async () => plan,
    rpc: async (name) => {
      calls++;
      return name.includes("snapshot") ? { data: snapshot, error: null }
        : { data: null, error: { message: "provider body contains private@example.invalid" } };
    },
  }), /^Error: booking_atomic_storage_unconfirmed$/);
  assert.equal(calls, 2);
  await assert.rejects(executeAtomicBookingCommand({ identity, authorize: async () => {}, plan: async () => plan,
    rpc: async () => { throw new Error("transport body contains private@example.invalid"); },
  }), /^Error: booking_atomic_storage_unconfirmed$/);
});

test("conflict retry is bounded and reruns business validation instead of forcing stale capacity", async () => {
  let plans = 0;
  await assert.rejects(executeAtomicBookingCommand({ identity, authorize: async () => {},
    plan: async () => { plans++; if (plans === 2) throw new Error("slot_full"); return plan; },
    rpc: async (name) => name.includes("snapshot") ? { data: snapshot, error: null }
      : { data: null, error: { message: "booking_atomic_conflict" } },
  }), /slot_full/);
  assert.equal(plans, 2);
  let commits = 0;
  await assert.rejects(executeAtomicBookingCommand({ identity, authorize: async () => {}, plan: async () => plan,
    rpc: async (name) => name.includes("snapshot") ? { data: snapshot, error: null }
      : (commits++, { data: null, error: { message: "booking_atomic_conflict" } }),
  }), /booking_atomic_conflict/);
  assert.equal(commits, 3);
});

test("malformed storage receipts and replay results cannot be reported as successful commands", async () => {
  for (const data of [{ unexpected: true }, { replayed: false }, { replayed: true, result: [] }]) {
    await assert.rejects(executeAtomicBookingCommand({ identity, authorize: async () => {}, plan: async () => plan,
      rpc: async (name) => ({ data: name.includes("snapshot") ? snapshot : data, error: null }),
    }), /booking_atomic_invalid_storage_response/);
  }
  await assert.rejects(executeAtomicBookingCommand({ identity, authorize: async () => {}, plan: async () => plan,
    rpc: async () => ({ data: { replayed: true, result: null }, error: null }),
  }), /booking_atomic_invalid_storage_response/);
});
