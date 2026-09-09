import assert from "node:assert/strict";
import test from "node:test";
import {
  PLATFORM_SNAPSHOT_ATOMIC_SCOPES,
  PlatformSnapshotAtomicError,
  commitPlatformSnapshotAtomic,
  readPlatformSnapshotAtomic,
  type PlatformSnapshotAtomicClient,
  type PlatformSnapshotAtomicExpected,
  type PlatformSnapshotAtomicScope,
  type PlatformSnapshotAtomicView,
  type PlatformSnapshotAtomicWrite,
  type PlatformSnapshotJson,
} from "./platformSnapshotAtomic.server";

const invalid = "platform_snapshot_atomic_invalid_request";
const unconfirmed = "platform_snapshot_atomic_write_unconfirmed";
const stamp = "2026-09-08T12:34:56.123456+00:00";

function fixture(scope: PlatformSnapshotAtomicScope = "backup_catalog") {
  const expected: PlatformSnapshotAtomicExpected[] = PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].map((slug, index) => ({
    slug,
    row: {
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      blocks: slug.startsWith("__platform_support_inbox_history") ? { entries: [], version: 1 } : [{ id: "original", raw: { future: [false, 0, null, ""] } }],
      updatedAt: stamp,
    },
  }));
  const writes: PlatformSnapshotAtomicWrite[] = expected.map(({ slug, row }) => ({ slug, blocks: structuredClone(row!.blocks) }));
  const view: PlatformSnapshotAtomicView = { version: 1, scope, rows: structuredClone(expected) };
  return { scope, expected, writes, view };
}
type Fixture = ReturnType<typeof fixture>;

async function rejectsSafely(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PlatformSnapshotAtomicError);
    assert.equal(error.message, code);
    assert.equal(error.retrySafe, false);
    assert.equal(Object.hasOwn(error, "cause"), false);
    return true;
  });
}

function stub(response: unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: PlatformSnapshotAtomicClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return response as { data?: unknown; error?: unknown };
    },
  };
  return { client, calls };
}

async function rejectsBeforeRpc(plan: Fixture) {
  const mock = stub({ data: plan.view, error: null });
  await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), invalid);
  assert.equal(mock.calls.length, 0);
}

test("unknown, prototype and coercible scopes cannot reach either RPC", async () => {
  for (const scope of ["__proto__", "constructor", "toString", "all", "backup_catalog ", null, 1, { toString: () => "backup_catalog" }]) {
    const mock = stub({ data: fixture().view, error: null });
    await rejectsSafely(readPlatformSnapshotAtomic(mock.client, scope as PlatformSnapshotAtomicScope), invalid);
    await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, scope as PlatformSnapshotAtomicScope, [], []), invalid);
    assert.equal(mock.calls.length, 0);
  }
});

test("incomplete, reordered or duplicate physical vectors never become partial writes", async () => {
  const mutations: ((plan: Fixture) => void)[] = [
    ({ expected }) => { expected.pop(); },
    ({ writes }) => { writes.pop(); },
    ({ expected }) => { expected.reverse(); },
    ({ writes }) => { writes.reverse(); },
    ({ expected }) => { expected.push(structuredClone(expected[0])); },
    ({ writes }) => { writes.push(structuredClone(writes[0])); },
    ({ expected }) => { expected[1].slug = expected[0].slug; },
    ({ writes }) => { writes[1].slug = writes[0].slug; },
    ({ expected }) => { expected[1].row!.id = expected[0].row!.id; },
  ];
  for (const mutate of mutations) {
    const plan = fixture(); mutate(plan); await rejectsBeforeRpc(plan);
  }
});

test("scope, merchant ownership and unrecognized metadata cannot be smuggled into a physical entry", async () => {
  const mutations: ((plan: Fixture) => void)[] = [
    ({ expected }) => { Object.assign(expected[0], { merchant_id: "10000000" }); },
    ({ expected }) => { Object.assign(expected[0].row!, { merchant_id: null }); },
    ({ expected }) => { Object.assign(expected[0].row!, { createdAt: stamp }); },
    ({ writes }) => { Object.assign(writes[0], { id: "00000000-0000-0000-0000-000000000009" }); },
    ({ writes }) => { Object.assign(writes[0], { scope: "user_manage" }); },
    ({ expected }) => { delete (expected[0] as Partial<PlatformSnapshotAtomicExpected>).row; },
    ({ expected }) => { delete (expected[0].row! as Partial<NonNullable<PlatformSnapshotAtomicExpected["row"]>>).updatedAt; },
  ];
  for (const mutate of mutations) {
    const plan = fixture(); mutate(plan); await rejectsBeforeRpc(plan);
  }
});

test("physical identities and timestamps are required as exact scalar types", async () => {
  for (const id of ["", "0001", " 00000000-0000-0000-0000-000000000001", 1, null, false]) {
    const plan = fixture(); plan.expected[0].row!.id = id as string; await rejectsBeforeRpc(plan);
  }
  for (const updatedAt of [undefined, 0, false, "", "infinity", "2026-09-08", "2026-09-08T12:34:56", "2026-09-08T12:34:56.1234567Z"] ) {
    const plan = fixture(); plan.expected[0].row!.updatedAt = updatedAt as string; await rejectsBeforeRpc(plan);
  }
});

test("history object and block array shapes cannot be interchanged or normalized", async () => {
  for (const scope of Object.keys(PLATFORM_SNAPSHOT_ATOMIC_SCOPES) as PlatformSnapshotAtomicScope[]) {
    for (let index = 0; index < PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].length; index++) {
      const wrong: PlatformSnapshotJson = PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope][index].startsWith("__platform_support_inbox_history") ? [] : {};
      const expectedPlan = fixture(scope); expectedPlan.expected[index].row!.blocks = wrong; await rejectsBeforeRpc(expectedPlan);
      const writesPlan = fixture(scope); writesPlan.writes[index].blocks = wrong; await rejectsBeforeRpc(writesPlan);
    }
  }
});

test("non-JSON numbers, undefined and executable values are rejected before RPC", async () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, BigInt(1), () => 1, Symbol("secret")]) {
    const plan = fixture(); plan.writes[0].blocks = [{ value }] as unknown as PlatformSnapshotJson; await rejectsBeforeRpc(plan);
  }
});

test("accessors, symbols and hidden properties cannot be silently stripped from the CAS snapshot", async () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "private", { enumerable: true, get: () => { getterCalls++; return "private"; } });
  const hidden = Object.defineProperty({}, "private", { value: "private", enumerable: false });
  const symbolic = { [Symbol("private")]: "private" };
  for (const value of [accessor, hidden, symbolic]) {
    const plan = fixture(); plan.writes[0].blocks = [value] as PlatformSnapshotJson; await rejectsBeforeRpc(plan);
  }
  assert.equal(getterCalls, 0);
});

test("a plain object's hidden length is not confused with a native array length", async () => {
  const plan = fixture("support_messages");
  plan.writes[1].blocks = Object.defineProperty({ entries: [] }, "length", { value: "must-not-disappear", enumerable: false });
  await rejectsBeforeRpc(plan);
});

test("array holes, extra properties, class objects, cycles and excessive nesting fail closed", async () => {
  const sparse = Array<unknown>(2); sparse[1] = null;
  const extra = Object.assign([1], { private: "must-not-disappear" });
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let deep: unknown = null;
  for (let index = 0; index < 70; index++) deep = [deep];
  for (const value of [sparse, extra, new Date(stamp), new Map([["a", 1]]), cyclic, deep]) {
    const plan = fixture(); plan.writes[0].blocks = [value] as PlatformSnapshotJson; await rejectsBeforeRpc(plan);
  }
});

test("read responses with a corrupt scope, shape or duplicate physical identity are not usable baselines", async () => {
  const mutations: ((view: PlatformSnapshotAtomicView) => void)[] = [
    (view) => { view.scope = "user_manage"; },
    (view) => { Object.assign(view, { version: "1" }); },
    (view) => { Object.assign(view, { partial: false }); },
    (view) => { view.rows.pop(); },
    (view) => { view.rows.reverse(); },
    (view) => { view.rows[1].row!.id = view.rows[0].row!.id; },
    (view) => { view.rows[0].row!.blocks = {}; },
    (view) => { Object.assign(view.rows[0].row!, { merchant_id: "other" }); },
  ];
  for (const mutate of mutations) {
    const { view } = fixture(); mutate(view);
    const mock = stub({ data: view, error: null });
    await rejectsSafely(readPlatformSnapshotAtomic(mock.client, "backup_catalog"), unconfirmed);
    assert.equal(mock.calls.length, 1);
  }
});

test("a commit ACK cannot replace an existing row, change a payload or omit a supposedly written row", async () => {
  const mutations: ((view: PlatformSnapshotAtomicView) => void)[] = [
    (view) => { view.rows[0].row = null; },
    (view) => { view.rows[0].row!.id = "00000000-0000-0000-0000-999999999999"; },
    (view) => { view.rows[0].row!.blocks = []; },
    (view) => { view.rows[0].row!.updatedAt = "2026-09-08T12:34:56.123457+00:00"; },
    (view) => { view.rows[0].row!.updatedAt = null; },
    (view) => { view.rows.reverse(); },
  ];
  for (const mutate of mutations) {
    const plan = fixture(); mutate(plan.view);
    const mock = stub({ data: plan.view, error: null });
    await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), unconfirmed);
    assert.equal(mock.calls.length, 1);
  }
});

test("equivalent PostgreSQL timestamp offsets are accepted without losing microseconds", async () => {
  const plan = fixture();
  plan.expected[0].row!.updatedAt = "2026-09-08T14:34:56.123456+02:00";
  plan.expected[1].row!.updatedAt = "2026-09-08T12:34:56.123456Z";
  const mock = stub({ data: plan.view, error: null });
  assert.deepEqual(await commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), plan.view);
  assert.equal((mock.calls[0].args.p_expected as PlatformSnapshotAtomicExpected[])[0].row!.updatedAt, "2026-09-08T14:34:56.123456+02:00");
});

test("offset equivalence cannot hide a one-microsecond no-op version change", async () => {
  const plan = fixture();
  plan.expected[0].row!.updatedAt = "2026-09-08T14:34:56.123456+02:00";
  plan.view.rows[0].row!.updatedAt = "2026-09-08T12:34:56.123457+00:00";
  const mock = stub({ data: plan.view, error: null });
  await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), unconfirmed);
  assert.equal(mock.calls.length, 1);
});

test("missing or ambiguous RPC envelopes never count as a successful commit", async () => {
  const { view } = fixture();
  for (const response of [undefined, null, {}, { data: view }, { data: view, error: false }, { data: view, error: 0 },
    { data: view, error: "" }, { data: null, error: null }, { data: undefined, error: null }, { data: false, error: null },
    { data: [], error: null }, { data: { ...view, rows: [] }, error: null }]) {
    const plan = fixture(); const mock = stub(response);
    await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), unconfirmed);
    assert.equal(mock.calls.length, 1);
  }
});

test("only exact P0001 safe codes with a null data result can escape the generic sanitizer", async () => {
  for (const code of [invalid, unconfirmed, "platform_snapshot_atomic_conflict", "platform_snapshot_atomic_store_corrupt"]) {
    const plan = fixture(); const mock = stub({ data: null, error: { code: "P0001", message: code, detail: "private-user@example.invalid" } });
    await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), code);
    assert.equal(mock.calls.length, 1);
  }
});

test("SQL, permission, missing-function and spoofed business errors reveal no private details and never fallback", async () => {
  const { view } = fixture();
  const responses = [
    { data: null, error: { code: "23505", message: "duplicate private-user@example.invalid", detail: "private row" } },
    { data: null, error: { code: "42501", message: "permission denied on private table" } },
    { data: null, error: { code: "PGRST202", message: "missing function private-secret" } },
    { data: null, error: { code: "P0001", message: "platform_snapshot_atomic_conflict private-user@example.invalid" } },
    { data: null, error: { code: "P0002", message: "platform_snapshot_atomic_conflict" } },
    { data: view, error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } },
    { error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } },
    { data: null, error: new Error("private-user@example.invalid") },
  ];
  for (const response of responses) {
    const plan = fixture(); const mock = stub(response);
    await rejectsSafely(commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes), unconfirmed);
    assert.equal(mock.calls.length, 1);
  }
});

test("transport rejection after a possible commit is sanitized without replay or direct table writes", async () => {
  let calls = 0;
  const client = {
    rpc: async () => { calls++; throw new Error("private database URL or member identity"); },
    from: () => { assert.fail("the candidate adapter must not issue a legacy table write"); },
  };
  const plan = fixture();
  await rejectsSafely(commitPlatformSnapshotAtomic(client, plan.scope, plan.expected, plan.writes), unconfirmed);
  assert.equal(calls, 1);
});

test("a null-prototype JSON object and own __proto__ data stay raw without prototype pollution", async () => {
  const plan = fixture("support_messages");
  const raw = Object.assign(Object.create(null) as Record<string, PlatformSnapshotJson>, JSON.parse('{"entries":[],"__proto__":{"admin":true},"constructor":"raw","toString":false}'));
  plan.expected[1].row!.blocks = raw; plan.writes[1].blocks = raw; plan.view.rows[1].row!.blocks = JSON.parse(JSON.stringify(raw));
  const mock = stub({ data: plan.view, error: null });
  const result = await commitPlatformSnapshotAtomic(mock.client, plan.scope, plan.expected, plan.writes);
  assert.deepEqual(result.rows[1].row!.blocks, plan.view.rows[1].row!.blocks);
  assert.equal(Object.hasOwn(Object.prototype, "admin"), false);
});
