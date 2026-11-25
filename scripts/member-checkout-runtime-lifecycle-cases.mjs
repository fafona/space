// Destructive capability changes are allowed ONLY inside the already-created
// disposable Linux CI DB. This is NOT an installer, production probe or CLI.
// No DROP, role redesign, JWT-secret rotation, business SQL rewrite or fallback.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { branch, database, databasePort } from './member-checkout-real-auth-support.mjs';

export function assertOwnedLifecycleTarget(db, env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.GITHUB_REPOSITORY, 'fafona/space'); assert.equal(env.GITHUB_REF, 'refs/heads/' + branch);
  assert.equal(env.FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE, '1');
  assert.equal(db.connectionParameters.host, '127.0.0.1'); assert.equal(db.connectionParameters.port, databasePort);
  assert.equal(db.connectionParameters.database, database); assert.equal(db.connectionParameters.user, 'checkout_ci_admin');
}

export async function runtimeLifecycleCases(caseOf, { db, site, state, rawCatalog, ordinaryRead, activeSession, replay, newSubmission, mintRuntime, currentRuntime }) {
  assertOwnedLifecycleTarget(db);
  assert.deepEqual((await db.query('select current_database() db,current_user::text actor')).rows[0], { db: database, actor: 'checkout_ci_admin' });
  const readCapabilities = async () => ({
    roles: (await db.query(`select rolname::text name,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit
      from pg_roles where rolname in ('faolla_checkout_runtime','faolla_checkout_executor','checkout_local_gateway') order by rolname`)).rows,
    entry: (await db.query(`select has_function_privilege('faolla_checkout_runtime','public.faolla_checkout_runtime_v1(text,jsonb)','EXECUTE') allowed,
      pg_has_role('checkout_local_gateway','faolla_checkout_runtime','MEMBER') member`)).rows[0],
    // Re-granting changes a grant row's physical OID. Compare semantic edges,
    // not that allocation detail; no unrelated membership may change.
    memberships: (await db.query(`select parent.rolname::text parent,child.rolname::text child,grantor.rolname::text grantor,m.admin_option
      from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles child on child.oid=m.member
      join pg_roles grantor on grantor.oid=m.grantor order by parent,child,grantor`)).rows,
  });
  const capabilities = await readCapabilities(); assert.equal(capabilities.entry.allowed, true); assert.equal(capabilities.entry.member, true);
  assert.equal(capabilities.roles.length, 3);
  const ledger = await state();
  const unchangedLedger = async () => assert.deepEqual(await state(), ledger);
  const stillAuthenticatedAndReadable = async () => { assert.equal(await ordinaryRead(), 200); assert.equal(await activeSession(), 200); };
  const recoverOriginal = async () => { const response = await replay(); assert.equal(response.status, 200); assert.equal(response.value.replayed, true); await unchangedLedger(); };
  await caseOf('fresh short-lived runtime capability works; expired or ordinary service credentials cannot use the fixed entry', async () => {
    const replacement = mintRuntime(); assert.notEqual(replacement, currentRuntime);
    assert.equal((await rawCatalog(replacement)).status, 200);
    // Allow clock skew conservatively: the test token expired an hour ago.
    const expired = await rawCatalog(mintRuntime(Math.floor(Date.now() / 1000) - 3600)); assert.equal(expired.status, 401);
    assert.equal((await rawCatalog('ordinary-service')).status, 403);
    assert.equal((await rawCatalog(currentRuntime)).status, 200); // Deliberate overlap, NOT immediate old-JWT revocation.
    await unchangedLedger(); await stillAuthenticatedAndReadable();
  });
  await caseOf('revoking only runtime EXECUTE blocks real HTTP and app checkout without breaking ordinary reads; exact grant resumes original once', async () => {
    await db.query('revoke execute on function public.faolla_checkout_runtime_v1(text,jsonb) from faolla_checkout_runtime');
    try {
      assert.equal((await readCapabilities()).entry.allowed, false);
      assert.equal((await rawCatalog(currentRuntime)).status, 403);
      const denied = await replay(); assert.equal(denied.status, 503); assert.equal(denied.value.error, 'checkout_unconfirmed');
      await unchangedLedger(); await stillAuthenticatedAndReadable();
    } finally { await db.query('grant execute on function public.faolla_checkout_runtime_v1(text,jsonb) to faolla_checkout_runtime'); }
    assert.deepEqual(await readCapabilities(), capabilities); await recoverOriginal();
  });
  await caseOf('revoking authenticator membership blocks valid runtime JWT at the database role boundary; no service-role fallback or second debit', async () => {
    await db.query('revoke faolla_checkout_runtime from checkout_local_gateway');
    try {
      const current = (await readCapabilities()).entry; assert.equal(current.allowed, true); assert.equal(current.member, false);
      assert.equal((await rawCatalog(currentRuntime)).status, 403);
      const denied = await replay(); assert.equal(denied.status, 503); assert.equal(denied.value.error, 'checkout_unconfirmed');
      await unchangedLedger(); await stillAuthenticatedAndReadable();
    } finally { await db.query('grant faolla_checkout_runtime to checkout_local_gateway'); }
    assert.deepEqual(await readCapabilities(), capabilities); await recoverOriginal();
  });
  await caseOf('closing the single-booking creation pilot refuses a new nonce but preserves the paid original; reopening never repeats debit', async () => {
    const row = (await db.query('select enabled from faolla_checkout_design.bundle_pilots where site_id=$1', [site])).rows[0]; assert.equal(row.enabled, true);
    await db.query('update faolla_checkout_design.bundle_pilots set enabled=false where site_id=$1', [site]);
    try {
      const closedState = await state();
      const old = await replay(); assert.equal(old.status, 200); assert.equal(old.value.replayed, true);
      const fresh = await newSubmission(randomUUID()); assert.equal(fresh.status, 503); assert.equal(fresh.value.error, 'checkout_disabled');
      assert.deepEqual(await state(), closedState); await stillAuthenticatedAndReadable();
    } finally { await db.query('update faolla_checkout_design.bundle_pilots set enabled=true where site_id=$1', [site]); }
    assert.deepEqual(await readCapabilities(), capabilities); await recoverOriginal();
  });
  await unchangedLedger();
}
