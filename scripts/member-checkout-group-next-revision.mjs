// Separate combined-topology evidence, not a refreshed application/source pin.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {loadCredentialCandidateSources} from './member-checkout-credential-candidate.mjs';
import {loadCredentialRenewalRevision} from './member-checkout-credential-renewal-revision.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export async function loadGroupNextRevision(){
 const {revision:candidate}=await loadCredentialCandidateSources(),renewal=await loadCredentialRenewalRevision();assert.equal(candidate.sha256,'b089e6595e8ed06e5e0a38da0edfb701a264be571878e4a5ac0bfee8b5b77603');assert.equal(renewal.sha256,'5a7381a219f5c6f2c359610b740dff40c861407c6d32fb899eebbbae026b2d3d');
 const sources=[];for(const file of ['scripts/member-checkout-group-runtime-host.mjs','scripts/member-checkout-group-runtime-supervisor.mjs','scripts/fixtures/member-checkout-group-runtime-worker.mjs','scripts/member-checkout-group-next-acceptance.mjs','scripts/member-checkout-group-next.test.mjs','scripts/fixtures/member-checkout-rollback-local-server.mjs']){assert.equal(await realpath(file),path.resolve(file));sources.push({file,sha256:sha((await readFile(file,'utf8')).replace(/\r\n/g,'\n'))});}
 const material={version:1,scope:'owned-built-next-automatic-renewal-distinct-uid-not-production',candidateRevisionSha256:candidate.sha256,renewalRevisionSha256:renewal.sha256,application:candidate.material.application,frozenApplication:candidate.material.baseApplication,sources,formalSigningKeysRead:false,formalIssuerProvisioned:false,productionAuthorized:false,deploymentReady:false};return{material,sha256:sha(canonical(material))};
}
