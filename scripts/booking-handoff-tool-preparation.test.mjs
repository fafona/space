import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_BASE_PENDING_GUARD_SHA256,assertBookingBasePendingGuardSource} from './booking-handoff-pending.mjs';
import {prepareBookingHandoffToolMain} from './booking-handoff-tool-preparation.mjs';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION} from './booking-handoff-policy.mjs';
import {bookingHandoffFixture} from './test-support/booking-handoff-retention-fixture.mjs';
import {assertBookingRollbackToolPreparation} from './booking-handoff-retention.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
import * as standard from './prepare-online-release-tool.mjs';
const clone=structuredClone,hash=x=>createHash('sha256').update(x).digest('hex');
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
function terminalFixture(){
  const f=bookingHandoffFixture(),ready=f.handoff.rollbackReadiness;
  const proof={target:APPLICATION,buildId:APPLICATION,guardedCommand:'npm run build',memoryBytes:4294967296,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};
  const artifacts={buildEvidence:Buffer.from(JSON.stringify(proof)),runtime:Buffer.from('synthetic-runtime'),environmentFile:Buffer.from('synthetic-environment')};
  ready.buildEvidenceSha256=hash(artifacts.buildEvidence);ready.runtimeSha256=hash(artifacts.runtime);ready.environmentFileSha256=hash(artifacts.environmentFile);
  f.handoff.evidence.rollbackReadinessSha256=retentionHash(ready);f.before.bookingHandoff=clone(f.handoff);
  f.before.activeState.bookingHandoffSha256=retentionHash(f.handoff);
  const primary=f.before.releaseProofs[0];primary.state=clone(f.before.activeState);primary.stateText=JSON.stringify(primary.state);primary.stateSha256=hash(primary.stateText);
  const receipt=buildOnlineRetentionReceipt(f.before,clone(f.before),{version:2,process:null},f.history,{preparedAt:'2026-10-26T10:01:00.000Z',completedAt:'2026-10-26T10:01:00.000Z'});
  const history={...f.history,entries:[...f.history.entries,receipt.certificate],headSha256:retentionHash(receipt.certificate)};
  return {...f,history,artifacts};
}
test('the new guard is byte-for-byte the frozen original after removing only its one explicit terminal booking branch',()=>{
  const original=read('./prepare-online-release-tool.mjs');assertBookingBasePendingGuardSource(original);
  assert.equal(BOOKING_BASE_PENDING_GUARD_SHA256,'2d0b65ce8ff36b2658af66d54210a069523e66c2b969584118b36c0fe58c314b');
  const s=read('./booking-handoff-pending.mjs'),from=s.indexOf('function bookingHandoffPendingBody'),to=s.indexOf('export function assertBookingBasePendingGuardSource');
  let body=s.slice(from,to).replace('function bookingHandoffPendingBody','export function assertOnlineToolNoPending');
  const first=body.indexOf('    // BEGIN exact booking terminal state;'),last=body.indexOf('    // END exact booking terminal state.\n',first);
  assert.ok(first>0&&last>first);body=body.slice(0,first)+body.slice(last+'    // END exact booking terminal state.\n'.length);
  assert.equal(hash(body),BOOKING_BASE_PENDING_GUARD_SHA256);
  assert.throws(()=>assertBookingBasePendingGuardSource(original.replace("fail('maintenance_not_ended')","fail('changed')")),/original_guard_changed/);
  assert.throws(()=>assertBookingBasePendingGuardSource('missing guard'),/original_guard_missing/);
});
function collectorFixture(){
  const f=terminalFixture(),directory='/var/lib/faolla-online-release/'+APPLICATION,state=directory+'/state.json';
  const source='/www/wwwroot/merchant-space.web-releases/'+APPLICATION.slice(0,12)+'-online';
  const maintenance='/var/lib/faolla-maintenance/merchant-space',release='/var/lib/faolla-online-release';
  const files=new Map([[maintenance+'/state.json',Buffer.from('{"phase":"ended"}')],[state,Buffer.from(f.handoff.rollbackReadiness.stateText)],
    [directory+'/attendance-build-proof.json',f.artifacts.buildEvidence],[directory+'/atomic-runtime.json',f.artifacts.runtime],
    [source+'/.env.local',f.artifacts.environmentFile],[source+'/.next/BUILD_ID',Buffer.from(APPLICATION)]]);
  const names=[APPLICATION],patches=new Map(),fds=new Map();let nextFd=10;
  const dirs=new Set([directory,source,source+'/.next',maintenance,release]);
  for(const file of [...files.keys(),...dirs])for(let parent=path.posix.dirname(file);;parent=path.posix.dirname(parent)){dirs.add(parent);if(parent==='/')break;}
  const stat=file=>{
    if(!files.has(file)&&!dirs.has(file))throw Object.assign(Error('synthetic missing'),{code:'ENOENT'});
    const isFile=files.has(file);
    return {dev:1,ino:[...files.keys(),...dirs].indexOf(file)+1,mode:isFile?0o100600:0o40700,uid:0,nlink:1,size:files.get(file)?.length??0,mtimeMs:1,ctimeMs:1,
      isFile:()=>isFile,isDirectory:()=>!isFile,isSymbolicLink:()=>false,...patches.get(file)};
  };
  const io={constants:fs.constants,lstatSync:stat,readFileSync:(file,encoding)=>{
    const name=typeof file==='number'?fds.get(file):file;assert.ok(files.has(name));return encoding?files.get(name).toString():Buffer.from(files.get(name));},
    openSync:file=>{const fd=nextFd++;fds.set(fd,file);return fd;},fstatSync:fd=>stat(fds.get(fd)),closeSync:fd=>{assert.ok(fds.has(fd));fds.delete(fd);},
    readdirSync:file=>{assert.equal(file,release);return [...names];}};
  const owned=(file,kind='directory')=>{const s=stat(file);assert.equal(s.uid,0);assert.equal(s.isSymbolicLink(),false);assert.equal(s.mode&0o022,0);
    if(kind==='file'){assert.ok(s.isFile());assert.equal(s.nlink,1);}else assert.ok(s.isDirectory());};
  const text=read('./booking-handoff-pending.mjs');
  const code=text.slice(text.indexOf('const APP='),text.indexOf('export function assertBookingBasePendingGuardSource')).replaceAll('export const ','const ')+
    '\n({bookingHandoffPendingBody,validateBookingRollbackTerminal,privateRead})';
  const api=runInNewContext(code,{fs:io,path:path.posix,createHash,isDeepStrictEqual,Buffer,APPLICATION,
    assertOnlineToolOwnedPath:owned,assertBookingRollbackToolPreparation,readOnlineRetentionHistory:()=>f.history,
    runOnlineToolGit:(root,args)=>{assert.equal(root,source);return Buffer.from(args[0]==='rev-parse'?APPLICATION:'');},
    ...Object.fromEntries(Object.entries(standard).filter(([k])=>k.startsWith('UNPUBLISHED_')||k.startsWith('assertUnpublished')||k==='readUnpublishedBuildEnvironmentDirectories'))});
  return {...f,api,files,names,patches,fds,directory,state,source,maintenance,owned};
}
test('the actual collector accepts only a complete committed ready receipt and preserves every artifact',()=>{
  const f=collectorFixture(),before=new Map([...f.files].map(([file,bytes])=>[file,Buffer.from(bytes)]));
  f.api.bookingHandoffPendingBody({},f.owned);
  assert.deepEqual(f.files,before);assert.equal(f.fds.size,0);
  assert.ok(!f.files.has(f.directory+'/published.json'));
});
test('building, incomplete and unrelated pending candidates never inherit the booking terminal exception',()=>{
  for(const status of ['booking-rollback-building','booking-rollback-built','staged','database-ready']){
    const f=collectorFixture(),v=JSON.parse(f.files.get(f.state));v.status=status;f.files.set(f.state,Buffer.from(JSON.stringify(v)));
    assert.throws(()=>f.api.bookingHandoffPendingBody({},f.owned),/release_pending/);
  }
  const f=collectorFixture(),other='a'.repeat(40);f.names.push(other);
  f.files.set('/var/lib/faolla-online-release/'+other+'/state.json',Buffer.from(JSON.stringify({target:other,status:'staged'})));
  const own=(file,kind)=>{if(file.includes(other))return;f.owned(file,kind);};
  assert.throws(()=>f.api.bookingHandoffPendingBody({},own),/release_pending/);
});
test('the actual terminal collector refuses artifact bytes, private modes, symlinks, hardlinks and source drift',()=>{
  for(const key of ['attendance-build-proof.json','atomic-runtime.json']){
    const f=collectorFixture();f.files.set(f.directory+'/'+key,Buffer.from('changed'));
    assert.throws(()=>f.api.bookingHandoffPendingBody({},f.owned));assert.equal(f.fds.size,0);
  }
  for(const patch of [{uid:1000},{mode:0o100644},{nlink:2},{isSymbolicLink:()=>true}]){
    const f=collectorFixture();f.patches.set(f.directory+'/atomic-runtime.json',patch);
    assert.throws(()=>f.api.bookingHandoffPendingBody({},f.owned));assert.equal(f.fds.size,0);
  }
  const f=collectorFixture();f.history.entries.pop();
  assert.throws(()=>f.api.bookingHandoffPendingBody({},f.owned));
});
test('the source-only adapter retains the full existing bootstrap, locks, immutable checkout and before/after live-state checks',()=>{
  const source=read('./booking-handoff-tool-preparation.mjs');
  for(const token of ['verifyOnlineToolBootstrap(plan,','verifyHistoricalOnlineTool(ownPlan,target)','verifyOnlineReleaseTool(ownPlan)',
    'assertBookingBasePendingGuardSource(standard)','withOnlineToolPreparationLocks(','assertBookingHandoffToolNoPending()',
    'executeOnlineReleaseToolPlan(plan)','equal(protectedFacts(),before,'])assert.ok(source.includes(token),token);
  assert.doesNotMatch(source,/writeFileSync|renameSync|unlinkSync|\['(?:start|stop|restart|reload|delete|save)'\]|--skip|--force|allowUnsafe|testOnly/);
  assert.ok(source.indexOf('verifyOnlineToolBootstrap(plan,')<source.indexOf('export function prepareBookingHandoffToolMain'));
});
test('real CLI rejects non-Linux or non-root callers before touching production paths',()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>prepareBookingHandoffToolMain(['f'.repeat(40)]),/invocation_invalid/);
  assert.throws(()=>prepareBookingHandoffToolMain([]),/invocation_invalid/);
});
