import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertLegacyMerchantIdentityAllowed,
  hasImmutableMerchantStaffPrincipal,
  isMerchantStaffPrincipal,
  MerchantStaffPrincipalError,
} from "@/lib/merchantStaffPrincipal.server";

function createStaffLookupClient(
  rows: Array<{ id: string }>,
  error: Error | null = null,
) {
  return {
    from(table: string) {
      assert.equal(table, "merchant_enterprise_employees");
      return {
        select(columns: string) {
          assert.equal(columns, "id");
          return {
            eq(column: string, value: string) {
              assert.equal(column, "auth_user_id");
              assert.ok(value);
              return {
                async limit(count: number) {
                  assert.equal(count, 1);
                  return { data: rows, error };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("merchant staff marker is trusted only from immutable app metadata", async () => {
  assert.equal(
    hasImmutableMerchantStaffPrincipal({
      id: "user-1",
      app_metadata: { principal_type: "merchant_staff" },
    }),
    true,
  );
  assert.equal(
    hasImmutableMerchantStaffPrincipal({
      id: "user-1",
      app_metadata: {},
      user_metadata: { principal_type: "merchant_staff" },
    }),
    false,
  );
  assert.equal(
    await isMerchantStaffPrincipal(null, {
      id: "user-1",
      app_metadata: {},
      user_metadata: { principal_type: "merchant_staff" },
    }),
    true,
  );
});

test("merchant staff lookup blocks a database-linked employee without metadata", async () => {
  const client = createStaffLookupClient([{ id: "employee-1" }]);
  assert.equal(
    await isMerchantStaffPrincipal(client, {
      id: "11111111-1111-4111-8111-111111111111",
      app_metadata: {},
    }),
    true,
  );
  await assert.rejects(
    () =>
      assertLegacyMerchantIdentityAllowed(client, {
        id: "11111111-1111-4111-8111-111111111111",
        app_metadata: {},
      }),
    (error: unknown) =>
      error instanceof MerchantStaffPrincipalError &&
      error.code === "merchant_staff_identity_forbidden" &&
      error.status === 403,
  );
});

test("merchant staff lookup fails closed when the authoritative check is unavailable", async () => {
  await assert.rejects(
    () =>
      assertLegacyMerchantIdentityAllowed(
        createStaffLookupClient([], new Error("database unavailable")),
        {
          id: "22222222-2222-4222-8222-222222222222",
          app_metadata: {},
        },
      ),
    (error: unknown) =>
      error instanceof MerchantStaffPrincipalError &&
      error.code === "merchant_staff_check_unavailable" &&
      error.status === 503,
  );
});

test("legacy owner-only token routes apply the staff principal guard", () => {
  [
    "src/app/api/publish/route.ts",
    "src/app/api/merchant-draft/route.ts",
    "src/app/api/merchant-domain-binding/route.ts",
    "src/app/api/merchant-chat-business-card/route.ts",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(
      source,
      /auth\.getUser\(accessToken\)[\s\S]{0,500}assertLegacyMerchantIdentityAllowed\(/,
      relativePath,
    );
  });
});
