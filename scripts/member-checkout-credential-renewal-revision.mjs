// New component identity; never rewrites the old component or application pin.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {loadCredentialDeliveryRevision} from './member-checkout-credential-delivery-revision.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function loadCredentialRenewalRevision(){
 const component=await loadCredentialDeliveryRevision();assert.equal(component.sha256,'b0a6c4eecd0ed53433d0d253e10caa4d1621027a28fcded05299c15e136b61d1');
 const sources=[];for(const file of ['scripts/member-checkout-credential-renewal.mjs','scripts/member-checkout-credential-renewal.test.mjs','scripts/fixtures/member-checkout-renewal-worker.mjs','scripts/member-checkout-credential-renewal-acceptance.mjs']){assert.equal(await realpath(file),path.resolve(file));sources.push({file,sha256:sha((await readFile(file,'utf8')).replace(/\r\n/g,'\n'))});}
 const material={version:1,scope:'independent-renewal-and-os-identity-component-not-next',frozenApplication:component.material.frozenApplication,fileComponentSha256:component.sha256,sources,
  formalSigningKeysRead:false,formalIssuerProvisioned:false,applicationIntegrated:false,productionAuthorized:false,deploymentReady:false};
 return{material,sha256:sha(canonical(material))};
}
