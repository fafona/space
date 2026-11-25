// Reviewable source bytes, not a production installer or migration reservation.
// No connector, credentials, filesystem writes or activation live in this file.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const maxBytes=2*1024*1024;
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const freeze=value=>{
  if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}
  return value;
};
const verified=new WeakSet();

async function localBundle() {
  // Always compare with independently loaded, frozen application/SQL sources.
  // A self-consistent hash supplied by a caller is NOT source approval.
  const plan=await loadInstallationPlan();
  const material={
    version:1,
    kind:'member-checkout-reviewed-installation-source-v1',
    scope:'owned-ci-only-not-production',
    planSha256:plan.digest,
    application:plan.material.application,
    prerequisites:{
      sources:plan.originals.map(({file,sha256})=>({file,sha256})),
      registry:plan.registry,
      protocolSha256:sha(canonical(plan.prerequisites)),
      newRolesMustBeAbsent:['faolla_checkout_executor','faolla_checkout_runtime'],
    },
    installedContract:{
      protocolSha256:sha(canonical(plan.expected)),
      functions:plan.expected.functions.length,tables:plan.expected.tables.length,guards:plan.expected.triggers.length,
      entry:'public.faolla_checkout_runtime_v1(text,jsonb)',
      runtime:{name:'faolla_checkout_runtime',login:false,inherit:false,bypassRls:false,dispatcherOnly:true},
      executor:{name:'faolla_checkout_executor',login:false,inherit:false,bypassRls:true},
      roleMemberships:'none',unexpectedGrantees:'refuse-not-repair',
    },
    registration:{version:'999999990001',namePrefix:'ci_only_checkout_bundle_',bind:'bundle-sha256',productionReservation:false},
    transaction:{mode:'one-transaction',lockTimeoutMs:1000,statementTimeoutMs:15000,advisoryLock:[20261125,6064]},
    authority:{productionExecution:false,credentials:false,authenticatorGrant:false,pilotActivation:false,
      businessDataChanges:false,stripe:false,mail:false,backgroundWorkers:false},
    steps:plan.steps.map(({file,sha256,body})=>({file,sourceSha256:sha256,bodySha256:sha(body),body})),
  };
  const digest=sha(canonical(material)),wire=canonical({sha256:digest,material});
  assert.ok(Buffer.byteLength(wire,'utf8')<=maxBytes,'installation_bundle_too_large');
  const result=freeze({digest,wire,material,receipt:{version:material.registration.version,name:material.registration.namePrefix+digest}});
  verified.add(result);return result;
}

export async function createInstallationSourceBundle() { return localBundle(); }

/** Accept only the exact canonical wire document produced from trusted local
 * source. Reject unknown fields, duplicates, reorderings, CRLF or a rehashed
 * attacker payload. Return a fresh deeply frozen local object, not parsed input.
 * Hashes give integrity/binding, NOT signatures or permission to install. */
export async function verifyInstallationSourceBundle(wire) {
  try {
    assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire,'utf8')<=maxBytes);
    const envelope=JSON.parse(wire);
    assert.equal(envelope?.sha256,sha(canonical(envelope?.material)));
    assert.equal(canonical(envelope),wire);
    const expected=await localBundle();assert.equal(expected.wire,wire);
    return expected;
  } catch { throw Error('installation_bundle_unapproved'); }
}

// Only this non-sensitive summary is suitable for uploaded CI reports.
export function installationBundleSummary(bundle) {
  assert.ok(verified.has(bundle),'installation_bundle_not_verified');
  return {
    sha256:bundle.digest,planSha256:bundle.material.planSha256,scope:bundle.material.scope,
    application:bundle.material.application,steps:bundle.material.steps.length,
    prerequisiteSources:bundle.material.prerequisites.sources.length,
    registryRows:bundle.material.prerequisites.registry.length,
    contractSha256:bundle.material.installedContract.protocolSha256,
    productionAuthorized:false,
  };
}
