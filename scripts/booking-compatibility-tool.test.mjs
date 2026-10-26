import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingCompatibilityToolImportClosure,prepareBookingCompatibilityTool,assertBookingCompatibilityRuntimeContinuation} from './booking-compatibility-tool.mjs';
import {assertBookingCompatibilityToolNoPending} from './booking-handoff-pending.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('scripts/booking-compatibility-tool.mjs');
test('actual static import closure includes complete unchanged bootstrap and all predecessor verification dependencies',()=>{
 const actual=bookingCompatibilityToolImportClosure(read),seen=new Set();
 function visit(file){if(seen.has(file))return;seen.add(file);const parsed=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const node of parsed.statements){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){const value=node.moduleSpecifier.text;if(!value.startsWith('node:'))visit('scripts/'+value.slice(2));}}
 }visit('scripts/booking-compatibility-tool.mjs');assert.deepEqual(actual,[...seen].sort());
 for(const name of ['prepare-online-release-tool','online-release-tool-retention','booking-built-smoke-repair','booking-built-smoke-repair-policy','booking-compatibility-tool-policy','booking-handoff-pending'])assert.ok(actual.includes('scripts/'+name+'.mjs'));
 assert.throws(()=>bookingCompatibilityToolImportClosure(()=>"import '../escape.mjs';"),/import_path/);
});
test('successor independently verifies exact historical source, full immutable pair and sealed original receipt',()=>{
 for(const token of ['verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision)','assertBookingCompatibilityToolDelta(',
  'verifyOnlineToolBootstrap(plan,','assertBookingHandoffToolClosure(','observeBookingBuiltSmokePair({phase})','assertBookingBuiltSmokeReceipt(',
  'BOOKING_COMPATIBILITY_STAGED_SHA256','preserved_evidence','booking-database-inactive.json','private_parent','O_EXCL','O_NOFOLLOW','fs.fsyncSync'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/\['(?:start|stop|restart|reload|delete|save)'\]|spawnSync|execFileSync|bookingHostSql|unlinkSync|rmSync|--force|--skip|command\('npm'/);
 assert.ok(!read('scripts/prepare-online-release-tool.mjs').includes('booking-compatibility'));
 const pending=read('scripts/booking-handoff-pending.mjs');assert.match(pending,/const pair=observeBookingCompatibilityContinuation\('staged'\)/);
});
function fixture(failure){
 const parsed=ts.createSourceFile('tool.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='prepareBookingCompatibilityTool');
 const calls=[];let seen=0;const gate=key=>{calls.push(key);if(failure===key)throw Error('unconfirmed');};
 const fn=runInNewContext(node.getText(parsed).replace(/^export /,'')+'\nprepareBookingCompatibilityTool',{
  OP:'/fixed',ROOT:'/bootstrap',RECEIPT:'receipt',PRIOR:'prior',ORIGINAL:'original',APP:'/app',
  need:(v,c)=>{if(!v)throw Error(c);},same:(a,b,c)=>{if(!isDeepStrictEqual(a,b))throw Error(c);},
  verifySource:(_revision,_directory,options)=>{gate(options?.bootstrap?'source':'prepared');return {sourceInputsSha256:'inputs',toolClosureSha256:'closure'};},
  observeBookingCompatibilityContinuation:()=>{gate('observe');return {preservedSha256:'pins',sequence:failure==='drift'?++seen:1};},
  assertBookingCompatibilityToolNoPending:()=>gate('pending'),assertBookingCompatibilityToolReceipt:()=>gate('receipt'),
  withOnlineToolPreparationLocks:(locks,work)=>{assert.equal(locks.deployLock,'/app.deploy.lock');gate('locks');return work();},
  createOnlineReleaseToolPlan:revision=>({revision}),executeOnlineReleaseToolPlan:()=>{gate('checkout');return {directory:'/tool'};},
  fs:{lstatSync:()=>{gate('exists');if(failure==='exists')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}},
  process:{umask:()=>0o022},seal:()=>gate('seal'),Date,
 });return {fn,calls};
}
test('actual preparer writes one NEW source checkout and exclusive receipt only after all independent gates',()=>{
 const f=fixture();assert.equal(f.fn('new','approved-booking-isolated-compatibility-adapter').applicationRebuilt,false);
 assert.equal(f.calls.filter(x=>x==='checkout').length,1);assert.equal(f.calls.filter(x=>x==='seal').length,1);
 assert.ok(f.calls.indexOf('locks')<f.calls.indexOf('checkout'));assert.ok(f.calls.indexOf('prepared')<f.calls.indexOf('seal'));
 for(const failAt of ['source','observe','pending','receipt','checkout','prepared','drift']){const f=fixture(failAt);assert.throws(()=>f.fn('new','approved-booking-isolated-compatibility-adapter'));
  assert.ok(!f.calls.includes('seal'));if(['source','observe','pending','receipt','drift'].includes(failAt))assert.ok(!f.calls.includes('checkout')||failAt==='drift');}
 const existing=fixture('exists');assert.throws(()=>existing.fn('new','approved-booking-isolated-compatibility-adapter'));assert.ok(!existing.calls.includes('checkout'));
});
test('entrypoints reject unapproved, non-host and forged pending invocations',()=>{
 assert.throws(()=>prepareBookingCompatibilityTool('f'.repeat(40),'not-approved'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingCompatibilityRuntimeContinuation({toolRevision:'f'.repeat(40),primary:{},rollback:{}}),/invocation/);
 assert.throws(()=>assertBookingCompatibilityToolNoPending({preserved:{fake:true}}),/unexpected_pending_argument/);
});
