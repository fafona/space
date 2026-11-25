// An explicit source overlay for an owned application candidate. Never changes
// the frozen worktree, old source bundle, an existing build or a deployed app.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,realpath,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
import {loadCredentialDeliveryRevision} from './member-checkout-credential-delivery-revision.mjs';
import {assertIsolatedCi} from './member-checkout-real-auth-support.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),lf=value=>value.replace(/\r\n/g,'\n');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const entry='src/lib/merchantCheckoutRuntime.server.ts';
const replace=(text,before,after)=>{assert.equal(text.split(before).length,2,'candidate_source_marker_changed');return text.replace(before,after);};
export function assertCredentialCandidateCi(){const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');assert.equal(process.env.FAOLLA_CHECKOUT_CREDENTIAL_NEXT_ACCEPTANCE,'1');return owned;}
export async function loadCredentialCandidateSources(){
 const component=await loadCredentialDeliveryRevision();assert.equal(component.sha256,'b0a6c4eecd0ed53433d0d253e10caa4d1621027a28fcded05299c15e136b61d1');
 const env=lf(await readFile(entry,'utf8'));let delivery=lf(await readFile('scripts/fixtures/merchant-checkout-runtime-delivery.ts','utf8'));
 delivery=replace(delivery,'// Independent, default-off delivery revision. Frozen src client remains intact;\n// this module is NOT wired into Next.js until a separately bound candidate.','// Source-bound candidate delivery. Default ENV delegates to the exact retained client.');
 delivery=replace(delivery,'../../src/lib/merchantCheckoutRuntime.server','./merchantCheckoutRuntimeEnv.server');
 delivery=replace(delivery,'../../src/lib/merchantCheckoutRuntimeMethods.json','./merchantCheckoutRuntimeMethods.json');
 delivery=replace(delivery,'./merchant-checkout-credential-file','./merchantCheckoutCredentialFile.server');
 delivery=replace(delivery,'export function createFileDeliveryRuntimeClient','export function createServerMerchantCheckoutRuntimeClient');
 const file=replace(lf(await readFile('scripts/fixtures/merchant-checkout-credential-file.ts','utf8')),'// Independent delivery revision, not imported by the frozen application yet.','// Source-bound candidate credential delivery; server filesystem only.');
 const overlay=Object.freeze({[entry]:'// Independent candidate entry; fixed original implementation retained separately.\nexport {createServerMerchantCheckoutRuntimeClient} from "./merchantCheckoutRuntimeDelivery.server";\nexport type {CheckoutRuntimeResponse} from "./merchantCheckoutRuntimeEnv.server";\n',
  'src/lib/merchantCheckoutRuntimeEnv.server.ts':env,'src/lib/merchantCheckoutRuntimeDelivery.server.ts':delivery,'src/lib/merchantCheckoutCredentialFile.server.ts':file});
 const names=[],walk=async relative=>{for(const item of await readdir(relative,{withFileTypes:true})){assert.equal(item.isSymbolicLink(),false);const name=relative+'/'+item.name;if(item.isDirectory())await walk(name);else{assert.ok(item.isFile());names.push(name);}}};await walk('src');
 names.push('package.json','package-lock.json','tsconfig.json',...(await readdir('.')).filter(n=>/^next\.config\.(?:js|mjs|ts)$/.test(n)));
 for(const name of Object.keys(overlay))if(!names.includes(name))names.push(name);names.sort();
 const hashes=[];for(const name of names){const raw=Object.hasOwn(overlay,name)?Buffer.from(overlay[name]):await readFile(name),bytes=/\.(?:tsx?|jsx?|mjs|json|css|md)$/.test(name)?Buffer.from(lf(new TextDecoder('utf-8',{fatal:true}).decode(raw))):raw;hashes.push(name+'\0'+sha(bytes));}
 const application={algorithm:'sha256-lf-path-content-v1',files:names.length,sha256:sha(hashes.join('\n'))};
 assert.deepEqual(application,{algorithm:'sha256-lf-path-content-v1',files:2974,sha256:'e41ee7fe36bf7cae3e6640c0d249f9f3822cbdd56e0175e947ae79ad2f1d0e33'});
 const material={version:1,scope:'independent-credential-next-candidate-not-production',baseApplication:component.material.frozenApplication,componentSha256:component.sha256,application,
  overlay:Object.entries(overlay).map(([file,text])=>({file,sha256:sha(text),operation:file===entry?'replace-owned-copy':'add-owned-copy'})),formalIssuerProvisioned:false,productionAuthorized:false,deploymentReady:false};
 return Object.freeze({overlay,revision:Object.freeze({material:Object.freeze(material),sha256:sha(canonical(material))})});
}
export async function materializeOwnedCredentialCandidate(fixture){
 assertCredentialCandidateCi();const {overlay,revision}=await loadCredentialCandidateSources();
 assert.equal(await realpath(fixture.root),await realpath(process.cwd()));assert.equal(await realpath(fixture.app),fixture.app);
 assert.equal(path.basename(fixture.app),'app');assert.equal(path.dirname(fixture.app),fixture.evidence);assert.ok(path.basename(fixture.evidence).startsWith('faolla-checkout-build-'));
 const relative=path.relative(await realpath(tmpdir()),fixture.evidence);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
 assert.notEqual(await realpath(fixture.app),await realpath(fixture.root));assert.equal((await lstat(fixture.evidence)).uid,process.getuid());
 assert.deepEqual(await applicationFingerprint(fixture.app),revision.material.baseApplication);
 for(const [name,text] of Object.entries(overlay))await writeFile(path.join(fixture.app,name),text,{flag:name===entry?'w':'wx',mode:0o600});
 assert.deepEqual(await applicationFingerprint(fixture.app),revision.material.application);assert.deepEqual(await applicationFingerprint(fixture.root),revision.material.baseApplication);
 return revision;
}
