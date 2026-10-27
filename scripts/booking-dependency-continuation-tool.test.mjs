import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingDependencyToolImportClosure,prepareBookingDependencyTool,assertBookingDependencyToolSource} from './booking-dependency-continuation-tool.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8'),source=read('scripts/booking-dependency-continuation-tool.mjs');
const need=(v,c)=>{if(!v)throw Error(c);},same=(a,b,c)=>need(isDeepStrictEqual(a,b),c),hash=x=>createHash('sha256').update(x).digest('hex');
function extracted(name,context){const ast=ts.createSourceFile('x.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);return runInNewContext(fn.getText(ast).replace(/^export /,'')+'\n'+name,context);}
test('bootstrap static import closure matches actual AST and contains only local tools and node builtins',()=>{
 const seen=new Set();function visit(f){if(seen.has(f))return;seen.add(f);const ast=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const n of ast.statements)if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&!n.moduleSpecifier.text.startsWith('node:')){assert.ok(n.moduleSpecifier.text.startsWith('./'));visit('scripts/'+n.moduleSpecifier.text.slice(2));}}
 visit('scripts/booking-dependency-continuation-tool.mjs');assert.deepEqual(bookingDependencyToolImportClosure(read),[...seen].sort());
 for(const name of ['booking-ci-continuation-tool','booking-formal-backup-tool','booking-dependency-pending','booking-dependency-fingerprint','prepare-online-release-tool'])assert.ok(seen.has('scripts/'+name+'.mjs'));
 assert.throws(()=>bookingDependencyToolImportClosure(()=>"import '../escape.mjs';"));
});
test('actual source preparation binds BOTH real predecessor deltas, current exact scope, historical installs, backups and genuine7 evidence',()=>{
 for(const token of ['changes(PRIOR,CI_BASE)','oldInputs(PRIOR)','oldInputs(CI_BASE)','changes(CI_BASE,BASE)','bookingCiInputs(rows(BASE))',
  'changes(BASE,toolRevision)','bookingDependencyInputs(rows(BASE))','bookingDependencyInputs(rows(toolRevision))','prior_source',
  'verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(BASE),toolRevision)','verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision)',
  "observeBookingFormalContinuation('database-ready')",'assertBookingFormalPreserved()','assertBookingCiKernelEvidence()',
  'assertBookingDependencyToolNoPending()','O_EXCL','O_NOFOLLOW','fs.fsyncSync','bootstrap_sparse','bootstrap_entry','existing_runtime','dependency_mode'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/spawnSync|execFileSync|bookingHostSql|runMigrationCommand|unlinkSync|rmSync|--force|--skip|\['(?:start|stop|restart|delete)'\]/);
 assert.throws(()=>prepareBookingDependencyTool('f'.repeat(40),'not-approved'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingDependencyToolSource('f'.repeat(40)),/invocation/);
});
function fixture(failure){
 const calls=[],STATES={primary:{target:'primary',file:'primary-copy',sha256:hash('primary')},rollback:{target:'rollback',file:'rollback-copy',sha256:hash('rollback')}};
 let seen=0;const gate=k=>{calls.push(k);if(failure===k)throw Error(k);};
 const fn=extracted('prepareBookingDependencyTool',{need,same,hash,Buffer,ROOT:'/bootstrap',OP:'/op',APP:'/app',RECEIPT:'receipt',BASE:'prior',STOPPED:{retained:true},STATES,Date,
  verifySource:(_r,_d,o)=>{gate(o?.bootstrap?'source':'prepared');return {sourceInputsSha256:'inputs',toolClosureSha256:'closure'};},
  originalPhase:()=>{gate('observe');return {n:failure==='drift'?++seen:1};},evidence:()=>{gate('evidence');return failure==='evidence-drift'?'bad':hash(JSON.stringify({retained:true}));},
  assertBookingDependencyToolNoPending:()=>gate('pending'),assertBookingDependencyReceipt:()=>gate('receipt'),
  withOnlineToolPreparationLocks:(locks,work)=>{assert.equal(locks.deployLock,'/app.deploy.lock');gate('locks');const result=work();assert.equal(typeof result.then,'undefined');return result;},
  createOnlineReleaseToolPlan:r=>({revision:r}),executeOnlineReleaseToolPlan:()=>{gate('checkout');return {directory:'/tool'};},
  fs:{lstatSync:()=>{if(failure==='exists')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}},
  process:{umask:()=>0o022},read:f=>Buffer.from(f.split('/').at(-2)),seal:(name,bytes)=>{calls.push('seal:'+name);assert.ok(Buffer.isBuffer(bytes));},
 });return {fn,calls};
}
test('actual locked synchronous preparer exclusively archives both exact states before the new receipt and never rewrites old receipts',()=>{
 const f=fixture(),result=f.fn('new','approved-booking-dependency-binding-continuation');
 for(const flag of ['applicationRebuilt','productionDatabaseChanged','trafficChanged'])assert.equal(result[flag],false);
 assert.deepEqual(f.calls.filter(c=>c.startsWith('seal:')),['seal:primary-copy','seal:rollback-copy','seal:receipt']);
 assert.ok(f.calls.indexOf('locks')<f.calls.indexOf('checkout'));assert.ok(f.calls.indexOf('prepared')<f.calls.indexOf('seal:primary-copy'));
 for(const failure of ['source','observe','pending','receipt','checkout','prepared','drift','exists','evidence','evidence-drift']){
  const f=fixture(failure);assert.throws(()=>f.fn('new','approved-booking-dependency-binding-continuation'));assert.ok(!f.calls.includes('seal:receipt'),failure);
  if(['source','observe','pending','receipt','exists'].includes(failure))assert.ok(!f.calls.includes('checkout'),failure);
 }
});
test('new receipt reattests source and immutable stopped evidence while allowing ONLY live status files to advance',()=>{
 for(const failure of [null,'source','receipt','evidence']){
  const value={sourceInputsSha256:'inputs',toolClosureSha256:'closure'},receipt={...value,stoppedEvidenceSha256:'pins'};
  const fn=extracted('assertBookingDependencyToolSource',{need,same:(a,b,c)=>same(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),c),ROOT:'/root',OP:'/op',RECEIPT:'receipt',
   verifySource:()=>{if(failure==='source')throw Error('source');return value;},read:()=>JSON.stringify(receipt),
   assertBookingDependencyReceipt:()=>{if(failure==='receipt')throw Error('receipt');},evidence:()=>failure==='evidence'?'bad':'pins'});
  if(failure)assert.throws(()=>fn('new'));else assert.deepEqual(fn('new'),value);
 }
 const evidence=source.slice(source.indexOf('function evidence('),source.indexOf('function originalPhase('));
 assert.match(evidence,/if\(file===OP\+'\/state.json'\)continue/);assert.match(evidence,/OP\+'\/'\+pin.file/);
 assert.match(evidence,/count===pin.bytes&&h.digest\('hex'\)===pin.sha256/);
});
test('runtime keeps original build tool for both immutable applications after strict database-ready attestation',()=>{
 for(const failure of [null,'source','primary','closure','rollback']){
  const primary={bookingReviewedStage:{toolRevision:'original',toolClosureSha256:'1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'}},rollback={toolRevision:'original'};
  if(failure==='primary')primary.bookingReviewedStage.toolRevision='new';if(failure==='closure')primary.bookingReviewedStage.toolClosureSha256='bad';if(failure==='rollback')rollback.toolRevision='new';
  const fn=extracted('assertBookingDependencyRuntimeContinuation',{need,BOOKING_REGISTRY_ORIGINAL_TOOL:'original',assertBookingDependencyContinuation:({toolRevision})=>{assert.equal(toolRevision,'new');if(failure==='source')throw Error('source');}});
  if(failure)assert.throws(()=>fn({toolRevision:'new',primary,rollback}));else assert.equal(fn({toolRevision:'new',primary,rollback}),'original');
 }
});
