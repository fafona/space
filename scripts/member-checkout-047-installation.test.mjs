import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,writeFile,chmod,symlink,link} from 'node:fs/promises';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {createInstallationSourceBundle,verifyInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {installationSealSql} from './member-checkout-installation-seal.mjs';
import {createCheckout047InstallationBundle,verifyCheckout047InstallationBundle,checkout047InstallationBundleSummary,
 checkout047InstallationSealSql,observeCheckout047Installation,assertCheckout047InstallationObservation,
 prepareCheckout047InstallationSeal,verifyCheckout047InstallationSeal,checkout047InstallationSealSummary,
 source047RegistryVersion,seal047RegistryVersion,checkout047SealRegistryName,checkout047SealRegistryDigest} from './member-checkout-047-installation.mjs';
import {createCheckout047InstallationJournal,openCheckout047InstallationJournal,checkout047SealFileName} from './member-checkout-047-installation-journal.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const bundle=await createCheckout047InstallationBundle();
const entries=rows=>rows.map(({version,name})=>({version,nameSha256:sha(name)})).sort((a,b)=>a.version.localeCompare(b.version));
const fixture=()=>({core:{context:{backendPid:100,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
 target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_test',databaseOwner:'owned_admin',databaseEncoding:'UTF8',serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',actor:{oid:'1234',rolname:'owned_admin',rolsuper:true}},
 registry:{count:6,entries:entries(bundle.material.prerequisites.registry)},roles:[{oid:'1234',rolname:'owned_admin',rolsuper:true}],memberships:[],defaultAcls:[],schemas:[{name:'public',owner:'owned_admin'}],
 relations:[{oid:'3456',namespace:'public',name:'faolla_redemption_checkouts'}],columns:[{relation:'3456',ordinal:1,name:'id',type:'text',not_null:true}],constraints:[],indexes:[],functions:[],extensions:[]},
 triggers:[{oid:'3457',relation:'3456',name:'synthetic_guard',enabled:'O',function_sha256:'2'.repeat(64)}],policies:[]});
const observe=raw=>observeCheckout047Installation(async sql=>{assert.equal(sql,checkout047InstallationSealSql);return {rows:[{metadata:raw}]};},bundle);
const before=await observe(fixture()),rawAfter=fixture();rawAfter.core.schemas.push({name:'faolla_checkout_design',owner:'owned_admin'});
const after=await observe(rawAfter),seal=prepareCheckout047InstallationSeal(before,after,bundle);
const installed=()=>{const value=structuredClone(rawAfter);value.core.registry={count:8,entries:entries([...bundle.material.prerequisites.registry,bundle.receipt,{version:seal047RegistryVersion,name:checkout047SealRegistryName(seal.digest)}])};return value;};
const current=await observe(installed());
const verify=(wire,observed=current,digest=seal.digest)=>verifyCheckout047InstallationSeal(wire,{expectedSha256:digest,before,current:observed,bundle});

test('the separate 38-step package binds all six prerequisites and 047 source without changing the old frozen package',async()=>{
 assert.equal(bundle.digest,'f34249f74c0311323fac2f7779fe14ea3151ffacc74d3b5cacf75de8d41d839e');
 assert.equal((await createInstallationSourceBundle()).digest,'8f4cb6b006d464c2f20ddad7cacc68f169f7a80885dae3749ad3abb934453f72');
 assert.equal(bundle.material.steps.length,38);assert.equal(bundle.material.prerequisites.sources.length,6);assert.equal(bundle.material.prerequisites.registry.length,6);
 assert.equal(bundle.material.prerequisites.legacySourcesToExecute,0);assert.equal(bundle.prerequisites.functions.length,26);
 assert.deepEqual(bundle.material.steps.slice(-4).map(v=>v.id),bundle.contract.revision.patches.map(v=>'047-overlay:'+v.function));
 for(const step of bundle.material.steps){assert.equal(sha(step.body),step.bodySha256);assert.ok(splitInstallationSql(step.body).every(v=>!/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(v.command)));}
 assert.equal(bundle.material.authority.productionExecution,false);assert.ok(Object.isFrozen(bundle.material));
 assert.equal(bundle.receipt.version,source047RegistryVersion);assert.throws(()=>checkout047InstallationBundleSummary({...bundle}),/unverified/);
});
test('source verification rejects altered SQL, prerequisites, ordering, roles, pins and authority despite recomputed envelope hashes',async()=>{
 for(const change of [m=>{m.steps.at(-1).body+='\nSELECT 1;';m.steps.at(-1).bodySha256=sha(m.steps.at(-1).body);},m=>m.steps.reverse(),m=>m.prerequisites.sources.pop(),
  m=>m.prerequisites.registry[0].name='changed',m=>m.revisionSha256='0'.repeat(64),m=>m.installedContract.runtime.bypassRls=true,m=>m.authority.productionExecution=true,m=>m.registration.productionReservation=true]){
  const material=structuredClone(bundle.material);change(material);await assert.rejects(verifyCheckout047InstallationBundle(canonical({material,sha256:sha(canonical(material))})),/^Error: checkout_047_installation_bundle_unapproved$/);
 }
 assert.equal((await verifyCheckout047InstallationBundle(bundle.wire)).digest,bundle.digest);
 await assert.rejects(verifyInstallationSourceBundle(bundle.wire),/installation_bundle_unapproved/);
 await assert.rejects(verifyCheckout047InstallationBundle((await createInstallationSourceBundle()).wire),/047_installation_bundle_unapproved/);
});
test('canonical bounded wire and branded immutable summaries cannot substitute source approval',async()=>{
 for(const wire of [bundle.wire+'\n',bundle.wire.slice(0,-1),canonical({...JSON.parse(bundle.wire),extra:true}),' '.repeat(2*1024*1024+1)])await assert.rejects(verifyCheckout047InstallationBundle(wire),/bundle_unapproved/);
 const summary=JSON.stringify(checkout047InstallationBundleSummary(bundle));assert.doesNotMatch(summary,/CREATE FUNCTION|"body"|owned_admin|owned_test/);
 assert.throws(()=>bundle.material.steps.pop(),TypeError);assert.throws(()=>checkout047InstallationSealSummary({...seal}),/not_prepared/);
});
test('the independent fixed metadata query extends both old financial tables, remains SELECT-only and parses on a real engine',async()=>{
 assert.notEqual(checkout047InstallationSealSql,installationSealSql);assert.equal(splitInstallationSql(checkout047InstallationSealSql+';').length,1);
 for(const name of ['faolla_redemption_checkouts','faolla_redemption_operations'])assert.equal(checkout047InstallationSealSql.split("'"+name+"'").length,3);
 assert.doesNotMatch(checkout047InstallationSealSql,/\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|CALL|COPY|SET|BEGIN|COMMIT|ROLLBACK)\b/i);
 assert.doesNotMatch(checkout047InstallationSealSql,/rolpassword|auth\.users|SELECT\s+\*\s+FROM\s+public\.pages/i);
 const db=new PGlite();try{await db.exec('CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL)');assert.ok((await db.query('EXPLAIN '+checkout047InstallationSealSql)).rows.length>0);}finally{await db.close();}
});
test('only the new six-source baseline and matching eight-row committed receipt pair can confirm a prepared seal',async()=>{
 assert.throws(()=>verify(seal.wire,after),/seal_unconfirmed/);assert.equal(verify(seal.wire).digest,seal.digest);
 for(const change of [v=>{v.core.registry.entries.pop();v.core.registry.count--;},v=>v.core.registry.entries[0].nameSha256='3'.repeat(64),v=>{v.core.registry.entries.push({version:'999999990049',nameSha256:'4'.repeat(64)});v.core.registry.count++;}]){
  const raw=installed();change(raw);const changed=await observe(raw);assert.throws(()=>verify(seal.wire,changed),/seal_unconfirmed/);
 }
 const old=fixture();old.core.registry.entries.pop();old.core.registry.count--;
 const observed=await observe(old);assert.throws(()=>prepareCheckout047InstallationSeal(observed,observed,bundle),/not_six_source_baseline/);
});
test('full target, trigger, policy, role, column, constraint and index drift cannot reuse a valid or self-rehashed seal',async()=>{
 for(const change of [v=>v.core.constraints.push({name:'extra'}),v=>v.core.columns[0].not_null=false,v=>v.core.indexes.push({valid:false}),
  v=>v.triggers[0].enabled='D',v=>v.policies.push({name:'extra'}),v=>v.core.roles[0].rolsuper=false,v=>v.core.target.databaseOid='98765']){
  const raw=installed();change(raw);const changed=await observe(raw);assert.throws(()=>verify(seal.wire,changed),/seal_unconfirmed/);
 }
 const forged=JSON.parse(seal.wire);forged.material.catalogSha256='f'.repeat(64);forged.sha256=sha(canonical(forged.material));assert.throws(()=>verify(canonical(forged),current,forged.sha256),/seal_unconfirmed/);
});
test('malformed metadata, copied observation brands and raw errors cannot confer observation or authority',async()=>{
 const raw=fixture(),same=await observe(raw);raw.triggers[0].enabled='D';assertCheckout047InstallationObservation(before,same);
 assert.throws(()=>assertCheckout047InstallationObservation({...before},same),/not_observed/);assert.throws(()=>same.data.core.roles.push({}),TypeError);
 for(const change of [v=>v.extra=true,v=>v.triggers=Array(5001).fill({}),v=>v.policies=[null],v=>delete v.core,v=>v.core.registry.count=7]){const value=fixture();change(value);await assert.rejects(observe(value),/^Error: checkout_047_observation_unavailable$/);}
 await assert.rejects(observeCheckout047Installation(async()=>{throw Object.assign(Error('private sentinel'),{code:'42601'});},bundle),e=>e.message==='checkout_047_observation_unavailable'&&e.code==='42601'&&!JSON.stringify(e).includes('sentinel'));
 assert.doesNotMatch(JSON.stringify(checkout047InstallationSealSummary(seal)),/owned_test|owned_admin|attemptId|"wire"/);
});
test('seal files are independently private, exclusive, reopened and durable on Linux, never simulated on Windows',async()=>{
 for(const digest of ['../unsafe','A'.repeat(64),'0'.repeat(63)]){assert.throws(()=>checkout047SealFileName(digest));assert.throws(()=>checkout047SealRegistryName(digest));}
 assert.equal(checkout047SealRegistryDigest(checkout047SealRegistryName(seal.digest)),seal.digest);
 if(process.platform!=='linux'){assert.throws(()=>createCheckout047InstallationJournal(),/platform_unsupported/);assert.throws(()=>openCheckout047InstallationJournal(path.resolve('output')),/platform_unsupported/);return;}
 const journal=createCheckout047InstallationJournal(),file=path.join(journal.root,checkout047SealFileName(seal.digest));assert.equal(journal.write(seal),seal.digest);
 assert.equal(openCheckout047InstallationJournal(journal.root).read(seal.digest),seal.wire);assert.throws(()=>journal.write(seal),e=>e.code==='EEXIST');
 await chmod(file,0o644);try{assert.throws(()=>journal.read(seal.digest),/file_privacy/);}finally{await chmod(file,0o600);}
 await symlink(file,path.join(journal.root,checkout047SealFileName('a'.repeat(64))));assert.throws(()=>journal.read('a'.repeat(64)),e=>e.code==='ELOOP');
 await link(file,path.join(journal.root,checkout047SealFileName('b'.repeat(64))));assert.throws(()=>journal.read(seal.digest),/file_type/);
 await writeFile(path.join(journal.root,checkout047SealFileName('c'.repeat(64))),'{',{flag:'wx',mode:0o600});assert.throws(()=>journal.read('c'.repeat(64)));
});
test('source/seal modules have no connector, environment, authority switch or mutation, and the new rehearsal preserves owned guards',async()=>{
 const source=await readFile('scripts/member-checkout-047-installation.mjs','utf8');assert.doesNotMatch(source,/process\.env|child_process|writeFile|appendFile|\bfetch\s*\(|from ['"](?:pg|node:net|node:https?)['"]/);
 assert.doesNotMatch(source,/productionAuthorized:\s*true|deploymentReady:\s*true/);
 const runner=await readFile('scripts/member-checkout-047-installation-acceptance.mjs','utf8');
 assert.ok(runner.indexOf('verifyCheckout047InstallationBundle(await readFile(bundleFile')<runner.indexOf('const db=await open();let applied'));
 assert.ok(runner.indexOf('journal.write(seal)')<runner.indexOf('commitDispatched=true'));
 assert.match(runner,/if\(!commitDispatched\)await db.query\('ROLLBACK'\)/);assert.match(runner,/COMMIT; SELECT 1\/0/);assert.match(runner,/assert.equal\(opened,count\+1\)/);
 assert.match(runner,/openCheckout047InstallationJournal\(journal.root\)/);assert.match(runner,/assert.equal\(process.env.FAOLLA_CHECKOUT_047_INSTALLATION_ACCEPTANCE,'1'/);
 const privileges=await readFile('scripts/member-checkout-047-installation-privileges.mjs','utf8');assert.doesNotMatch(privileges,/\b(?:GRANT|REVOKE|ALTER|INSERT|UPDATE|DELETE)\s+(?:ON|EXECUTE|FUNCTION|ROLE|TABLE|SCHEMA|INTO|FROM)/);
});
test('both new installation paths remain hosted branch-only, opt-in and separate from unchanged old installation evidence',async()=>{
 const workflow=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8'),old=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
 assert.match(workflow,/branches:\s+- acceptance\/member-checkout-real-auth-20261125/);assert.match(workflow,/permissions:\s+contents: read/);
 assert.match(workflow,/ack-mode: \[normal, commit-unknown\]/);assert.match(workflow,/FAOLLA_CHECKOUT_047_INSTALLATION_ACCEPTANCE: '1'/);
 assert.match(workflow,/run: node --import tsx --test scripts\/member-checkout-047-installation-acceptance.mjs/);
 assert.match(workflow,/path: \$\{\{ runner.temp \}\}\/faolla-install-047-evidence\/report.json/);
 assert.match(workflow,/name: member-checkout-047-installation-\$\{\{ matrix.ack-mode \}\}/);
 assert.doesNotMatch(workflow,/secrets\.|contents: write|workflow_run:|workflow_dispatch:|pull_request:|environment:|ssh |scp /);
 assert.doesNotMatch(old,/047_INSTALLATION|047-installation/);assert.match(old,/scripts\/member-checkout-installation-acceptance.mjs/);
});
