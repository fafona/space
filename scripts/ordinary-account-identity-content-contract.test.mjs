import assert from "node:assert/strict";
import test from "node:test";

import {
  isOrdinaryAccountIdentityContentSha256,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_PATTERN,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SELECT_SQL,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_FIELDS,
} from "./ordinary-account-identity-content-contract.mjs";

test("ordinary identity content SQL freezes every identity-bearing row with canonical multiplicity", () => {
  assert.equal(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY,
    "ordinaryIdentityContentSha256",
  );
  assert.equal(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_PATTERN.source,
    "^[0-9a-f]{64}$",
  );
  for (const relation of [
    "auth.users",
    "public.merchants",
    "public.faolla_personal_accounts",
    "public.merchant_enterprise_staff_identities",
    "public.merchant_enterprise_employees",
  ]) {
    assert.match(
      ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
      new RegExp(relation.replaceAll(".", "\\.")),
    );
  }
  assert.deepEqual(ORDINARY_ACCOUNT_IDENTITY_CONTENT_FIELDS, [
    "auth.users.id",
    "public.merchants.id",
    "public.merchants.user_id",
    "public.merchants.auth_user_id",
    "public.merchants.owner_user_id",
    "public.merchants.owner_id",
    "public.merchants.auth_id",
    "public.merchants.created_by",
    "public.merchants.created_by_user_id",
    "public.faolla_personal_accounts.auth_user_id",
    "public.faolla_personal_accounts.personal_account_id",
    "public.faolla_personal_accounts.status",
    "public.merchant_enterprise_staff_identities.auth_user_id",
    "public.merchant_enterprise_employees.auth_user_id",
  ]);
  for (const [alias, column] of [
    ["identity", "id"],
    ["merchant", "id"],
    ["merchant", "user_id"],
    ["merchant", "auth_user_id"],
    ["merchant", "owner_user_id"],
    ["merchant", "owner_id"],
    ["merchant", "auth_id"],
    ["merchant", "created_by"],
    ["merchant", "created_by_user_id"],
    ["personal", "auth_user_id"],
    ["personal", "personal_account_id"],
    ["personal", "status"],
    ["staff", "auth_user_id"],
    ["employee", "auth_user_id"],
  ]) {
    assert.match(
      ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
      new RegExp(
        `pg_catalog\\.to_jsonb\\(${alias}\\) OPERATOR\\(pg_catalog\\.->>\\) '${column}'`,
      ),
    );
  }
  assert.doesNotMatch(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
    /\)\s+->>\s+'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
    /pg_catalog\.sha256\(\s*pg_catalog\.convert_to\(/,
  );
  assert.match(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
    /pg_catalog\.octet_length\(pg_catalog\.convert_to\(/,
  );
  assert.match(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
    /ORDER BY pg_catalog\.convert_to\(row_payload, 'UTF8'\)/,
  );
  assert.ok(
    (
      ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL.match(/UNION ALL/g) ??
      []
    ).length >= 4,
  );
  assert.doesNotMatch(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
    /\b(?:DISTINCT|digest|pgcrypto|md5|json_agg|jsonb_agg|search_path)\b/i,
  );
  assert.equal(
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SELECT_SQL,
    `SELECT ${ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL} AS ordinary_identity_content_sha256;`,
  );
});

test("ordinary identity content SHA-256 accepts only canonical lowercase hex", () => {
  assert.equal(isOrdinaryAccountIdentityContentSha256("a".repeat(64)), true);
  for (const value of [
    "A".repeat(64),
    "a".repeat(63),
    `sha256:${"a".repeat(64)}`,
    1,
    null,
  ]) {
    assert.equal(isOrdinaryAccountIdentityContentSha256(value), false);
  }
});
