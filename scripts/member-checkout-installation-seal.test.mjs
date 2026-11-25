import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,chmodSync,symlinkSync,linkSync} from 'node:fs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {installationSealSql,observeInstallationSeal,assertInstallationSealObservation,prepareInstallationSeal,verifyInstallationSeal,
 installationSealSummary,sealRegistryVersion,installationSealRegistryName,installationSealRegistryDigest} from './member-checkout-installation-seal.mjs';
import {createInstallationSealJournal,openInstallationSealJournal,installationSealFileName} from './member-checkout-installation-seal-journal.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const bundle=await createInstallationSourceBundle();
const entries=rows=>rows.map(({version,name})=>({version,nameSha256:sha(name)})).sort((a,b)=>a.version.localeCompare(b.version));
const fixture=()=>({core:{
 context:{backendPid:100,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
 target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_test',databaseOwner:'owned_admin',databaseEncoding:'UTF8',
  serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',actor:{oid:'1234',rolname:'owned_admin',rolsuper:true}},
 registry:{count:5,entries:entries(bundle.material.prerequisites.registry)},
 roles:[{oid:'1234',rolname:'owned_admin',rolsuper:true}],memberships:[],defaultAcls:[],schemas:[{name:'public',owner:'owned_admin'}],
 relations:[{oid:'3456',namespace:'public',name:'pages'}],columns:[{relation:'3456',ordinal:1,name:'id',type:'uuid',not_null:true}],
 constraints:[],indexes:[],functions:[],extensions:[]},
 triggers:[{oid:'3457',relation:'3456',name:'set_pages_updated_at',enabled:'O',function_sha256:'2'.repeat(64)}],policies:[]});
const observe=value=>observeInstallationSeal(async sql=>{assert.equal(sql,installationSealSql);return{rows:[{metadata:value}]};},bundle);
const before=await observe(fixture()),post=fixture();post.core.schemas.push({name:'faolla_checkout_design',owner:'owned_admin'});
const after=await observe(post),seal=prepareInstallationSeal(before,after,bundle);
const installed=(prepared=seal)=>{const value=structuredClone(post);value.core.registry={count:7,entries:entries([...bundle.material.prerequisites.registry,
 bundle.receipt,{version:sealRegistryVersion,name:installationSealRegistryName(prepared.digest)}])};return value;};
const verify=(wire,current,expectedSha256=seal.digest)=>verifyInstallationSeal(wire,{expectedSha256,before,current,bundle});

test('complete seal is one fixed metadata-only SELECT including legacy trigger bodies and row policies',async()=>{
 assert.equal(splitInstallationSql(installationSealSql+';').length,1);
 assert.doesNotMatch(installationSealSql,/\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|CALL|COPY|SET|BEGIN|COMMIT|ROLLBACK)\b/i);
 assert.doesNotMatch(installationSealSql,/rolpassword|auth\.users|SELECT\s+\*\s+FROM\s+public\.pages/i);
 for(const value of ['pg_catalog.pg_trigger','pg_catalog.pg_policy','pg_catalog.pg_get_functiondef','pg_catalog.pg_get_expr'])assert.ok(installationSealSql.includes(value));
 const db=new PGlite();try{
  await db.exec('create table public.faolla_schema_migrations(version bigint primary key,name text not null)');
  assert.ok((await db.query('EXPLAIN '+installationSealSql)).rows.length>0);
 }finally{await db.close();}
});
test('prepared seal is not committed proof until source and seal registry rows both match on the same target',async()=>{
 assert.throws(()=>verify(seal.wire,after),/installation_seal_unconfirmed/);
 const current=await observe(installed());assert.equal(verify(seal.wire,current).digest,seal.digest);
 const summary=installationSealSummary(seal);assert.equal(summary.productionAuthorized,false);
 assert.doesNotMatch(JSON.stringify(summary),/owned_admin|owned_test|attemptId|"wire"|127\.0\.0\.1/);
 assert.throws(()=>installationSealSummary({...seal}),/not_prepared/);
});
test('complete post-install structure and guard drift cannot reuse a valid file or a self-rehashed replacement',async()=>{
 for(const change of [v=>v.core.constraints.push({name:'new_guard'}),v=>v.core.columns[0].not_null=false,
  v=>v.core.indexes.push({valid:false}),v=>v.triggers[0].enabled='D',v=>v.triggers[0].function_sha256='3'.repeat(64),
  v=>v.policies.push({name:'extra',using_sha256:'4'.repeat(64)}),v=>v.core.target.databaseOid='999']){
  const raw=installed();change(raw);assert.throws(()=>verify(seal.wire,{}),/installation_seal_unconfirmed/);
  const current=await observe(raw);assert.throws(()=>verify(seal.wire,current),/installation_seal_unconfirmed/);
 }
 const forged=JSON.parse(seal.wire);forged.material.catalogSha256='f'.repeat(64);forged.sha256=sha(canonical(forged.material));
 assert.throws(()=>verify(canonical(forged),awaitedCurrent,forged.sha256),/installation_seal_unconfirmed/);
});
const awaitedCurrent=await observe(installed());
test('noncanonical, extra fields, truncated, unknown version and modified material all fail closed',()=>{
 for(const wire of [seal.wire+'\n',seal.wire.slice(0,-1),canonical({...JSON.parse(seal.wire),extra:true}),
  seal.wire.replace('prepared-result','other-result'),seal.wire.replace('"version":1','"version":2')])
  assert.throws(()=>verify(wire,awaitedCurrent),/installation_seal_unconfirmed/);
 const forged=JSON.parse(seal.wire);forged.material.extra=true;forged.sha256=sha(canonical(forged.material));
 assert.throws(()=>verify(canonical(forged),awaitedCurrent,forged.sha256),/installation_seal_unconfirmed/);
});
test('missing, wrong or additional registry rows and an unreviewed pre-install baseline are refused',async()=>{
 for(const change of [v=>{v.core.registry.entries.pop();v.core.registry.count--;},
  v=>v.core.registry.entries.at(-1).nameSha256='5'.repeat(64),
  v=>{v.core.registry.entries.push({version:'999999990004',nameSha256:'6'.repeat(64)});v.core.registry.count++;}]){
  const raw=installed();change(raw);assert.throws(()=>verify(seal.wire,{}),/unconfirmed/);
  const current=await observe(raw);assert.throws(()=>verify(seal.wire,current),/unconfirmed/);
 }
 const raw=fixture();raw.core.registry.entries[0].nameSha256='7'.repeat(64);
 const changed=await observe(raw);assert.throws(()=>prepareInstallationSeal(changed,changed,bundle),/not_ci_baseline/);
});
test('observation brands, deep immutability, bounded input and safe errors cannot be replaced by serialized hashes',async()=>{
 const raw=fixture(),observed=await observe(raw);raw.triggers[0].enabled='D';assertInstallationSealObservation(before,observed);
 assert.throws(()=>observed.core.data.roles.push({}),TypeError);
 assert.throws(()=>assertInstallationSealObservation({...before},observed),/not_observed/);
 for(const change of [v=>v.extra=true,v=>v.triggers=Array(5001).fill({}),v=>v.policies=[null],v=>delete v.core]){
  const value=fixture();change(value);await assert.rejects(observe(value),/^Error: installation_seal_observation_unavailable$/);
 }
 await assert.rejects(observeInstallationSeal(async()=>{throw Object.assign(Error('secret text'),{code:'42601'});},bundle),error=>{
  assert.equal(error.message,'installation_seal_observation_unavailable');assert.equal(error.code,'42601');assert.doesNotMatch(JSON.stringify(error),/secret/);return true;
 });
});
test('registry digest cannot supply arbitrary filenames or paths',()=>{
 assert.equal(installationSealRegistryDigest(installationSealRegistryName(seal.digest)),seal.digest);
 for(const digest of ['../unsafe','a'.repeat(63),'A'.repeat(64),'0'.repeat(64)+'/x']){
  assert.throws(()=>installationSealFileName(digest));assert.throws(()=>installationSealRegistryName(digest));
 }
 assert.throws(()=>installationSealRegistryDigest('unapproved:'+seal.digest));
});
test('Linux private journal is exclusive, reopened and durable; unsupported platforms explicitly refuse instead of simulating proof',()=>{
 if(process.platform!=='linux'){
  assert.throws(()=>createInstallationSealJournal(),/platform_unsupported/);
  assert.throws(()=>openInstallationSealJournal(path.resolve('output')),/platform_unsupported/);return;
 }
 const journal=createInstallationSealJournal(),file=path.join(journal.root,installationSealFileName(seal.digest));
 assert.equal(journal.write(seal),seal.digest);assert.equal(openInstallationSealJournal(journal.root).read(seal.digest),seal.wire);
 assert.throws(()=>journal.write(seal),error=>error.code==='EEXIST');assert.equal(readFileSync(file,'utf8'),seal.wire);
 chmodSync(file,0o644);try{assert.throws(()=>journal.read(seal.digest),/file_privacy/);}finally{chmodSync(file,0o600);}
 const symlinkDigest='a'.repeat(64);symlinkSync(file,path.join(journal.root,installationSealFileName(symlinkDigest)));
 assert.throws(()=>journal.read(symlinkDigest),error=>error.code==='ELOOP');
 const hardlinkDigest='b'.repeat(64);linkSync(file,path.join(journal.root,installationSealFileName(hardlinkDigest)));
 assert.throws(()=>journal.read(seal.digest),/file_type/);
 const corruptDigest='c'.repeat(64);writeFileSync(path.join(journal.root,installationSealFileName(corruptDigest)),'{',{flag:'wx',mode:0o600});
 assert.throws(()=>journal.read(corruptDigest));
});
test('isolated installation retains original checks, prepares before commit and recovers via a fresh connection without replay',async()=>{
 const source=await readFile('scripts/member-checkout-installation-acceptance.mjs','utf8');
 assert.ok(source.indexOf('journal.write(seal)')<source.indexOf('commitDispatched=true'));
 assert.match(source,/if\(!commitDispatched\)await db\.query\('ROLLBACK'\)/);
 assert.match(source,/COMMIT; SELECT 1\/0/);assert.match(source,/assert\.equal\(opened,connections\+1\)/);
 assert.match(source,/await installed\(db\);[\s\S]*?verifyInstallationSeal\(reopened\.read/);
 assert.match(source,/assertInstallationSealObservation\(sealBaseline,currentSeal\)/);
 const workflow=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
 assert.match(workflow,/ack-mode: \[normal, commit-unknown\]/);
 assert.match(workflow,/FAOLLA_CHECKOUT_INSTALLATION_ACK_MODE: \$\{\{ matrix\.ack-mode \}\}/);
 assert.doesNotMatch(workflow,/workflow_dispatch:|secrets\.|environment:|ssh |scp /);
});
