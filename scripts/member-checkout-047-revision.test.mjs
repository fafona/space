import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {loadCheckout047Revision,renderCheckout047Replacement} from './member-checkout-047-revision.mjs';
const revision=await loadCheckout047Revision();
test('047 revision is separate, frozen, pins the registered source and never refreshes the old package',async()=>{
 assert.equal(revision.material.scope,'owned-local-047-compatibility-revision-only');
 assert.equal(revision.material.productionAuthorized,false);assert.equal(revision.material.deploymentReady,false);
 assert.equal(revision.material.replacements.length,4);assert.ok(Object.isFrozen(revision.patches));
 assert.equal((await createInstallationSourceBundle()).digest,'8f4cb6b006d464c2f20ddad7cacc68f169f7a80885dae3749ad3abb934453f72');
});
test('only four exact new function calls change; public 047 and all ordinary saves are untouched',async()=>{
 for(const patch of revision.patches){
  assert.match(patch.sql,/CREATE OR REPLACE FUNCTION/);
  assert.equal(patch.sql.split('faolla_checkout_design.commit_redemption_047(').length,2);
  assert.doesNotMatch(patch.sql,/CREATE OR REPLACE FUNCTION public\.faolla_commit_redemption/);
  const original=await readFile(patch.file,'utf8');
  assert.throws(()=>renderCheckout047Replacement(patch.file,original.replace('public.faolla_commit_redemption_v1','public.changed_writer')),/call_boundary_changed/);
 }
 assert.throws(()=>renderCheckout047Replacement('scripts/supabase-migrations/202609080047_redemption_checkout_context.sql',revision.legacySql),/source_forbidden/);
});
test('bridge has deferred original/cancellation evidence, immutable forced-RLS audit and no internal-writer grant',()=>{
 const sql=revision.adapterSql;
 assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/g);assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/immutable_redemption_047_audits/);assert.match(sql,/redemption_047_original_required/);
 assert.match(sql,/original\.request_hash IS DISTINCT FROM NEW\.request_hash/);
 assert.match(sql,/cancellation\.receipt->>'pointsReturned'/);
 assert.doesNotMatch(sql,/GRANT[^;]+faolla_commit_redemption_internal_v1/is);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.|SET ROLE|set_config|current_setting|\bEXECUTE\s+(?:format|p_)/i);
 assert.equal((sql.match(/result:=public\.faolla_commit_redemption_internal_v1/g)??[]).length,1);
});
test('the new privilege boundary contains no public function or dispatcher method and fixes definer search paths',()=>{
 assert.deepEqual(revision.adapterMetadata.functions.map(fn=>fn.namespace),['faolla_checkout_design','faolla_checkout_design']);
 for(const fn of revision.adapterMetadata.functions){assert.equal(fn.securityDefiner,true);assert.deepEqual(fn.config,['search_path=pg_catalog,pg_temp']);}
 assert.deepEqual(revision.adapterMetadata.tables,['faolla_checkout_design.redemption_047_audits']);
 assert.equal(revision.adapterMetadata.functions.find(fn=>fn.name==='commit_redemption_047').signature,
  'faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb)');
 assert.doesNotMatch(revision.adapterSql,/GRANT[^;]+TO\s+(?:PUBLIC|anon|authenticated|service_role|faolla_checkout_runtime)\s*;/is);
});
test('the compatibility loader has no transport, environment lookup, file mutation or migration registration',async()=>{
 const code=await readFile(new URL('member-checkout-047-revision.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/process\.env|child_process|\bfetch\s*\(|writeFile|appendFile|createWriteStream|from ['"](?:pg|node:net|node:https?)['"]/);
 assert.doesNotMatch(revision.adapterSql,/INSERT\s+INTO\s+public\.faolla_schema_migrations|NOTIFY\s+pgrst|ALTER\s+ROLE|CREATE\s+ROLE/i);
});
test('exact legacy wrapper keeps rejecting old financial envelopes on the new source profile',async()=>{
 const db=new PGlite();try{
  await db.exec('create function public.faolla_commit_redemption_internal_v1(p_site_id text,p_mutation jsonb) returns jsonb language sql as $$select p_mutation$$');
  const part=revision.legacySql.match(/create or replace function public\.faolla_commit_redemption_v1\([\s\S]+?\$ordinary\$;/i)[0];await db.exec(part);
  assert.deepEqual((await db.query("select public.faolla_commit_redemption_v1('10909992',$1::jsonb) result",[{settings:{next:{}}}])).rows[0].result,{settings:{next:{}}});
  await assert.rejects(db.query("select public.faolla_commit_redemption_v1('10909992',$1::jsonb)",[{operation:{},settings:{},memberships:{next:[]}}]),e=>e.code==='P0001'&&e.message==='redemption_checkout_context_required');
 }finally{await db.close();}
});
