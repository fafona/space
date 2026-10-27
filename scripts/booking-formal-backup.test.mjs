import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingPublicationBackupRequest,assertBookingFormalDatabaseSelection,assertBookingFormalBackupBinding,runBookingFormalBackup} from './booking-formal-backup.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
import {attendanceProductionIdentity as production} from './attendance-production-database-migrations.mjs';
const source=readFileSync(new URL('./booking-formal-backup.mjs',import.meta.url),'utf8');
const need=(v,c)=>{if(!v)throw Error(c);},same=(a,b,c)=>need(isDeepStrictEqual(a,b),c),hash=x=>createHash('sha256').update(x).digest('hex');
function extracted(name,context){const ast=ts.createSourceFile('backup.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 return runInNewContext(node.getText(ast).replace(/^export /,'')+'\n'+name,context);}
test('only the exact candidate/operation maps to the explicit NEW physical namespace',()=>{
 const op='/var/lib/faolla-online-release/'+C,request=bookingPublicationBackupRequest(C,op);
 assert.equal(request.backup,op+'/formal-backup-20261027/database.tar.enc');assert.equal(request.createReport,op+'/formal-backup-20261027/backup-create.json');
 assert.equal(request.verifyReport,op+'/formal-backup-20261027/backup-verify.json');
 assert.equal(bookingPublicationBackupRequest('a'.repeat(40),'/other').backup,'/other/database.tar.enc');
 assert.equal(bookingPublicationBackupRequest(C,'/other').backup,'/other/database.tar.enc');
});
test('formal identity checks cannot normalize a pilot, changed mount, missing peer or metadata drift into production',()=>{
 const facts={container:{id:production.containerId,name:'/supabase-db',running:true,mounts:[{Type:'bind',Source:production.dataSource,RW:true}]},
  state:{...production},pilots:BOOKING_FORMAL_PILOT_IDS.map(id=>({id,running:false})),metadataContractSha256:'a'.repeat(64),expectedMetadataContractSha256:'a'.repeat(64)};
 assert.equal(assertBookingFormalDatabaseSelection(facts),true);
 for(const change of [v=>{v.container.id=BOOKING_FORMAL_PILOT_IDS[0];},v=>{v.container.name='/faolla-attendance-pilot-db';},v=>{v.container.running=false;},
  v=>{v.container.mounts[0].Source='/pilot';},v=>{v.container.mounts[0].RW=false;},v=>{v.state.systemIdentifier='7694613959029145639';},
  v=>{v.state.databaseOid=5;},v=>{v.state.serverVersionNum='170000';},v=>{v.pilots[0].running=true;},v=>{v.pilots.pop();},v=>{v.pilots[0].id=v.pilots[1].id;},
  v=>{v.metadataContractSha256='b'.repeat(64);},v=>{v.metadataContractSha256=v.expectedMetadataContractSha256='bad';}]){
  const changed=structuredClone(facts);change(changed);assert.throws(()=>assertBookingFormalDatabaseSelection(changed));
 }
});
const observed=()=>({candidate:C,baseline:'b'.repeat(40),toolRevision:'f'.repeat(40),sourceInputsSha256:'1'.repeat(64),toolClosureSha256:'2'.repeat(64),
 preservedSha256:'3'.repeat(64),toolReceiptSha256:'4'.repeat(64),application:{target:C,tree:'d'.repeat(40),originalBuildTool:'e'.repeat(40),
  buildProofSha256:'5'.repeat(64),environmentSha256:'6'.repeat(64),dependenciesSha256:'7'.repeat(64),builtOutputSha256:'8'.repeat(64)},
 compatibilitySha256:'9'.repeat(64),compatibilityEvidenceSha256:'0'.repeat(64)});
const backup=()=>({archiveSha256:'a'.repeat(64),archiveBytes:2345,createdAt:new Date(Date.now()-1000).toISOString(),source:{sha:'f'.repeat(40)},restoreRehearsed:false});
test('binding includes exact application, tool, retained evidence, compatibility, attempt, key and reports',()=>{
 const facts={...observed(),attemptSha256:'a',keySha256:'b',createReportSha256:'c',verifyReportSha256:'d'},dr=backup(),value={schemaVersion:1,kind:'booking-formal-backup-binding',...facts,backup:dr,completedAt:new Date().toISOString()};
 assert.equal(assertBookingFormalBackupBinding(value,facts,dr),true);
 for(const key of Object.keys(facts)){
  const changed=structuredClone(value);changed[key]='forged';assert.throws(()=>assertBookingFormalBackupBinding(changed,facts,dr));
 }
 for(const patch of [{extra:true},{completedAt:'bad'},{completedAt:new Date(Date.now()-60000).toISOString()},{completedAt:new Date(Date.now()+120000).toISOString()},
  {backup:{...dr,archiveSha256:'wrong'}}])assert.throws(()=>assertBookingFormalBackupBinding({...value,...patch},facts,dr));
});
function fixture(failure){
 const calls=[],files=new Map(),facts=observed(),dr=backup(),formal={identity:'formal',metadata:'same'};let observations=0,formalReads=0;
 const gate=k=>{calls.push(k);if(failure===k)throw Error('unconfirmed_'+k);};
 const expected={target:C,backup:'/op/new/database.tar.enc',createReport:'/op/new/backup-create.json',verifyReport:'/op/new/backup-verify.json'};
 const context={need,same,hash,OP:'/op',DIR:'/op/new',FILE:'/op/new/application-binding.json',ROOT:'/tool',C,B:'b'.repeat(40),Date,Buffer,JSON,production,
  input:()=>expected,assertOnlineRetentionHeldLocks:lock=>{gate('lock');need(lock==='genuine','lock');},
  observe:()=>{gate('observe');return failure==='source-drift'&&observations++?{...facts,toolRevision:'changed'}:facts;},
  assertBookingFormalContinuation:()=>gate('continuation'),formalBeforeBackup:async()=>{gate('formal');return failure==='formal-drift'&&formalReads++?{identity:'changed'}:formal;},
  assertOnlineToolOwnedPath:()=>gate('owned'),
  fs:{existsSync:()=>failure==='existing-install',mkdirSync:(path,options)=>{gate('mkdir');assert.equal(path,'/op/new');assert.deepEqual(JSON.parse(JSON.stringify(options)),{mode:0o700});},lstatSync:()=>({mode:0o700})},
  write:(file,value)=>{gate('write:'+file);assert.ok(file.startsWith('/op/new/'));assert.ok(!files.has(file));files.set(file,Buffer.from(typeof value==='string'?value:JSON.stringify(value)));},
  read:file=>file==='/op/state.json'?Buffer.from(JSON.stringify({oldDirectory:'/old'})):files.get(file)??Buffer.from('synthetic-private'),
  randomBytes:()=>Buffer.from('synthetic-key'),process:{env:{FAOLLA_DATABASE_CONTAINER:'faolla-attendance-pilot-db',FAOLLA_STORAGE_CONTAINER:'wrong'}},
  createProductionDatabaseBackup:async options=>{gate('create');assert.equal(options.outputPath,expected.backup);assert.equal(options.sourceSha,facts.toolRevision);
   assert.equal(options.sourceDirectory,'/tool');assert.equal(options.appDirectory,'/old');assert.equal(options.env.FAOLLA_DATABASE_CONTAINER,'supabase-db');assert.equal(options.env.FAOLLA_STORAGE_CONTAINER,'supabase-storage');return dr;},
  verifyProductionDatabaseBackup:async options=>{gate('verify');assert.equal(options.inputPath,expected.backup);return {status:'verified'};},
  validateAttendanceBackupEvidence:async request=>{gate('validate');assert.equal(request.target,facts.toolRevision);assert.equal(request.backup,expected.backup);return dr;},
  assertBookingFormalBackupBinding:(v,f,b)=>assertBookingFormalBackupBinding(JSON.parse(JSON.stringify(v)),f,b),
  validatePriorBackup:async request=>{gate('prior');return request;},
 };return {context,files,calls,expected,facts,dr,run:extracted('runBookingFormalBackup',context)};
}
test('actual runner explicitly overrides wrong inherited DB, verifies before/after, and seals only after genuine shared DR checks',async()=>{
 const f=fixture();assert.equal((await f.run({lock:'genuine'})).formalDatabase,'supabase-db');
 assert.ok(f.calls.indexOf('continuation')<f.calls.indexOf('mkdir'));assert.ok(f.calls.indexOf('formal')<f.calls.indexOf('mkdir'));
 assert.ok(f.calls.indexOf('create')<f.calls.indexOf('verify'));assert.ok(f.calls.indexOf('verify')<f.calls.indexOf('validate'));
 assert.ok(f.calls.indexOf('validate')<f.calls.indexOf('write:/op/new/application-binding.json'));assert.equal(f.calls.filter(c=>c==='formal').length,2);
 for(const name of ['attempt.json','backup.key','backup-create.json','backup-verify.json','application-binding.json'])assert.ok(f.files.has('/op/new/'+name));
 assert.ok(f.calls.filter(c=>c==='lock').length>=2);
});
test('every unconfirmed pre/post condition stops without binding, migration, old-file writes or replay',async()=>{
 for(const failure of ['lock','observe','continuation','formal','owned','mkdir','existing-install','create','verify','validate','source-drift','formal-drift']){
  const f=fixture(failure);await assert.rejects(f.run({lock:'genuine'}));assert.ok(!f.files.has('/op/new/application-binding.json'));
  assert.ok([...f.files.keys()].every(file=>file.startsWith('/op/new/')));assert.ok(f.calls.filter(c=>c==='create').length<=1);
  if(['lock','observe','continuation','formal','owned','existing-install'].includes(failure))assert.ok(!f.calls.includes('create'));
 }
 const fake=fixture();await assert.rejects(fake.run({lock:'forged'}));assert.deepEqual([...fake.files],[]);
 await assert.rejects(runBookingFormalBackup({lock:true,sourceSha:'forged'}),/arguments/);
});
test('consumer requires NEW physical paths, sealed key/attempt/reports and unchanged shared formal validation',async()=>{
 const f=fixture();await f.run({lock:'genuine'});f.context.fs.existsSync=()=>true;
 const fn=extracted('validateBookingPublicationBackupEvidence',f.context);assert.equal((await fn(f.expected)).archiveSha256,f.dr.archiveSha256);
 for(const patch of [{backup:'/op/database.tar.enc'},{createReport:'/op/backup-create.json'},{verifyReport:'/op/backup-verify.json'},{sourceSha:'forged'},{nowMs:1}])await assert.rejects(fn({...f.expected,...patch}));
 f.files.set('/op/new/backup.key',Buffer.from('changed'));await assert.rejects(fn(f.expected));
 const absent=fixture();absent.context.fs.existsSync=()=>false;await assert.rejects(extracted('validateBookingPublicationBackupEvidence',absent.context)(absent.expected),/binding_missing/);
 const other=fixture();const request={target:'other',backup:'/other'};assert.equal(await extracted('validateBookingPublicationBackupEvidence',other.context)(request),request);assert.deepEqual(other.calls,['prior']);
});
test('new adapter never changes source refs, shared code, builds, old archives, pilot services or saved rows',()=>{
 for(const token of ['assertBookingFormalPreserved()','application_blob','application_proof','application_environment','application_dependencies','application_build',
  'assertBookingCompatibilityProof(proof,','validateBookingDatabaseState(','attendanceCompatibilityMetadataContractSql()',
  'FAOLLA_DATABASE_CONTAINER:production.containerName',"FAOLLA_STORAGE_CONTAINER:'supabase-storage'",'fs.mkdirSync(DIR,{mode:0o700})',
  'same(await formalBeforeBackup(),formal,','validateAttendanceBackupEvidence({...input(),target:before.toolRevision})','O_EXCL','O_NOFOLLOW'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/update-ref|unlinkSync|rmSync|\['(?:start|stop|restart|delete)'\]|--force|--skip|installInactiveBookingSchema|guardedBookingMigrationSql/);
});
