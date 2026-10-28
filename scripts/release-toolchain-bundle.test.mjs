import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {toolchainImportGraph} from './release-toolchain-pack.mjs';import {bundleManifest,writeNewBundle,verifyToolchainBundle,BUNDLE_MANIFEST} from './release-toolchain-bundle.mjs';
import {canonicalJson} from './release-toolchain-contracts.mjs';
const tree=()=>({'scripts/main.mjs':Buffer.from("import './child.mjs';import 'node:fs';import './data.json' with {type:'json'};export const text='import missing';"),
 'scripts/child.mjs':Buffer.from("// import './not-real.mjs'\nexport const value=1;"),'scripts/data.json':Buffer.from('{"a":1}')});
function plan(blobs=tree()){const readBlob=p=>{if(!blobs[p])throw Error('private');return blobs[p];};
 return {readBlob,manifest:bundleManifest({toolRevision:'a'.repeat(40),entrypoints:['scripts/main.mjs'],files:toolchainImportGraph({entrypoints:['scripts/main.mjs'],resources:['scripts/data.json'],readBlob})})};}
function fixture(fn){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'faolla-bundle-test-'));try{return fn(path.join(parent,'new-bundle'));}finally{fs.rmSync(parent,{recursive:true,force:true});}}
test('AST closure includes static/dynamic imports, reexports and declared non-code resources, not comments/strings',()=>{
 const blobs={...tree(),'scripts/main.mjs':Buffer.from("import './child.mjs';export {value} from './other.mjs';await import('./late.mjs');const u=new URL('./data.json',import.meta.url);"),
 'scripts/other.mjs':Buffer.from('export const value=2;'),'scripts/late.mjs':Buffer.from('export const late=true;')};
 assert.deepEqual(plan(blobs).manifest.files.map(f=>f.path),['scripts/child.mjs','scripts/data.json','scripts/late.mjs','scripts/main.mjs','scripts/other.mjs']);
});
test('a missing runtime JSON or omitted declaration fails before creating/installing a tool',()=>{
 assert.throws(()=>toolchainImportGraph({entrypoints:['scripts/main.mjs'],readBlob:p=>tree()[p]}),/resource_missing/);
 const blobs=tree();delete blobs['scripts/data.json'];assert.throws(()=>plan(blobs),/missing_file/);
});
test('unbounded dynamic imports, third-party imports, syntax errors and escapes are refused',()=>{
 for(const code of ["await import(process.env.MODULE);","import x from 'not-bundled';","import '../outside/../../secret.mjs';","const broken = ;", "const u=new URL(name,import.meta.url);"]){const blobs=tree();blobs['scripts/main.mjs']=Buffer.from(code);assert.throws(()=>plan(blobs));}
});
test('bundle fingerprint is deterministic and verifies the complete fresh copied package',()=>fixture(directory=>{
 const p=plan(),a=writeNewBundle(directory,p);assert.equal(a.files,3);assert.equal(a.publicationAuthority,false);assert.deepEqual(verifyToolchainBundle(directory),a);
 const again=plan();assert.equal(canonicalJson(again.manifest),canonicalJson(p.manifest));assert.throws(()=>writeNewBundle(directory,p),/invalid_bundle/);
}));
test('missing, modified or unexpected files fail verification, including JSON resources',()=>{
 for(const action of ['remove','modify','extra'])fixture(directory=>{writeNewBundle(directory,plan());const file=path.join(directory,'scripts','data.json');
  if(action==='remove')fs.unlinkSync(file);if(action==='modify')fs.writeFileSync(file,'{"changed":true}');if(action==='extra')fs.writeFileSync(path.join(directory,'extra.log'),'unexpected');
  assert.throws(()=>verifyToolchainBundle(directory),/missing_file|bytes_changed|extra_file/);
 });
});
test('symlink resources, duplicate/case-colliding paths and manipulated manifests are refused',()=>{
 fixture(directory=>{writeNewBundle(directory,plan());const file=path.join(directory,BUNDLE_MANIFEST),v=JSON.parse(fs.readFileSync(file,'utf8'));v.toolRevision='b'.repeat(40);fs.writeFileSync(file,canonicalJson(v));assert.throws(()=>verifyToolchainBundle(directory));});
 const p=plan();assert.throws(()=>bundleManifest({...p.manifest,files:[...p.manifest.files,{...p.manifest.files[0],path:'SCRIPTS/CHILD.MJS'}]}));
 if(process.platform!=='win32')fixture(directory=>{writeNewBundle(directory,plan());const file=path.join(directory,'scripts','data.json');fs.renameSync(file,file+'.old');fs.symlinkSync(file+'.old',file);assert.throws(()=>verifyToolchainBundle(directory));});
});
