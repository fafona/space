import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingPublicationBackupRequest} from './booking-ready-backup.mjs';
import {assertBookingFormalBackupBinding} from './booking-formal-backup.mjs';
import {BOOKING_DEPENDENCY_BASE as BASE} from './booking-dependency-continuation-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
const source=readFileSync(new URL('./booking-ready-backup.mjs',import.meta.url),'utf8'),hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);},same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
function extracted(name,context){const ast=ts.createSourceFile('x.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);return runInNewContext(fn.getText(ast).replace(/^export /,'')+'\n'+name,context);}
test('canonical formal backup paths and unchanged shared DR validator are retained, never a new-source alias',()=>{
 const op='/var/lib/faolla-online-release/'+C,request=bookingPublicationBackupRequest(C,op);
 assert.equal(request.backup,op+'/formal-backup-20261027/database.tar.enc');
 for(const token of ['assertBookingReadySource(toolRevision)','for(const pin of P.pair)','application_blob','application_proof','application_environment',
  'bookingModeAwareDependencies(directory','assertBookingDependencyBinding(','same(built,pin.built','STATES.rollback.file','STATES.primary.file',
  'prior.toolRevision===BASE','toolRevision:BASE','toolReceiptSha256:hash(receipt)','assertBookingFormalPreserved()',
  'validateAttendanceBackupEvidence({...request,target:BASE})','assertBookingFormalBackupBinding(','same(observe(),before'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/createProductionDatabaseBackup|runMigrationCommand|writeFileSync|unlinkSync|rmSync|bookingCurrentReceiptName/);
});
function fixture(failure){
 const op='/op',request=bookingPublicationBackupRequest(C,op),facts={toolRevision:BASE,sourceInputsSha256:'inputs',toolClosureSha256:'closure',application:{build:'original'}};
 const files=Object.fromEntries(['attempt.json','backup.key','backup-create.json','backup-verify.json'].map(n=>['/dir/'+n,Buffer.from(n)]));
 // Request report paths are canonical for this operation.
 files[request.createReport]=Buffer.from('backup-create.json');files[request.verifyReport]=Buffer.from('backup-verify.json');
 const observed={...facts,attemptSha256:hash(files['/dir/attempt.json']),keySha256:hash(files['/dir/backup.key']),
  createReportSha256:hash(files[request.createReport]),verifyReportSha256:hash(files[request.verifyReport])};
 const backup={createdAt:'2026-10-27T18:28:38.984Z',archiveSha256:'original'};
 const binding={schemaVersion:1,kind:'booking-formal-backup-binding',...observed,backup,completedAt:'2026-10-27T18:28:40.000Z'};
 if(failure==='binding-source')binding.toolRevision='new-source';
 if(failure==='binding-build')binding.application={build:'changed'};
 if(failure==='archive')backup.archiveSha256='changed';
 const sealed=JSON.stringify(binding);if(failure==='archive')backup.archiveSha256='different';
 const calls=[];let observedCount=0;
 const fn=extracted('validateBookingPublicationBackupEvidence',{C,BASE,OP:op,DIR:'/dir',need,same,hash,bookingPublicationBackupRequest,
  observe:()=>{calls.push('observe');observedCount++;if(failure==='source')throw Error('source');return failure==='drift'&&observedCount>1?{...facts,application:{build:'changed'}}:facts;},
  read:f=>{if(failure==='missing')throw Error('missing');if(f.endsWith('application-binding.json'))return sealed;return failure==='report'&&f===request.verifyReport?Buffer.from('changed'):files[f];},
  validateAttendanceBackupEvidence:async input=>{calls.push('validate');assert.equal(input.target,BASE);assert.equal(input.backup,request.backup);if(failure==='shared')throw Error('shared');return backup;},
  assertBookingFormalBackupBinding:(value,observed,checked)=>assertBookingFormalBackupBinding(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(observed)),JSON.parse(JSON.stringify(checked))),priorValidate:async()=>{calls.push('prior');return 'prior';}});
 return {fn,request,calls};
}
test('actual adapter revalidates original source4005 backup with unchanged strict binding before and after; drift never passes',async()=>{
 const f=fixture();assert.equal((await f.fn(f.request)).archiveSha256,'original');assert.deepEqual(f.calls,['observe','validate','observe']);
 for(const failure of ['source','missing','report','shared','binding-source','binding-build','archive','drift']){const f=fixture(failure);await assert.rejects(f.fn(f.request),undefined,failure);}
 const bad=fixture();await assert.rejects(bad.fn({...bad.request,backup:'/wrong/archive'}));assert.deepEqual(bad.calls,[]);
 const other=fixture();assert.equal(await other.fn({target:'other'}),'prior');assert.deepEqual(other.calls,['prior']);
});


test('application/build verifier keeps the original strict checks and backup validator does not rewrite old provenance',()=>{
 assert.match(source,/export function observeBookingReadyApplication/);
 assert.match(source,/const application=observeBookingReadyApplication\(\)/);
 assert.match(source,/toolRevision:BASE/);
});
