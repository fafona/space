// Read-only, unapproved prototype identity. Never refresh the old application
// pin or pretend this is an installed/built Next.js revision.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function loadCredentialDeliveryRevision(){
 const application=await applicationFingerprint();assert.deepEqual(application,{algorithm:'sha256-lf-path-content-v1',files:2971,sha256:'7aaecb5c7bf82f5e43c21c408dbb4fd9b12404525abe49cadcb00d57a0a72f26'});
 const original=(await readFile('src/lib/merchantCheckoutRuntime.server.ts','utf8')).replace(/\r\n/g,'\n');assert.equal(sha(original),'af8c5ac2acbdba24dc2325fcf99377a95529d2188773a836d7fa3df49f30054a');
 const sources=[];for(const file of ['scripts/fixtures/merchant-checkout-credential-file.ts','scripts/fixtures/merchant-checkout-runtime-delivery.ts','scripts/member-checkout-credential-file.test.ts']){
  assert.equal(await realpath(file),path.resolve(file));sources.push(Object.freeze({file,sha256:sha((await readFile(file,'utf8')).replace(/\r\n/g,'\n'))}));
 }
 const material=Object.freeze({version:1,kind:'checkout-credential-delivery-prototype-v1',scope:'independent-fixture-not-application-integration',frozenApplication:Object.freeze(application),originalRuntimeSha256:sha(original),sources:Object.freeze(sources),
  formalSigningKeysRead:false,formalIssuerProvisioned:false,applicationIntegrated:false,groupDistinctUidValidated:false,productionAuthorized:false,deploymentReady:false});
 return Object.freeze({material,sha256:sha(canonical(material))});
}
