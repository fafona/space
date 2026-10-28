import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingCiToolImportClosure,prepareBookingCiTool,assertBookingCiToolSource} from './booking-ci-continuation-tool.mjs';
import {BOOKING_CI_EVIDENCE,BOOKING_CI_VERIFIED_SOURCE} from './booking-ci-continuation-policy.mjs';
import {historicalBootstrapBlobs} from './test-support/release-toolchain-historical-fixture.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),source=read('scripts/booking-ci-continuation-tool.mjs');
const need=(v,c)=>{if(!v)throw Error(c);},same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const hash=x=>createHash('sha256').update(x).digest('hex');
function extracted(name,context){const parsed=ts.createSourceFile('tool.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(fn,name);return runInNewContext(fn.getText(parsed).replace(/^export /,'')+'\n'+name,context);}
test('actual bootstrap closure matches parsed static imports without changing the sealed predecessor preparer',()=>{
 function parsed(reader){const seen=new Set();function visit(file){if(seen.has(file))return;seen.add(file);const ast=ts.createSourceFile(file,reader(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const n of ast.statements)if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&!n.moduleSpecifier.text.startsWith('node:'))visit('scripts/'+n.moduleSpecifier.text.slice(2));}
 visit('scripts/booking-ci-continuation-tool.mjs');return seen;}
 assert.deepEqual(bookingCiToolImportClosure(read),[...parsed(read)].sort());
 const blobs=historicalBootstrapBlobs(),historicalRead=file=>{assert.equal(typeof blobs[file],'string');return blobs[file];},seen=parsed(historicalRead);
 assert.deepEqual(bookingCiToolImportClosure(historicalRead),[...seen].sort());
 assert.equal(seen.size,28);
 for(const name of ['booking-formal-backup-tool','booking-formal-backup-policy','booking-registry-tool','booking-compatibility-tool','prepare-online-release-tool'])assert.ok(seen.has('scripts/'+name+'.mjs'));
 assert.throws(()=>bookingCiToolImportClosure(()=>"import '../escape.mjs';"),/import_path/);
});
test('source-only successor retains every old check and adds exact real-tree and kernel evidence binding',()=>{
 for(const token of ['changes(PRIOR,BASE)','oldInputs(PRIOR)','oldInputs(BASE)','changes(BASE,toolRevision)',
  'bookingCiInputs(rows(BASE))','bookingCiInputs(rows(toolRevision))','verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision)',
  'observeBookingFormalContinuation(phase)','assertBookingFormalPreserved()','assertBookingRegistryToolNoPending()',
  'O_EXCL','O_NOFOLLOW','fs.fsyncSync','bootstrap_sparse','bootstrap_entry','before_after_changed'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/spawnSync|execFileSync|bookingHostSql|runMigrationCommand|unlinkSync|rmSync|--force|--skip|\['(?:start|stop|restart|delete)'\]/);
 assert.throws(()=>prepareBookingCiTool('f'.repeat(40),'not-approved'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingCiToolSource('f'.repeat(40)),/invocation/);
 assert.equal(BOOKING_CI_EVIDENCE['booking-ci-kernel7-job.log'],'a3f093a1fabd9798048d59ea375c4005df2b3561f7d70197c417abf238be343e');
 assert.equal(BOOKING_CI_EVIDENCE['booking-ci-kernel7-run.json'],'808c6ad68b8559e3bcd75871ccf9d718fb39cd018afe4bb386cd1563c3c4b015');
});
function fixture(failure){
 const calls=[];let seen=0,kernelSeen=0;const gate=k=>{calls.push(k);if(failure===k)throw Error('unconfirmed');};
 const fn=extracted('prepareBookingCiTool',{need,same,ROOT:'/bootstrap',OP:'/op',APP:'/app',RECEIPT:'receipt',PRIOR:'prior',BASE:'base',VERIFIED:'verified',Date,
  verifySource:(_r,_d,o)=>{gate(o?.bootstrap?'source':'prepared');return {sourceInputsSha256:'inputs',toolClosureSha256:'closure'};},
  observeBookingFormalContinuation:()=>{gate('observe');return {formalPreservedSha256:'pins',n:failure==='drift'?++seen:1};},
  assertBookingCiKernelEvidence:()=>{gate('kernel');return failure==='kernel-drift'?String(++kernelSeen):'kernel';},
  assertBookingRegistryToolNoPending:()=>gate('pending'),assertBookingCiReceipt:()=>gate('receipt'),
  withOnlineToolPreparationLocks:(locks,work)=>{assert.equal(locks.deployLock,'/app.deploy.lock');assert.equal(locks.maintenance,'/var/lib/faolla-maintenance/merchant-space');gate('locks');return work();},
  createOnlineReleaseToolPlan:r=>({revision:r}),executeOnlineReleaseToolPlan:()=>{gate('checkout');return {directory:'/tool'};},
  fs:{lstatSync:()=>{if(failure==='exists')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}},
  process:{umask:()=>0o022},seal:()=>gate('seal'),
 });return {fn,calls};
}
test('actual preparer seals only after all locked source, preserved-build and evidence checks pass',()=>{
 const f=fixture();const result=f.fn('new','approved-booking-ci-only-continuation');
 for(const flag of ['applicationRebuilt','productionDatabaseChanged','trafficChanged'])assert.equal(result[flag],false);
 assert.equal(f.calls.filter(c=>c==='checkout').length,1);assert.equal(f.calls.filter(c=>c==='seal').length,1);
 assert.ok(f.calls.indexOf('locks')<f.calls.indexOf('checkout'));assert.ok(f.calls.indexOf('prepared')<f.calls.indexOf('seal'));
 for(const failAt of ['source','observe','kernel','pending','receipt','checkout','prepared','drift','exists','kernel-drift']){
  const f=fixture(failAt);assert.throws(()=>f.fn('new','approved-booking-ci-only-continuation'));assert.ok(!f.calls.includes('seal'),failAt);
  if(['source','observe','kernel','pending','receipt','exists'].includes(failAt))assert.ok(!f.calls.includes('checkout'),failAt);
 }
});
function kernelFixture(failure){
 const report={ok:true,groups:7,namespaceIsolated:true,kernelRelease:'7.0.0-1017-azure',
  planSha256:'63b3225a508d3191fe7c0c0e61c02ea0afa46ce9120a4c7f2d77da0ab84069a7',nginxEvidence:'synthetic_config_and_requests_only'};
 const job={databaseId:122344176257,conclusion:'success',status:'completed',url:'https://github.com/fafona/space/actions/runs/40523080088/job/122344176257',
  steps:['Initialize Bridge Netfilter Module on Disposable CI Host Only','Run Real Ingress Rules Only Inside New Network Namespace'].map(name=>({name,status:'completed',conclusion:'success'}))};
 const metadata={attempt:9,headSha:BOOKING_CI_VERIFIED_SOURCE,status:'completed',conclusion:'failure',jobs:[job]};
 if(failure==='head')metadata.headSha='a'.repeat(40);if(failure==='attempt')metadata.attempt=8;
 if(failure==='job')job.conclusion='failure';if(failure==='step')job.steps[1].conclusion='skipped';if(failure==='id')job.databaseId++;
 if(failure==='namespace')report.namespaceIsolated=false;if(failure==='plan')report.planSha256='b'.repeat(64);if(failure==='groups')report.groups=6;
 if(failure==='old-kernel')report.kernelRelease='6.17.0-azure';
 const log='Version: 20261025.353.1\ningress-preflight os=ubuntu:24.04 kernel='+(failure==='host'?'6.17.0-azure':'7.0.0-1017-azure')+'\n2026-10-27T17:11:54Z '+JSON.stringify(report)+'\n';
 const files={'booking-ci-kernel7-job.log':Buffer.from('\uFEFF'+log,'utf16le'),'booking-ci-kernel7-run.json':Buffer.from('\uFEFF'+JSON.stringify(metadata),'utf16le')};
 const pins=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,hash(bytes)]));
 return extracted('assertBookingCiKernelEvidence',{read:f=>{const bytes=files[f.slice('/op/'.length)];if(failure==='missing')throw Error('missing');return failure==='digest'?Buffer.concat([bytes,Buffer.from('changed')]):bytes;},
  OP:'/op',BOOKING_CI_EVIDENCE:pins,VERIFIED:BOOKING_CI_VERIFIED_SOURCE,need,hash});
}
test('genuine-job evidence parser binds exact host, head, attempt, module and real network acceptance; aggregate failure is never claimed green',()=>{
 assert.match(kernelFixture()(),/^[a-f0-9]{64}$/);
 for(const failAt of ['head','attempt','job','step','id','namespace','plan','groups','old-kernel','host','missing','digest'])assert.throws(kernelFixture(failAt),undefined,failAt);
});
test('source receipt attester verifies current source, kernel proof and retained immutable pair evidence every time',()=>{
 for(const failure of [null,'source','receipt','kernel','preserved']){
  const sourceValue={sourceInputsSha256:'inputs',toolClosureSha256:'closure'},receipt={...sourceValue,kernelEvidenceSha256:'kernel',preservedSha256:'retained'};let calls=0;
  const fn=extracted('assertBookingCiToolSource',{need,same:(a,b,c)=>same(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),c),ROOT:'/root',OP:'/op',RECEIPT:'receipt',
   verifySource:()=>{calls++;if(failure==='source')throw Error('source');return sourceValue;},
   read:()=>JSON.stringify(receipt),assertBookingCiReceipt:()=>{if(failure==='receipt')throw Error('receipt');},
   assertBookingCiKernelEvidence:()=>failure==='kernel'?'changed':'kernel',assertBookingFormalPreserved:()=>failure==='preserved'?'changed':'retained'});
  if(failure)assert.throws(()=>fn('revision'));else assert.deepEqual(fn('revision'),sourceValue);assert.equal(calls,1);
 }
});
test('actual runtime continuation keeps the original build tool for BOTH immutable applications and requires database-ready attestation',()=>{
 for(const failure of [null,'source','primary','closure','rollback']){
  const primary={bookingReviewedStage:{toolRevision:'original',toolClosureSha256:'1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'}},rollback={toolRevision:'original'};
  if(failure==='primary')primary.bookingReviewedStage.toolRevision='new-tool';if(failure==='closure')primary.bookingReviewedStage.toolClosureSha256='changed';
  if(failure==='rollback')rollback.toolRevision='new-tool';let checked=false;
  const fn=extracted('assertBookingCiRuntimeContinuation',{need,BOOKING_REGISTRY_ORIGINAL_TOOL:'original',assertBookingCiContinuation:input=>{
   assert.equal(input.toolRevision,'new-tool');assert.equal(input.phase,'database-ready');checked=true;if(failure==='source')throw Error('source');
  }});
  if(failure)assert.throws(()=>fn({toolRevision:'new-tool',primary,rollback}));else assert.equal(fn({toolRevision:'new-tool',primary,rollback}),'original');
  assert.equal(checked,true);
 }
});
