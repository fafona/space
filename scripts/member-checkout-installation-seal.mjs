// Prepared result evidence, NOT a signature, installation permission or a
// production migration. Caller must run the original source/ACL checks too.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installationBundleSummary} from './member-checkout-installation-bundle.mjs';
import {installationPreflightSql,readInstallationPreflight,assertInstallationTarget} from './member-checkout-installation-preflight.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const observations=new WeakSet(),prepared=new WeakSet();
export const sealRegistryVersion='999999990003'; // Synthetic CI ONLY, not reserved in production.
const prefix='ci_only_checkout_seal_v1:';

// The unchanged core SELECT and the guard metadata share ONE statement snapshot.
// Full function bodies and policy/trigger expressions never leave PostgreSQL.
export const installationSealSql=`WITH core AS (${installationPreflightSql}), selected_relations AS (
 SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='faolla_checkout_design' OR n.nspname='public' AND c.relname IN
  ('pages','faolla_schema_migrations','faolla_booking_atomic_control','faolla_booking_atomic_commands')
 ) SELECT pg_catalog.jsonb_build_object('core',(SELECT metadata FROM core),
 'triggers',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY relation,name,oid),'[]'::jsonb) FROM (
  SELECT t.oid::text,t.tgrelid::text relation,t.tgname::text name,t.tgenabled enabled,t.tgisinternal internal,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,false),'UTF8')),'hex') definition_sha256,
   pg_catalog.pg_get_userbyid(p.proowner) function_owner,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') function_sha256,
   ARRAY(SELECT acl::text FROM pg_catalog.unnest(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a(acl) ORDER BY acl::text) function_acl
  FROM pg_catalog.pg_trigger t JOIN selected_relations c ON c.oid=t.tgrelid JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid) r),
 'policies',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY relation,name,oid),'[]'::jsonb) FROM (
  SELECT p.oid::text,p.polrelid::text relation,p.polname::text name,p.polcmd command,p.polpermissive permissive,
   ARRAY(SELECT role::text FROM pg_catalog.unnest(p.polroles) x(role) ORDER BY role) roles,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'UTF8')),'hex') using_sha256,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'UTF8')),'hex') check_sha256
  FROM pg_catalog.pg_policy p JOIN selected_relations c ON c.oid=p.polrelid) r)) AS metadata`;

export async function observeInstallationSeal(query,bundle) {
  try {
    const source=installationBundleSummary(bundle),result=await query(installationSealSql);
    assert.equal(result.rows.length,1);const wire=canonical(result.rows[0].metadata);
    assert.ok(Buffer.byteLength(wire,'utf8')<=3*1024*1024);const data=JSON.parse(wire);
    assert.deepEqual(Object.keys(data).sort(),['core','policies','triggers']);
    for(const key of ['triggers','policies'])assert.ok(Array.isArray(data[key])&&data[key].length<=5000&&data[key].every(v=>v&&typeof v==='object'&&!Array.isArray(v)));
    // Decode the core from that SAME real response; this is not a second read.
    const core=await readInstallationPreflight(async()=>({rows:[{metadata:data.core}]}),bundle);
    const guardsSha256=sha(canonical({triggers:data.triggers,policies:data.policies}));
    const catalogSha256=sha(canonical({coreCatalogSha256:core.catalogSha256,guardsSha256}));
    const value=freeze({core,sourceBundleSha256:source.sha256,querySha256:sha(installationSealSql),guardsSha256,catalogSha256,
      sha256:sha(canonical({coreSha256:core.sha256,guardsSha256})),triggers:data.triggers.length,policies:data.policies.length});
    observations.add(value);return value;
  } catch(error) {
    const code=/^[A-Z0-9_]{1,40}$/.test(error?.code??'')?error.code:'INSTALL_SEAL_OBSERVATION_INVALID';
    throw Object.assign(Error('installation_seal_observation_unavailable'),{code});
  }
}
export function assertInstallationSealObservation(reference,current) {
  assert.ok(observations.has(reference)&&observations.has(current),'installation_seal_not_observed');
  assertInstallationTarget(reference.core,current.core);
  assert.equal(current.sha256,reference.sha256,'installation_seal_precondition_changed');
}
const registryEntries=rows=>rows.map(({version,name})=>({version,nameSha256:sha(name)})).sort((a,b)=>a.version.localeCompare(b.version));
function materialFor(before,current,bundle,attemptId) {
  assert.ok(observations.has(before)&&observations.has(current),'installation_seal_not_observed');
  const source=installationBundleSummary(bundle);assertInstallationTarget(before.core,current.core);
  assert.equal(before.sourceBundleSha256,source.sha256);assert.equal(current.sourceBundleSha256,source.sha256);
  assert.deepEqual(before.core.data.registry.entries,registryEntries(bundle.material.prerequisites.registry),'installation_seal_not_ci_baseline');
  assert.match(attemptId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  return {version:1,scope:'owned-ci-prepared-result-not-installation-authority',attemptId,sourceBundleSha256:source.sha256,
    planSha256:source.planSha256,querySha256:sha(installationSealSql),beforeSha256:before.sha256,priorRegistrySha256:before.core.registrySha256,
    targetSha256:current.core.targetSha256,catalogSha256:current.catalogSha256,productionAuthorized:false};
}
export function prepareInstallationSeal(before,after,bundle) {
  assert.deepEqual(after.core.data.registry,before.core.data.registry,'installation_seal_registry_changed_before_prepare');
  const material=materialFor(before,after,bundle,randomUUID()),digest=sha(canonical(material));
  const value=freeze({digest,wire:canonical({sha256:digest,material}),material});prepared.add(value);return value;
}
export function installationSealRegistryName(digest) { assert.match(digest,/^[a-f0-9]{64}$/);return prefix+digest; }
export function installationSealRegistryDigest(name) {
  assert.equal(typeof name,'string');assert.ok(name.startsWith(prefix),'installation_seal_receipt_invalid');
  const digest=name.slice(prefix.length);assert.match(digest,/^[a-f0-9]{64}$/);return digest;
}
export function verifyInstallationSeal(wire,{expectedSha256,before,current,bundle}) {
  try {
    assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire,'utf8')<=65536);assert.match(expectedSha256,/^[a-f0-9]{64}$/);
    const value=JSON.parse(wire);assert.deepEqual(Object.keys(value).sort(),['material','sha256']);
    assert.equal(canonical(value),wire);assert.equal(value.sha256,expectedSha256);assert.equal(sha(canonical(value.material)),expectedSha256);
    const expected=materialFor(before,current,bundle,value.material.attemptId);
    assert.deepEqual(value.material,JSON.parse(canonical(expected)),'installation_seal_catalogue_changed');
    const expectedRegistry=registryEntries([...bundle.material.prerequisites.registry,bundle.receipt,
      {version:sealRegistryVersion,name:installationSealRegistryName(expectedSha256)}]);
    assert.deepEqual(current.core.data.registry.entries,expectedRegistry,'installation_seal_registry_pair_changed');
    assert.equal(current.core.data.registry.count,expectedRegistry.length);
    const result=freeze({digest:expectedSha256,wire,material:value.material});prepared.add(result);return result;
  } catch { throw Error('installation_seal_unconfirmed'); }
}
export function installationSealSummary(seal) {
  assert.ok(prepared.has(seal),'installation_seal_not_prepared');
  return {sha256:seal.digest,sourceBundleSha256:seal.material.sourceBundleSha256,targetSha256:seal.material.targetSha256,
    catalogSha256:seal.material.catalogSha256,scope:seal.material.scope,productionAuthorized:false};
}
