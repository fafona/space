import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createInstallationSourceBundle,verifyInstallationSourceBundle,installationBundleSummary} from './member-checkout-installation-bundle.mjs';

const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const repack=material=>canonical({material,sha256:createHash('sha256').update(canonical(material)).digest('hex')});
const sample=await createInstallationSourceBundle();

test('the portable package binds all source bodies, prerequisite registry, roles and application without granting production authority',async()=>{
  const bundle=await verifyInstallationSourceBundle(sample.wire);
  assert.equal(bundle.wire,sample.wire);assert.notEqual(bundle,sample);
  assert.equal(bundle.material.planSha256,'4d8e71922c8c65b5bea46077240d9f52acdc4671fb5921a241a8dd67cada261d');
  assert.equal(bundle.material.application.files,2971);
  assert.equal(bundle.material.application.sha256,'7aaecb5c7bf82f5e43c21c408dbb4fd9b12404525abe49cadcb00d57a0a72f26');
  assert.equal(bundle.material.steps.length,33);assert.equal(bundle.material.prerequisites.sources.length,5);
  assert.equal(bundle.material.prerequisites.registry.length,5);
  assert.equal(bundle.material.installedContract.functions,80);assert.equal(bundle.material.installedContract.tables,23);
  assert.equal(bundle.material.installedContract.guards,26);
  assert.ok(Object.values(bundle.material.authority).every(value=>value===false));
  assert.equal(bundle.material.registration.productionReservation,false);
  assert.deepEqual(bundle.receipt,{version:'999999990001',name:'ci_only_checkout_bundle_'+bundle.digest});
  assert.notEqual(bundle.digest,bundle.material.planSha256);
  for(const step of bundle.material.steps)assert.equal(createHash('sha256').update(step.body).digest('hex'),step.bodySha256);
  assert.equal((await createInstallationSourceBundle()).wire,sample.wire);
});

test('changed SQL is rejected even when both its body checksum and the envelope checksum are recomputed',async()=>{
  const material=JSON.parse(sample.wire).material;
  material.steps[0].body+='\nSELECT 1;';
  material.steps[0].bodySha256=createHash('sha256').update(material.steps[0].body).digest('hex');
  await assert.rejects(verifyInstallationSourceBundle(repack(material)),/^Error: installation_bundle_unapproved$/);
});

test('self-hashed source order, registry, application, role and authority substitutions cannot supply their own approval',async()=>{
  const changes=[
    value=>value.steps.reverse(),
    value=>value.prerequisites.registry.pop(),
    value=>value.application.sha256='0'.repeat(64),
    value=>value.installedContract.runtime.bypassRls=true,
    value=>value.authority.productionExecution=true,
    value=>value.registration.version='202611250001',
    value=>value.extra='unreviewed',
  ];
  for(const change of changes){const material=JSON.parse(sample.wire).material;change(material);
    await assert.rejects(verifyInstallationSourceBundle(repack(material)),/installation_bundle_unapproved/);}
});

test('ambiguous, malformed, oversized and noncanonical wire encodings fail without returning source bytes',async()=>{
  const envelope=JSON.parse(sample.wire);
  for(const wire of [null,{},'',sample.wire+'\n',JSON.stringify(envelope,null,2),' '.repeat(2*1024*1024+1),
    sample.wire.replace('"sha256":','"sha256":"ignored-duplicate","sha256":'),
    canonical({...envelope,extra:true}),canonical({...envelope,sha256:'0'.repeat(64)})])
    await assert.rejects(verifyInstallationSourceBundle(wire),/^Error: installation_bundle_unapproved$/);
});

test('validated objects are deeply immutable and reports cannot serialize SQL, registry names or roles',()=>{
  for(const change of [()=>sample.material.steps.pop(),()=>sample.material.steps[0].body='changed',
    ()=>sample.material.prerequisites.registry[0].name='changed',()=>sample.receipt.version='changed'])assert.throws(change,TypeError);
  const summary=installationBundleSummary(sample);
  assert.equal(summary.sha256,sample.digest);assert.equal(summary.productionAuthorized,false);
  assert.equal(summary.registryRows,5);assert.equal(summary.steps,33);
  assert.doesNotMatch(JSON.stringify(summary),/CREATE |BEGIN|body|ci_only_checkout_bundle_|faolla_checkout_runtime|registry":/);
  assert.throws(()=>installationBundleSummary(JSON.parse(JSON.stringify(sample))),/installation_bundle_not_verified/);
});

test('packaging has no production transports and the owned database rehearsal executes only independently verified bytes',async()=>{
  const source=await readFile('scripts/member-checkout-installation-bundle.mjs','utf8');
  assert.doesNotMatch(source,/process\.env|spawn|fetch\(|\.query\(|writeFile|PRIVATE_KEY|SUPABASE/);
  const rehearsal=await readFile('scripts/member-checkout-installation-acceptance.mjs','utf8');
  assert.match(rehearsal,/verifyInstallationSourceBundle\(await readFile\(bundleFile,'utf8'\)\)/);
  assert.match(rehearsal,/assert\.equal\(approved\.digest,bundle\.digest,'installation_bundle_changed'\)/);
  assert.match(rehearsal,/for\(const step of approved\.material\.steps\)\{await db\.query\(step\.body\)/);
  assert.ok(rehearsal.indexOf('verifyInstallationSourceBundle(await readFile(bundleFile')<rehearsal.indexOf('const db=await open();let applied=0'));
  assert.match(rehearsal,/flag:'wx',mode:0o600/);
  const workflow=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
  assert.match(workflow,/node --test scripts\/member-checkout-installation-plan\.test\.mjs scripts\/member-checkout-installation-bundle\.test\.mjs/);
  assert.doesNotMatch(workflow,/path:.*installation-bundle|secrets\.|environment:|workflow_dispatch:|ssh |scp /);
});
