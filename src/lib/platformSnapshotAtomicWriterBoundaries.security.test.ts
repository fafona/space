import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { saveMerchantSnapshotHistory, type MerchantSnapshotHistoryStoreClient } from "./merchantSnapshotHistoryStore";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES } from "./platformSnapshotAtomic.server";
import { getPlatformSnapshotWriteMode, PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID } from "./platformSnapshotAtomicMode.server";

const allSlugs = Object.values(PLATFORM_SNAPSHOT_ATOMIC_SCOPES).flat();
const modeVariable = "FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE";

async function withMode(mode: string | undefined, callback: () => Promise<void>) {
  const previous = process.env[modeVariable];
  try {
    if (mode === undefined) delete process.env[modeVariable];
    else process.env[modeVariable] = mode;
    await callback();
  } finally {
    if (previous === undefined) delete process.env[modeVariable];
    else process.env[modeVariable] = previous;
  }
}

function forbiddenClient() {
  const calls: string[] = [];
  const client: MerchantSnapshotHistoryStoreClient = {
    from: (table) => { calls.push(table); throw new Error("local-test-database-access-forbidden"); },
  };
  return { calls, client };
}

const input = {
  siteId: "platform-support-inbox", slug: "__platform_support_inbox_history__", backupSlug: "__platform_support_inbox_history_backup__",
  source: "test-only", before: { threads: [] }, after: { threads: [] }, merchantId: null,
};

test("atomic mode rejects all eleven protected slugs through either generic history argument before any I/O", async () => {
  await withMode("atomic", async () => {
    for (const slug of allSlugs) {
      for (const property of ["slug", "backupSlug"] as const) {
        for (const requireAllWrites of [false, true]) {
          const mock = forbiddenClient();
          const result = await saveMerchantSnapshotHistory(mock.client, {
            ...input, slug: "unrelated-main", backupSlug: "unrelated-backup", [property]: slug, requireAllWrites,
          });
          assert.deepEqual(result, { error: "platform_snapshot_atomic_direct_write_forbidden" });
          assert.deepEqual(mock.calls, []);
        }
      }
    }
  });
});

test("invalid mode cannot bypass the protected generic writer via normal or restore-only strict paths", async () => {
  for (const mode of ["ATOMIC", " atomic", "atomic ", "true", "on", "maintenance", "private-value-that-must-not-be-returned"]) {
    await withMode(mode, async () => {
      for (const requireAllWrites of [false, true]) {
        const mock = forbiddenClient();
        assert.deepEqual(await saveMerchantSnapshotHistory(mock.client, { ...input, requireAllWrites }), {
          error: PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID,
        });
        assert.deepEqual(mock.calls, []);
      }
    });
  }
});

test("normalization of a protected slug cannot bypass the atomic gate", async () => {
  await withMode("atomic", async () => {
    const mock = forbiddenClient();
    const result = await saveMerchantSnapshotHistory(mock.client, { ...input, slug: ` ${input.slug}\n`, backupSlug: "other" });
    assert.deepEqual(result, { error: "platform_snapshot_atomic_direct_write_forbidden" });
    assert.deepEqual(mock.calls, []);
  });
});

test("default, empty and explicit off keep the existing generic history branch available", async () => {
  for (const mode of [undefined, "", "off"]) {
    await withMode(mode, async () => {
      const mock = forbiddenClient();
      await assert.rejects(saveMerchantSnapshotHistory(mock.client, input), /local-test-database-access-forbidden/);
      assert.ok(mock.calls.length > 0, "off selects the original writer; the fake prevents actual persistence");
    });
  }
});

test("atomic rollout does not accidentally block unrelated merchant history stores", async () => {
  for (const mode of ["atomic", "invalid"]) {
    await withMode(mode, async () => {
      const mock = forbiddenClient();
      await assert.rejects(saveMerchantSnapshotHistory(mock.client, {
        ...input, siteId: "10000000", merchantId: "10000000",
        slug: "__merchant_catalog_history__:10000000", backupSlug: "__merchant_catalog_history_backup__:10000000",
      }), /local-test-database-access-forbidden/);
      assert.ok(mock.calls.length > 0);
    });
  }
});

test("only explicit supported server modes are accepted; typos never silently select off", () => {
  assert.equal(getPlatformSnapshotWriteMode({}), "off");
  assert.equal(getPlatformSnapshotWriteMode({ [modeVariable]: "" }), "off");
  assert.equal(getPlatformSnapshotWriteMode({ [modeVariable]: "off" }), "off");
  assert.equal(getPlatformSnapshotWriteMode({ [modeVariable]: "atomic" }), "atomic");
  for (const mode of ["false", "0", "OFF", "Atomic", " atomic ", "\n", "maintenance"]) {
    assert.throws(() => getPlatformSnapshotWriteMode({ [modeVariable]: mode }), (error: unknown) => {
      assert.ok(error instanceof Error); assert.equal(error.message, PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID); return true;
    });
  }
});

test("domain-binding checks actor and invalid mode before its independent page/name writes", () => {
  const source = readFileSync(new URL("../app/api/merchant-domain-binding/route-handler.ts", import.meta.url), "utf8");
  const post = source.slice(source.indexOf("export async function POST("));
  const sameOrigin = post.indexOf("isTrustedSameOriginMutationRequest(request)");
  const authorize = post.indexOf("await isAuthorizedForMerchant(request, supabase, merchantId)");
  const mode = post.indexOf("getPlatformSnapshotWriteMode()");
  const firstWrite = post.indexOf("await updateMerchantSlug(");
  assert.ok(sameOrigin >= 0 && authorize > sameOrigin && mode > authorize && firstWrite > mode);
  assert.match(post.slice(mode, firstWrite), /PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID[\s\S]*status: 503/);
});

test("guest merge checks invalid support mode before any independent order/booking attachments", () => {
  const source = readFileSync(new URL("../app/api/personal-guest-merge/route.ts", import.meta.url), "utf8");
  const post = source.slice(source.indexOf("export async function POST("));
  const sameOrigin = post.indexOf("isTrustedSameOriginMutationRequest(request)");
  const authorize = post.indexOf("await resolvePersonalAccountSessionFromRequest(request)");
  const normalize = post.indexOf("const supportMessages = normalizeSupportMessages(");
  const mode = post.indexOf("getPlatformSnapshotWriteMode()");
  const orders = post.indexOf("attachPersonalMerchantOrdersByGuestHash({");
  const bookings = post.indexOf("attachPersonalMerchantBookingsByGuestHash({");
  assert.ok(sameOrigin >= 0 && authorize > sameOrigin && normalize > authorize && mode > normalize);
  assert.ok(orders > mode && bookings > mode);
  assert.match(post.slice(normalize, mode), /if \(supportMessages\.length > 0\)/);
  assert.match(post.slice(mode, orders), /PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID[\s\S]*status: 503/);
});
