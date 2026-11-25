import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {installationPreflightSql,readInstallationPreflight,assertInstallationTarget,assertInstallationPreflight,installationPreflightSummary} from './member-checkout-installation-preflight.mjs';

const bundle=await createInstallationSourceBundle();
const fixture=()=>({
  context:{backendPid:100,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
  target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_test',databaseOwner:'owned_admin',databaseEncoding:'UTF8',
    serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',actor:{oid:'1234',rolname:'owned_admin',rolsuper:true}},
  registry:{count:1,entries:[{version:'202611250001',nameSha256:'2'.repeat(64)}]},
  roles:[{oid:'1234',rolname:'owned_admin',rolsuper:true}],memberships:[],defaultAcls:[],schemas:[{name:'public',owner:'owned_admin'}],
  relations:[{oid:'3456',namespace:'public',name:'pages'}],columns:[{relation:'3456',ordinal:1,name:'id',type:'uuid',not_null:true}],
  constraints:[],indexes:[],functions:[],extensions:[],
});
const observe=value=>readInstallationPreflight(async sql=>{assert.equal(sql,installationPreflightSql);return{rows:[{metadata:value}]};},bundle);

test('the exact SELECT parses and plans without fabricated catalogue functions (in-memory syntax evidence only)',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create table public.faolla_schema_migrations(version bigint primary key,name text not null)');
    assert.ok((await db.query('EXPLAIN '+installationPreflightSql)).rows.length>0);
  }finally{await db.close();}
});

test('a single fixed SELECT captures complete bounded metadata and excludes business rows, credentials and SQL bodies',async()=>{
  assert.equal(splitInstallationSql(installationPreflightSql+';').length,1);
  assert.match(installationPreflightSql,/^WITH\b/);
  assert.doesNotMatch(installationPreflightSql,/\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|CALL|COPY|SET|BEGIN|COMMIT|ROLLBACK)\b/i);
  assert.doesNotMatch(installationPreflightSql,/auth\.users|rolpassword|jwt|password|SELECT\s+\*\s+FROM\s+public\.pages/i);
  assert.match(installationPreflightSql,/FROM public\.faolla_schema_migrations ORDER BY version LIMIT 1001/);
  for(const required of ['pg_control_system','pg_default_acl','pg_auth_members','pg_attribute','pg_constraint','pg_index','pg_proc','pg_extension'])assert.ok(installationPreflightSql.includes('pg_catalog.'+required));
  const snapshot=await observe(fixture());assert.match(snapshot.sha256,/^[a-f0-9]{64}$/);
  assert.equal(snapshot.sourceBundleSha256,bundle.digest);assertInstallationPreflight(snapshot,await observe(fixture()));
});

test('connection PID and readonly preview context do not masquerade as target changes; the installation source is still bound',async()=>{
  const original=await observe(fixture()),changed=fixture();changed.context={...changed.context,backendPid:200,readOnly:false,isolation:'read committed'};
  const current=await observe(changed);assert.notEqual(original.data.context.backendPid,current.data.context.backendPid);
  assertInstallationTarget(original,current);assertInstallationPreflight(original,current);
  assert.equal(original.sourceBundleSha256,bundle.digest);
});

test('another cluster, database owner, role or session identity cannot reuse a reviewed target',async()=>{
  const reference=await observe(fixture());
  for(const change of [v=>v.target.clusterSha256='0'.repeat(64),v=>v.target.databaseOid='999',v=>v.target.databaseOwner='another_owner',
    v=>v.target.sessionUser='another_actor',v=>v.target.actor.rolsuper=false,v=>v.target.serverVersion='170006',
    v=>{v.target.currentRole='another_role';v.target.actor.rolname='another_role';}]){
    const value=fixture();change(value);assert.throws(()=>assertInstallationTarget(reference,null),/not_observed/);
    const current=await observe(value);assert.throws(()=>assertInstallationPreflight(reference,current),/installation_target_changed/);
  }
});

test('whole registry, defaults, role graph and scoped object shape drift are refused, not just known five names',async()=>{
  const reference=await observe(fixture());
  const changes=[v=>{v.registry.count++;v.registry.entries.push({version:'202611250002',nameSha256:'3'.repeat(64)});},
    v=>v.registry.entries[0].nameSha256='4'.repeat(64),v=>v.defaultAcls.push({owner:'owned_admin',acl:['extra=EXECUTE']}),
    v=>v.roles[0].rolsuper=false,v=>v.memberships.push({parent:'service_role',child:'anon'}),
    v=>v.schemas[0].owner='other',v=>v.columns[0].not_null=false,v=>v.constraints.push({name:'extra_guard'}),
    v=>v.indexes.push({oid:'5678',valid:false}),v=>v.functions.push({name:'faolla_test',definition_sha256:'5'.repeat(64)}),
    v=>v.extensions.push({name:'extra',version:'1.0'})];
  for(const change of changes){const value=fixture();change(value);const current=await observe(value);
    assertInstallationTarget(reference,current);assert.throws(()=>assertInstallationPreflight(reference,current),/installation_preflight_changed/);}
});

test('incomplete, duplicate, malformed, unbounded or wrongly scoped observations cannot form an empty valid baseline',async()=>{
  for(const change of [v=>v.registry.count=2,v=>{v.registry.count=2;v.registry.entries.push(v.registry.entries[0]);},
    v=>v.registry.entries[0].version='unregistered',v=>v.registry.entries[0].nameSha256='bad',
    v=>v.registry.count=1001,v=>v.context.searchPath='public,pg_catalog',v=>v.roles=null,
    v=>v.relations=Array(5001).fill({}),v=>v.roles[0].extra='x'.repeat(2*1024*1024),v=>delete v.functions,v=>v.extra='unreviewed',v=>v.target.actor.rolname='mismatch']){
    const value=fixture();change(value);await assert.rejects(observe(value),/^Error: installation_preflight_unavailable$/);
  }
  await assert.rejects(readInstallationPreflight(async()=>({rows:[]}),bundle),/installation_preflight_unavailable/);
  let queried=false;await assert.rejects(readInstallationPreflight(async()=>{queried=true;return{rows:[]};},{...bundle,digest:'0'.repeat(64)}),/installation_preflight_unavailable/);
  assert.equal(queried,false);
});

test('private observations are copied, deeply frozen and cannot be forged from serialized digests; reports contain only digests/counts',async()=>{
  const raw=fixture(),snapshot=await observe(raw);raw.columns[0].name='later change';assert.equal(snapshot.data.columns[0].name,'id');
  assert.throws(()=>snapshot.data.registry.entries.pop(),TypeError);
  assert.throws(()=>snapshot.data.target.currentRole='changed',TypeError);
  assert.throws(()=>assertInstallationPreflight(JSON.parse(JSON.stringify(snapshot)),snapshot),/not_observed/);
  const summary=installationPreflightSummary(snapshot);assert.equal(summary.registryRows,1);assert.equal(summary.productionAuthorized,false);
  assert.doesNotMatch(JSON.stringify(summary),/owned_admin|owned_test|127\.0\.0\.1|databaseOid|backendPid|nameSha256|"data"|"actor"/);
});

test('SQL failure diagnostic retains only an approved SQLSTATE and fixed query position, never exception text',async()=>{
  await assert.rejects(readInstallationPreflight(async()=>{throw Object.assign(Error('secret credential and customer row'),{code:'42601',position:'12'});},bundle),error=>{
    assert.equal(error.message,'installation_preflight_unavailable');assert.equal(error.code,'PREFLIGHT_42601_AT_12');
    assert.doesNotMatch(JSON.stringify(error),/credential|customer|secret/);return true;
  });
});

test('owned installation gates the full pre-DDL snapshot but uses exact post-install checks for repeats without rewriting original records',async()=>{
  const source=await readFile('scripts/member-checkout-installation-acceptance.mjs','utf8');
  assert.match(source,/assertInstallationTarget\(preflight,currentPreflight\)/);
  assert.ok(source.indexOf('assertInstallationPreflight(preflight,currentPreflight)')<source.indexOf('for(const step of approved.material.steps)'));
  assert.match(source,/report\.installationPreflight=installationPreflightSummary\(preflight\)/);
  assert.match(source,/if\(receipt\)\{[\s\S]*?await installed\(db\);await db\.query\('COMMIT'\)/);
  assert.match(source,/await observer\.query\('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'\)/);
  const protocols=await readFile('scripts/member-checkout-real-auth-acceptance.mjs','utf8');
  assert.match(protocols,/fixed metadata-only installation observation works against the selected real PG protocol/);
  assert.match(protocols,/report\.installationObservation=installationPreflightSummary\(first\)/);
  const workflow=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
  assert.match(workflow,/member-checkout-installation-preflight\.test\.mjs/);
  assert.doesNotMatch(workflow,/workflow_dispatch:|secrets\.|environment:|ssh |scp /);
});
