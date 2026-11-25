import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {loadInstallationSupplement,installationSupplementSql,observeInstallationSupplement,inspectInstallationSupplement,installationSupplementSummary} from './member-checkout-installation-supplement.mjs';
const bundle=await createInstallationSourceBundle(),contract=await loadInstallationSupplement(bundle),addresses=['127.0.0.1'];
const fixture=()=>{
 const functions=contract.expected.functions.map((v,i)=>({...v,oid:String(6000+i),bodySha256:v.bodySha256,definitionSha256:String(i%10).repeat(64),
  owner:'owned_admin',ownerBypassesRls:true,sqlBody:false,defaults:0}));
 return {seal:{core:{context:{backendPid:1,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
  target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_supplement',databaseOwner:'owned_admin',databaseEncoding:'UTF8',serverVersion:'150008',
   serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',actor:{oid:'1234',rolname:'owned_admin',rolsuper:true}},
  registry:{count:0,entries:[]},roles:[{oid:'1234',rolname:'owned_admin',rolcanlogin:true}],memberships:[],defaultAcls:[],schemas:[{name:'public'}],relations:[],columns:[],constraints:[],indexes:[],extensions:[],
  functions:functions.map(v=>({oid:v.oid,owner:v.owner,definition_sha256:v.definitionSha256}))},triggers:[],policies:[]},
 legacyFunctions:functions,legacyTriggers:contract.expected.triggers.map(v=>({...v,enabled:'O',args:0,qualified:false,columns:''})),
 gatewayLogins:[{roleOid:'1234',role:'owned_admin',connections:2}]};
};
const observe=value=>observeInstallationSupplement(async sql=>{assert.equal(sql,installationSupplementSql(contract,addresses));return{rows:[{metadata:value}]};},contract,bundle,addresses);
test('supplement plans one SELECT, hashes bodies inside SQL and never selects SQL activity text or business rows',async()=>{
 const sql=installationSupplementSql(contract,addresses);assert.equal(splitInstallationSql(sql+';').length,1);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|CALL|COPY|SET|COMMIT|ROLLBACK)\b/i);
 assert.doesNotMatch(sql,/rolpassword|auth\.users|a\.query\b|a\.query_id|SELECT\s+\*\s+FROM\s+public\.pages/i);
 assert.match(sql,/pg_catalog\.pg_stat_activity/);assert.match(sql,/a\.client_addr=ANY/);assert.match(sql,/p\.prosrc/);
 const db=new PGlite();try{await db.exec('create table public.faolla_schema_migrations(version bigint primary key,name text not null)');
  assert.ok((await db.query('EXPLAIN '+sql)).rows.length>0);}finally{await db.close();}
});
test('gateway address parameters are validated as literals and cannot add SQL, zones, duplicates or unbounded input',()=>{
 for(const value of [[],['127.0.0.1','127.0.0.1'],["127.0.0.1');select 1--"],['host.example'],['fe80::1%eth0'],Array(9).fill('::1'),[null]])
  assert.throws(()=>installationSupplementSql(contract,value),/addresses_invalid/);
 assert.match(installationSupplementSql(contract,['::1','192.0.2.2']),/'192\.0\.2\.2'::pg_catalog\.inet/);
 assert.throws(()=>installationSupplementSql({...contract},addresses),/contract_unverified/);
});
test('all 15 exact source functions and three enabled legacy guards match without conferring role or deployment authority',async()=>{
 const observed=await observe(fixture()),result=inspectInstallationSupplement(contract,observed);
 assert.equal(result.legacyDefinitionsMatch,true);assert.deepEqual(result.issues,[]);assert.equal(result.gatewayStatus,'observed-session-login');
 assert.equal(result.gatewayIsConfiguredLoginProof,false);assert.equal(result.gatewayGrantAuthorized,false);assert.equal(result.productionAuthorized,false);
 const summary=installationSupplementSummary(contract,observed);assert.equal(summary.legacyFunctions,15);assert.equal(summary.legacyTriggers,3);
 assert.equal(summary.deploymentReady,false);assert.doesNotMatch(JSON.stringify(summary),/owned_admin|owned_supplement|"roleOid"|"bodySha256"|client_addr|"data"/);
});
test('body, execution attributes, arguments, defaults, search path and duplicate or unexpected overload drift are reported',async()=>{
 for(const change of [v=>v.legacyFunctions[0].bodySha256='a'.repeat(64),v=>v.legacyFunctions[0].securityDefiner=true,
  v=>v.legacyFunctions[0].args=['other'],v=>v.legacyFunctions[0].config=['search_path=public'],v=>v.legacyFunctions[0].sqlBody=true,
  v=>v.legacyFunctions[0].defaults=1,v=>v.legacyFunctions.pop(),v=>v.legacyFunctions.push(v.legacyFunctions[0]),
  v=>v.legacyFunctions.push({...v.legacyFunctions[0],types:['integer']})]){
  const raw=fixture();change(raw);const result=inspectInstallationSupplement(contract,await observe(raw));assert.equal(result.legacyDefinitionsMatch,false);assert.ok(result.issues.length);
 }
});
test('function definition/owner must agree with the core snapshot from the same single SELECT',async()=>{
 for(const change of [v=>v.legacyFunctions[0].definitionSha256='a'.repeat(64),v=>v.legacyFunctions[0].owner='different']){
  const raw=fixture();change(raw);assert.ok(inspectInstallationSupplement(contract,await observe(raw)).issues.includes('supplement_definition_metadata_invalid'));
 }
});
test('disabled, replica-only, conditional, reassigned, column-specific or missing legacy triggers cannot match',async()=>{
 for(const change of [v=>v.legacyTriggers[0].enabled='D',v=>v.legacyTriggers[0].enabled='R',v=>v.legacyTriggers[0].function='public.other()',
  v=>v.legacyTriggers[0].qualified=true,v=>v.legacyTriggers[0].columns='1',v=>v.legacyTriggers[0].type=0,v=>v.legacyTriggers.pop()]){
  const raw=fixture();change(raw);assert.equal(inspectInstallationSupplement(contract,await observe(raw)).legacyDefinitionsMatch,false);
 }
});
test('missing, multiple, non-login or unknown gateway roles remain unconfirmed rather than assuming authenticator',async()=>{
 for(const [change,status] of [[v=>v.gatewayLogins=[],'not-observed'],[v=>v.gatewayLogins.push({...v.gatewayLogins[0],role:'other'}),'ambiguous'],
  [v=>v.gatewayLogins[0].role='unmatched','unconfirmed'],[v=>v.seal.core.roles[0].rolcanlogin=false,'unconfirmed'],[v=>v.gatewayLogins[0].connections=0,'unconfirmed']]){
  const raw=fixture();change(raw);const result=inspectInstallationSupplement(contract,await observe(raw));assert.equal(result.gatewayStatus,status);assert.equal(result.gatewayGrantAuthorized,false);
 }
});
test('only bounded branded single-statement observations may be summarized; errors never return raw diagnostics',async()=>{
 const raw=fixture(),snapshot=await observe(raw);raw.legacyFunctions[0].name='changed';assert.equal(snapshot.data.legacyFunctions[0].name,contract.expected.functions[0].name);
 assert.throws(()=>snapshot.data.gatewayLogins.pop(),TypeError);assert.throws(()=>installationSupplementSummary(contract,{...snapshot}),/not_observed/);
 for(const change of [v=>v.extra=true,v=>v.legacyFunctions=Array(501).fill({}),v=>v.gatewayLogins=[null],v=>delete v.seal]){
  const value=fixture();change(value);await assert.rejects(observe(value),/^Error: installation_supplement_unavailable$/);
 }
 await assert.rejects(observeInstallationSupplement(async()=>{throw Object.assign(Error('secret server text'),{code:'42601'});},contract,bundle,addresses),error=>{
  assert.equal(error.message,'installation_supplement_unavailable');assert.equal(error.code,'42601');assert.doesNotMatch(JSON.stringify(error),/secret/);return true;
 });
});
test('query module has no production transport, credentials, metadata mutation or automatic authority',async()=>{
 const source=await readFile('scripts/member-checkout-installation-supplement.mjs','utf8');
 assert.doesNotMatch(source,/process\.env|child_process|fetch\(|writeFile\(|spawn\(|\.Config\.Env|PGRST_DB_URI|JWT_SECRET|DATABASE_URL/);
 const harness=await readFile('scripts/member-checkout-installation-acceptance.mjs','utf8');
 assert.match(harness,/read-only supplement matches all original function definitions and guards on the real owned PG/);
 const workflow=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');assert.match(workflow,/member-checkout-installation-supplement\.test\.mjs/);
});
