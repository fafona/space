import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {openCheckoutEvidenceStorage,validateCheckoutEvidenceBinding} from './member-checkout-evidence-storage.mjs';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const binding=()=>canonical({version:1,kind:'checkout-installation-storage-binding-v1',operationId:randomUUID(),sourceBundleSha256:'1'.repeat(64),targetSha256:'2'.repeat(64),beforeSha256:'3'.repeat(64),priorRegistrySha256:'4'.repeat(64)});
const provision=()=>{const parent=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'faolla-checkout-evidence-test-'));fs.chmodSync(parent,0o700);
 const roots={dataRoot:path.join(parent,'data'),locatorRoot:path.join(parent,'locators')};for(const root of Object.values(roots))fs.mkdirSync(root,{mode:0o700});return {parent,roots};};
const input=()=>({bindingWire:binding(),sourceWire:canonical({source:'owned synthetic only'}),baselineWire:canonical({baseline:1})});
const linux={skip:process.platform!=='linux'};
const begin=(store)=>{const data=input(),wire=store.begin(data);return {data,wire,op:JSON.parse(data.bindingWire).operationId};};

test('bounded canonical binding rejects ambiguity, path IDs, altered shapes and authority',()=>{
 const wire=binding();assert.equal(Object.isFrozen(validateCheckoutEvidenceBinding(wire)),true);
 for(const bad of [wire+'\n','{','null',wire.replace('"version":1','"version":2'),wire.replace(/"operationId":"[^"]+"/,'"operationId":"../escape"'),canonical({...JSON.parse(wire),productionAuthorized:true}),' '.repeat(16385),wire.replace('"version":1','"version":1,"version":1')])assert.throws(()=>validateCheckoutEvidenceBinding(bad),/^Error: checkout_evidence_binding_invalid$/);
});
test('unsupported Windows storage is explicitly refused, not simulated',()=>{
 if(process.platform==='linux')return;assert.throws(()=>openCheckoutEvidenceStorage({dataRoot:'D:/not-provisioned',locatorRoot:'D:/not-provisioned-locators'}),/platform_unsupported/);
});
test('private preprovisioned roots, exact data-only options, and root identities are required',linux,()=>{
 const {roots}=provision();let accessed=false;
 for(const bad of [null,{},Object.create(null),new Proxy(roots,{}),{...roots,extra:'bad'},{...roots,[Symbol('extra')]:'bad'},Object.defineProperty({...roots},'dataRoot',{get(){accessed=true;return roots.dataRoot;}})])assert.throws(()=>openCheckoutEvidenceStorage(bad));
 assert.equal(accessed,false);
 for(const bad of [{...roots,dataRoot:roots.dataRoot+'/..'}, {...roots,locatorRoot:roots.dataRoot}, {...roots,dataRoot:path.join(path.dirname(roots.dataRoot),'missing')}])assert.throws(()=>openCheckoutEvidenceStorage(bad));
 fs.chmodSync(roots.locatorRoot,0o755);assert.throws(()=>openCheckoutEvidenceStorage(roots),/directory_private_required/);fs.chmodSync(roots.locatorRoot,0o700);
 const store=openCheckoutEvidenceStorage(roots);try{fs.renameSync(roots.dataRoot,roots.dataRoot+'.retained');fs.mkdirSync(roots.dataRoot,{mode:0o700});assert.throws(()=>store.begin(input()),/root_changed/);}finally{store.close();}
});
test('immutable initial, prepared and confirmed evidence reopens with an independent locator chain',linux,()=>{
 const {roots}=provision();let store=openCheckoutEvidenceStorage(roots);const {data,wire,op}=begin(store);
 const prepared=store.append(wire,'prepared',canonical({seal:'owned'})),confirmed=store.append(prepared,'confirmation',canonical({confirmed:true,productionAuthorized:false}));store.close();store=openCheckoutEvidenceStorage(roots);
 try{
  const loaded=store.read(confirmed);assert.equal(loaded.locator.stage,'confirmed');assert.equal(loaded.locator.productionAuthorized,false);assert.equal(loaded.artifacts.source,data.sourceWire);assert.equal(loaded.artifacts.baseline,data.baselineWire);assert.equal(Object.isFrozen(loaded.locator.binding),true);
  assert.equal(store.locate(op,'prepared'),prepared);assert.equal(store.locate(op,'confirmed'),confirmed);assert.throws(()=>store.locate('../escape','prepared'),/locator_request_invalid/);assert.throws(()=>store.locate(op,'latest'),/locator_request_invalid/);
  assert.equal(fs.statSync(path.join(roots.dataRoot,op,'source.json')).mode&0o777,0o600);assert.equal(fs.statSync(path.join(roots.locatorRoot,op+'.confirmed.json')).mode&0o777,0o600);
  assert.throws(()=>store.begin(data),/conflict/);assert.throws(()=>store.append(wire,'prepared','{}'),/conflict/);assert.throws(()=>store.append(confirmed,'confirmation','{}'),/stage_invalid/);assert.throws(()=>store.append(wire,'confirmation','{}'),/stage_invalid/);
 }finally{store.close();}store.close();assert.throws(()=>store.read(wire),/closed/);
});
test('missing independent locator, altered chain or artifacts cannot be regenerated from supplied JSON',linux,()=>{
 for(const scenario of ['missing-locator','forged-locator','changed-artifact','changed-parent']){
  const {roots}=provision(),store=openCheckoutEvidenceStorage(roots);try{const {wire,op}=begin(store),prepared=store.append(wire,'prepared','{}');
   if(scenario==='missing-locator')fs.renameSync(path.join(roots.locatorRoot,op+'.prepared.json'),path.join(roots.locatorRoot,op+'.retained.json'));
   if(scenario==='forged-locator')assert.throws(()=>store.read(canonical({...JSON.parse(prepared),parentSha256:'0'.repeat(64)})));
   if(scenario==='changed-artifact')fs.writeFileSync(path.join(roots.dataRoot,op,'source.json'),canonical({source:'changed'}));
   if(scenario==='changed-parent')fs.writeFileSync(path.join(roots.locatorRoot,op+'.initial.json'),canonical({...JSON.parse(wire),binding:{...JSON.parse(wire).binding,targetSha256:'0'.repeat(64)}}));
   if(scenario!=='forged-locator'){assert.throws(()=>store.read(prepared));assert.throws(()=>store.locate(op,'prepared'));}
  }finally{store.close();}
 }
});
test('links, public modes, replaced operation directories and malformed UTF-8 fail closed',linux,()=>{
 for(const scenario of ['symlink','hardlink','mode','operation','utf8','bom','oversize']){
  const {roots}=provision(),store=openCheckoutEvidenceStorage(roots);try{const {wire,op}=begin(store),file=path.join(roots.dataRoot,op,'source.json');
   if(scenario==='symlink'){fs.renameSync(file,file+'.retained');fs.symlinkSync(file+'.retained',file);}
   if(scenario==='hardlink')fs.linkSync(file,file+'.extra-link');
   if(scenario==='mode')fs.chmodSync(file,0o644);
   if(scenario==='operation'){fs.renameSync(path.join(roots.dataRoot,op),path.join(roots.dataRoot,op+'.retained'));fs.mkdirSync(path.join(roots.dataRoot,op),{mode:0o700});}
   if(scenario==='utf8')fs.writeFileSync(file,Buffer.from([0xc3,0x28]));
   if(scenario==='bom')fs.writeFileSync(file,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),fs.readFileSync(file)]));
   if(scenario==='oversize')fs.writeFileSync(file,' '.repeat(2097153));
   assert.throws(()=>store.read(wire));
  }finally{store.close();}
 }
});
test('injected ENOSPC retains the partial file and refuses overwrite or automatic repair',linux,()=>{
 const {roots}=provision(),store=openCheckoutEvidenceStorage(roots),{wire,op}=begin(store),original=fs.writeFileSync;
 try{
  fs.writeFileSync=()=>{throw Object.assign(Error('injected private disk failure'),{code:'ENOSPC'});};
  assert.throws(()=>store.append(wire,'prepared','{}'),/^Error: checkout_evidence_unavailable$/);
 }finally{fs.writeFileSync=original;}
 try{
  const file=path.join(roots.dataRoot,op,'prepared.json');assert.equal(fs.statSync(file).size,0);assert.equal(fs.existsSync(path.join(roots.locatorRoot,op+'.prepared.json')),false);
  assert.throws(()=>store.append(wire,'prepared','{}'),/conflict/);assert.equal(store.read(wire).locator.stage,'initial');
 }finally{store.close();}
});
test('owned child process death after fsync/readback preserves both initial and prepared evidence', {...linux,timeout:15000},async()=>{
 const {roots}=provision();let wire;
 for(const action of ['begin','prepared']){
  const child=fork(new URL('./member-checkout-evidence-storage-worker.mjs',import.meta.url),[],{env:{},stdio:['ignore','ignore','ignore','ipc']});
  const exited=once(child,'exit'),timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{
   const received=Promise.race([once(child,'message').then(([value])=>value),exited.then(()=>{throw Error('owned_evidence_child_no_reply');})]);child.send({action,roots,input:input(),locatorWire:wire,body:'{}'});const reply=await received;
   assert.equal(reply.ok,true);wire=reply.locatorWire;assert.equal(child.kill('SIGKILL'),true);await exited;
   const reopened=openCheckoutEvidenceStorage(roots);try{assert.equal(reopened.read(wire).locator.stage,action==='begin'?'initial':'prepared');}finally{reopened.close();}
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 }
});
test('storage and worker cannot connect, discover credentials, repair or promote production authority',()=>{
 const source=fs.readFileSync(new URL('./member-checkout-evidence-storage.mjs',import.meta.url),'utf8'),worker=fs.readFileSync(new URL('./member-checkout-evidence-storage-worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source+worker,/process\.env|\bfetch\s*\(|from ['"](?:pg|node:net|node:https?)['"]|unlinkSync|rmSync|chmodSync|chownSync|productionAuthorized:\s*true/);
 assert.match(source,/O_EXCL\|fs.constants.O_NOFOLLOW/);assert.match(source,/fs\.fsyncSync\(handle\)/);assert.match(source,/fs\.fsyncSync\(fd\)/);assert.match(source,/\/proc\/self\/fd\//);
 assert.match(worker,/faolla-checkout-evidence-test-/);
});
