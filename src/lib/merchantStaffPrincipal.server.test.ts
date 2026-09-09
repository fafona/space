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
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(
      source,
      /auth\.getUser\(accessToken\)[\s\S]{0,500}assertLegacyMerchantIdentityAllowed\(/,
      relativePath,
    );
  });
});

test("chat token handlers bind the real staff guard and await its acceptance before owner lookup", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/api/merchant-chat-business-card/route.ts"), "utf8");
  assert.match(source, /import \{ assertLegacyMerchantIdentityAllowed \} from "@\/lib\/merchantStaffPrincipal\.server"/);
  const defaultsStart = source.indexOf("const defaultDependencies:");
  const defaultsEnd = source.indexOf("function normalizeText(", defaultsStart);
  assert.ok(defaultsStart >= 0 && defaultsEnd > defaultsStart);
  assert.match(source.slice(defaultsStart, defaultsEnd), /assertLegacyIdentityAllowed:\s*assertLegacyMerchantIdentityAllowed\s*,/);

  const authorizationStart = source.indexOf("async function isAuthorizedForMerchant(");
  const authorizationEnd = source.indexOf("async function resolveMerchantName(", authorizationStart);
  assert.ok(authorizationStart >= 0 && authorizationEnd > authorizationStart);
  const authorization = source.slice(authorizationStart, authorizationEnd);
  const authenticate = authorization.indexOf("await supabase.auth.getUser(accessToken)");
  const guard = authorization.indexOf("await dependencies.assertLegacyIdentityAllowed(");
  const refusal = authorization.indexOf("if (!legacyIdentityAllowed) continue;");
  const ownerLookup = authorization.indexOf("await getAuthorizedMerchantIds(");
  assert.ok(authenticate >= 0 && guard > authenticate && refusal > guard && ownerLookup > refusal,
    "a verified token must pass the staff guard before its aliases can authorize an owner");
  assert.match(authorization.slice(guard, refusal), /authResult\.data\.user,[\s\S]*\)\.then\(\s*\(\) => true,\s*\(\) => false,/,
    "staff or unavailable-authority rejection must fail closed, not authorize legacy aliases");

  // A mockable handler is safe only if the actual Next exports use the real
  // default dependencies and select the intended read/write policy.
  for (const [method, suffix, access] of [["GET", "Get", "read"], ["POST", "Post", "write"]] as const) {
    assert.match(source, new RegExp(`export async function handleMerchantChatBusinessCard${suffix}\\(\\s*request: Request,\\s*dependencies: MerchantChatBusinessCardDependencies = defaultDependencies,`));
    assert.match(source, new RegExp(`export async function ${method}\\(request: Request\\) \\{\\s*return handleMerchantChatBusinessCard${suffix}\\(request\\);\\s*\\}`));
    const start = source.indexOf(`export async function handleMerchantChatBusinessCard${suffix}(`);
    const nextExport = source.indexOf("export async function ", start + 1);
    assert.match(source.slice(start, nextExport), new RegExp(`await isAuthorizedForMerchant\\(request, supabase, merchantId, "${access}", dependencies\\)`));
  }
});
