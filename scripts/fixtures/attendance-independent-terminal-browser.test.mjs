import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createIndependentTerminalBrowserModel,independentTerminalBrowserLimits} from './attendance-independent-terminal-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceIndependent.ts'),f=require('./attendance-independent-ui-model.ts');
const origin='http://127.0.0.1',api=origin+'/api/merchant-enterprise/attendance/independent-terminal',device=origin+'/api/merchant-enterprise/attendance/terminal-device';
const body=(m,request)=>({...m.seed,pin:'12345678',request});
const send=async(m,request)=>m.respond(api,'POST',JSON.stringify(body(m,request)));
async function state(m){return JSON.parse((await send(m,{kind:'state'})).text).data.data;}
function command(s,n,action){const subject=s.subject;return{operationId:f.independentUiId(n),subjectId:subject.subjectId,workerId:subject.workerId,generation:subject.generation,
 credentialId:subject.credentialId,credentialRevision:subject.credentialRevision,expectedWorkerVersion:subject.workerVersion,expectedSettingsVersion:subject.settingsVersion,
 locationId:subject.locationId,expectedLocationVersion:subject.locationVersion,expectedSequence:s.head.sequence,action,breakPaid:action==='break_start'?false:null};}

test('196 browser model uses exact existing paired-device DTO and one original command, not a simulated member actor',async()=>{
 const m=await createIndependentTerminalBrowserModel(),paired=JSON.parse((await m.respond(device,'GET','')).text);
 assert.equal(paired.paired,true);assert.equal(paired.terminal.id,m.seed.terminalId);assert.equal(paired.clockEnabled,false);
 const before=await state(m),c=command(before,200,'clock_in'),r=JSON.parse((await send(m,{kind:'clock',command:c})).text).data;
 assert.equal(r.data.receipt.event.actorEmployeeId,null);assert.equal(r.data.receipt.event.sequence,1);assert.equal(m.records.size,1);
 assert.equal(r.data.receipt.commandFingerprint,await p.independentClockCommandFingerprint(m.seed.siteId,m.seed.terminalId,c));
 await assert.rejects(send(m,{kind:'clock',command:c}),/duplicate_clock_POST/);assert.equal(m.records.size,1);
 await assert.rejects(m.respond(device,'POST','{}'));await assert.rejects(m.respond(api,'GET',''));
});

test('196 browser lost reply and null recovery preserve a single committed command until exact read-only receipt',async()=>{
 const m=await createIndependentTerminalBrowserModel(),c=command(await state(m),201,'clock_in');m.loseNextClock();
 const lost=await send(m,{kind:'clock',command:c});assert.throws(()=>JSON.parse(lost.text));assert.equal(m.records.size,1);
 const recover={kind:'recover',subjectId:c.subjectId,workerId:c.workerId,operationId:c.operationId,commandFingerprint:await p.independentClockCommandFingerprint(m.seed.siteId,m.seed.terminalId,c)};
 m.hideReceipt(true);assert.equal(JSON.parse((await send(m,recover)).text).data.data.receipt,null);assert.equal(m.records.size,1);
 m.hideReceipt(false);const result=JSON.parse((await send(m,recover)).text).data;await p.parseIndependentTerminalResult(result,body(m,recover));
 assert.deepEqual(result.data.receipt.command,c);assert.equal(m.records.size,1);
 await assert.rejects(m.respond(api,'POST',JSON.stringify({...body(m,recover),pin:'wrong'})));assert.equal(m.records.size,1);
});

test('196 browser raw-personal and explicit working-tail models stay scoped, unassessed and non-formal',async()=>{
 const m=await createIndependentTerminalBrowserModel();m.working();const current=await state(m);assert.equal(current.head.status,'working');
 const c=command(current,202,'clock_out'),out=JSON.parse((await send(m,{kind:'clock',command:c})).text).data;assert.equal(out.data.head.sequence,11);assert.equal(out.data.head.status,'off');
 const personal={kind:'personal',subjectId:c.subjectId,workerId:c.workerId,fromDate:'2026-10-08',throughDate:'2026-10-08',cursor:null};
 const report=JSON.parse((await send(m,personal)).text).data;await p.parseIndependentTerminalResult(report,body(m,personal));
 assert.equal(report.data.report.rulesAssessment,'unassessed');assert.equal(report.data.report.fixedPeriodEligible,false);assert.deepEqual(report.data.report.items,[]);
 await assert.rejects(send(m,{...personal,throughDate:'2026-11-08'}));
 await assert.rejects(m.respond(api,'POST',JSON.stringify({...body(m,{kind:'state'}),workerNo:'OTHER-01'})));
});

test('196 runner is inert, memory-only, four finite actual Page/Panel groups and owned cleanup, not Auth/SQL/KDF evidence',async()=>{
 const source=await readFile(new URL('./attendance-independent-terminal-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-independent-terminal-browser-entry.tsx',import.meta.url),'utf8');
 assert.deepEqual(independentTerminalBrowserLimits,{groups:4,ttlMs:180000,http:35,api:20,posts:12,mobileWidth:390});
 for(const fragment of ['write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualSql:false','actualAuth:false','kdf:0',
  "process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)','httpOnly:true',"assert.equal(requests.length,0)",
  'lost_reply_remount_null_then_exact_original','flagoff_working_safe_finish_no_newstart','raw_personal_bounds_visibility_and_mobile'])assert(source.includes(fragment),fragment);
 for(const fragment of ['attendance-terminal/independent/page','MerchantAttendanceIndependentTerminalPanel','<Page key=', '<Panel key=', 'visibilitychange', '合成HttpOnly配对cookie'])assert(entry.includes(fragment),fragment);
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb|supabase|scrypt/.test(source));
});
