// A separate owned-CI harness, not an extension of the six-row installer guard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {assertIsolatedCi} from './member-checkout-real-auth-support.mjs';

export const nativeInstallationModes=Object.freeze(['normal','commit-unknown']);
export function assertFullRegistryInstallationCi(env=process.env,platform=process.platform,arch=process.arch){
 const owned=assertIsolatedCi(env,platform,arch);
 assert.equal(owned.profileName,'current-auth');
 assert.equal(env.FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_ACCEPTANCE,'1');
 assert.ok(nativeInstallationModes.includes(env.FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_MODE));
 return owned;
}
export function fullRegistryInstallationEnvironment(env=process.env){
 assertFullRegistryInstallationCi(env);
 return Object.fromEntries(['GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA','RUNNER_TEMP',
  'FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE','FAOLLA_CHECKOUT_AUTH_TEST_PROFILE','FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_ACCEPTANCE',
  'FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_MODE'].map(key=>[key,env[key]]));
}
export function assertFullRegistryInstallationRequest(value){
 assertFullRegistryInstallationCi();assert.ok(value&&Object.getPrototypeOf(value)===Object.prototype);
 assert.deepEqual(Object.keys(value).sort(),['action','inputPath','inputSha256','operationId','phase','roots','stage']);
 assert.ok(['install','recover'].includes(value.action));
 assert.match(value.operationId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.match(value.inputSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(value.roots).sort(),['dataRoot','locatorRoot']);
 const parent=path.dirname(value.roots.dataRoot);
 assert.equal(path.dirname(parent),fs.realpathSync(tmpdir()));assert.match(path.basename(parent),/^faolla-checkout-evidence-test-full-native-[A-Za-z0-9]{6}$/);
 assert.equal(value.roots.dataRoot,path.join(parent,'data'));assert.equal(value.roots.locatorRoot,path.join(parent,'locators'));
 assert.equal(value.inputPath,path.join(parent,'input.private.json'));
 if(value.action==='install'){assert.equal(value.stage,'initial');assert.ok(['after34','before-commit',...nativeInstallationModes].includes(value.phase));}
 else{assert.equal(value.phase,'none');assert.ok(['prepared','confirmed'].includes(value.stage));}
 return value;
}
export function readFullRegistryInstallationInput(request){
 assertFullRegistryInstallationRequest(request);assert.ok(process.getuid()>0);
 const parent=path.dirname(request.inputPath),root=fs.lstatSync(parent);
 assert.equal(fs.realpathSync(parent),parent);assert.ok(root.isDirectory());assert.equal(root.uid,process.getuid());assert.equal(root.mode&0o7777,0o700);
 const fd=fs.openSync(request.inputPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);assert.ok(stat.isFile());assert.equal(stat.uid,process.getuid());assert.equal(stat.mode&0o7777,0o600);assert.equal(stat.nlink,1);
  assert.ok(stat.size>0&&stat.size<=4*1024*1024);
  const bytes=fs.readFileSync(fd);assert.equal(bytes.length,stat.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),request.inputSha256);
  const current=fs.lstatSync(request.inputPath);assert.equal(current.dev,stat.dev);assert.equal(current.ino,stat.ino);assert.equal(current.size,stat.size);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  assert.deepEqual(Object.keys(value).sort(),['metadata','sourceDraftSha256','version']);assert.equal(value.version,1);assert.match(value.sourceDraftSha256,/^[a-f0-9]{64}$/);
  return value;
 }finally{fs.closeSync(fd);}
}
