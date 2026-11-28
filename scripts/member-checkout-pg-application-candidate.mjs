// Separate TEMP application candidate. No original source/lock mutation.
import assert from 'node:assert/strict';
import {readFile,readdir,lstat,realpath,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),lf=v=>v.replaceAll('\r\n','\n');
const base={algorithm:'sha256-lf-path-content-v1',files:2971,sha256:'7aaecb5c7bf82f5e43c21c408dbb4fd9b12404525abe49cadcb00d57a0a72f26'};
const entry='src/lib/merchantCheckoutRuntime.server.ts';
const replace=(text,before,after)=>{assert.equal(text.split(before).length,2,'pg_candidate_marker_changed');return text.replace(before,after);};
// Only the owned synthetic site is enabled, with every existing nested gate.
// This is test configuration, never an application or production default.
export function ownedPgApplicationPilotEnvironment(siteId){
 assert.match(siteId,/^\d{8}$/);
 return Object.fromEntries(['MERCHANT_MEMBER_CHECKOUT_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES',
  'MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES'].map(key=>[key,siteId]));
}
export async function loadPgApplicationCandidate(){
 assert.deepEqual(await applicationFingerprint(),base,'pg_candidate_original_application_changed');
 const dependencyBytes=lf(await readFile('scripts/fixtures/member-checkout-pg-dependencies.json','utf8'));
 assert.equal(sha(dependencyBytes),'e67b3b0ce9024b311f258eef7c2e0ba442892ec8e4a269db4fcc630da65a3304');
 const patch=JSON.parse(dependencyBytes);
 assert.equal(patch.version,1);assert.equal(patch.pg,'8.23.1');assert.equal(Object.keys(patch.packages).length,14);
 const pkg=JSON.parse(await readFile('package.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8'));
 assert.equal(pkg.dependencies.pg,undefined);assert.equal(lock.packages[''].dependencies.pg,undefined);
 pkg.dependencies.pg=patch.pg;lock.packages[''].dependencies.pg=patch.pg;
 for(const [name,item]of Object.entries(patch.packages)){
  assert.match(name,/^node_modules\/[a-z0-9-]+$/);assert.match(item.integrity,/^sha512-[A-Za-z0-9+/=]+$/);assert.ok(item.resolved.startsWith('https://registry.npmjs.org/'));assert.equal(item.hasInstallScript,undefined);
  if(Object.hasOwn(lock.packages,name)){
   const previous={...lock.packages[name]};delete previous.dev;
   assert.deepEqual(previous,item,'pg_dependency_conflict');lock.packages[name]=previous;
  }else lock.packages[name]=item;
 }
 const core=replace(lf(await readFile('scripts/fixtures/merchant-checkout-pg-core.ts','utf8')),'../../src/lib/merchantCheckoutRuntimeMethods.json','./merchantCheckoutRuntimeMethods.json');
 let selected=replace(lf(await readFile('scripts/fixtures/merchant-checkout-pg-entry.ts','utf8')),'../../src/lib/merchantCheckoutRuntime.server','./merchantCheckoutRuntimeEnv.server');
 selected=replace(selected,'./merchant-checkout-pg-core','./merchantCheckoutPgCore.server');
 const overlay={
  [entry]:'// Separate PostgreSQL candidate; original ENV entry is byte-preserved.\nexport {createServerMerchantCheckoutRuntimeClient} from "./merchantCheckoutPgEntry.server";\nexport type {CheckoutRuntimeResponse} from "./merchantCheckoutRuntimeEnv.server";\n',
  'src/lib/merchantCheckoutRuntimeEnv.server.ts':lf(await readFile(entry,'utf8')),
  'src/lib/merchantCheckoutPgCore.server.ts':core,'src/lib/merchantCheckoutPgEntry.server.ts':selected,
  'package.json':JSON.stringify(pkg,null,2)+'\n','package-lock.json':JSON.stringify(lock,null,2)+'\n',
 };
 const names=[];async function walk(relative){for(const item of await readdir(relative,{withFileTypes:true})){assert.equal(item.isSymbolicLink(),false);const name=relative+'/'+item.name;if(item.isDirectory())await walk(name);else{assert.ok(item.isFile());names.push(name);}}}await walk('src');
 names.push('package.json','package-lock.json','tsconfig.json',...(await readdir('.')).filter(n=>/^next\.config\.(?:js|mjs|ts)$/.test(n)));
 for(const name of Object.keys(overlay))if(!names.includes(name))names.push(name);names.sort();
 const hashes=[];for(const name of names){const raw=Object.hasOwn(overlay,name)?Buffer.from(overlay[name]):await readFile(name);const bytes=/\.(?:tsx?|jsx?|mjs|json|css|md)$/.test(name)?Buffer.from(lf(new TextDecoder('utf-8',{fatal:true}).decode(raw))):raw;hashes.push(name+'\0'+sha(bytes));}
 const application={algorithm:base.algorithm,files:names.length,sha256:sha(hashes.join('\n'))};assert.equal(application.files,2974);
 const material={version:1,scope:'isolated-direct-pg-application-candidate',baseApplication:base,application,
  overlay:Object.entries(overlay).map(([file,text])=>({file,sha256:sha(text)})),pgVersion:patch.pg,pgDependencyPackages:14,
  originalBusinessSqlChanged:false,productionAuthorized:false,deploymentReady:false};
 return {overlay,patch,revision:{material,sha256:sha(JSON.stringify(material))}};
}
export async function materializePgApplicationCandidate(fixture,driverDirectory,{productionBuild=false}={}){
 assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
 assert.equal(process.env.GITHUB_REF,'refs/heads/acceptance/member-checkout-pg-app-20261128');
 const {overlay,patch,revision}=await loadPgApplicationCandidate();
 assert.equal(await realpath(fixture.root),await realpath(process.cwd()));assert.equal(await realpath(fixture.app),fixture.app);assert.equal(path.basename(fixture.app),'app');assert.equal(path.dirname(fixture.app),fixture.evidence);
 assert.equal(typeof productionBuild,'boolean');
 const relative=path.relative(await realpath(tmpdir()),fixture.evidence);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(fixture.evidence).startsWith(productionBuild?'faolla-checkout-build-':'faolla-checkout-next-'));
 assert.equal((await lstat(fixture.evidence)).uid,process.getuid());assert.deepEqual(await applicationFingerprint(fixture.app),base);
 for(const [name,text]of Object.entries(overlay))await writeFile(path.join(fixture.app,name),text,{flag:[entry,'package.json','package-lock.json'].includes(name)?'w':'wx',mode:0o600});
 // Only the 14 integrity-pinned driver dependencies are copied; none of the
 // original dependency junctions or packages are rewritten.
 for(const [name,pinned]of Object.entries(patch.packages)){
  const source=path.join(driverDirectory,name),destination=path.join(fixture.app,name);
  assert.equal(JSON.parse(await readFile(path.join(source,'package.json'),'utf8')).version,pinned.version);
  try{await lstat(destination);assert.equal(name,'node_modules/split2');}catch(e){if(e.code!=='ENOENT')throw e;await cp(source,destination,{recursive:true,errorOnExist:true,force:false,dereference:true});}
 }
 assert.deepEqual(await applicationFingerprint(fixture.app),revision.material.application);assert.deepEqual(await applicationFingerprint(fixture.root),base);
 return revision;
}
