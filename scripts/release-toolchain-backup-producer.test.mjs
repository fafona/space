import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {backupProducerGitPlan,backupProducerFailure,backupPassphraseFileText,assertProducerApplicationBackupBinding,createReviewedBookingBackup} from './release-toolchain-backup-producer.mjs';
import {inspectPinnedExecutionSource,sourceApplicationIdentity} from './release-toolchain-source.mjs';
import {FULL_REHEARSAL_SOURCES} from './release-toolchain-native-inventory.mjs';

const C='f274ad615550c83717aa7af2ad32339608e6f8aa',A='6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0';
const ROOT='/var/lib/faolla-booking-handoff/'+C+'/toolchain-admission/';
const producer=ROOT+'1793189051512-12345678-1234-1234-1234-123456789abc/producer-source';
const revision='a'.repeat(40);

test('producer protocol has fixed formal source, real remote main, private destination and no formal-ref writes',()=>{
 const plan=backupProducerGitPlan({revision,producer});
 assert.deepEqual(plan[0].args,['clone','--shared','--no-hardlinks','--no-checkout','/www/wwwroot/merchant-space',producer]);
 assert.deepEqual(plan[2].args,['fetch','--no-tags','origin','main:refs/remotes/origin/main']);
 assert.equal(plan[3].input,'/*\n!/public/downloads/\n');
 for(const step of plan.slice(1))assert.equal(step.cwd,producer);
 for(const p of ['/www/wwwroot/merchant-space','/tmp/source',producer+'/../escape',producer+'-other',ROOT+'../producer-source'])assert.throws(()=>backupProducerGitPlan({revision,producer:p}));
 assert.throws(()=>backupProducerGitPlan({revision:'main',producer}));
 assert.ok(FULL_REHEARSAL_SOURCES.includes('release-toolchain-backup-producer.mjs'));
});

test('actual independent Git producer fetches advanced main while the formal fixture stays on its old ref',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'faolla-backup-producer-test-'));
 const remote=path.join(root,'remote.git'),seed=path.join(root,'seed'),formal=path.join(root,'formal'),replica=path.join(root,'replica');
 const git=(cwd,args,input)=>{
  const r=spawnSync('git',['-c','core.hooksPath='+(process.platform==='win32'?'NUL':'/dev/null'),...args],{cwd,input,encoding:'utf8',timeout:15000,maxBuffer:1024**2,windowsHide:true});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();
 };
 try{
  git(root,['init','--bare',remote]);git(root,['init',seed]);
  git(seed,['config','user.name','Fixture']);git(seed,['config','user.email','fixture@example.invalid']);
  fs.mkdirSync(path.join(seed,'public','downloads'),{recursive:true});
  fs.writeFileSync(path.join(seed,'README'),'application');fs.writeFileSync(path.join(seed,'public','downloads','excluded'),'download');
  git(seed,['add','.']);git(seed,['commit','-m','application']);git(seed,['branch','-M','main']);
  git(seed,['remote','add','origin',remote]);git(seed,['push','-u','origin','main']);git(remote,['symbolic-ref','HEAD','refs/heads/main']);
  git(root,['clone',remote,formal]);const original=git(formal,['rev-parse','refs/remotes/origin/main']);
  fs.writeFileSync(path.join(seed,'tool.mjs'),'// tool only');git(seed,['add','.']);git(seed,['commit','-m','tool']);git(seed,['push','origin','main']);
  const current=git(seed,['rev-parse','HEAD']);assert.notEqual(current,original);
  const plan=backupProducerGitPlan({revision:current,producer});
  for(const step of plan){
   const args=step.args.map(v=>v===producer?replica:v==='/www/wwwroot/merchant-space'?formal:v==='https://github.com/fafona/space.git'?remote:v);
   git(step.cwd===producer?replica:root,args,step.input);
  }
  assert.equal(git(formal,['rev-parse','HEAD']),original);
  assert.equal(git(formal,['rev-parse','refs/remotes/origin/main']),original);
  assert.equal(git(replica,['rev-parse','HEAD']),current);
  assert.equal(git(replica,['rev-parse','refs/remotes/origin/main']),current);
  assert.equal(git(replica,['rev-parse','--abbrev-ref','HEAD']),'HEAD');
  assert.equal(git(replica,['status','--porcelain=v1','--untracked-files=all']),'');
  assert.equal(fs.readFileSync(path.join(replica,'README'),'utf8'),'application');
  assert.equal(fs.existsSync(path.join(replica,'public','downloads','excluded')),false);
 }finally{
  // Only this test's newly created, resolved temporary tree is removed.
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('faolla-backup-producer-test-'));
  fs.rmSync(root,{recursive:true,force:true});
 }
});

test('backup producer identity cannot stand in for application/build identity or the actual environment payload',()=>{
 const application=sourceApplicationIdentity(C,[{file:'package.json',mode:'100644',oid:'b'.repeat(40)}]);
 const input={toolRevision:revision,producer:{revision,originMainSha:revision,directory:producer,inventorySha256:'c'.repeat(64)},application,
  applicationBuilds:{[C]:{target:C,environmentSha256:'d'.repeat(64)},[A]:{target:A}},
  backup:{source:{sha:revision,originMainSha:revision,repository:'fafona/space'},archiveSha256:'e'.repeat(64)},payloadEnvironmentSha256:'d'.repeat(64)};
 const bound=assertProducerApplicationBackupBinding(input);assert.equal(bound.application.revision,C);assert.equal(bound.producer.revision,revision);assert.equal(bound.archive.domain,'backup-archive');
 for(const patch of [
  {application:{...application,revision}},
  {producer:{...input.producer,originMainSha:C}},
  {backup:{...input.backup,source:{...input.backup.source,sha:C}}},
  {backup:{...input.backup,archiveSha256:'not-a-digest'}},
  {applicationBuilds:{[C]:input.applicationBuilds[C]}},
  {payloadEnvironmentSha256:'f'.repeat(64)},
 ])assert.throws(()=>assertProducerApplicationBackupBinding({...input,...patch}));
});

test('new path cannot be entered without the real lock/capability and cannot loosen installed source authority',async()=>{
 await assert.rejects(createReviewedBookingBackup({lock:null,toolRevision:revision,directory:producer,passphrase:'not authority'}));
 assert.throws(()=>inspectPinnedExecutionSource({revision,directory:producer,repository:producer}));
});

test('bounded backup diagnostics never inspect getters or disclose arbitrary exception text',()=>{
 assert.equal(backupProducerFailure(Object.assign(Error('secret'),{code:'backup_source_origin_main_mismatch'}),'create').code,'backup_source_origin_main_mismatch');
 const hostile={};Object.defineProperty(hostile,'code',{get(){assert.fail('getter');}});
 for(const error of [hostile,Error('password=secret'),{code:'password=secret'}]){
  const report=backupProducerFailure(error,'create');assert.equal(report.code,'operation_unconfirmed');assert.equal(JSON.stringify(report).includes('secret'),false);
 }
 assert.throws(()=>backupProducerFailure(Error(),'caller phase'));
});

test('retained backup key round-trips as the existing raw-line format, not a JSON-quoted secret',()=>{
 const passphrase='a'.repeat(64),text=backupPassphraseFileText(passphrase);
 assert.equal(text.trim(),passphrase);assert.equal(text.includes('"'),false);assert.equal(text,passphrase+'\n');
 for(const bad of ['short','a'.repeat(63),'a'.repeat(64)+'\n','"'+'a'.repeat(64)+'"'])assert.throws(()=>backupPassphraseFileText(bad));
 const source=fs.readFileSync(new URL('./release-toolchain-backup-producer.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("bookingHostWriteOnce(directory+'/backup.key',backupPassphraseFileText(passphrase))"));
});

test('shared backup creation, manifest, verification and source validators remain byte-identical to the accepted main',()=>{
 const pins={
  'create-production-database-backup.mjs':'5618cc4ebc712e92cc5f884aeb05f820f5fe162a0a1203ae2c0acbd58e1bace7',
  'database-backup-contract.mjs':'fe0ba8f4f4a8d77453541d4cd6e6d130de23828176520ae5e8b5e76eca9be29d',
  'verify-production-database-backup.mjs':'2140f4dbf086940fc987797fd32afd88ccdc3332957e6be6e094b75e92470b03',
  'attendance-production-database-migrations.mjs':'3347190c3f28fafe1d76e178a4a455491ade73abf6d0895ad5b653b705610a5a',
 };
 for(const [file,pin]of Object.entries(pins)){
  const current=fs.readFileSync(new URL('./'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(current).digest('hex'),pin);
 }
});
