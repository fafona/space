import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingReadyImportClosure,prepareBookingReadyTool,assertBookingReadySource} from './booking-ready-tool.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8'),source=read('scripts/booking-ready-tool.mjs');
function node(name){const ast=ts.createSourceFile('x.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast).replace(/^export /,'');}
test('bootstrap traverses the actual cyclic AST import closure, not a guessed subset',()=>{
 const seen=new Set();function visit(f){if(seen.has(f))return;seen.add(f);const ast=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const n of ast.statements)if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&!n.moduleSpecifier.text.startsWith('node:')){assert.ok(n.moduleSpecifier.text.startsWith('./'));visit('scripts/'+n.moduleSpecifier.text.slice(2));}}
 visit('scripts/booking-ready-tool.mjs');assert.deepEqual(bookingReadyImportClosure(read),[...seen].sort());assert.throws(()=>bookingReadyImportClosure(()=>"import '../escape.mjs';"));
});
test('raw current/predecessor source, historical checkouts, failed evidence and compiled app/deps are revalidated without mutations',()=>{
 for(const token of ['changes(BASE,revision)','bookingReadyInputs(rows(BASE))','bookingReadyInputs(rows(revision))','changes(PRIOR,BASE)','bookingDependencyInputs(rows(BASE))',
 'verifyHistoricalOnlineTool','assertBookingDependencyReceipt(prior,BASE)','assertBookingFormalPreserved()','assertBookingCiKernelEvidence()',
 'observeBookingReadyApplication()','collectBookingReadyOriginalCohort()','private_web_identity','bootstrap_sparse','bootstrap_entry','O_NOFOLLOW','O_EXCL','fs.fsyncSync','existing_attempt',
 'changes(ORIGINAL,FORMAL)','formalInputs(ORIGINAL)','formalInputs(FORMAL)','changes(FORMAL,PRIOR)','bookingCiInputs(rows(PRIOR))','assertBookingCiReceipt(ci,PRIOR)','prior_ci_source'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/spawnSync|process\.kill|bookingHostSql|unlinkSync|rmSync|projectBooking|\['start'|\['restart'|\['stop'/);
 assert.throws(()=>prepareBookingReadyTool('f'.repeat(40),'wrong'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingReadySource('f'.repeat(40)),/invocation/);
});
test('actual preparer stays synchronous under preparation locks, preserves old evidence, and seals only after all rechecks',()=>{
 for(const failure of [null,'source','pending','original','checkout','prepared','exists','drift']){
  const calls=[];let observations=0;const gate=k=>{calls.push(k);if(k===failure)throw Error(k);},need=(v,c)=>{if(!v)throw Error(c);};
  const fn=runInNewContext(node('prepareBookingReadyTool')+'\nprepareBookingReadyTool',{need,Date,JSON,ROOT:'/bootstrap',BASE:'base',OP:'/op',C:'candidate',APP:'/app',RECEIPT:'receipt',
   same:(a,b,c)=>need(isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b))),c),
   source:(_r,_d,o)=>{gate(o?.bootstrap?'source':'prepared');return {sourceInputsSha256:'inputs',toolClosureSha256:'closure'};},
   original:()=>{gate('original');return {preserved:'pins',seen:failure==='drift'?++observations:1};},assertBookingReadyToolNoPending:()=>gate('pending'),
   assertBookingReadyReceipt:()=>gate('receipt'),process:{umask:()=>0o022},
   fs:{lstatSync:()=>{if(failure==='exists')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}},
   withOnlineToolPreparationLocks:(locks,work)=>{assert.equal(locks.deployLock,'/app.deploy.lock');calls.push('locks');const v=work();assert.equal(v?.then,undefined);return v;},
   createOnlineReleaseToolPlan:r=>({revision:r}),executeOnlineReleaseToolPlan:()=>{gate('checkout');return {directory:'/tool'};},seal:n=>calls.push('seal:'+n)});
  if(failure){assert.throws(()=>fn('new','approved-booking-native-ready-continuation'));assert.ok(!calls.includes('seal:receipt'));}
  else{const result=fn('new','approved-booking-native-ready-continuation');for(const k of ['applicationRebuilt','webProcessesChanged','productionDatabaseChanged','trafficChanged','mailEnabled'])assert.equal(result[k],false);assert.deepEqual(calls.filter(k=>k.startsWith('seal:')),['seal:receipt']);}
 }
});
