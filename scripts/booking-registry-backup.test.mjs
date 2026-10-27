import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {assertBookingRegistryBackupBinding,sealBookingRegistryBackupBinding} from './booking-registry-backup.mjs';
const source=readFileSync(new URL('./booking-registry-backup.mjs',import.meta.url),'utf8');
const observed=()=>({candidate:'c'.repeat(40),baseline:'b'.repeat(40),toolRevision:'a'.repeat(40),sourceInputsSha256:'1'.repeat(64),toolClosureSha256:'2'.repeat(64),
 registryToolReceiptSha256:'3'.repeat(64),application:{target:'c'.repeat(40),tree:'d'.repeat(40),originalBuildTool:'e'.repeat(40),buildProofSha256:'4'.repeat(64),
 environmentSha256:'5'.repeat(64),dependenciesSha256:'6'.repeat(64),builtOutputSha256:'7'.repeat(64)},createReportSha256:'8'.repeat(64),verifyReportSha256:'9'.repeat(64)});
const backup=()=>({archiveSha256:'0'.repeat(64),archiveBytes:1234,createdAt:new Date(Date.now()-1000).toISOString(),source:{sha:'a'.repeat(40),originMainSha:'a'.repeat(40),detached:true},restoreRehearsed:false});
test('binding requires every application/tool/DR fact, exact report bytes and real backup time',()=>{
 const facts=observed(),dr=backup(),value={schemaVersion:1,kind:'booking-registry-backup-binding',...facts,backup:dr,completedAt:new Date().toISOString()};
 assert.equal(assertBookingRegistryBackupBinding(value,facts,dr),true);
 for(const change of [v=>{v.candidate='x';},v=>{v.baseline='x';},v=>{v.toolRevision='x';},v=>{v.sourceInputsSha256='x';},v=>{v.toolClosureSha256='x';},
  v=>{v.registryToolReceiptSha256='x';},v=>{v.application.target='x';},v=>{v.application.builtOutputSha256='x';},v=>{v.application.dependenciesSha256='x';},
  v=>{v.createReportSha256='x';},v=>{v.verifyReportSha256='x';},v=>{v.backup.archiveSha256='x';},v=>{v.backup.source.sha='x';},v=>{v.extra=true;},
  v=>{delete v.application;},v=>{v.completedAt='bad';},v=>{v.completedAt=new Date(Date.now()+120000).toISOString();},v=>{v.completedAt=new Date(Date.now()-60000).toISOString();}]){
  const changed=structuredClone(value);change(changed);assert.throws(()=>assertBookingRegistryBackupBinding(changed,facts,dr));
 }
});
function extracted(name,context){const ast=ts.createSourceFile('backup.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 return runInNewContext(fn.getText(ast).replace(/^export /,'')+'\n'+name,context);}
function fixture(failure){
 const calls=[],facts=observed(),dr=backup();let sealed,observations=0;const need=(v,c)=>{if(!v)throw Error(c);};
 const gate=name=>{calls.push(name);if(failure===name)throw Error('unconfirmed_'+name);};
 const expected={target:'c'.repeat(40),backup:'/op/database.tar.enc',createReport:'/op/backup-create.json',verifyReport:'/op/backup-verify.json'};
 const value={schemaVersion:1,kind:'booking-registry-backup-binding',...facts,backup:dr,completedAt:new Date().toISOString()};
 const context={need,same:(a,b,c)=>need(isDeepStrictEqual(a,b),c),observe:()=>{gate('observe');return failure==='drift'&&observations++?{...facts,candidate:'drift'}:facts;},
  validateAttendanceBackupEvidence:async request=>{gate('validate');assert.equal(request.target,facts.toolRevision);assert.equal(request.backup,expected.backup);return dr;},
  // Normalize only the VM realm prototype, as a real serialized receipt does.
  assertBookingRegistryBackupBinding:(value,facts,backup)=>assertBookingRegistryBackupBinding(JSON.parse(JSON.stringify(value)),facts,backup),
  assertOnlineRetentionHeldLocks:lock=>{gate('lock');need(lock==='genuine','lock');},
  input:()=>expected,OP:'/op',FILE:'/op/binding.json',C:expected.target,Buffer,Date,JSON,
  assertOnlineToolOwnedPath:()=>gate('owned'),read:()=>sealed??Buffer.from(JSON.stringify(value)),
  fs:{existsSync:()=>true,lstatSync:()=>({mode:0o700}),constants:{O_WRONLY:1,O_CREAT:2,O_EXCL:4,O_NOFOLLOW:8,O_RDONLY:16,O_DIRECTORY:32},
   openSync:()=>{gate('open');return 1;},writeFileSync:(_fd,bytes)=>{gate('write');sealed=bytes;},fsyncSync:()=>gate('sync'),closeSync:()=>{}},
 };return {context,calls,expected,value,fn:extracted('sealBookingRegistryBackupBinding',context)};
}
test('sealer requires real held locks, unchanged built facts and unchanged shared DR validation before exclusive receipt',async()=>{
 const f=fixture(),result=await f.fn({lock:'genuine'});assert.equal(result.toolRevision,observed().toolRevision);
 assert.ok(f.calls.indexOf('validate')<f.calls.indexOf('write'));assert.ok(f.calls.filter(x=>x==='lock').length>=2);
 for(const fail of ['lock','observe','validate','drift','owned','open']){const f=fixture(fail);await assert.rejects(f.fn({lock:'genuine'}));assert.ok(!f.calls.includes('write'));}
 const fake=fixture();await assert.rejects(fake.fn({lock:'fake'}));assert.ok(!fake.calls.includes('write'));
 await assert.rejects(sealBookingRegistryBackupBinding({lock:true,sourceSha:'forged'}),/arguments/);
});
test('consumer validates the sealed binding and fresh shared DR evidence, with no caller-selected tool SHA',async()=>{
 const f=fixture(),fn=extracted('validateBookingPublicationBackupEvidence',f.context);
 assert.equal((await fn(f.expected)).archiveSha256,backup().archiveSha256);
 for(const patch of [{backup:'/other'},{target:f.expected.target,sourceSha:'forged'},{rootOwned:false},{nowMs:1}])await assert.rejects(fn({...f.expected,...patch}));
 const changed=fixture();changed.context.read=()=>Buffer.from(JSON.stringify({...changed.value,toolRevision:'forged'}));
 await assert.rejects(extracted('validateBookingPublicationBackupEvidence',changed.context)(changed.expected));
});
test('the adapter never changes shared trust or builds, and checks full application blobs, dependencies and outputs',()=>{
 for(const token of ['assertBookingRegistryToolSource(toolRevision)','application_blob','application_proof','application_environment','application_dependencies','application_build',
  'registryToolReceiptSha256','source_changed','O_EXCL','O_NOFOLLOW','assertOnlineRetentionHeldLocks(options.lock)',
  'validateAttendanceBackupEvidence({...input(),target:before.toolRevision})','validateAttendanceBackupEvidence({...request,target:observed.toolRevision})'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/createProductionDatabaseBackup|origin\/main.*(?:update|set)|update-ref|spawnSync|execFileSync|unlinkSync|rmSync|--skip|--force/);
 const generator=readFileSync(new URL('./create-production-database-backup.mjs',import.meta.url),'utf8');assert.ok(generator.includes('backup_source_origin_main_mismatch'));
 const shared=readFileSync(new URL('./attendance-production-database-migrations.mjs',import.meta.url),'utf8');assert.ok(shared.includes('source.source.sha===input.target'));
});
