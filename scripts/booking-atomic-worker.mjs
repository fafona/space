// Dedicated booking automation only. This entrypoint never starts the unrelated
// enterprise/outbox workers and cannot dispatch before a durable handoff gate.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_APPLICATION as APPLICATION} from './booking-handoff-policy.mjs';
import {BOOKING_RETENTION_KIND} from './booking-handoff-retention.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionHistory,inspectOnlineRetentionWindow,retentionHash,retentionCanonicalText} from './online-release-retention-policy.mjs';
import {assertOnlineToolOwnedPath,createOnlineReleaseToolPlan,readOnlineToolInventory,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {bookingWorkerEntryMode} from './release-toolchain-worker-entry.mjs';
import {assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {withPinnedFormalPm2Process} from './release-toolchain-proc-witness.mjs';

const ROOT='/var/lib/faolla-booking-handoff/'+CANDIDATE;
const SOURCE='/www/wwwroot/merchant-space.web-releases/'+CANDIDATE.slice(0,12)+'-online';
const fail=code=>{throw Error('booking_atomic_worker_'+code);};
const need=(v,code)=>{if(!v)fail(code);};
const equal=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hex=/^[a-f0-9]{64}(?![\s\S])/,sha=/^[a-f0-9]{40}(?![\s\S])/;
const identity=st=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,st[k]]));
function privateText(file){
  assertOnlineToolOwnedPath(file,'file');
  const before=fs.lstatSync(file);
  need((before.mode&0o777)===0o600&&before.size>0&&before.size<=4*1024**2,'private_file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    equal(identity(fs.fstatSync(fd)),identity(before),'file_replaced');
    const bytes=fs.readFileSync(fd);equal(identity(fs.fstatSync(fd)),identity(before),'file_changed');
    equal(identity(fs.lstatSync(file)),identity(before),'file_replaced');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    need(Buffer.from(text).equals(bytes)&&bytes.length===before.size,'file_encoding');return text;
  }finally{fs.closeSync(fd);}
}

export function assertBookingAtomicWorkerEnvironment(env){
  need(object(env)&&env.NODE_ENV==='production'&&env.PWD===SOURCE&&
    env.MERCHANT_BOOKING_STORAGE_MODE==='atomic-v2'&&env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED==='1'&&
    env.FAOLLA_BACKGROUND_JOBS_PAUSED==='0'&&env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED==='0'&&
    env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED==='0'&&!env.RESEND_API_KEY&&!env.BOOKING_CONFIRMATION_EMAIL_FROM,'environment');
  return true;
}
export function assertBookingAtomicWorkerGate({gate,history,actualActive,current,toolRevision}){
  need(object(gate),'gate_shape');
  equal(Object.keys(gate).sort(),['schemaVersion','kind','candidate','toolRevision','certificateSha256','generation','enabled'].sort(),'gate_shape');
  need(gate.schemaVersion===1&&gate.kind==='booking-atomic-worker-gate'&&gate.candidate===CANDIDATE&&
    gate.enabled===true&&sha.test(toolRevision??'')&&gate.toolRevision===toolRevision&&hex.test(gate.certificateSha256??''),'gate_identity');
  assertOnlineRetentionHistory(history);
  const certificate=history.entries.find(c=>c.kind===BOOKING_RETENTION_KIND&&retentionHash(c)===gate.certificateSha256);
  need(certificate&&certificate.toolRevision===toolRevision&&certificate.active.target===CANDIDATE&&
    certificate.rollback.target===APPLICATION&&gate.generation===certificate.bookingHandoff.databaseAfter.generation,'gate_certificate');
  need([CANDIDATE,APPLICATION].includes(actualActive?.target),'gate_active');
  inspectOnlineRetentionWindow({history,actualActive,current});
  return {generation:gate.generation,certificateSha256:gate.certificateSha256};
}

/** No overlapping ticks and no immediate retry on an unknown result. Tests can
 * supply synthetic operations; the production CLI accepts no dependency ports. */
export async function runBookingAtomicWorkerLoop(operations,{maxCycles=Infinity}={}){
  need(maxCycles===Infinity||Number.isSafeInteger(maxCycles)&&maxCycles>=0,'cycle_limit');
  let cycles=0;
  while(cycles<maxCycles&&!operations.stopped()){
    let status='paused';
    try{
      const gate=await operations.gate();
      if(gate&&!operations.stopped()){
        const snapshot=await operations.probe();
        need(snapshot?.protocol===2&&snapshot.generation===gate.generation,'database_generation');
        // Recheck the actual durable gate after the remote read. A closed or
        // replaced gate cannot admit a new tick based on an earlier snapshot.
        const again=await operations.gate();equal(again,gate,'gate_changed');
        if(!operations.stopped()){status='running';operations.status(status);await operations.tick();status='completed';}
      }
    }catch{status=status==='running'?'unconfirmed':'paused';}
    operations.status(status);cycles++;
    if(cycles<maxCycles&&!operations.stopped())await operations.wait(60000);
  }
  return {cycles,stopped:operations.stopped()};
}

function verifyPinnedSource(toolRevision){
  const tool='/var/lib/faolla-online-code/'+toolRevision;
  // A long-lived worker pins its reviewed immutable source, not the moving
  // origin/main ref. No fabricated Git result or process-environment bypass.
  need(sha.test(toolRevision)&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))===tool,'tool_path');
  for(const directory of [tool,SOURCE]){
    assertOnlineToolOwnedPath(directory);
    const expected=directory===tool?toolRevision:CANDIDATE;
    need(runOnlineToolGit(directory,['rev-parse','HEAD']).toString().trim()===expected&&
      !runOnlineToolGit(directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'source_changed');
  }
  for(const item of readOnlineToolInventory(createOnlineReleaseToolPlan(toolRevision))){
    if(item.excluded)continue;
    const file=tool+'/'+item.name;assertOnlineToolOwnedPath(file,'file');
    const bytes=fs.readFileSync(file),oid=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
    need(oid===item.oid,'tool_bytes');
  }
}
export function loadBookingAtomicWorkerApplication(source=SOURCE){
  const require=createRequire(source+'/package.json'),{require:tsxRequire}=require('tsx/cjs/api');
  // The scoped CJS API resolves the application's extensionless TS imports
  // and aliases on both Node 20 and Node 24. No environment file is loaded.
  const atomic=tsxRequire(source+'/src/lib/merchantBookingAtomicRuntime.server.ts',source+'/package.json');
  const bookings=tsxRequire(source+'/src/lib/merchantBookings.server.ts',source+'/package.json');
  const probe=atomic.readAtomicBookingSnapshot??atomic.default?.readAtomicBookingSnapshot;
  const tick=bookings.runMerchantBookingAutomationForAllSites??bookings.default?.runMerchantBookingAutomationForAllSites;
  need(typeof probe==='function'&&typeof tick==='function','application_exports');
  return {probe,tick};
}
async function productionWorker(){
  need(process.platform==='linux'&&process.getuid?.()===0&&process.argv.length===2&&fs.realpathSync(process.cwd())===SOURCE,'invocation');
  const toolRevision=path.basename(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  verifyPinnedSource(toolRevision);assertBookingAtomicWorkerEnvironment(process.env);
  const savedText=privateText(ROOT+'/worker-runtime.json'),saved=JSON.parse(savedText);
  assertBookingAtomicWorkerEnvironment(saved);
  for(const [key,value]of Object.entries(saved))need(typeof value==='string'&&process.env[key]===value,'runtime_changed');
  const {probe,tick}=loadBookingAtomicWorkerApplication();
  let stopped=false,wake;
  const stop=()=>{stopped=true;wake?.();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    await runBookingAtomicWorkerLoop({stopped:()=>stopped,probe,tick,
      gate:()=>withPinnedFormalPm2Process(()=>{
        // Missing is deliberately paused. Malformed/partial evidence is an
        // error, never an alternative permission to fall back to legacy.
        try{fs.lstatSync(ROOT+'/worker-enabled.json');}catch(e){if(e.code==='ENOENT')return null;throw e;}
        const text=privateText(ROOT+'/worker-enabled.json'),gate=JSON.parse(text);
        need(text===retentionCanonicalText(gate),'gate_encoding');
        equal(privateText(ROOT+'/worker-runtime.json'),savedText,'runtime_file_changed');
        assertBookingAtomicWorkerEnvironment(process.env);
        // A missing/replaced manager fails closed. A task must never boot a
        // fresh daemon as the PM2 CLI's jlist command can do implicitly.
        const current=collectFormalBookingPm2Registry().rows.map(normalizeRetirementProcess);
        const actualActive=JSON.parse(privateText('/var/lib/faolla-online-release/active.json'));
        const history=readOnlineRetentionHistory();
        assertBookingWorkerExecutionRevision({gate,history,toolRevision});
        return assertBookingAtomicWorkerGate({gate,history,actualActive,current,toolRevision:gate.toolRevision});
      }),
      status:value=>{console.info(JSON.stringify({kind:'booking-atomic-worker',status:value,at:new Date().toISOString()}));},
      wait:ms=>new Promise(resolve=>{let timer;wake=()=>{clearTimeout(timer);wake=undefined;resolve();};timer=setTimeout(wake,ms);}),
    });
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(bookingWorkerEntryMode(import.meta.url)){
  productionWorker().catch(()=>{console.error('booking_atomic_worker_unverified');process.exitCode=1;});
}
