import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingFormalToolImportClosure,prepareBookingFormalTool,assertBookingFormalToolSource} from './booking-formal-backup-tool.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),source=read('scripts/booking-formal-backup-tool.mjs');
const need=(v,c)=>{if(!v)throw Error(c);},same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
function extracted(name,context){const parsed=ts.createSourceFile('tool.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 return runInNewContext(fn.getText(parsed).replace(/^export /,'')+'\n'+name,context);}
test('actual bootstrap closure matches parser, retains sealed predecessors and refuses path escapes',()=>{
 const seen=new Set();function visit(file){if(seen.has(file))return;seen.add(file);const ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const n of ast.statements)if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&!n.moduleSpecifier.text.startsWith('node:'))visit('scripts/'+n.moduleSpecifier.text.slice(2));}
 visit('scripts/booking-formal-backup-tool.mjs');assert.deepEqual(bookingFormalToolImportClosure(read),[...seen].sort());
 for(const f of ['booking-registry-tool','booking-registry-tool-policy','booking-compatibility-tool','prepare-online-release-tool','online-release-tool-retention','booking-handoff-pending'])assert.ok(seen.has('scripts/'+f+'.mjs'));
 assert.throws(()=>bookingFormalToolImportClosure(()=>"import '../escape.mjs';"),/import_path/);
});
test('source-only successor verifies real predecessor/current source, complete pair, retained files and locks',()=>{
 for(const token of ['verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision)','originalInputs:inputs(PRIOR),currentInputs:inputs(toolRevision)',
  'observeBookingRegistryContinuation(phase)','assertBookingRegistryToolReceipt(','assertBookingRegistryToolNoPending()',
  'O_EXCL','O_NOFOLLOW','fs.fsyncSync','fs.readSync','preserved_digest','before_after_changed','bootstrap_sparse','bootstrap_entry'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/spawnSync|execFileSync|bookingHostSql|runMigrationCommand|unlinkSync|rmSync|--force|--skip|\['(?:start|stop|restart|delete)'\]/);
 assert.throws(()=>prepareBookingFormalTool('f'.repeat(40),'not-approved'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingFormalToolSource('f'.repeat(40)),/invocation/);
});
function fixture(failure){
 const calls=[];let seen=0;const gate=k=>{calls.push(k);if(failure===k)throw Error('unconfirmed');};
 const fn=extracted('prepareBookingFormalTool',{need,same,ROOT:'/bootstrap',OP:'/op',APP:'/app',RECEIPT:'receipt',PRIOR:'prior',Date,
  verifySource:(_r,_d,o)=>{gate(o?.bootstrap?'source':'prepared');return {sourceInputsSha256:'inputs',toolClosureSha256:'closure'};},
  observeBookingFormalContinuation:()=>{gate('observe');return {formalPreservedSha256:'pins',n:failure==='drift'?++seen:1};},
  assertBookingRegistryToolNoPending:()=>gate('pending'),assertBookingFormalToolReceipt:()=>gate('receipt'),
  withOnlineToolPreparationLocks:(locks,work)=>{assert.equal(locks.deployLock,'/app.deploy.lock');gate('locks');return work();},
  createOnlineReleaseToolPlan:r=>({revision:r}),executeOnlineReleaseToolPlan:()=>{gate('checkout');return {directory:'/tool'};},
  fs:{lstatSync:()=>{if(failure==='exists')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}},
  process:{umask:()=>0o022},seal:()=>gate('seal'),
 });return {fn,calls};
}
test('actual preparer is source-only, exclusive and fail-closed at every pre/post gate',()=>{
 const f=fixture();assert.equal(f.fn('new','approved-booking-formal-backup-continuation').applicationRebuilt,false);
 assert.equal(f.calls.filter(c=>c==='checkout').length,1);assert.equal(f.calls.filter(c=>c==='seal').length,1);
 assert.ok(f.calls.indexOf('locks')<f.calls.indexOf('checkout'));assert.ok(f.calls.indexOf('prepared')<f.calls.indexOf('seal'));
 for(const failAt of ['source','observe','pending','receipt','checkout','prepared','drift','exists']){
  const f=fixture(failAt);assert.throws(()=>f.fn('new','approved-booking-formal-backup-continuation'));assert.ok(!f.calls.includes('seal'));
  if(['source','observe','pending','receipt','exists'].includes(failAt))assert.ok(!f.calls.includes('checkout'));
 }
});
test('actual preserved-file streamer rejects truncation, content drift, hard links and mid-read replacement',()=>{
 for(const failure of [null,'size','digest','link','replaced','changed']){
  const bytes=Buffer.from('retained-wrong-pilot-archive'),pin={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};let pos=0,closed=false;
  const stat={dev:1,ino:2,uid:0,mode:0o100600,nlink:failure==='link'?2:1,size:failure==='size'?bytes.length+1:bytes.length,mtimeMs:3,ctimeMs:4};
  const fn=extracted('assertBookingFormalPreserved',{need,same,OP:'/op',PRESERVED:{archive:pin},BOOKING_REGISTRY_RECEIPT:'receipt',PRIOR:'prior',Buffer,createHash,
   hash:x=>createHash('sha256').update(x).digest('hex'),assertOnlineToolOwnedPath:()=>{},assertBookingRegistryToolReceipt:()=>{},readBookingFormalFile:()=>Buffer.from('{}'),
   fs:{lstatSync:()=>failure==='changed'&&pos?{...stat,mtimeMs:99}:stat,fstatSync:()=>failure==='replaced'?{...stat,ino:9}:stat,
    constants:{O_RDONLY:1,O_NOFOLLOW:2},openSync:()=>1,closeSync:()=>{closed=true;},readSync:(_fd,buffer)=>{
     if(pos)return 0;const actual=failure==='digest'?Buffer.from('x'.repeat(bytes.length)):bytes;actual.copy(buffer);pos=bytes.length;return bytes.length;},
   }});
  if(failure)assert.throws(fn);else assert.match(fn(),/^[a-f0-9]{64}$/);
  if(!['size','link'].includes(failure))assert.equal(closed,true);
 }
});
