import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310003_merchant_enterprise_invitation_lifecycle.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readFunction(source, functionName) {
  const signature = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(\\s*p_input\\s+jsonb\\s*\\)`,
    "i",
  );
  const match = signature.exec(source);
  assert.ok(match, `missing RPC ${functionName}`);
  const end = source.indexOf("\n$$;", match.index);
  assert.notEqual(end, -1, `unterminated RPC ${functionName}`);
  return source.slice(match.index, end + 4);
}

const rpcNames = [
  "faolla_reserve_merchant_employee_invitation_v1",
  "faolla_revoke_merchant_employee_invitation_v1",
  "faolla_accept_merchant_employee_invitation_v1",
  "faolla_finalize_merchant_employee_invitation_v1",
  "faolla_bind_merchant_employee_auth_user_v1",
];

test("invitation lifecycle migration is additive and registers its forward-only version", () => {
  const source = readMigration();
  assert.match(source, /^\s*(?:--[^\n]*\n\s*)*begin\s*;/i);
  assert.match(source, /commit\s*;\s*$/i);
  assert.match(
    source,
    /insert into public\.faolla_schema_migrations\s*\(version,\s*name\)[\s\S]*values\s*\(\s*202607310003,\s*'merchant_enterprise_invitation_lifecycle'\s*\)/i,
  );
  assert.doesNotMatch(source, /\bdrop\s+(?:table|column)\b|\btruncate\b/i);
});

test("employee invitations gain versioned secret, expiry, revocation and delivery metadata", () => {
  const source = readMigration();
  [
    ["invitation_version", "bigint"],
    ["invitation_token_hash", "text"],
    ["invitation_expires_at", "timestamptz"],
    ["invitation_revoked_at", "timestamptz"],
    ["invitation_sent_at", "timestamptz"],
    ["invitation_delivery_status", "text"],
  ].forEach(([column, type]) => {
    assert.match(
      source,
      new RegExp(
        `alter table public\\.merchant_enterprise_employees[\\s\\S]*?add column if not exists ${column} ${type}`,
        "i",
      ),
    );
  });
  assert.match(source, /invitation_version\s*>=\s*0/i);
  assert.match(source, /invitation_token_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i);
  for (const status of ["legacy", "sending", "sent", "failed", "revoked"]) {
    assert.match(source, new RegExp(`'${status}'`, "i"));
  }
  assert.match(
    source,
    /create index if not exists merchant_enterprise_employees_pending_invitation_expiry_idx[\s\S]*merchant_id[\s\S]*invitation_expires_at[\s\S]*invitation_version[\s\S]*where status = 'invited' and accepted_at is null/i,
  );
});

test("legacy pending links receive exactly a migration-time 72-hour version-zero window", () => {
  const source = readMigration();
  assert.match(
    source,
    /update public\.merchant_enterprise_employees[\s\S]*invitation_expires_at = statement_timestamp\(\) \+ interval '72 hours'[\s\S]*invitation_delivery_status = 'legacy'[\s\S]*where status = 'invited'[\s\S]*accepted_at is null[\s\S]*invitation_version = 0[\s\S]*invitation_token_hash is null/i,
  );
  assert.match(
    source,
    /alter column invitation_expires_at[\s\S]*set default \(statement_timestamp\(\) \+ interval '72 hours'\)/i,
  );
  const acceptRpc = readFunction(
    source,
    "faolla_accept_merchant_employee_invitation_v1",
  );
  assert.match(
    acceptRpc,
    /invitation_version = 0[\s\S]*invitation_token_hash is null[\s\S]*coalesce\(v_supplied_invitation_version,\s*0\) <> 0[\s\S]*v_supplied_token_hash is not null/i,
  );
  assert.match(
    acceptRpc,
    /invitation_expires_at is null[\s\S]*invitation_expires_at <= v_now[\s\S]*employee_invitation_expired/i,
  );
});

test("pre-accept disabled zombie rows are retained as revoked renewable invitations", () => {
  const source = readMigration();
  assert.match(
    source,
    /update public\.merchant_enterprise_employees[\s\S]*set status = 'invited'[\s\S]*invitation_version = greatest\(invitation_version,\s*0\) \+ 1[\s\S]*invitation_token_hash = null[\s\S]*invitation_revoked_at = statement_timestamp\(\)[\s\S]*invitation_delivery_status = 'revoked'[\s\S]*where status = 'disabled'[\s\S]*accepted_at is null/i,
  );
});

test("reserve and revoke serialize the employee row and rotate invitation generations with row-version CAS", () => {
  const source = readMigration();
  const reserveRpc = readFunction(
    source,
    "faolla_reserve_merchant_employee_invitation_v1",
  );
  assert.match(reserveRpc, /from public\.merchant_enterprise_employees[\s\S]*for update/i);
  assert.match(reserveRpc, /v_employee\.version <> v_expected_version/i);
  assert.match(reserveRpc, /invitation_version = v_employee\.invitation_version \+ 1/i);
  assert.match(reserveRpc, /invitation_token_hash = v_token_hash/i);
  assert.match(reserveRpc, /invitation_revoked_at = null/i);
  assert.match(reserveRpc, /invitation_delivery_status = 'sending'/i);
  assert.match(
    reserveRpc,
    /where merchant_id = v_site_id[\s\S]*version = v_expected_version[\s\S]*status = 'invited'[\s\S]*accepted_at is null/i,
  );

  const revokeRpc = readFunction(
    source,
    "faolla_revoke_merchant_employee_invitation_v1",
  );
  assert.match(revokeRpc, /from public\.merchant_enterprise_employees[\s\S]*for update/i);
  assert.match(revokeRpc, /v_employee\.version <> v_expected_version/i);
  assert.match(revokeRpc, /invitation_version = v_employee\.invitation_version \+ 1/i);
  assert.match(revokeRpc, /invitation_token_hash = null/i);
  assert.match(revokeRpc, /invitation_expires_at = v_now/i);
  assert.match(revokeRpc, /invitation_revoked_at = v_now/i);
  assert.match(revokeRpc, /invitation_delivery_status = 'revoked'/i);
});

test("accept checks auth binding, generation, token, expiry and role inside the revocation lock", () => {
  const source = readMigration();
  const acceptRpc = readFunction(
    source,
    "faolla_accept_merchant_employee_invitation_v1",
  );
  assert.match(
    acceptRpc,
    /where merchant_id = v_site_id[\s\S]*auth_user_id = v_auth_user_id[\s\S]*for update/i,
  );
  assert.match(acceptRpc, /status = 'active'[\s\S]*already_active[\s\S]*true/i);
  assert.match(acceptRpc, /status = 'disabled'[\s\S]*employee_account_disabled/i);
  assert.match(acceptRpc, /invitation_revoked_at is not null[\s\S]*employee_invitation_revoked/i);
  assert.match(
    acceptRpc,
    /v_supplied_invitation_version is distinct from v_employee\.invitation_version[\s\S]*v_supplied_token_hash is distinct from v_employee\.invitation_token_hash/i,
  );
  assert.match(
    acceptRpc,
    /from public\.merchant_enterprise_roles[\s\S]*status = 'active'[\s\S]*for share/i,
  );
  assert.match(
    acceptRpc,
    /set status = 'active'[\s\S]*accepted_at = v_now[\s\S]*invitation_token_hash = null/i,
  );
  assert.match(
    acceptRpc,
    /version = v_employee\.version[\s\S]*invitation_version = v_employee\.invitation_version[\s\S]*status = 'invited'[\s\S]*invitation_revoked_at is null[\s\S]*invitation_expires_at > v_now/i,
  );
});

test("delivery finalization and auth binding cannot overwrite a newer or revoked invitation", () => {
  const source = readMigration();
  const finalizeRpc = readFunction(
    source,
    "faolla_finalize_merchant_employee_invitation_v1",
  );
  assert.match(finalizeRpc, /v_delivery_status not in \('sent', 'failed'\)/i);
  assert.match(
    finalizeRpc,
    /v_employee\.invitation_version <> v_expected_invitation_version[\s\S]*invitation_revoked_at is not null[\s\S]*'applied',[\s\S]*false/i,
  );
  assert.match(
    finalizeRpc,
    /version = v_employee\.version[\s\S]*invitation_version = v_expected_invitation_version[\s\S]*status = 'invited'[\s\S]*invitation_revoked_at is null/i,
  );

  const bindRpc = readFunction(
    source,
    "faolla_bind_merchant_employee_auth_user_v1",
  );
  assert.match(bindRpc, /v_employee\.invitation_version <> v_expected_invitation_version/i);
  assert.match(bindRpc, /v_employee\.invitation_revoked_at is not null/i);
  assert.match(bindRpc, /v_employee\.invitation_expires_at <= v_now/i);
  assert.match(bindRpc, /v_employee\.version <> v_expected_version/i);
  assert.match(
    bindRpc,
    /version = v_expected_version[\s\S]*invitation_version = v_expected_invitation_version[\s\S]*status = 'invited'[\s\S]*auth_user_id is null[\s\S]*invitation_revoked_at is null[\s\S]*invitation_expires_at > v_now/i,
  );
  assert.doesNotMatch(bindRpc, /set[\s\S]{0,200}invited_at\s*=/i);
});

test("all invitation RPCs are service-role only and never return the token digest", () => {
  const source = readMigration();
  for (const rpcName of rpcNames) {
    const rpc = readFunction(source, rpcName);
    assert.match(rpc, /security definer/i);
    assert.match(rpc, /set search_path = public/i);
    assert.doesNotMatch(
      rpc,
      /return\s+to_jsonb\(v_employee\)|^\s*'invitation_token_hash'\s*,/im,
    );
    assert.match(rpc, /to_jsonb\(v_employee\) - 'invitation_token_hash'/i);
    assert.match(
      source,
      new RegExp(
        `revoke all on function public\\.${rpcName}\\(jsonb\\)\\s+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function public\\.${rpcName}\\(jsonb\\)\\s+to service_role`,
        "i",
      ),
    );
  }

  const serializedRows = source.match(/to_jsonb\(v_employee\)/gi) ?? [];
  const sanitizedRows =
    source.match(/to_jsonb\(v_employee\) - 'invitation_token_hash'/gi) ?? [];
  assert.equal(serializedRows.length, sanitizedRows.length);
});
