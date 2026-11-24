// Fresh owned TEMP only. This is role/SQL acceptance, NOT JWT/PostgREST or
// production configuration. Do not install this test bridge on a real server.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtimeContract, renderRuntimePrototype, runtimeFixture, runtimeRole, executorRole, runtimeEntry } from './member-checkout-runtime-contract.mjs';
import { readCompatibilityCatalog, inspectCompatibilityCatalog } from './member-checkout-compatibility-check.mjs';

export async function installOwnedRuntimePrototype(t, { db }) {
  const contract = await runtimeContract(), sql = await readFile(runtimeFixture, 'utf8');
  assert.equal(sql.replace(/\r\n/g, '\n'), renderRuntimePrototype(contract));
  await db.query(sql);
  await t.test('server runtime role has one checkout entry, no private schema/table/original RPC or executor membership', async () => {
    const entry = (await db.query('select p.prosecdef definer,p.proconfig config,r.rolname::text owner from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=$1::regprocedure',[runtimeEntry])).rows[0];
    assert.deepEqual(entry,{definer:true,config:['search_path=pg_catalog, pg_temp'],owner:executorRole});
    const roles = (await db.query('select rolname::text name,rolsuper,rolcanlogin,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit,rolreplication from pg_roles where rolname=any($1) order by rolname', [[runtimeRole, executorRole]])).rows;
    assert.equal(roles.length, 2);
    for (const r of roles) for (const k of ['rolsuper','rolcanlogin','rolcreaterole','rolcreatedb','rolinherit','rolreplication']) assert.equal(r[k], false);
    assert.equal(roles.find(r => r.name === runtimeRole).rolbypassrls, false);
    assert.equal(roles.find(r => r.name === executorRole).rolbypassrls, true);
    assert.equal((await db.query('select pg_has_role($1,$2,$3) allowed', [runtimeRole,executorRole,'MEMBER'])).rows[0].allowed, false);
    for (const role of ['anon','authenticated','service_role',runtimeRole]) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role,runtimeEntry])).rows[0].allowed, role === runtimeRole);
      assert.equal((await db.query("select has_schema_privilege($1,'faolla_checkout_design','USAGE') allowed", [role])).rows[0].allowed, false);
      for (const p of contract.methods) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role,p.signature])).rows[0].allowed, false);
    }
    for (const table of [...contract.baseline.expected.tables,'public.pages','public.faolla_booking_atomic_control'])
      assert.equal((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed", [runtimeRole,table])).rows[0].allowed, false);
    assert.equal((await db.query("select count(*)::int n from pg_auth_members where roleid=(select oid from pg_roles where rolname=$1) or member=(select oid from pg_roles where rolname=$1)", [executorRole])).rows[0].n, 0);
  });
  const refused = async (role, statement, args, code) => {
    await db.query('begin');
    try { await db.query(`set local session authorization ${role}`); await assert.rejects(db.query(statement,args), e => e.code === code); }
    finally { await db.query('rollback'); }
  };
  await t.test('restricted session can call only the fixed entry; legacy/API roles cannot enter', async () => {
    await db.query('begin');
    try {
      await db.query(`set local session authorization ${runtimeRole}`);
      assert.deepEqual((await db.query('select current_user::text current,session_user::text session')).rows[0],{current:runtimeRole,session:runtimeRole});
      const r = await db.query('select public.faolla_checkout_runtime_v1($1,$2) result', ['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909992'}]);
      assert.deepEqual(r.rows[0].result,{version:null,offers:[]});
    } finally { await db.query('rollback'); }
    for (const role of ['anon','authenticated','service_role']) await refused(role, 'select public.faolla_checkout_runtime_v1($1,$2)', ['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909992'}], '42501');
    await refused(runtimeRole, 'select * from faolla_checkout_design.bundle_results', [], '42501');
    await refused(runtimeRole, 'select public.faolla_member_checkout_catalog_snapshot_v1($1)', ['10909992'], '42501');
    await refused(runtimeRole, `set role ${executorRole}`, [], '42501');
    await refused(runtimeRole, 'select * from public.pages', [], '42501');
    await refused(runtimeRole, 'alter function public.faolla_checkout_runtime_v1(text,jsonb) security invoker', [], '42501');
  });
  await t.test('executor cannot delete ledger rows, create public objects or call the configuration writer', async () => {
    for (const table of contract.baseline.expected.tables) assert.equal((await db.query("select has_table_privilege($1,$2,'DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed", [executorRole,table])).rows[0].allowed, false);
    assert.equal((await db.query("select has_schema_privilege($1,'public','CREATE') allowed", [executorRole])).rows[0].allowed, false);
    await refused(executorRole, 'delete from faolla_checkout_design.bundle_results', [], '42501');
    // A column UPDATE grant is necessary for FOR SHARE; it is deliberately NOT
    // claimed to forbid executor edits of that column. Only the fixed dispatcher
    // is reachable by runtime, and no dispatcher branch edits rollout settings.
    await refused(executorRole, 'select public.faolla_booking_atomic_configuration_v2($1,$2,$3)', ['10909992','rules',{}], '42501');
  });
  await t.test('unknown methods, SQL names and extra/missing envelope keys never dispatch', async () => {
    for (const [name,args,message] of [
      ['faolla_commit_redemption_v1',{},'checkout_runtime_forbidden'],
      ['faolla_member_checkout_catalog_snapshot_v1; select 1',{},'checkout_runtime_forbidden'],
      ['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909992',sql:'select 1'},'checkout_runtime_invalid_request'],
      ['faolla_member_checkout_catalog_snapshot_v1',{},'checkout_runtime_invalid_request'],
      ['faolla_member_checkout_catalog_snapshot_v1',[],'checkout_runtime_invalid_request'],
    ]) {
      await db.query('begin');
      try {
        await db.query(`set local role ${runtimeRole}`);
        await assert.rejects(db.query('select public.faolla_checkout_runtime_v1($1,$2)', [name,args]), e => e.message === message);
      } finally { await db.query('rollback'); }
    }
  });
  await t.test('revoking the runtime capability blocks a previously successful method; rollback restores it', async () => {
    await db.query('begin');
    try {
      await db.query(`revoke execute on function ${runtimeEntry} from ${runtimeRole}`);
      await db.query(`set local role ${runtimeRole}`);
      await assert.rejects(db.query('select public.faolla_checkout_runtime_v1($1,$2)', ['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909992'}]), e=>e.code==='42501');
    } finally { await db.query('rollback'); }
    assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[runtimeRole,runtimeEntry])).rows[0].allowed,true);
  });
  await t.test('unapproved runtime extension is still refused by the original compatibility baseline', async () => {
    const report = inspectCompatibilityCatalog(contract.baseline.expected,await readCompatibilityCatalog(sql=>db.query(sql)));
    assert.deepEqual(report.issues,['unexpected_private_function:'+runtimeEntry]);
    assert.equal(report.deploymentReady,false);
  });
  await t.test('all 46 fixed branches bind named arguments and reach original validation without a privilege bypass', async () => {
    for (const method of contract.methods) {
      await db.query('begin');
      try {
        await db.query(`set local session authorization ${runtimeRole}`);
        try { await db.query('select public.faolla_checkout_runtime_v1($1,$2)',[method.name,Object.fromEntries(method.args.map(a=>[a,null]))]); }
        catch (e) {
          const originalError = method.name === 'faolla_checkout_legacy_order_commit_v1' ? /^order_update_conflict$/
            : method.name === 'faolla_checkout_legacy_booking_commit_v1' ? /^booking_atomic_invalid_command$/ : /^checkout_/;
          assert.match(e.message,originalError,`${method.name}: ${e.message}`); assert.equal(e.code,'P0001');
        }
      } finally { await db.query('rollback'); }
    }
  });
  // Financial tests already run inside caller-owned transactions. A test-only
  // definer bridge preserves that transaction while entering as the real restricted
  // runtime role. The installer/admin role is NOT the dispatcher invoker.
  await db.query(`create function pg_temp.checkout_as_runtime(p_name text,p_args jsonb) returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
    select jsonb_build_object('invoker',current_user,'result',public.faolla_checkout_runtime_v1(p_name,p_args)) $$;
    revoke all on function pg_temp.checkout_as_runtime(text,jsonb) from PUBLIC,anon,authenticated,service_role;
    alter function pg_temp.checkout_as_runtime(text,jsonb) owner to ${runtimeRole}`);
  return async (name,args) => {
    const result = (await db.query('select pg_temp.checkout_as_runtime($1,$2) envelope', [name,args])).rows[0].envelope;
    assert.equal(result.invoker,runtimeRole);
    return result.result;
  };
}
