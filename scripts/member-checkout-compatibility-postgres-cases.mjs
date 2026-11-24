// Only the parent-owned, fresh TEMP cluster. Intentional metadata mutations
// are rolled back before the original financial acceptance cases continue.
import assert from 'node:assert/strict';
import { loadCompatibilityBaseline, readCompatibilityCatalog, inspectCompatibilityCatalog } from './member-checkout-compatibility-check.mjs';

export async function checkoutCompatibilityCases(t, { db }) {
  const baseline = await loadCompatibilityBaseline(); assert.deepEqual(baseline.issues, []);
  const read = () => readCompatibilityCatalog(sql => db.query(sql));
  const inspect = async () => inspectCompatibilityCatalog(baseline.expected, await read());
  const before = await read();
  await t.test('exact pinned SQL function bodies, retained guards and private effective ACLs match, but do not authorize deployment', async () => {
    await db.query('begin read only');
    try { const report = await inspect(); assert.deepEqual(report.issues, []); assert.equal(report.protocolObjectsMatch, true); assert.equal(report.deploymentReady, false); }
    finally { await db.query('rollback'); }
    const entry = before.functions.find(v => v.name === 'faolla_member_checkout_original_service_review_v1');
    assert.ok(entry); assert.deepEqual(entry.executors, []); assert.equal(entry.publicExecute, false);
  });
  const cases = [
    ['disabled resource guard', 'alter table public.pages disable trigger checkout_resource_final_state', 'trigger_changed:public.pages:checkout_resource_final_state'],
    ['replica-only resource guard', 'alter table public.pages enable replica trigger checkout_resource_final_state', 'trigger_changed:public.pages:checkout_resource_final_state'],
    ['missing immutable receipt guard', 'drop trigger immutable_bundle_results on faolla_checkout_design.bundle_results', 'trigger_missing_or_duplicate:faolla_checkout_design.bundle_results:immutable_bundle_results'],
    ['altered guard body', "create or replace function faolla_checkout_design.reject_historical_change() returns trigger language plpgsql set search_path=pg_catalog as $$begin return NEW;end;$$", 'function_changed:faolla_checkout_design.reject_historical_change()'],
    ['wrong guard security mode', 'alter function faolla_checkout_design.guard_legacy_resource_final_state() security invoker', 'function_changed:faolla_checkout_design.guard_legacy_resource_final_state()'],
    ['non-bypass guard owner', 'alter function faolla_checkout_design.guard_legacy_resource_final_state() owner to anon', 'guard_owner_invalid:faolla_checkout_design.guard_legacy_resource_final_state()'],
    ['private RLS disabled', 'alter table faolla_checkout_design.bundle_results disable row level security', 'table_boundary_changed:faolla_checkout_design.bundle_results'],
    ['private RLS no longer forced', 'alter table faolla_checkout_design.bundle_results no force row level security', 'table_boundary_changed:faolla_checkout_design.bundle_results'],
    ['permissive private policy', 'create policy synthetic_open on faolla_checkout_design.bundle_results using(true)', 'table_boundary_changed:faolla_checkout_design.bundle_results'],
    ['service-role direct table access', 'grant select on faolla_checkout_design.bundle_results to service_role', 'table_boundary_changed:faolla_checkout_design.bundle_results'],
    ['PUBLIC schema access', 'grant usage on schema faolla_checkout_design to PUBLIC', 'schema_boundary_changed'],
    ['PUBLIC function access', 'grant execute on function public.faolla_member_checkout_original_service_review_v1(text,text,text) to PUBLIC', 'private_function_exposed:public.faolla_member_checkout_original_service_review_v1(text,text,text)'],
    ['service-role function access', 'grant execute on function public.faolla_member_checkout_original_service_review_v1(text,text,text) to service_role', 'private_function_exposed:public.faolla_member_checkout_original_service_review_v1(text,text,text)'],
    ['inherited API function access', 'create role synthetic_checkout_reader nologin; grant execute on function public.faolla_member_checkout_original_service_review_v1(text,text,text) to synthetic_checkout_reader; grant synthetic_checkout_reader to authenticated', 'private_function_exposed:public.faolla_member_checkout_original_service_review_v1(text,text,text)'],
  ];
  for (const [name, change, issue] of cases) await t.test(`catalogue inspection refuses ${name} without repairing or granting anything`, async () => {
    await db.query('begin');
    try {
      await db.query(change); const mutated = await read(), report = inspectCompatibilityCatalog(baseline.expected, mutated);
      assert.equal(report.protocolObjectsMatch, false); assert.ok(report.issues.includes(issue), JSON.stringify(report.issues)); assert.equal(report.deploymentReady, false);
      assert.deepEqual(await read(), mutated); // inspection itself is read-only
    } finally { await db.query('rollback'); }
    assert.deepEqual(await read(), before);
  });
}
