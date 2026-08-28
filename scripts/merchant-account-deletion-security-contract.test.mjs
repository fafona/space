import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../src/app/api/super-admin/merchant-accounts/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("merchant deletion authenticates before reading or mutating accounts", () => {
  const deleteHandler = source.slice(source.indexOf("export async function DELETE"));
  assert.match(deleteHandler, /if \(!\(await ensureAuthorized\(request\)\)\)/);
  assert.ok(
    deleteHandler.indexOf("await ensureAuthorized(request)") <
      deleteHandler.indexOf("createServerSupabaseClient()"),
  );
});

test("merchant deletion binds the exact database owner and blocks enterprise dependencies", () => {
  const deleteHandler = source.slice(source.indexOf("export async function DELETE"));
  assert.match(
    deleteHandler,
    /id,user_id,auth_user_id,owner_user_id,owner_id,auth_id,created_by,created_by_user_id/,
  );
  assert.match(deleteHandler, /resolveMerchantDeletionOwnerAuthUserId/);
  assert.match(deleteHandler, /merchant_owner_binding_invalid/);
  assert.match(deleteHandler, /merchant_owner_mismatch/);
  assert.match(deleteHandler, /merchant_enterprise_employees/);
  assert.match(deleteHandler, /merchant_enterprise_roles/);
  assert.match(deleteHandler, /merchant_enterprise_deprovision_required/);
});

test("merchant tenant deletion precedes the irreversible owner auth deletion", () => {
  const deleteHandler = source.slice(source.indexOf("export async function DELETE"));
  const tenantDelete = deleteHandler.indexOf(
    '.from("merchants")\n            .delete()',
  );
  const authDelete = deleteHandler.indexOf(
    "supabase.auth.admin.deleteUser(resolvedAuthUserId)",
  );
  assert.ok(tenantDelete >= 0 && authDelete > tenantDelete);
  assert.match(
    deleteHandler,
    /accountType === "merchant" && !isMerchantNumericId\(accountId\)/,
  );
  for (const ownerColumn of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(
      deleteHandler,
      new RegExp(`\\.eq\\("${ownerColumn}", resolvedAuthUserId\\)`),
    );
  }
  assert.match(
    deleteHandler,
    /\.select\("id"\)[\s\S]+\.maybeSingle\(\)[\s\S]+if \(!deletedMerchant\)[\s\S]+merchant_delete_conflict/,
  );
});
