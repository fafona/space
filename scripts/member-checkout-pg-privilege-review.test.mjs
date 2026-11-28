import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readCheckoutPgPrivilegeReview as read, checkoutPgLogin as login } from './member-checkout-pg-privilege-review.mjs';
import { runtimeEntry as entry, executorRole, runtimeRole } from './member-checkout-runtime-contract.mjs';

test('read-only review reports only fixed issues; connection failures and malformed rows fail closed', async () => {
  let calls = 0;
  const unavailable = async () => { calls++; throw Error('passphrase-should-not-be-returned'); };
  await assert.rejects(read(unavailable, 0), /^Error: checkout_pg_review_invalid_input$/);
  assert.equal(calls, 0);
  await assert.rejects(read(unavailable, 6), /^Error: checkout_pg_review_unavailable$/);
  assert.equal(calls, 1);
  await assert.rejects(read(async () => ({rows: [{role_ok: true}]}), 6), /^Error: checkout_pg_review_invalid_result$/);
});

test('effective grants and fixed entry contract in an owned PostgreSQL-WASM catalog', async t => {
  const db = new PGlite();
  try {
    const name = (await db.query('SELECT current_database() name')).rows[0].name;
    assert.match(name, /^[a-z_]+$/);
    await db.exec(`CREATE ROLE ${login} LOGIN NOINHERIT CONNECTION LIMIT 6;
      CREATE ROLE ${executorRole} NOLOGIN; CREATE ROLE ${runtimeRole} NOLOGIN;
      CREATE SCHEMA faolla_checkout_design;
      CREATE TABLE faolla_checkout_design.audit_test (id integer);
      CREATE TABLE public.audit_test (id integer);
      CREATE SEQUENCE public.audit_counter;
      CREATE FUNCTION ${entry} RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$ SELECT '{}'::jsonb $$;
      ALTER FUNCTION ${entry} OWNER TO ${executorRole};
      REVOKE ALL ON FUNCTION ${entry} FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${entry} TO ${runtimeRole},${login};
      GRANT CONNECT ON DATABASE ${name} TO ${login}; GRANT USAGE ON SCHEMA public TO ${login};
      CREATE FUNCTION public.audit_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);
    let diagnostic;
    // This database is synthetic. Test failures may show the fixed SQLSTATE,
    // never the database message or submitted values.
    const query = async (sql, args) => { try { return await db.query(sql, args); } catch (e) { diagnostic = e.code; throw e; } };
    const get = async () => {
      diagnostic = null;
      try { return await read(query, 6); } catch (e) { throw Error(`${e.message}:${diagnostic ?? 'no_sqlstate'}`); }
    };
    const check = async (title, sql, issues) => {
      await t.test(title, async () => {
        await db.exec('BEGIN');
        try {
          if (sql) await db.exec(sql);
          const actual = await get();
          assert.deepEqual(actual.issues.sort(), issues.sort());
          assert.equal(actual.passed, issues.length === 0);
          assert.equal(actual.hostAuthenticationVerified, false);
          assert.equal(actual.productionAuthorized, false);
        } finally { await db.exec('ROLLBACK'); }
      });
    };
    await check('exact setup passes; standard TEMP is observed, not revoked', null, []);
    assert.equal((await get()).temporaryAllowed, true);
    assert.equal((await get()).counts.invoker_trigger_grants, 1);
    await check('a column-only PUBLIC grant is detected even without private schema USAGE',
      'GRANT SELECT (id) ON faolla_checkout_design.audit_test TO PUBLIC', ['table_grants']);
    await check('effective sequence access is counted', `GRANT USAGE ON SEQUENCE public.audit_counter TO ${login}`, ['sequence_grants']);
    await check('additional callable routines are detected regardless of their name',
      `CREATE FUNCTION public.audit_helper() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`, ['other_callable_routines']);
    await check('a definer trigger grant is conservatively flagged',
      'ALTER FUNCTION public.audit_trigger() SECURITY DEFINER', ['other_callable_routines']);
    await check('entry grant option and PUBLIC access cannot pass',
      `GRANT EXECUTE ON FUNCTION ${entry} TO PUBLIC; GRANT EXECUTE ON FUNCTION ${entry} TO ${login} WITH GRANT OPTION`, ['entry_ok','unexpected_entry_grants']);
    await check('retained original credential path must keep its own EXECUTE',
      `REVOKE EXECUTE ON FUNCTION ${entry} FROM ${runtimeRole}`, ['entry_ok']);
    await check('PUBLIC does not substitute for an explicit CONNECT and USAGE',
      `REVOKE CONNECT ON DATABASE ${name} FROM ${login}; REVOKE USAGE ON SCHEMA public FROM ${login}`, ['database_ok','public_schema_ok']);
    await check('role attributes, membership in either direction, and overrides must match',
      `ALTER ROLE ${login} CONNECTION LIMIT 7; GRANT ${runtimeRole} TO ${login}; GRANT ${login} TO ${executorRole}; ALTER ROLE ${login} SET statement_timeout='10s'`,
      ['role_ok','membership_edges','role_settings']);
    await check('owned schema objects are detected',
      `CREATE SCHEMA audit_owner AUTHORIZATION ${login}`, ['owned_objects','schema_create']);
    await check('future explicit PUBLIC grant is not mistaken for harmless defaults',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC', ['widening_default_grants']);
    assert.equal((await get()).passed, true);
  } finally { await db.close(); }
});
