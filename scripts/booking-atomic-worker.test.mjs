import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertBookingAtomicWorkerEnvironment,assertBookingAtomicWorkerGate,runBookingAtomicWorkerLoop,selectBookingWorkerDatabaseCredential} from './booking-atomic-worker.mjs';
import {bookingHandoffFixture} from './test-support/booking-handoff-retention-fixture.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE} from './booking-handoff-policy.mjs';
const clone=structuredClone;
test('database selection copies only the existing matching service credential, never mail or admin settings',()=>{
  const value='synthetic-service-credential-'.repeat(3),env={NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.invalid',SUPABASE_INTERNAL_URL:'http://127.0.0.1:8000'},text=`NEXT_PUBLIC_SUPABASE_URL=${env.NEXT_PUBLIC_SUPABASE_URL}\nSUPABASE_INTERNAL_URL=${env.SUPABASE_INTERNAL_URL}\nSUPABASE_SERVICE_ROLE_KEY="${value}"\nRESEND_API_KEY=must-not-load\nSUPER_ADMIN_PASSWORD=must-not-load\n`;
  const before=clone(env);assert.deepEqual(selectBookingWorkerDatabaseCredential(text,env),{name:'SUPABASE_SERVICE_ROLE_KEY',value});assert.deepEqual(env,before);
  assert.deepEqual(selectBookingWorkerDatabaseCredential(text.replace('SUPABASE_SERVICE_ROLE_KEY','NEXT_SUPABASE_SERVICE_ROLE_KEY'),env),{name:'NEXT_SUPABASE_SERVICE_ROLE_KEY',value});
  for(const changed of [text.replace('SUPABASE_SERVICE_ROLE_KEY','UNRELATED_KEY'),text+'SUPABASE_SERVICE_ROLE_KEY='+value+'\n',text.replace(value,'$VARIABLE'),text.replace(value,'bad value'),text.replace('https://synthetic.invalid','https://foreign.invalid')])assert.throws(()=>selectBookingWorkerDatabaseCredential(changed,env),error=>!error.message.includes(value)&&!error.message.includes('must-not-load'));
  assert.throws(()=>selectBookingWorkerDatabaseCredential(text,{...env,SUPABASE_SERVICE_ROLE_KEY:'foreign-credential'}),/database_credential_changed/);
  assert.throws(()=>selectBookingWorkerDatabaseCredential(text,{...env,SUPABASE_INTERNAL_URL:'http://foreign.invalid'}),/database_destination_changed/);
  assert.throws(()=>selectBookingWorkerDatabaseCredential(text+'NEXT_SUPABASE_SERVICE_ROLE_KEY=another-service-credential-different\n',env));
});
test('booking worker environment can enable only atomic booking automation, not mail or enterprise workers',()=>{
  const env={NODE_ENV:'production',PWD:'/www/wwwroot/merchant-space.web-releases/'+CANDIDATE.slice(0,12)+'-online',
    MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1',FAOLLA_BACKGROUND_JOBS_PAUSED:'0',
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'};
  assertBookingAtomicWorkerEnvironment(env);
  for(const key of Object.keys(env))assert.throws(()=>assertBookingAtomicWorkerEnvironment({...env,[key]:'wrong'}),undefined,key);
  for(const key of ['RESEND_API_KEY','BOOKING_CONFIRMATION_EMAIL_FROM'])assert.throws(()=>assertBookingAtomicWorkerEnvironment({...env,[key]:'forbidden'}));
});
function gateFixture(){
  const f=bookingHandoffFixture(),receipt=buildOnlineRetentionReceipt(f.before,clone(f.before),{version:2,process:null},f.history,
    {preparedAt:'2026-10-26T10:01:00.000Z',completedAt:'2026-10-26T10:01:00.000Z'});
  const history={...f.history,entries:[...f.history.entries,receipt.certificate],headSha256:retentionHash(receipt.certificate)};
  return {gate:{schemaVersion:1,kind:'booking-atomic-worker-gate',candidate:CANDIDATE,toolRevision:f.before.toolRevision,
    certificateSha256:history.headSha256,generation:f.handoff.databaseAfter.generation,enabled:true},history,
    actualActive:Object.fromEntries(['target','name','directory','port'].map(k=>[k,f.active[k]])),current:f.after,toolRevision:f.before.toolRevision};
}
test('worker gate requires the complete committed handoff, exact generation, actual process set and selected compatible edge',()=>{
  const f=gateFixture();assertBookingAtomicWorkerGate(f);
  for(const [key,value]of Object.entries({schemaVersion:2,kind:'other',candidate:'a'.repeat(40),toolRevision:'b'.repeat(40),
    certificateSha256:'c'.repeat(64),generation:'wrong',enabled:false,extra:true})){
    const v=clone(f);v.gate[key]=value;assert.throws(()=>assertBookingAtomicWorkerGate(v),undefined,key);
  }
  for(const mutate of [v=>v.history.entries.pop(),v=>{v.current.find(p=>p.name==='merchant-space-enterprise-automation-worker').pid++;},
    v=>{v.actualActive.target='a'.repeat(40);},v=>{v.history.entries.at(-1).bookingHandoff.databaseAfter.active=false;}]){
    const v=clone(f);mutate(v);assert.throws(()=>assertBookingAtomicWorkerGate(v));
  }
});
function operations(){
  const events=[],gate={generation:'synthetic',certificateSha256:'a'.repeat(64)};
  return {events,gate:async()=>{events.push('gate');return gate;},probe:async()=>{events.push('probe');return {protocol:2,generation:'synthetic'};},
    tick:async()=>{events.push('tick');},wait:async ms=>{events.push(['wait',ms]);},stopped:()=>false,status:v=>events.push(v)};
}
test('a missing, invalid or changed durable gate never reaches booking automation',async()=>{
  for(const behavior of ['missing','invalid','changed','generation']){
    const o=operations();let reads=0;
    if(behavior==='missing')o.gate=async()=>null;
    if(behavior==='invalid')o.gate=async()=>{throw Error('private failure');};
    if(behavior==='changed')o.gate=async()=>++reads===1?{generation:'synthetic'}:null;
    if(behavior==='generation')o.probe=async()=>({protocol:2,generation:'foreign'});
    await runBookingAtomicWorkerLoop(o,{maxCycles:1});assert.ok(!o.events.includes('tick'),behavior);assert.equal(o.events.at(-1),'paused');
  }
});
test('ticks are serial and a lost result waits a full interval without immediately resending or exposing errors',async()=>{
  const o=operations();let running=0,max=0;
  o.tick=async()=>{running++;max=Math.max(max,running);await Promise.resolve();running--;throw Error('private credential synthetic');};
  await runBookingAtomicWorkerLoop(o,{maxCycles:2});
  assert.equal(max,1);assert.deepEqual(o.events.filter(Array.isArray),[['wait',60000]]);
  assert.equal(o.events.filter(v=>v==='unconfirmed').length,2);
  assert.ok(!JSON.stringify(o.events).includes('credential'));
});
test('stop observed during probing prevents a new tick and the loop does not overlap an admitted tick',async()=>{
  const o=operations();let stopped=false;o.stopped=()=>stopped;
  o.probe=async()=>{stopped=true;return {protocol:2,generation:'synthetic'};};
  const result=await runBookingAtomicWorkerLoop(o,{maxCycles:3});assert.equal(result.cycles,1);assert.ok(!o.events.includes('tick'));
  const live=operations();let finish;live.tick=()=>new Promise(resolve=>{finish=resolve;});
  const run=runBookingAtomicWorkerLoop(live,{maxCycles:1});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(live.events.at(-1),'running');finish();await run;assert.equal(live.events.at(-1),'completed');
});
test('worker CLI has no secret-loading prompt, alternate roots, unguarded timer or enterprise worker startup',()=>{
  const source=readFileSync(new URL('./booking-atomic-worker.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/setInterval\(|loadEnvConfig|startMerchantEnterprise|exec\(|--skip|--force/);
  assert.match(source,/process\.argv\.length===2/);assert.match(source,/readOnlineRetentionHistory\(\)/);
  assert.match(source,/withPinnedFormalPm2Process/);assert.match(source,/collectFormalBookingPm2Registry\(\)/);assert.doesNotMatch(source,/spawnSync\('pm2'|\['jlist'\]/);
});
test('the actual worker loader imports the approved TS application without executing a tick or any remote request',()=>{
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const script=`globalThis.fetch=()=>{throw Error('remote_request_forbidden');};
    const {loadBookingAtomicWorkerApplication}=await import(${JSON.stringify(new URL('./booking-atomic-worker.mjs',import.meta.url).href)});
    const v=loadBookingAtomicWorkerApplication(${JSON.stringify(root)});
    if(typeof v.probe!=='function'||typeof v.tick!=='function')throw Error('application_exports');
    console.log('booking-worker-import-only-ok');`;
  const env=Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','HOME'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,env:{...env,NODE_ENV:'test'},encoding:'utf8',timeout:60000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
  assert.equal(result.stdout.trim(),'booking-worker-import-only-ok');
});
