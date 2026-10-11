import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';
import {assertRetainedOnlineProcesses} from './online-release-retirement-policy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {assertRollingRetainedProcesses,assertRollingStateHistory,rollingHash,ROLLING_BASE_NAMES} from './online-release-rolling-policy.mjs';
import {BOOKING_MERGE_CPU_FOCUSED_TESTS,CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS,BOOKING_STAGE_RESUME,BOOKING_STAGE_PROBE_RESUME,BOOKING_STAGE_RESUME_TOOL_FILES,assertBookingStageResumeToolScope,assertBookingStageResumeState} from './online-traffic-release-policy.mjs';
import {assertOnlineTrafficScope,onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations,assertOrderAttentionReleaseProof,assertPendingTrafficMigrations,onlineProxy,hasExpectedCardWebsite,STATIC_RECOVERY_TOOL_FILES,assertStaticRecoveryToolScope,assertCatalogStaticRecoveryState} from './online-traffic-release-policy.mjs';
import {ATTENDANCE_RELEASE_SCOPE,ATTENDANCE_RELEASE_FILES,ATTENDANCE_RELEASE_FOCUSED_TESTS,validateAttendanceReleaseScope,assertAttendanceReleaseScope,attendanceCandidateEnvironment,assertAttendanceCandidateEnvironment,assertAttendanceDatabaseReadyProof} from './online-traffic-release-policy.mjs';
import {CONTACT_WECHAT_RELEASE_BASELINE,CONTACT_WECHAT_APPROVED_SUPPORT_FILES} from './contact-wechat-release-policy.mjs';

function releaseRequestSource(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 return code.slice(code.indexOf('async function request('),code.indexOf('async function verifyBase('));
}

async function isolatedProbeServer(){
 // The server must keep running while this test's client event loop is blocked,
 // just as the existing web process keeps running during synchronous release gates.
 const child=spawn(process.execPath,['--input-type=module','-e',`
  import http from 'node:http';
  let nextConnection=0;
  const server=http.createServer((req,res)=>{
   if(req.url==='/disconnect'){req.socket.destroy();return;}
   if(req.url==='/redirect'){res.writeHead(307,{Location:'/wrong-destination'});res.end();return;}
   const status=req.url==='/unavailable'?503:req.url==='/unauthorized'?401:req.url==='/wrong-destination'?500:200;
   res.writeHead(status,{'Content-Type':'application/json'});
   res.end(JSON.stringify({connectionId:req.socket.probeId,host:req.headers.host,connection:req.headers.connection,buildId:'synthetic-booking-build'}));
  });
  server.on('connection',socket=>{socket.probeId=++nextConnection;});
  server.keepAliveTimeout=50;
  if('keepAliveTimeoutBuffer' in server)server.keepAliveTimeoutBuffer=0;
  server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
  process.stdin.resume();
  process.stdin.on('end',()=>{server.close();server.closeAllConnections();});
 `],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 let diagnostic='';child.stderr.on('data',chunk=>{diagnostic+=chunk;});
 const close=async()=>{
  child.stdin.end();
  let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve(null);},3000);});
  try{await Promise.race([exited,timeout]);}finally{clearTimeout(timer);}
  await exited;
 };
 try{
  const port=await new Promise((resolve,reject)=>{
   let pending='';const timeout=setTimeout(()=>reject(Error('probe_fixture_start_timeout')),5000);
   const cleanup=()=>clearTimeout(timeout);
   child.once('error',error=>{cleanup();reject(error);});
   child.once('exit',()=>{cleanup();reject(Error(`probe_fixture_early_exit:${diagnostic}`));});
   child.stdout.on('data',chunk=>{
    pending+=chunk;
    if(!pending.includes('\n'))return;
    try{const value=JSON.parse(pending.split('\n')[0]);assert.ok(Number.isInteger(value.port)&&value.port>0);cleanup();resolve(value.port);}catch(error){cleanup();reject(error);}
   });
  });
  return {origin:`http://127.0.0.1:${port}`,close};
 }catch(error){await close();throw error;}
}

test('real release probes use fresh connections after synchronous work while preserving status, host and manual redirects',async()=>{
 const fixture=await isolatedProbeServer();
 try{
  const request=runInNewContext(`${releaseRequestSource()}request`,{fetch,AbortSignal,Headers,URL,fail:message=>{throw Error(message);}});
  const connectionIds=new Set();
  for(let i=0;i<3;i++){
   const response=await request(`${fixture.origin}/version`,[200],'www.faolla.com');
   const body=await response.json();
   assert.equal(body.buildId,'synthetic-booking-build');
   // Native fetch versions differ on whether an explicit Host is normalized to
   // the URL authority. The controller's supplied header is covered below.
   assert.ok(['www.faolla.com',new URL(fixture.origin).host].includes(body.host));
   assert.equal(body.connection,'close');assert.equal(response.headers.get('connection'),'close');
   assert.equal(connectionIds.has(body.connectionId),false);connectionIds.add(body.connectionId);
   if(i<2){
    await new Promise(resolve=>setImmediate(resolve));
    execFileSync(process.execPath,['-e','Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,180)'],{timeout:5000,windowsHide:true});
   }
  }
  assert.equal((await request(`${fixture.origin}/unauthorized`,[401],'console.faolla.com')).status,401);
  await assert.rejects(request(`${fixture.origin}/unavailable`),/online_http:503:\/unavailable/);
  const redirect=await request(`${fixture.origin}/redirect`,[307]);
  assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),'/wrong-destination');
  await assert.rejects(request(`${fixture.origin}/disconnect`),/online_fetch_failed/);
 }finally{await fixture.close();}
});

test('probe transport enforces connection closure and retains timeout, host, headers and single-attempt HTTP acceptance',async()=>{
 const source=releaseRequestSource(),calls=[],timeouts=[];
 const make=(fetcher)=>runInNewContext(`${source}request`,{fetch:fetcher,Headers,URL,
  AbortSignal:{timeout:milliseconds=>{timeouts.push(milliseconds);return 'timeout-sentinel';}},fail:message=>{throw Error(message);},
 });
 const request=make(async(url,options)=>{calls.push({url,options});return {status:200};});
 for(const extra of [{},{connection:'keep-alive'},{Connection:'keep-alive'},{CONNECTION:'keep-alive'}]){
  await request('https://example.test/check?private=value',[200],'console.faolla.com',{'X-Probe':'synthetic',...extra});
  const {url,options}=calls.at(-1),headers=new Headers(options.headers);
  assert.equal(url,'https://example.test/check?private=value');assert.equal(options.redirect,'manual');
  assert.equal(headers.get('host'),'console.faolla.com');assert.equal(headers.get('x-probe'),'synthetic');
  assert.equal(headers.get('connection'),'close');assert.equal(options.signal,'timeout-sentinel');
 }
 assert.deepEqual(timeouts,[20000,20000,20000,20000]);
 for(const [status,allowed,pass] of [[401,[401],true],[401,[200],false],[503,[200],false],[307,[307],true]]){
  let count=0;const check=make(async()=>{count++;return {status};});
  const pending=check('https://example.test/check?secret=hidden',allowed);
  if(pass)assert.equal((await pending).status,status);else await assert.rejects(pending,new RegExp(`online_http:${status}:/check`));
  assert.equal(count,1);
 }
 for(const cause of [{code:'UND_ERR_SOCKET',message:'secret-token'}, {code:'ECONNRESET'}, {code:'injected\nsecret-token'}, undefined]){
  let count=0;const check=make(async()=>{count++;throw Object.assign(new TypeError('secret-token'),{cause});});
  await assert.rejects(check('https://example.test/check?secret=hidden'),error=>{
   assert.match(error.message,/online_fetch_failed/);assert.match(error.message,/\/check/);
   assert.doesNotMatch(error.message,/secret-token|secret=hidden|injected/);
   if(cause?.code==='UND_ERR_SOCKET'||cause?.code==='ECONNRESET')assert.ok(error.message.includes(cause.code));
   return true;
  });
  assert.equal(count,1);
 }
});

function retainedProcessHarness(){
 const sha=x=>x.repeat(40),name=x=>`merchant-space-online-${x.repeat(12)}`,cwd=x=>`/www/wwwroot/merchant-space.web-releases/${x.repeat(12)}-online`;
 const raw=(x,id,port)=>({name:name(x),pm_id:id,pid:id+100,pm2_env:{pm_cwd:cwd(x),status:'online',PORT:String(port),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'}});
 const original=[raw('a',1,3110),raw('b',2,3109),raw('c',3,3103)];
 const certificate={version:1,status:'completed',victim:{target:sha('c'),name:name('c'),pmId:3,pid:103,cwd:cwd('c'),port:3103},activeTarget:sha('a'),rollbackTarget:sha('b'),nextTarget:sha('d'),allowedActiveTargets:[sha('a'),sha('b'),sha('d')],beforeSha256:'1'.repeat(64),afterSha256:'2'.repeat(64),completedAt:'2026-09-27T18:00:00.000Z'};
 const current=structuredClone(original);current[2].pid=0;current[2].pm2_env.status='stopped';
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const helpers=source.slice(source.indexOf('const protectedBaseProcesses='),source.indexOf('async function request('));
 const saved=original.map(p=>({name:p.name,pid:p.pid,cwd:p.pm2_env.pm_cwd}));
 const s={target:sha('a'),name:name('a'),oldName:name('b'),processes:saved};
 const normalize=p=>({name:p.name,pmId:p.pm_id,pid:p.pid,cwd:p.pm2_env.pm_cwd,status:p.pm2_env.status,port:Number(p.pm2_env.PORT),backgroundPaused:p.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED,automationEnabled:p.pm2_env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,invitationEnabled:p.pm2_env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED});
 certificate.stoppedProcess=normalize(current[2]);
 const execute=(expression,{certificates=[certificate],all=current,state=s,history={version:1,entries:[],headSha256:null},rollingCheck=()=>{throw Error('unexpected_rolling_check');},action='stage',stateHistoryCheck=()=>{throw Error('unexpected_rolling_state_check');}}={})=>runInNewContext(`${helpers}${expression}`,{s:state,all,action,releaseTarget:sha('d'),oldName:name('a'),readOnlineRetentionHistory:()=>({entries:[]}),readOnlineRetirementCertificates:()=>certificates,readOnlineRollingRetentions:()=>history,assertRollingRetainedProcesses:rollingCheck,assertRollingStateHistory:stateHistoryCheck,normalizeRetirementProcess:normalize,assertRetainedOnlineProcesses,fail:m=>{throw Error(m);}});
 return {sha,name,cwd,original,current,certificate,s,execute,source,normalize};
}

test('historical process checks retain original strict behavior without a retirement certificate',()=>{
 const h=retainedProcessHarness();
 assert.doesNotThrow(()=>h.execute('verifyRetainedProcesses(s,all)',{certificates:[],all:h.original}));
 assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{certificates:[]}),/existing_process_changed/);
 assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{certificates:[],all:h.original.slice(0,2)}),/existing_process_changed/);
});

test('one certified stopped entry supports new-to-current-to-previous rollback without rewriting old snapshots',()=>{
 const h=retainedProcessHarness(),before=structuredClone(h.s);
 for(const target of ['a','b','d'])assert.doesNotThrow(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,target:h.sha(target)}}));
 assert.deepEqual(h.s,before);
 const next=JSON.parse(JSON.stringify(h.execute('snapshotRetainedProcesses(all,releaseTarget,oldName)')));
 assert.deepEqual(next,h.s.processes.slice(0,2));
 assert.doesNotThrow(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,target:h.sha('d'),processes:next}}));
 assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,target:h.sha('e')}}),/certificate_anchor_rejected/);
 for(const key of ['name','oldName'])assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,[key]:h.name('c')}}),/certificate_anchor_rejected/);
});

test('retirement cannot mask absent restarted replaced or unrelated stopped processes during stage or rollback',()=>{
 const h=retainedProcessHarness();
 const changes=[all=>all.pop(),all=>{all[2].pid=103;all[2].pm2_env.status='online';},all=>{all[2].pm_id=9;},all=>{all[2].pm2_env.pm_cwd='/replacement';},all=>{all[1].pid=0;all[1].pm2_env.status='stopped';}];
 for(const change of changes){const all=structuredClone(h.current);change(all);
  assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{all}),/online_retirement_/);
  assert.throws(()=>h.execute('snapshotRetainedProcesses(all,releaseTarget,oldName)',{all}),/online_retirement_/);
 }
});

test('retirement wiring precedes baseline HTTP acceptance and persists only a verified new snapshot',()=>{
 const {source}=retainedProcessHarness();
 const verify=source.slice(source.indexOf('async function verifyBase('),source.indexOf('function configUnchanged('));
 assert.ok(verify.indexOf('verifyRetainedProcesses(s,pm())')<verify.indexOf('baseline_version_changed'));
 assert.match(source,/\.\.\.snapshotOnlineRetention\(all,target,old.name\)/);
 assert.match(source,/if\(lane==='runtime-performance'\)run\('node',\['--test','scripts\/online-release-retirement-policy.test.mjs','scripts\/online-release-retirement.test.mjs'\]/);
 assert.doesNotMatch(source,/pm2.*\['(?:stop|delete)'/);
});

test('QR export lane admits only the requested client feature and exact release tooling',()=>{
 const feature=['src/lib/merchantBusinessCardQrExport.ts','src/lib/merchantBusinessCardQrExport.test.ts','src/components/admin/BusinessCardQrExportDialog.tsx','src/components/admin/MerchantBusinessCardManager.tsx'];
 assert.equal(onlineReleaseLane(feature),'qr-export');
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficCampaign.server.ts']),'traffic');
 for(const file of ['src/app/api/polls/route.ts','src/lib/superAdminVerification.ts','src/lib/merchantBusinessCards.ts','src/data/platformControlStore.ts','package-lock.json','scripts/supabase-migrations/202609230049_account_traffic_events.sql','scripts/production-maintenance-attempt-recovery-evidence.mjs'])assert.throws(()=>onlineReleaseLane([...feature,file]));
 assert.equal(onlineReleaseLane([...feature,'scripts/production-maintenance-attempt-recovery-evidence.test.mjs']),'qr-export');
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.throws(()=>assertOnlineReleaseDatabaseAllowed('qr-export'),/qr_export_database_forbidden/);
 assert.equal(onlineReleaseStageStatus('qr-export'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('qr-export'),'ready-no-database');
 assert.match(code,/assertOnlineReleaseDatabaseAllowed\(s.lane\)/);
 assert.match(code,/s.status=onlineReleaseStageStatus\(lane\)/);
 assert.match(code,/lane==='traffic'\?\{FAOLLA_TRAFFIC_ENABLED:'0'/);
 assert.match(code,/qr_export_analytics_baseline_invalid/);
});

const performanceRuntimeFiles=[
 'src/app/admin/AdminClient.tsx','src/components/admin/MerchantCustomerManager.tsx',
 'src/lib/merchantCustomers.ts','src/lib/merchantCustomerListViewport.ts',
 'src/lib/performanceTelemetry.ts','src/lib/visiblePolling.ts',
];
const performanceAcceptanceFiles=[
 'src/app/admin/AdminClient.attention.test.ts',
 'src/components/admin/MerchantCustomerManager.behavior.test.ts',
 'src/components/admin/MerchantCustomerManager.contract.test.ts',
 'src/lib/merchantCustomers.test.ts','src/lib/merchantCustomerListViewport.test.ts',
 'src/lib/performanceTelemetry.test.ts','src/lib/visiblePolling.test.ts',
 'scripts/performance-phase1-browser-harness.mjs','scripts/fixtures/performance-phase1-browser.tsx',
 'scripts/repair-unlaunched-transport.test.mjs','src/lib/merchantBusinessCardWebsiteRoute.test.ts',
 'docs/performance-phase1-2026-09-24.md','scripts/online-traffic-release-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];
test('performance lane requires a runtime anchor and admits only the exact phase 1 files',()=>{
 for(const anchor of performanceRuntimeFiles)assert.equal(onlineReleaseLane([anchor]),'performance');
 assert.equal(onlineReleaseLane([...performanceRuntimeFiles,...performanceAcceptanceFiles]),'performance');
 for(const file of performanceAcceptanceFiles.filter(file=>!file.startsWith('scripts/online-traffic-release')&&file!=='docs/no-maintenance-release.md'))assert.throws(()=>onlineReleaseLane([file]),/online_release_scope_rejected/);
 assert.throws(()=>onlineReleaseLane([]),/online_release_scope_rejected/);
});
test('performance lane cannot inherit authorization from traffic, QR, dependencies or arbitrary matching filenames',()=>{
 const rejected=[
  'src/app/api/bookings/route.ts','src/app/api/orders/route-handler.ts','src/app/api/merchant-customers/route.ts',
  'src/app/api/polls/route.ts','src/app/api/traffic/collect/route-handler.ts','src/lib/accountTrafficCampaign.server.ts',
  'src/app/api/auth/signin/route.ts','src/lib/superAdminVerification.ts','src/data/platformControlStore.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/lib/merchantOrdersStore.ts','src/lib/merchantBookings.server.ts',
  'src/lib/merchantCustomerDirectoryStore.ts','src/lib/merchantEnterpriseAutomation.server.ts',
  'src/lib/merchantBusinessCardQrExport.ts','src/components/admin/MerchantBusinessCardManager.tsx',
  'package.json','package-lock.json','.env.example','.github/workflows/ci.yml','scripts/deploy.production.sh',
  'scripts/repair-unlaunched-transport.mjs','src/lib/merchantBusinessCardWebsiteRoute.ts',
  'scripts/supabase-migrations/202609230049_account_traffic_analytics.sql',
  'scripts/supabase-migrations/202609240052_performance.sql',
  'src/lib/performanceTelemetry.server.ts','src/lib/visiblePollingExtra.ts',
  'scripts/fixtures/performance-phase2-browser.tsx','docs/performance-phase2-2026-09-24.md',
  './src/lib/visiblePolling.ts','src/lib/../lib/visiblePolling.ts','src/lib\\visiblePolling.ts',
 ];
 for(const file of rejected){
  assert.throws(()=>onlineReleaseLane([...performanceRuntimeFiles,file]),/performance_release_scope_rejected/,file);
  assert.throws(()=>onlineReleaseLane([file,...performanceRuntimeFiles]),/performance_release_scope_rejected/,file);
 }
 // The old analytics assertion itself must not become a performance bypass.
 for(const file of performanceRuntimeFiles)assert.throws(()=>assertOnlineTrafficScope([file]),/online_release_scope_rejected/);
});
test('stage and activation readiness remain lane-specific and fail closed for unknown persisted lanes',()=>{
 assert.equal(onlineReleaseStageStatus('performance'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('performance'),'ready-no-database');
 assert.equal(onlineReleaseStageStatus('traffic'),'staged');
 assert.equal(onlineReleaseActivationStatus('traffic'),'database-ready');
 assert.doesNotThrow(()=>assertOnlineReleaseDatabaseAllowed('traffic'));
 for(const lane of [undefined,null,'','ui','Performance','toString','__proto__']){
  for(const check of [onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed])assert.throws(()=>check(lane),/unknown_online_release_lane/);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(code,/verifyCandidate\(s\);s.status=onlineReleaseStageStatus\(lane\);save\(s\)/);
 assert.match(code,/await smoke\(s\);s.status=onlineReleaseStageStatus\(s.lane\);save\(s\)/);
 assert.match(code,/if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\)/);
});
test('actual database branch refuses every no-database lane before backup, migrations or candidate operations',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database'){");
 const end=code.indexOf("}else if(action==='activate'){",start);
 assert.ok(start>0&&end>start);
 // This branch is extracted from an ESM controller. Substitute only the module
 // URL expression so the unchanged branch can be parsed in a classic VM script.
 const branch=code.slice(start+"}else if(action==='database'){".length,end).replaceAll('import.meta.url','controllerModuleUrl');
 for(const [lane,error] of [['performance','performance_database_forbidden'],['qr-export','qr_export_database_forbidden'],['bounded-lists','bounded_lists_database_forbidden'],['read-index','read_index_database_forbidden'],['public-catalog-batch','public_catalog_batch_database_forbidden'],['runtime-performance','runtime_performance_database_forbidden'],['booking-merge-cpu','booking_merge_cpu_database_forbidden'],['customer-code-performance','customer_code_performance_database_forbidden'],['contact-wechat-code-only','contact_wechat_code_only_database_forbidden']]){
  const calls=[];
  const denied=(name)=>()=>{calls.push(name);throw Error(`unexpected_${name}`);};
  const task=runInNewContext(`(async()=>{${branch}})()`,{
   s:{lane,status:'staged'},assertOnlineReleaseDatabaseAllowed,controllerModuleUrl:import.meta.url,
   configUnchanged:denied('config'),verifyCandidate:denied('candidate'),verifyOrderAttentionSource:denied('source'),
   applyProductionDatabaseMigrations:denied('migration'),createProductionDatabaseBackup:denied('backup'),
   verifyProductionDatabaseBackup:denied('verify_backup'),run:denied('command'),atomic:denied('state'),
   verifyOrderAttention:denied('pilot_operation'),setOrderAttentionCandidateFlag:denied('pilot_flag'),
   fail:(message)=>{throw Error(message);},
  });
  await assert.rejects(task,new RegExp(`^Error: ${error}$`));
  assert.deepEqual(calls,[]);
 }
});

const bookingMergeCpuFiles=[
 'src/lib/merchantBookingPersistenceStore.ts','src/lib/merchantBookingMergeParity.test.ts',
 'src/app/api/merchant-customers/route.booking-merge.test.ts','docs/booking-merge-cpu-2026-09-27.md',
 '.github/workflows/ci.yml','scripts/run-ci-tests.mjs','scripts/ci-workflow-contract.test.mjs',
 'scripts/production-maintenance-pm2-connection.test.mjs','scripts/repair-startup.test.mjs','docs/performance-ci-parallel-2026-09-27.md',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
 'scripts/online-release-rolling-policy.mjs','scripts/online-release-rolling-policy.test.mjs',
 'scripts/online-release-rolling.mjs','scripts/online-release-rolling.test.mjs','docs/booking-merge-release-2026-09-27.md',
];

function bookingResumeIncident(){
 const p=BOOKING_STAGE_RESUME,directory='/www/wwwroot/merchant-space.web-releases/';
 const active={target:p.baseline,port:p.oldPort,directory:`${directory}${p.baseline.slice(0,12)}-online`,name:`merchant-space-online-${p.baseline.slice(0,12)}`};
 return {target:p.target,baseline:p.baseline,status:'preparing',lane:'booking-merge-cpu',port:p.port,oldPort:p.oldPort,
  directory:`${directory}${p.target.slice(0,12)}-online`,name:`merchant-space-online-${p.target.slice(0,12)}`,
  oldDirectory:active.directory,oldName:active.name,previousActive:active,rollingRetentionHeadSha256:p.historyHead};
}
function bookingResumeFunction(name,next){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 return code.slice(code.indexOf(name),code.indexOf(next,code.indexOf(name)));
}

test('pre-build resume pins one incident and an exact five-file operational tool scope, without opening any other lane',()=>{
 const s=bookingResumeIncident();
 assert.doesNotThrow(()=>assertBookingStageResumeState(s,s.previousActive,s.target,s.baseline));
 for(const patch of [{target:'a'.repeat(40)},{baseline:'a'.repeat(40)},{status:'active'},{status:'rolled-back'},
  {lane:'runtime-performance'},{port:3105},{oldPort:3102},{directory:'/other'},{name:'other'},
  {oldDirectory:'/other'},{oldName:'other'},{rollingRetentionHeadSha256:'a'.repeat(64)},{previousActive:null}]){
  assert.throws(()=>assertBookingStageResumeState({...s,...patch},s.previousActive,s.target,s.baseline),/incident_not_owned/);
 }
 assert.throws(()=>assertBookingStageResumeState(s,{...s.previousActive,port:3104},s.target,s.baseline),/incident_not_owned/);
 assert.throws(()=>assertBookingStageResumeState(s,s.previousActive,'a'.repeat(40),s.baseline),/incident_not_owned/);
 assert.equal(new Set(BOOKING_STAGE_RESUME_TOOL_FILES).size,5);
 assert.doesNotThrow(()=>assertBookingStageResumeToolScope([...BOOKING_STAGE_RESUME_TOOL_FILES]));
 for(const path of ['src/lib/merchantBookingPersistenceStore.ts','.github/workflows/ci.yml','package-lock.json',
  'scripts/online-release-rolling.mjs','scripts/online-release-rolling-policy.mjs','scripts/online-release-retirement.mjs',
  'scripts/online-static-recovery.mjs','scripts/run-local-tests.mjs','scripts/new.sql','docs/other.md']){
  assert.throws(()=>assertBookingStageResumeToolScope([...BOOKING_STAGE_RESUME_TOOL_FILES,path]),/scope_rejected/);
 }
 assert.throws(()=>assertBookingStageResumeToolScope([]),/scope_rejected/);
});

test('booking and customer stages alone serialize their exact suites without relaxing discovery or any old lane',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),call=code.indexOf("run('node',['--import','tsx','--test'",start),end=code.indexOf('\n',call);
 for(const lane of ['booking-merge-cpu','customer-code-performance','runtime-performance','qr-export','public-catalog-batch','bounded-lists','order-attention','performance']){
  const calls=[];
  runInNewContext(code.slice(start,end),{lane,BOOKING_MERGE_CPU_FOCUSED_TESTS,CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS,s:{directory:'/original-candidate'},env:{original:true},run:(...args)=>calls.push(args)});
  assert.equal(calls.length,1);const [command,args,options]=calls[0];
  assert.equal(command,'node');assert.equal(options.cwd,'/original-candidate');assert.equal(options.env.original,true);
  assert.equal(args.filter(x=>x==='--test-concurrency=1').length,['booking-merge-cpu','customer-code-performance'].includes(lane)?1:0);
  if(lane==='booking-merge-cpu')assert.deepEqual(Array.from(args.slice(4)),Array.from(BOOKING_MERGE_CPU_FOCUSED_TESTS));
  if(lane==='customer-code-performance'){
   const expected=[...CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS,'src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
   assert.deepEqual(Array.from(args.slice(4)),expected);
   assert.equal(expected.length,84);assert.equal(new Set(expected).size,84);
   for(const file of expected){assert.match(file,/\.(?:test|spec)\.[cm]?[jt]sx?$/);assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);}
   assert.equal(expected.includes('scripts/customer-membership-profile-projection-native.mjs'),false);
  }
 }
 assert.equal(new Set(BOOKING_MERGE_CPU_FOCUSED_TESTS).size,26);
});

test('resume tool verifies exact current main, ancestry, clean root-owned source and operational-only bytes',()=>{
 const source=bookingResumeFunction('function bookingResumeToolIdentity(', 'function bookingResumePrivateProof(').replaceAll('import.meta.url','controllerModuleUrl');
 const s=bookingResumeIncident(),revision='a'.repeat(40),directory=`/var/lib/faolla-online-code/${revision}`;
 const check=(failure)=>runInNewContext(`${source}bookingResumeToolIdentity(s)`,{s,app:'/app',URL,fileURLToPath:url=>url.pathname,
  controllerModuleUrl:`file://${directory}/scripts/online-traffic-release.mjs`,BOOKING_STAGE_RESUME_TOOL_FILES,assertBookingStageResumeToolScope,
  realpathSync:path=>failure==='symlink'?'/elsewhere':path,bookingResumeOwnedPath:()=>{if(failure==='owner')throw Error('owner');},
  safeFile:()=>failure==='bytes'?'changed':'original',hash:String,fail:m=>{throw Error(m);},
  run:(_command,args)=>{
   if(args[0]==='merge-base'){if(failure==='ancestor')throw Error('ancestor');return '';}
   if(args[0]==='diff')return [...BOOKING_STAGE_RESUME_TOOL_FILES,...(failure==='scope'?['src/changed.ts']:[])].join('\n');
   if(args[0]==='status')return failure==='dirty'?'?? draft':'';
   if(args[0]==='show')return 'original';
   return failure==='main'&&args[1]==='origin/main'?s.target:failure==='head'&&args[1]==='HEAD'?'b'.repeat(40):revision;
  },
 });
 assert.equal(check().revision,revision);
 for(const failure of ['main','head','dirty','symlink','owner','ancestor','scope','bytes'])assert.throws(()=>check(failure));
});

test('resume private proof rejects any original state/runtime/environment drift and returns only its checked runtime bytes',()=>{
 const source=bookingResumeFunction('function bookingResumePrivateProof(', 'function bookingResumeDependencies('),s=bookingResumeIncident();
 const paths=['/operation/state.json','/operation/runtime.json',`${s.directory}/.env.local`];
 for(const failAt of [null,...paths]){
  const reads=[],expected=[BOOKING_STAGE_RESUME.stateSha256,BOOKING_STAGE_RESUME.runtimeSha256,BOOKING_STAGE_RESUME.environmentSha256];
  const invoke=()=>runInNewContext(`${source}bookingResumePrivateProof(s)`,{s,stateFile:paths[0],operation:'/operation',BOOKING_STAGE_RESUME,
   bookingResumeOwnedPath:()=>{},lstatSync:()=>({mode:0o100600}),safeFile:path=>{reads.push(path);return path===paths[1]?'{}':path;},
   hash:value=>{const path=value==='{}'?paths[1]:value;return path===failAt?'changed':expected[paths.indexOf(path)];},fail:m=>{throw Error(m);},
  });
  if(failAt)assert.throws(invoke,/private_proof_changed/);else {assert.deepEqual(JSON.parse(JSON.stringify(invoke())),{});assert.deepEqual(reads,paths);}
 }
});

test('resume dependency comparison accepts ordinary internal bin symlinks and rejects escaping or changed dependency trees',()=>{
 const source=bookingResumeFunction('function bookingResumeDependencies(', 'function bookingResumeVacant(');
 const run=(patch={})=>runInNewContext(`${source}bookingResumeDependencies('/deps')`,{
  bookingResumeOwnedPath:()=>{},createHash,hash:v=>createHash('sha256').update(v).digest('hex'),
  readdirSync:path=>path==='/deps'?['pkg','.bin']:path==='/deps/pkg'?['cli.js']:['command'],
  lstatSync:path=>({uid:patch.owner??0,mode:path.endsWith('command')?0o120777:path.endsWith('cli.js')?(patch.mode??0o100644):0o40755,
   isSymbolicLink:()=>path.endsWith('command'),isDirectory:()=>['/deps/pkg','/deps/.bin'].includes(path),isFile:()=>path.endsWith('cli.js')}),
  realpathSync:()=>patch.escape?'/outside/cli.js':'/deps/pkg/cli.js',readlinkSync:()=> '../pkg/cli.js',readFileSync:()=>patch.contents??'original',fail:m=>{throw Error(m);},
 });
 assert.match(run(),/^[a-f0-9]{64}$/);assert.notEqual(run({contents:'changed'}),run());
 for(const patch of [{owner:1000},{mode:0o100666},{escape:true}])assert.throws(()=>run(patch),/booking_stage_resume_dependency_/);
});

test('actual preflight rejects source, original proof, proxy/history, artifacts, dependencies and occupied slot before any mutation',async()=>{
 const source=bookingResumeFunction('async function verifyBookingStageResume(', 'async function resumeBookingStage(');
 for(const failure of [null,'state','private','owned','base','config','saved','source','tree','lock','artifact','dependency','slot']){
  const s=bookingResumeIncident(),calls=[];if(failure==='state')s.status='active';
  const gate=name=>{calls.push(name);if(name===failure)throw Error(`failed_${name}`);};
  const task=runInNewContext(`${source}verifyBookingStageResume(s,undefined,false)`,{s,target:BOOKING_STAGE_RESUME.target,baseline:BOOKING_STAGE_RESUME.baseline,
   BOOKING_STAGE_RESUME:{...BOOKING_STAGE_RESUME,dependencySha256:'digest'},assertBookingStageResumeState,activeFile:'/active',app:'/app',
   safeFile:path=>path==='/active'?JSON.stringify(s.previousActive):failure==='lock'?'different':'lock',hash:String,
   bookingResumePrivateProof:()=>gate('private'),bookingResumeOwnedPath:()=>gate('owned'),verifyBase:async()=>gate('base'),
   configUnchanged:()=>gate('config'),readRuntimePerformanceSavedConfigs:()=>gate('saved'),verifyRuntimePerformanceSource:()=>gate('source'),
   run:(_c,args)=>args[0]==='show'?'lock':failure==='tree'?'bad':BOOKING_STAGE_RESUME.tree,
   bookingResumeEntryExists:()=>failure==='artifact',bookingResumeDependencies:path=>failure==='dependency'&&path.startsWith(s.directory)?'bad':'digest',
   bookingResumeVacant:()=>gate('slot'),fail:m=>{throw Error(m);},
  });
  if(failure)await assert.rejects(task);else assert.equal(await task,'digest');
  assert.equal(calls.includes('build'),false);
 }
});

test('reserved PM2 identity and listening port are checked independently, including IPv6 listeners',()=>{
 const source=bookingResumeFunction('function bookingResumeVacant(', 'async function verifyBookingStageResume('),s=bookingResumeIncident();
 const check=(processes=[],sockets='')=>runInNewContext(`${source}bookingResumeVacant(s)`,{s,pm:()=>processes,run:()=>sockets,fail:m=>{throw Error(m);}});
 assert.doesNotThrow(()=>check());
 for(const p of [{name:s.name},{name:'alias',pm2_env:{pm_cwd:s.directory}}])assert.throws(()=>check([p]),/candidate_exists/);
 for(const endpoint of ['127.0.0.1:3104','[::]:3104','*:3104'])assert.throws(()=>check([],`LISTEN 0 511 ${endpoint} *:*`),/port_occupied/);
 assert.doesNotThrow(()=>check([],'LISTEN 0 511 127.0.0.1:13104 *:*'));
});

test('resume treats dangling artifact links as existing and never mistakes permission failures for absence',()=>{
 const source=bookingResumeFunction('function bookingResumeEntryExists(', 'function bookingResumeVacant(');
 const check=kind=>runInNewContext(`${source}bookingResumeEntryExists('/candidate/.next')`,{lstatSync:()=>{
  if(kind==='link')return {isSymbolicLink:()=>true};
  throw Object.assign(Error(kind),{code:kind});
 }});
 assert.equal(check('link'),true);assert.equal(check('ENOENT'),false);assert.throws(()=>check('EACCES'),/EACCES/);
});

test('actual resume runs all original suites serially, then the guarded real build/start/smoke; failures never fabricate ready',async()=>{
 const source=bookingResumeFunction('async function resumeBookingStage(', 'if(process.platform');
 for(const failure of [null,'preflight','prior-attempt','focused','retirement','tooltests','recheck','build','postbuild','start','smoke','finalproof','candidate']){
  const s=bookingResumeIncident(),calls=[],writes=[],commands=[];let verified=0,privateReads=0,mask=0o077;
  const gate=name=>{calls.push(name);if(name===failure)throw Error(`failed_${name}`);};
  const task=runInNewContext(`${source}resumeBookingStage(s)`,{s,operation:'/operation',BOOKING_STAGE_RESUME,BOOKING_MERGE_CPU_FOCUSED_TESTS,
   bookingResumeToolIdentity:()=>({revision:'a'.repeat(40),directory:'/new-tool'}),verifyBookingStageResume:async(_s,digest,built)=>{gate(built?'postbuild':++verified===1?'preflight':'recheck');return digest??'digest';},
   bookingResumeEntryExists:()=>failure==='prior-attempt',bookingResumePrivateProof:()=>{if(++privateReads>1)gate('finalproof');return {original:'environment'};},
   writeFileSync:(path,_bytes,options)=>{assert.equal(options.flag,'wx');assert.equal(options.mode,0o600);writes.push(path);},
   run:(command,args,options)=>{
    commands.push([command,Array.from(args),options]);
    if(command==='node')gate(args.includes('scripts/online-release-rolling.test.mjs')?'retirement':options.cwd==='/new-tool'?'tooltests':'focused');
    else gate(command==='nice'?'build':'start');
   },process:{execPath:'/node',umask:value=>{const old=mask;mask=value;return old;}},
   smoke:async()=>gate('smoke'),setTimeout:callback=>callback(),verifyBase:async()=>gate('base'),configUnchanged:()=>gate('config'),
   readRuntimePerformanceSavedConfigs:()=>gate('saved'),verifyCandidate:()=>gate('candidate'),onlineReleaseStageStatus,
   save:()=>gate('save'),fail:m=>{throw Error(m);},
  });
  if(failure){await assert.rejects(task);assert.equal(calls.includes('save'),false);assert.equal(s.status,'preparing');}
  else {
   await task;assert.equal(s.status,'ready-no-database');assert.equal(calls.at(-1),'save');
   assert.deepEqual(commands[0][1],['--import','tsx','--test','--test-concurrency=1',...BOOKING_MERGE_CPU_FOCUSED_TESTS]);
   assert.equal(commands[0][2].cwd,s.directory);assert.equal(commands[0][2].env.original,'environment');
   assert.deepEqual(commands[1][1],['--test','--test-concurrency=1','scripts/online-release-retirement-policy.test.mjs','scripts/online-release-retirement.test.mjs','scripts/online-release-rolling-policy.test.mjs','scripts/online-release-rolling.test.mjs']);
   assert.equal(commands[1][2].cwd,s.directory);assert.equal(commands[2][2].cwd,'/new-tool');
   assert.ok(calls.indexOf('postbuild')<calls.indexOf('start'));assert.ok(calls.indexOf('candidate')<calls.indexOf('save'));
  }
  assert.equal(mask,0o077);
  if(['preflight','prior-attempt'].includes(failure))assert.deepEqual(writes,[]);
  if(['preflight','prior-attempt','focused','retirement','tooltests','recheck','build','postbuild'].includes(failure))assert.equal(calls.includes('start'),false);
  assert.equal(commands.some(([command,args])=>command==='pm2'&&args[0]!=='start'),false);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(code,/else if\(action==='resume-booking-stage'\)\{\s*await resumeBookingStage\(s\);/);
 assert.match(code,/if\(!existsSync\(`\$\{s.directory\}\/\.next\/BUILD_ID`\)\)fail\('resume_build_missing'\)/);
 assert.doesNotMatch(source,/activateCandidate|restoreConfigs|worktree|\['stop'|\['restart'|rmSync|s\.target\s*=/);
});

test('probe recovery requires the exact unchanged private receipts from the failed first attempt',()=>{
 const source=bookingResumeFunction('function bookingProbeResumePriorProof(', 'function bookingResumeDependencies(');
 const p=BOOKING_STAGE_RESUME,q=BOOKING_STAGE_PROBE_RESUME,s=bookingResumeIncident();
 const originalBefore={toolRevision:q.priorToolRevision,applicationTarget:p.target,originalStateSha256:p.stateSha256,
  historyHead:p.historyHead,dependencySha256:p.dependencySha256,startedAt:'2026-09-27T21:32:20.000Z'};
 const originalFailure={toolRevision:q.priorToolRevision,error:'fetch failed',failedAt:q.priorFailureAt};
 const check=({before=originalBefore,failure=originalFailure,state=s,badHash=false,badMode=false,badOwner=false,missing=false}={})=>{
  const values=[Buffer.from(JSON.stringify(before)),Buffer.from(JSON.stringify(failure))],reads=[],owned=[];
  const result=runInNewContext(`${source}bookingProbeResumePriorProof(s)`,{s:state,operation:'/operation',BOOKING_STAGE_RESUME,BOOKING_STAGE_PROBE_RESUME,
   bookingResumeOwnedPath:(path,file)=>{owned.push([path,file]);if(badOwner)throw Error('unowned');},
   readFileSync:path=>{if(missing)throw Object.assign(Error('missing'),{code:'ENOENT'});reads.push(path);return values[path.endsWith('-before.json')?0:1];},
   lstatSync:()=>({mode:badMode?0o100644:0o100600}),hash:bytes=>badHash?'changed':bytes===values[0]?q.priorBeforeSha256:q.priorFailureSha256,
   fail:message=>{throw Error(message);},
  });
  assert.deepEqual(reads,['/operation/booking-stage-resume-before.json','/operation/booking-stage-resume-failure.json']);
  assert.deepEqual(owned,reads.map(path=>[path,true]));
  return JSON.parse(JSON.stringify(result));
 };
 assert.deepEqual(check(),{priorToolRevision:q.priorToolRevision,priorBeforeSha256:q.priorBeforeSha256,priorFailureSha256:q.priorFailureSha256});
 for(const options of [{badHash:true},{badMode:true},{badOwner:true},{missing:true},
  {state:{...s,target:'a'.repeat(40)}},{state:{...s,baseline:'a'.repeat(40)}}])assert.throws(()=>check(options));
 for(const patch of [{toolRevision:'a'.repeat(40)},{applicationTarget:'a'.repeat(40)},{originalStateSha256:'a'.repeat(64)},
  {historyHead:'a'.repeat(64)},{dependencySha256:'a'.repeat(64)},{startedAt:'invalid'},{startedAt:'2027-01-01T00:00:00.000Z'},
  {extra:'field'}])assert.throws(()=>check({before:{...originalBefore,...patch}}),/prior_receipt_invalid/);
 for(const patch of [{toolRevision:'a'.repeat(40)},{error:'different failure'},{failedAt:'2027-01-01T00:00:00.000Z'},
  {extra:'field'}])assert.throws(()=>check({failure:{...originalFailure,...patch}}),/prior_receipt_invalid/);
 for(const value of [[],null,{},'receipt']){
  assert.throws(()=>check({before:value}),/prior_receipt_invalid/);
  assert.throws(()=>check({failure:value}),/prior_receipt_invalid/);
 }
});

test('probe continuation tool must descend from the failed tool as well as the original app and remain ops-only',()=>{
 const source=bookingResumeFunction('function bookingResumeToolIdentity(', 'function bookingResumePrivateProof(').replaceAll('import.meta.url','controllerModuleUrl');
 const s=bookingResumeIncident(),q=BOOKING_STAGE_PROBE_RESUME;
 const check=failure=>{
  const revision=failure==='old-tool'?q.priorToolRevision:'a'.repeat(40),directory=`/var/lib/faolla-online-code/${revision}`,calls=[];
  const result=runInNewContext(`${source}bookingResumeToolIdentity(s,true)`,{s,app:'/app',URL,fileURLToPath:url=>url.pathname,
   controllerModuleUrl:`file://${directory}/scripts/online-traffic-release.mjs`,BOOKING_STAGE_RESUME_TOOL_FILES,BOOKING_STAGE_PROBE_RESUME,
   assertBookingStageResumeToolScope,realpathSync:path=>path,bookingResumeOwnedPath:()=>{},safeFile:()=> 'original',hash:String,
   fail:message=>{throw Error(message);},run:(_command,args)=>{
    calls.push(Array.from(args));
    if(args[0]==='merge-base'){if(failure==='prior-ancestry'&&args[2]===q.priorToolRevision)throw Error('not_descendant');return '';}
    if(args[0]==='diff')return [...BOOKING_STAGE_RESUME_TOOL_FILES,...(failure==='prior-scope'&&args[2]===q.priorToolRevision?['src/changed.ts']:[])].join('\n');
    if(args[0]==='status')return '';
    if(args[0]==='show')return 'original';
    return revision;
   },
  });
  assert.equal(result.revision,revision);
  assert.deepEqual(calls.filter(args=>args[0]==='merge-base').map(args=>args[2]),[s.target,q.priorToolRevision]);
  assert.deepEqual(calls.filter(args=>args[0]==='diff').map(args=>args[2]),[s.target,q.priorToolRevision]);
 };
 assert.doesNotThrow(()=>check());
 for(const failure of ['old-tool','prior-ancestry','prior-scope'])assert.throws(()=>check(failure));
});

test('authorized probe continuation has one separate audit and preserves all original gates and receipts across every failure phase',async()=>{
 const source=bookingResumeFunction('async function resumeBookingStage(', 'if(process.platform');
 const prior={priorToolRevision:BOOKING_STAGE_PROBE_RESUME.priorToolRevision,priorBeforeSha256:BOOKING_STAGE_PROBE_RESUME.priorBeforeSha256,priorFailureSha256:BOOKING_STAGE_PROBE_RESUME.priorFailureSha256};
 for(const failure of [null,'preflight','proof-1','already-audit','create-audit','focused','retirement','tooltests','recheck','proof-2','build','postbuild','proof-3','start','smoke','finalproof','candidate','proof-4']){
  const s=bookingResumeIncident(),calls=[],writes=[],commands=[],toolModes=[];let verified=0,proofReads=0,privateReads=0,mask=0o077;
  const gate=name=>{calls.push(name);if(name===failure)throw Error(`failed_${name}`);};
  const task=runInNewContext(`${source}resumeBookingStage(s,true)`,{s,operation:'/operation',BOOKING_STAGE_RESUME,BOOKING_STAGE_PROBE_RESUME,BOOKING_MERGE_CPU_FOCUSED_TESTS,
   bookingResumeToolIdentity:(_s,mode)=>{toolModes.push(mode);return {revision:'a'.repeat(40),directory:'/new-tool'};},
   verifyBookingStageResume:async(_s,digest,built)=>{gate(built?'postbuild':++verified===1?'preflight':'recheck');return digest??'digest';},
   bookingProbeResumePriorProof:()=>{gate(`proof-${++proofReads}`);return prior;},
   bookingResumeEntryExists:path=>path.includes('/booking-stage-resume-')||(failure==='already-audit'&&path.includes('/booking-stage-probe-resume-')),
   bookingResumePrivateProof:()=>{if(++privateReads>1)gate('finalproof');return {original:'environment'};},
   writeFileSync:(path,bytes,options)=>{
    assert.equal(options.flag,'wx');assert.equal(options.mode,0o600);
    assert.ok(path.startsWith('/operation/booking-stage-probe-resume-'));
    if(path.endsWith('-before.json'))gate('create-audit');
    writes.push({path,value:JSON.parse(bytes)});
   },
   run:(command,args,options)=>{
    commands.push([command,Array.from(args),options]);
    if(command==='node')gate(args.includes('scripts/online-release-rolling.test.mjs')?'retirement':options.cwd==='/new-tool'?'tooltests':'focused');
    else gate(command==='nice'?'build':'start');
   },process:{execPath:'/node',umask:value=>{const old=mask;mask=value;return old;}},
   smoke:async()=>gate('smoke'),setTimeout:callback=>callback(),verifyBase:async()=>gate('base'),configUnchanged:()=>gate('config'),
   readRuntimePerformanceSavedConfigs:()=>gate('saved'),verifyCandidate:()=>gate('candidate'),onlineReleaseStageStatus,
   save:()=>gate('save'),fail:message=>{throw Error(message);},
  });
  if(failure){await assert.rejects(task);assert.equal(calls.includes('save'),false);assert.equal(s.status,'preparing');}
  else{
   await task;assert.equal(s.status,'ready-no-database');assert.equal(calls.at(-1),'save');assert.equal(proofReads,4);
   assert.deepEqual(commands[0][1],['--import','tsx','--test','--test-concurrency=1',...BOOKING_MERGE_CPU_FOCUSED_TESTS]);
   assert.equal(commands[0][2].cwd,s.directory);assert.equal(commands[0][2].env.original,'environment');
   assert.equal(commands[1][2].cwd,s.directory);assert.equal(commands[2][2].cwd,'/new-tool');
   assert.equal(commands[3][0],'nice');assert.equal(commands[4][0],'pm2');assert.equal(commands[4][1][0],'start');
   assert.ok(calls.indexOf('proof-2')<calls.indexOf('build'));assert.ok(calls.indexOf('proof-3')<calls.indexOf('start'));
   assert.ok(calls.indexOf('candidate')<calls.indexOf('proof-4'));assert.ok(calls.indexOf('proof-4')<calls.indexOf('save'));
   for(const [key,value] of Object.entries(prior)){assert.equal(writes[0].value[key],value);assert.equal(s.stageResume[key],value);}
   assert.equal(writes.length,1);
  }
  assert.equal(mask,0o077);assert.ok(toolModes.every(mode=>mode===true));
  if(['preflight','proof-1','already-audit','create-audit'].includes(failure))assert.deepEqual(writes,[]);
  else if(failure){assert.equal(writes.length,2);assert.ok(writes[1].path.endsWith('-failure.json'));}
  if(['preflight','proof-1','already-audit','create-audit','focused','retirement','tooltests','recheck','proof-2','build','postbuild','proof-3'].includes(failure))assert.equal(calls.includes('start'),false);
  assert.equal(commands.some(([command,args])=>command==='pm2'&&args[0]!=='start'),false);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(code,/else if\(action==='resume-booking-probe-stage'\)\{\s*await resumeBookingStage\(s,true\);/);
 assert.match(code,/else if\(action==='resume-booking-stage'\)\{\s*await resumeBookingStage\(s\);/);
 assert.doesNotMatch(source,/unlink|rmSync|renameSync|restoreConfigs|activateCandidate|\['stop'|\['restart'/);
});

test('booking CPU lane is exactly the approved 19-path live-to-target closure and requires its own anchor',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const section=policy.slice(policy.indexOf('const bookingMergeCpuAnchor ='),policy.indexOf('const runtimePerformanceAnchor ='));
 assert.deepEqual(Array.from(runInNewContext(`${section}Array.from(bookingMergeCpuFiles)`)),bookingMergeCpuFiles);
 assert.equal(new Set(bookingMergeCpuFiles).size,19);
 assert.equal(onlineReleaseLane(bookingMergeCpuFiles),'booking-merge-cpu');
 assert.equal(onlineReleaseLane([bookingMergeCpuFiles[0]]),'booking-merge-cpu');
 assert.throws(()=>onlineReleaseLane(bookingMergeCpuFiles.slice(1)));
 assert.throws(()=>assertOnlineTrafficScope(bookingMergeCpuFiles),/online_release_scope_rejected/);
 for(const file of [
  'src/lib/merchantBookings.server.ts','src/lib/merchantBookings.ts','src/lib/merchantBookingCreation.server.ts',
  'src/lib/merchantBookingAdmission.ts','src/lib/merchantBookingPolicyPreparationCandidate.server.ts',
  'src/lib/merchantCustomers.ts','src/app/api/merchant-customers/route.ts','src/app/api/bookings/route.ts',
  'src/lib/personalAccountSession.ts','src/lib/personalGuestSession.ts','src/lib/merchantCustomerSearch.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantEnterpriseAutomation.server.ts','src/lib/superAdminVerification.ts',
  'scripts/supabase-migrations/202609260058_booking_create_operations.sql','scripts/new.sql',
  'scripts/online-release-retirement.mjs','scripts/online-release-retirement-policy.mjs',
  'scripts/online-release-retirement.test.mjs','scripts/online-release-retirement-policy.test.mjs',
  'package.json','package-lock.json','.env.example','scripts/deploy.production.sh',
  './src/lib/merchantBookingPersistenceStore.ts','src/lib/../lib/merchantBookingPersistenceStore.ts',
  'src/lib\\merchantBookingPersistenceStore.ts','docs/booking-merge-extra.md',
 ])for(const files of [[bookingMergeCpuFiles[0],file],[file,bookingMergeCpuFiles[0]]]){
  assert.throws(()=>onlineReleaseLane(files),/booking_merge_cpu_release_scope_rejected/,file);
 }
 assert.equal(onlineReleaseStageStatus('booking-merge-cpu'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('booking-merge-cpu'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,lane=>assertPendingOnlineReleaseMigrations(lane,[])]){
  assert.throws(()=>check('booking-merge-cpu'),/booking_merge_cpu_database_forbidden/);
 }
});

test('completed rolling history snapshot pins one head and retains complete process identities; empty history is legacy',()=>{
 const h=retainedProcessHarness(),history={version:1,entries:[{status:'completed',nextTarget:h.sha('d')}],headSha256:'f'.repeat(64)},calls=[];
 const rollingCheck=value=>calls.push(value);
 const snapshot=JSON.parse(JSON.stringify(h.execute('snapshotOnlineRetention(all,releaseTarget,oldName)',{history,rollingCheck})));
 assert.deepEqual(snapshot,{processes:h.current.slice(0,2).map(h.normalize),rollingRetentionHeadSha256:history.headSha256});
 assert.equal(calls.length,1);
 assert.equal(calls[0].history,history);
 assert.equal(calls[0].activeTarget,h.sha('d'));
 assert.ok(calls[0].protectedNames.includes(h.name('a')));
 assert.ok(calls[0].protectedNames.includes(h.name('d')));
 const s={...h.s,...snapshot,target:h.sha('d')};
 h.execute('verifyRetainedProcesses(s,all)',{history,rollingCheck,state:s});
 assert.equal(calls.length,2);
 assert.equal(calls[1].history,history);
 const legacy=JSON.parse(JSON.stringify(h.execute('snapshotOnlineRetention(all,releaseTarget,oldName)')));
 assert.deepEqual(legacy,{processes:h.s.processes.slice(0,2)});
 assert.throws(()=>h.execute('snapshotOnlineRetention(all,releaseTarget,oldName)',{history:{...history,entries:[{...history.entries[0],nextTarget:h.sha('a')}]},rollingCheck}),/rolling_retention_stage_target_invalid/);
});

test('rolling stage head cannot disappear, advance or become authorized by a different history during any verification',()=>{
 const h=retainedProcessHarness(),history={version:1,entries:[{status:'completed'}],headSha256:'f'.repeat(64)};
 for(const [state,loaded] of [
  [h.s,history],
  [{...h.s,rollingRetentionHeadSha256:'e'.repeat(64)},history],
  [{...h.s,rollingRetentionHeadSha256:history.headSha256},{version:1,entries:[],headSha256:null}],
 ])assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{state,history:loaded}),/rolling_retention_history_changed/);
 // The adapter does not swallow a history reader error or fall back after a
 // partially-written/unverified history; the reader owns filesystem validation.
 const helpers=h.source.slice(h.source.indexOf('const protectedBaseProcesses='),h.source.indexOf('async function request('));
 for(const expression of ['verifyRetainedProcesses(s,all)','snapshotOnlineRetention(all,releaseTarget,oldName)']){
  assert.throws(()=>runInNewContext(`${helpers}${expression}`,{
   s:h.s,all:h.current,releaseTarget:h.sha('d'),oldName:h.name('a'),
   readOnlineRetentionHistory:()=>({entries:[]}),readOnlineRollingRetentions:()=>{throw Error('incomplete_rolling_history');},
   readOnlineRetirementCertificates:()=>{throw Error('legacy_fallback_forbidden');},
  }),/incomplete_rolling_history/);
 }
});

function rollingReleaseHistoryHarness(){
 const sha=x=>x.repeat(40),name=x=>`merchant-space-online-${x.repeat(12)}`,cwd=x=>`/www/wwwroot/merchant-space.web-releases/${x.repeat(12)}-online`;
 const raw=(x,id,port)=>({name:name(x),pm_id:id,pid:100+id,pm2_env:{pm_cwd:cwd(x),pm_exec_path:`${cwd(x)}/node_modules/next/dist/bin/next`,status:'online',PORT:String(port),args:['start','-H','127.0.0.1','-p',String(port)],exec_interpreter:'/usr/bin/node',exec_mode:'fork_mode',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'}});
 const base=ROLLING_BASE_NAMES.map((name,index)=>({name,pm_id:20+index,pid:200+index,pm2_env:{pm_cwd:'/www/wwwroot/base',pm_exec_path:'/www/wwwroot/base/server.js',status:'online'}}));
 const initial=[...base,raw('a',1,3110),raw('b',2,3109),raw('c',3,3103),raw('d',4,3103),raw('e',5,3104),raw('f',6,3105)];
 const stopped=p=>({...normalizeRetirementProcess(p),pid:0,status:'stopped'});
 const identity=p=>({target:sha(p.name.at(-1)),name:p.name,pmId:p.pm_id,pid:p.pid,cwd:p.pm2_env.pm_cwd,port:Number(p.pm2_env.PORT)});
 const anchor=x=>{const p=initial.find(item=>item.name===name(x));return {target:sha(x),name:name(x),directory:cwd(x),port:Number(p.pm2_env.PORT),process:normalizeRetirementProcess(p)};};
 const legacy={version:1,status:'completed',victim:identity(initial[6]),stoppedProcess:stopped(initial[6]),activeTarget:sha('a'),rollbackTarget:sha('b'),nextTarget:sha('d'),allowedActiveTargets:[sha('a'),sha('b'),sha('d')],beforeSha256:'1'.repeat(64),afterSha256:'2'.repeat(64),completedAt:'2026-09-27T18:00:00.000Z'};
 const history={version:1,legacyCertificates:[legacy],legacyProcesses:initial.filter(p=>p.name!==name('d')).map(p=>p.name===name('c')?stopped(p):normalizeRetirementProcess(p)),legacySha256:'3'.repeat(64),entries:[],headSha256:null};
 const certify=(next,victim,anchors)=>{
  const p=initial.find(item=>item.name===name(victim)),entry={version:1,policy:'rolling-v1',status:'completed',sequence:history.entries.length+1,nextTarget:sha(next),victim:identity(p),stoppedProcess:stopped(p),protectedAnchors:anchors.map(anchor),allowedActiveTargets:[next,...anchors].map(sha),legacySha256:history.legacySha256,previousSha256:history.headSha256,beforeSha256:'4'.repeat(64),afterSha256:'5'.repeat(64),preparedSha256:'6'.repeat(64),recoverySha256:'7'.repeat(64),completedAt:'2026-09-27T19:00:00.000Z'};
  history.entries.push(entry);history.headSha256=rollingHash(entry);
 };
 certify('7','e',['d','a','b']);
 const first=structuredClone(history),newFirst=raw('7',7,3104);initial.push(newFirst);
 const allFor=h=>initial.map(p=>h.legacyCertificates.concat(h.entries).some(cert=>cert.victim.name===p.name)?{...p,pid:0,pm2_env:{...p.pm2_env,status:'stopped'}}:structuredClone(p));
 const firstCurrent=allFor(first);
 certify('8','f',['7','d','a']);
 const second=structuredClone(history);initial.push(raw('8',8,3105));
 const secondCurrent=allFor(second);
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const helpers=source.slice(source.indexOf('const protectedBaseProcesses='),source.indexOf('async function request('));
 const state=(from,to,pin)=>({target:sha(from),baseline:sha(to),name:name(from),oldName:name(to),status:'active',
  // New snapshots keep every normalized field and omit only already-certified
  // stopped registrations; actual historical snapshots used only name/PID/cwd.
  processes:pin?(from==='8'?secondCurrent:firstCurrent).filter(p=>p.name!==name(from)&&p.pm2_env.status==='online').map(normalizeRetirementProcess)
   :initial.filter(p=>!['d','7','8',...(from==='d'?['c']:[])].includes(p.name.at(-1))).map(p=>({name:p.name,pid:p.pid,cwd:p.pm2_env.pm_cwd})),
  ...(pin?{rollingRetentionHeadSha256:pin}:{})});
 const execute=(s,h,all,action='rollback')=>runInNewContext(`${helpers}verifyRetainedProcesses(s,all)`,{s,all,action,normalizeRetirementProcess,
  readOnlineRetentionHistory:()=>({entries:[]}),readOnlineRollingRetentions:()=>h,assertRollingRetainedProcesses,assertRollingStateHistory,readOnlineRetirementCertificates:()=>{throw Error('no_legacy_scope_upgrade');},fail:m=>{throw Error(m);}});
 return {sha,name,state,execute,first,second,firstCurrent,secondCurrent};
}

test('real rolling policy plus actual release adapter preserves adjacent owned rollback through two releases without state rewrites',()=>{
 const h=rollingReleaseHistoryHarness();
 const firstStates=[h.state('7','d',h.first.headSha256),h.state('d','a'),h.state('a','b')];
 const before=structuredClone(firstStates);
 for(const state of firstStates)assert.doesNotThrow(()=>h.execute(state,h.first,h.firstCurrent));
 assert.deepEqual(firstStates,before);
 const secondStates=[h.state('8','7',h.second.headSha256),h.state('7','d',h.first.headSha256),h.state('d','a')];
 for(const state of secondStates)assert.doesNotThrow(()=>h.execute(state,h.second,h.secondCurrent));
 for(const [state,history,all] of [[h.state('b','9'),h.first,h.firstCurrent],[h.state('a','b'),h.second,h.secondCurrent],
  [h.state('8','d',h.second.headSha256),h.second,h.secondCurrent],[h.state('d','7'),h.second,h.secondCurrent]]){
  assert.throws(()=>h.execute(state,history,all),/online_rolling_(?:state_|rollback_)/);
 }
 for(const action of ['stage','finish-stage','activate','status'])assert.throws(()=>h.execute(secondStates[1],h.second,h.secondCurrent,action),/rolling_retention_history_changed/);
 assert.throws(()=>h.execute({...secondStates[1],status:'ready-no-database'},h.second,h.secondCurrent),/rolling_retention_history_changed/);
 assert.throws(()=>h.execute(h.state('8','7',h.first.headSha256),h.second,h.secondCurrent),/online_rolling_state_birth_pin_invalid/);
 assert.throws(()=>h.execute(h.state('7','d'),h.second,h.secondCurrent),/online_rolling_state_birth_pin_missing/);
});

test('real rolling adapter protects the third pre-switch anchor and all normalized retained fields after cutover',()=>{
 const h=rollingReleaseHistoryHarness();
 for(const [history,all,from,to,third] of [[h.first,h.firstCurrent,'7','d','b'],[h.second,h.secondCurrent,'8','7','a']]){
  for(const mutate of [p=>{p.pid+=1000;},p=>{p.pm2_env.PORT='3108';},p=>{p.pm2_env.status='stopped';p.pid=0;},p=>{p.pm2_env.exec_interpreter='/changed/node';}]){
   const changed=structuredClone(all);mutate(changed.find(p=>p.name===h.name(third)));
   assert.throws(()=>h.execute(h.state(from,to,history.headSha256),history,changed),/online_rolling_protected_anchor_changed/);
  }
 }
 const changed=structuredClone(h.secondCurrent);changed[0].pm2_env.args=['different'];
 assert.throws(()=>h.execute(h.state('8','7',h.second.headSha256),h.second,changed),/online_rolling_existing_process_changed/);
});

test('booking CPU candidate preserves analytics retention and pilot, pauses only candidate jobs, and rejects drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const original={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-secret'};
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'booking-merge-cpu',target:'a'.repeat(40),port:3104,env:original,randomBytes:()=>{throw Error('no_secret_rotation');}});
 for(const key of Object.keys(original))assert.equal(Object.hasOwn(changes,key),false);
 const env={...original,...changes,status:'online',pm_cwd:'/candidate'};
 for(const [key,value] of [['FAOLLA_BACKGROUND_JOBS_PAUSED','1'],['MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED','0'],['MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED','0']])assert.equal(env[key],value);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='booking-merge-cpu'"));
 const baseline=(patch={})=>runInNewContext(guard,{lane:'booking-merge-cpu',env:{...original,...patch},fail:m=>{throw Error(m);}});
 assert.doesNotThrow(()=>baseline());
 for(const patch of [{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'}])assert.throws(()=>baseline(patch),/booking_merge_cpu_baseline_features_invalid/);
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic(')),target='a'.repeat(40),calls=[];
 const check=(patch={},head=target,status='')=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'booking-merge-cpu',target,name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>original,fail:m=>{throw Error(m);},run:(command,args,options)=>{
   calls.push([command,Array.from(args),options.cwd]);return args[0]==='rev-parse'?head:status;
  },
 });
 assert.doesNotThrow(()=>check());
 assert.deepEqual(calls,[['git',['rev-parse','HEAD'],'/candidate'],['git',['status','--porcelain=v1','--untracked-files=all'],'/candidate']]);
 for(const key of Object.keys(original))for(const value of ['',undefined,'changed'])assert.throws(()=>check({[key]:value}),/booking_merge_cpu_baseline_features_changed/);
 for(const key of ['MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED','MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED'])assert.throws(()=>check({[key]:'1'}),/booking_merge_cpu_baseline_features_changed/);
 assert.throws(()=>check({FAOLLA_BACKGROUND_JOBS_PAUSED:'0'}),/candidate_identity_invalid/);
 assert.throws(()=>check({},'b'.repeat(40)),/booking_merge_cpu_candidate_source_changed/);
 for(const status of [' M src/lib/merchantBookingPersistenceStore.ts','?? unexpected.txt'])assert.throws(()=>check({},target,status),/booking_merge_cpu_candidate_source_changed/);
});

test('booking CPU stage mandates all seven CPU suites plus public auth static CI and separate rolling guards before build',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'booking-merge-cpu',BOOKING_MERGE_CPU_FOCUSED_TESTS,run:()=>{throw Error('no_dynamic_discovery');}}));
 assert.deepEqual(tests,[
  'src/lib/merchantBookingPersistenceStore.test.ts','src/lib/merchantBookingMergeParity.test.ts','src/app/api/merchant-customers/route.booking-merge.test.ts',
  'src/app/api/merchant-customers/route.test.ts','src/lib/merchantCustomers.test.ts','src/lib/merchantCustomerDirectoryStore.test.ts','src/lib/merchantBookings.test.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts','src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomerSearch.test.ts',
  'src/components/SitePageClient.behavior.test.ts','src/components/blocks/ProductBlock.behavior.test.ts',
  'src/app/api/orders/catalog/public/batch-route.test.ts','src/app/api/orders/catalog/public/route.test.ts','src/app/api/orders/route.test.ts',
  'src/lib/publicCatalogCoordinator.test.ts','src/lib/usePublicCatalogBlocks.test.ts','scripts/check-release-baseline.test.mjs','scripts/online-static-recovery.test.mjs',
  'scripts/run-ci-tests.test.mjs','scripts/ci-workflow-contract.test.mjs','scripts/production-maintenance-pm2-connection.test.mjs','scripts/repair-startup.test.mjs',
 ]);
 for(const file of tests)assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 const rolling="if(lane==='booking-merge-cpu')run('node',['--test','scripts/online-release-retirement-policy.test.mjs','scripts/online-release-retirement.test.mjs','scripts/online-release-rolling-policy.test.mjs','scripts/online-release-rolling.test.mjs']";
 assert.ok(code.indexOf(rolling,end)>end);
 assert.ok(code.indexOf(rolling,end)<code.indexOf("run('nice',['-n','10','npm','run','build']",end));
 assert.doesNotMatch(code,/pm2.*\['(?:stop|delete)'/);
 const common=code.slice(end,code.indexOf('console.log(\'online_build_started\')',end));
 for(const file of ['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'])assert.ok(common.includes(file));
});

test('booking CPU activation and rollback validate all saved proxy files with owned rollback and snapshot writes',async()=>{
 for(const side of ['before','after'])for(const missing of [false,true]){
  const h=runtimePerformanceProxyHarness('booking-merge-cpu'),path=`/operation/${side}-last.conf`;
  if(missing)h.files.delete(path);else h.files.set(path,'unowned saved config');
  await assert.rejects(h.api.activateCandidate(h.s),missing?/missing_fixture_file/:/booking_merge_cpu_saved_proxy_changed/);
  assert.deepEqual(h.effects,[]);
 }
 for(const invalid of ['saved-drift','saved-missing','current-drift']){
  const h=runtimePerformanceProxyHarness('booking-merge-cpu');h.s.status='active';
  for(const file of h.names)h.files.set(`/proxy/${file}`,h.files.get(`/operation/after-${file}`));
  if(invalid==='saved-drift')h.files.set('/operation/before-last.conf','unowned');
  if(invalid==='saved-missing')h.files.delete('/operation/before-last.conf');
  if(invalid==='current-drift')h.files.set('/proxy/last.conf','unowned');
  assert.throws(()=>h.api.restoreConfigs(h.s),invalid==='current-drift'?/rollback_proxy_not_owned/:invalid==='saved-missing'?/missing_fixture_file/:/booking_merge_cpu_saved_proxy_changed/);
  assert.deepEqual(h.effects,[]);
 }
 const h=runtimePerformanceProxyHarness('booking-merge-cpu'),before=h.names.map(file=>h.files.get(`/proxy/${file}`));
 h.hooks.failPublic=true;
 await assert.rejects(h.api.activateCandidate(h.s),/public_verification_failed/);
 assert.equal(h.s.status,'rolled-back');
 assert.deepEqual(h.names.map(file=>h.files.get(`/proxy/${file}`)),before);
 assert.equal(h.effects.includes('pm2:save'),false);
 const a=runtimePerformanceProxyHarness('booking-merge-cpu'),after=a.names.map(file=>a.files.get(`/operation/after-${file}`));
 a.hooks.beforeStatic=()=>{for(const file of a.names)a.files.set(`/operation/after-${file}`,'late drift');};
 await a.api.activateCandidate(a.s);
 assert.deepEqual(a.names.map(file=>a.files.get(`/proxy/${file}`)),after);
 for(const file of a.names)assert.equal(a.reads.filter(path=>path===`/operation/after-${file}`).length,1);
 const r=runtimePerformanceProxyHarness('booking-merge-cpu'),prior=r.names.map(file=>r.files.get(`/operation/before-${file}`));
 r.hooks.beforeWrite=()=>{for(const file of r.names)r.files.set(`/operation/before-${file}`,'late drift');};
 r.api.restoreConfigs(r.s);
 assert.deepEqual(r.names.map(file=>r.files.get(`/proxy/${file}`)),prior);
 for(const file of r.names)assert.equal(r.reads.filter(path=>path===`/operation/before-${file}`).length,1);
});

const runtimePerformanceFiles=[
 'src/lib/merchantCustomerSearch.ts','src/lib/merchantCustomerSearch.test.ts',
 'src/components/admin/MerchantCustomerManager.tsx','src/components/admin/MerchantCustomerManager.behavior.test.ts',
 'src/app/site/[siteId]/SitePageClient.tsx','src/components/SitePageClient.behavior.test.ts',
 'src/components/blocks/ProductBlock.tsx','src/components/blocks/ProductBlock.behavior.test.ts',
 'docs/customer-request-lifecycle-2026-09-25.md','docs/customer-search-corpus-2026-09-25.md',
 'docs/performance-public-render-2026-09-26.md','docs/performance-runtime-release-2026-09-27.md',
 'scripts/online-static-recovery.mjs','scripts/online-static-recovery.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
 'scripts/online-release-retirement-policy.mjs','scripts/online-release-retirement-policy.test.mjs',
 'scripts/online-release-retirement.mjs','scripts/online-release-retirement.test.mjs',
];

test('runtime performance admits exactly the curated 22 paths and needs its unique search anchor',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const start=policy.indexOf('const runtimePerformanceAnchor ='),end=policy.indexOf(']);',start)+3;
 assert.ok(start>0&&end>start);
 const actual=Array.from(runInNewContext(`${policy.slice(start,end)}Array.from(runtimePerformanceFiles)`));
 assert.deepEqual(actual,runtimePerformanceFiles);
 assert.equal(new Set(actual).size,22);
 assert.equal(onlineReleaseLane(runtimePerformanceFiles),'runtime-performance');
 assert.equal(onlineReleaseLane([runtimePerformanceFiles[0]]),'runtime-performance');
 for(const file of runtimePerformanceFiles.slice(1)){
  try { assert.notEqual(onlineReleaseLane([file]),'runtime-performance',file); }
  catch(error) { assert.match(error.message,/online_release_scope_rejected/); }
 }
 assert.equal(onlineReleaseLane(['src/components/admin/MerchantCustomerManager.tsx']),'performance');
 assert.throws(()=>assertOnlineTrafficScope([runtimePerformanceFiles[0]]),/online_release_scope_rejected/);
 assert.throws(()=>onlineReleaseLane(runtimePerformanceFiles.filter(file=>file!==runtimePerformanceFiles[0])));
 assert.throws(()=>onlineReleaseLane(STATIC_RECOVERY_TOOL_FILES));
});

test('runtime performance rejects API, auth, writer, worker, schema, dependencies and every other lane in either order',()=>{
 const anchor=runtimePerformanceFiles[0];
 const rejected=[
  'src/app/api/merchant-customers/route.ts','src/app/api/bookings/route.ts','src/app/api/publish/route.ts',
  'src/app/api/orders/route-handler.ts','src/app/api/orders/catalog/public/batch-route-handler.ts',
  'src/app/api/auth/signin/route.ts','src/lib/personalAccountSession.server.ts','src/lib/superAdminVerification.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/lib/merchantBusinessActor.server.ts',
  'src/lib/merchantCustomers.ts','src/lib/merchantCustomerDirectoryStore.ts','src/data/platformControlStore.ts',
  'src/lib/merchantBookings.server.ts','src/lib/merchantBookingRulesStore.ts','src/lib/merchantBookingWorkbenchStore.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantEnterpriseAutomation.server.ts','src/lib/webPush.ts',
  'src/lib/webPushTopic.server.ts','src/lib/merchantCustomerReadProjection.shadow.ts',
  'src/lib/merchantBookingPolicyPreparationCandidate.server.ts',
  'src/lib/accountTrafficCampaign.server.ts','src/lib/merchantBusinessCardQrExport.ts',
  'src/app/admin/AdminClient.tsx','src/lib/visiblePolling.ts','src/lib/merchantCustomerListViewport.ts',
  'src/lib/merchantCatalogReadIndex.ts','src/components/admin/MerchantCatalogProductList.tsx',
  'src/lib/merchantCustomerPagination.ts','src/lib/merchantOrderAttention.server.ts',
  'scripts/order-attention-pilot.ts','scripts/apply-production-database-migrations.mjs',
  'scripts/create-production-database-backup.mjs','scripts/deploy.production.sh',
  'scripts/booking-policy-admission-integration/candidate.sql','scripts/booking-policy-admission-integration/verify-preparation.ts',
  'scripts/supabase-migrations/202609230049_account_traffic_events.sql',
  'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
  'scripts/supabase-migrations/202609250053_customer_query_shadow.sql',
  'scripts/supabase-migrations/202609250054_customer_source_observation.sql',
  'scripts/supabase-migrations/202609250055_booking_dispatch_shadow.sql',
  'scripts/supabase-migrations/202609250056_booking_dispatch_shadow_evidence.sql',
  'scripts/supabase-migrations/202609260057_booking_authority_records.sql',
  'scripts/supabase-migrations/202609260058_booking_create_operations.sql',
  'scripts/supabase-migrations/202609260059_booking_policy_current_sources.sql',
  'package.json','package-lock.json','.env.example','.github/workflows/ci.yml','PROJECT_RULES.md',
  'src/lib/merchantCustomerSearchExtra.ts','src/lib/merchantCustomerSearch.server.ts',
  'docs/performance-runtime-release-other.md','scripts/online-static-recovery-extra.mjs',
  './src/lib/merchantCustomerSearch.ts','src/lib/../lib/merchantCustomerSearch.ts','src/lib\\merchantCustomerSearch.ts',
 ];
 for(const file of rejected)for(const files of [[anchor,file],[file,anchor]]){
  assert.throws(()=>onlineReleaseLane(files),/runtime_performance_release_scope_rejected/,file);
 }
 // The new acceptance/source files do not widen any old lane either.
 for(const oldAnchor of ['src/lib/visiblePolling.ts','src/lib/merchantCatalogReadIndex.ts',
  'src/lib/merchantCustomerPagination.ts','src/lib/merchantOrderAttention.server.ts',
  'src/lib/merchantBusinessCardQrExport.ts','src/app/api/orders/catalog/public/batch-route-handler.ts',
  'src/lib/accountTrafficCampaign.server.ts']){
  assert.throws(()=>onlineReleaseLane([oldAnchor,'src/lib/merchantCustomerSearch.test.ts']));
 }
});

test('runtime performance is ready without a database and cannot migrate, prepare or toggle the pilot',()=>{
 assert.equal(onlineReleaseStageStatus('runtime-performance'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('runtime-performance'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget]){
  assert.throws(()=>check('runtime-performance'),/runtime_performance_database_forbidden/);
 }
 for(const pending of [null,[],[{version:'202609240052'}]]){
  assert.throws(()=>assertPendingOnlineReleaseMigrations('runtime-performance',pending),/runtime_performance_database_forbidden/);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const denied=()=>{throw Error('unexpected_pilot_operation');};
 for(const command of ['prepare','enable','verify','disable'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'runtime-performance'},command,run:denied,atomic:denied,candidateEnvironment:denied,
 });
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),code.indexOf('function restoreOrderAttentionConfigs('));
 assert.throws(()=>runInNewContext(`${flag}setOrderAttentionCandidateFlag(s,'10000000')`,{
  s:{lane:'runtime-performance'},fail:message=>{throw Error(message);},verifyCandidate:denied,candidateEnvironment:denied,
 }),/order_attention_candidate_flag_invalid/);
});

test('runtime performance inherits analytics, retention, pilot and signing secret while only pausing candidate jobs',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-original-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'runtime-performance',target:'a'.repeat(40),port:3109,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [field,value] of Object.entries(env))assert.equal(effective[field],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(effective.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.faolla.com');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='runtime-performance'"));
 assert.ok(guard);
 const check=(patch={})=>runInNewContext(guard,{lane:'runtime-performance',env:{...env,...patch},fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}]){
  assert.throws(()=>check(patch),/runtime_performance_baseline_features_invalid/);
 }
});

test('runtime performance source verification pins HEAD and the complete clean tree without affecting old lanes',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyRuntimePerformanceSource('),code.indexOf('function publishStatic('));
 const s={lane:'runtime-performance',target:'a'.repeat(40),directory:'/owned-candidate'};
 for(const [head,status] of [[s.target,''],['b'.repeat(40),''],[s.target,' M src/lib/merchantCustomerSearch.ts'],[s.target,'?? unexpected.txt']]){
  const calls=[];
  const check=()=>runInNewContext(`${source}verifyRuntimePerformanceSource(s)`,{s,
   run:(command,args,options)=>{
    assert.equal(command,'git');assert.equal(options.cwd,s.directory);calls.push(Array.from(args));
    if(args[0]==='rev-parse'){assert.deepEqual(Array.from(args),['rev-parse','HEAD']);return head+'\n';}
    assert.deepEqual(Array.from(args),['status','--porcelain=v1','--untracked-files=all']);return status;
   },fail:message=>{throw Error(message);},
  });
  if(head===s.target&&!status)assert.doesNotThrow(check);
  else assert.throws(check,/runtime_performance_candidate_source_changed/);
  assert.equal(calls.length,head===s.target?2:1);
 }
 for(const lane of ['traffic','qr-export','performance','bounded-lists','read-index','public-catalog-batch','order-attention']){
  runInNewContext(`${source}verifyRuntimePerformanceSource(s)`,{s:{lane},run:()=>{throw Error('old_lane_changed');}});
 }
});

test('runtime performance candidate refuses source, analytics, pilot, process and paused-state drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const target='a'.repeat(40);
 const check=(patch={},expected='unchanged',head=target,status='')=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'runtime-performance',target,name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:expected}),fail:message=>{throw Error(message);},
  run:(_command,args)=>args[0]==='rev-parse'?head:status,
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://other.invalid'},
  {pm_cwd:'/old'},{status:'stopped'}])assert.throws(()=>check(patch),/changed|invalid/);
 assert.throws(()=>check({FAOLLA_TRAFFIC_SIGNING_SECRET:''},''),/runtime_performance_baseline_features_changed/);
 assert.throws(()=>check({},'unchanged','b'.repeat(40)),/runtime_performance_candidate_source_changed/);
 assert.throws(()=>check({},'unchanged',target,'?? unknown'),/runtime_performance_candidate_source_changed/);
});

test('runtime performance stage runs its exact suites between source gates before the unchanged build and readiness guards',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'runtime-performance',run:()=>{throw Error('unexpected_discovery');}}));
 assert.deepEqual(tests,[
  'src/components/admin/MerchantCustomerManager.behavior.test.ts','src/lib/merchantCustomerSearch.test.ts',
  'src/components/SitePageClient.behavior.test.ts','src/components/blocks/ProductBlock.behavior.test.ts',
  'src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomers.test.ts',
  'src/lib/merchantCustomerPagination.test.ts','src/lib/merchantCustomerListViewport.test.ts',
  'src/lib/merchantCustomerImport.test.ts','src/lib/merchantCustomerDirectoryStore.test.ts',
  'src/app/api/merchant-customers/route.test.ts','src/app/api/orders/catalog/public/batch-route.test.ts',
  'src/app/api/orders/catalog/public/route.test.ts','src/app/api/orders/route.test.ts',
  'src/lib/merchantPublicCatalog.test.ts','src/lib/publicCatalogCoordinator.test.ts','src/lib/usePublicCatalogBlocks.test.ts',
  'src/lib/merchantCatalog.test.ts','src/lib/merchantCatalogStore.test.ts','src/lib/merchantOrderCatalog.test.ts',
  'src/lib/productBlock.test.ts','scripts/check-release-baseline.test.mjs','scripts/online-static-recovery.test.mjs',
 ]);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 assert.equal(new Set([...tests,...fixed]).size,26);
 for(const file of [...tests,...fixed])assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 assert.ok(code.slice(end).startsWith(`run('node',['--import','tsx','--test',...(lane==='booking-merge-cpu'||lane==='customer-code-performance'?['--test-concurrency=1']:[]),...tests,${fixed.map(file=>`'${file}'`).join(',')}]`));
 const stage=code.indexOf("if(action==='stage'){");
 const before=code.indexOf('verifyRuntimePerformanceSource(s);',stage);
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const after=code.indexOf('verifyRuntimePerformanceSource(s);',build);
 const launch=code.indexOf("run('pm2',['start'",after);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',launch);
 assert.ok(stage<before&&before<start&&end<build&&build<after&&after<launch&&launch<ready);
 assert.ok(code.indexOf("fail('target_not_main')",stage)<before);
 assert.ok(code.indexOf("fail('dependencies_changed')",stage)<before);
 assert.ok(code.indexOf("fail('candidate_not_ready')",launch)<ready);
 assert.match(code,/const port=\[3103,3104,3105,3106,3107,3108,3109,3110\]\.find/);
 assert.match(code,/if\(!port\)fail\('no_candidate_port'\)/);
 assert.match(code,/if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\)/);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.equal(tests.some(file=>file.includes('booking-policy')||file.includes('shadow')||file.includes('browser-harness')),false);
});

function runtimePerformanceProxyHarness(lane='runtime-performance'){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const saved=code.slice(code.indexOf('function readRuntimePerformanceSavedConfigs('),code.indexOf('function verifyCandidate('));
 const restore=code.slice(code.indexOf('function restoreConfigs('),code.indexOf('function candidateEnvironment('));
 const activate=code.slice(code.indexOf('async function activateCandidate('),code.indexOf('function bookingResumeOwnedPath('));
 const unchanged=code.slice(code.indexOf('function configUnchanged('),code.indexOf('function readRuntimePerformanceSavedConfigs('));
 const names=['first.conf','second.conf','last.conf'];
 const files=new Map(),reads=[],effects=[],hooks={beforeStatic:null,beforeWrite:null,failPublic:false};
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const s={lane,target:'a'.repeat(40),baseline:'b'.repeat(40),
  status:'ready-no-database',directory:'/candidate',port:3110,oldPort:3109,name:'candidate',configs:{}};
 for(const file of names){
  const before=`# original ${file}\nupstream previous;\n`,after=`# candidate ${file}\nupstream next;\n`;
  files.set(`/operation/before-${file}`,before);files.set(`/operation/after-${file}`,after);files.set(`/proxy/${file}`,before);
  s.configs[file]={oldHash:digest(before),newHash:digest(after)};
 }
 const api=runInNewContext(`${unchanged}${saved}${restore}${activate}({activateCandidate,restoreConfigs,readRuntimePerformanceSavedConfigs})`,{
  readOnlineRetentionHistory:()=>({entries:[]}),
  WEB_RELEASE_FILES:names,operation:'/operation',proxy:'/proxy',app:'/www/wwwroot/merchant-space',
  activeFile:'/active',nginx:'/nginx',hash:digest,
  safeFile:path=>{reads.push(path);if(!files.has(path))throw Error('missing_fixture_file');return files.get(path);},
  atomic:(path,value)=>{hooks.beforeWrite?.(path);effects.push(`write:${path}`);files.set(path,value);},
  realpathSync:()=>'/www/wwwroot/merchant-space.releases/base/.next/static',
  publishStatic:()=>{hooks.beforeStatic?.();effects.push('static');return 4;},
  run:(command,args)=>effects.push(`${command}:${Array.from(args).join(',')}`),
  save:()=>effects.push(`state:${s.status}`),existsSync:()=>false,
  verifyOrderAttention:()=>{},verifyBase:async()=>{},verifyCandidate:()=>{},
  smoke:async()=>{if(hooks.failPublic)throw Error('synthetic_public_failure');return 4;},request:async()=>{},
  setTimeout:callback=>callback(),console:{error(){}},fail:message=>{throw Error(message);},
 });
 return {api,s,names,files,reads,effects,hooks};
}

test('runtime activation validates all saved before and after files before any static or cutover side effect',async()=>{
 for(const side of ['before','after'])for(const missing of [false,true]){
  const h=runtimePerformanceProxyHarness(),path=`/operation/${side}-last.conf`;
  if(missing)h.files.delete(path);else h.files.set(path,'# valid-looking but unowned upstream configuration');
  await assert.rejects(h.api.activateCandidate(h.s),missing?/missing_fixture_file/:/runtime_performance_saved_proxy_changed/);
  assert.deepEqual(h.effects,[],`${side} drift on the last file must not publish static files, write state/proxies or reload`);
  assert.equal(h.s.status,'ready-no-database');
  assert.ok(h.reads.includes('/operation/before-first.conf'));
  assert.ok(h.reads.includes(path));
 }
});

test('runtime rollback validates every saved before target before any write without relaxing current ownership',()=>{
 for(const invalid of ['saved-drift','saved-missing','current-drift']){
  const h=runtimePerformanceProxyHarness();h.s.status='active';
  for(const file of h.names)h.files.set(`/proxy/${file}`,h.files.get(`/operation/after-${file}`));
  if(invalid==='saved-drift')h.files.set('/operation/before-last.conf','unowned rollback target');
  if(invalid==='saved-missing')h.files.delete('/operation/before-last.conf');
  if(invalid==='current-drift')h.files.set('/proxy/last.conf','unowned current proxy');
  const error=invalid==='current-drift'?/rollback_proxy_not_owned/:invalid==='saved-missing'?/missing_fixture_file/:/runtime_performance_saved_proxy_changed/;
  assert.throws(()=>h.api.restoreConfigs(h.s),error);
  assert.deepEqual(h.effects,[],`${invalid} on the final file must not partially restore or reload`);
  assert.equal(h.s.status,'active');
  assert.equal(h.reads.some(path=>path.startsWith('/operation/after-')),false,'rollback does not need a saved after file');
 }
});

test('runtime activation and rollback write their validated snapshots rather than rereading a later changed saved file',async()=>{
 const activate=runtimePerformanceProxyHarness();
 const expectedAfter=activate.names.map(file=>activate.files.get(`/operation/after-${file}`));
 activate.hooks.beforeStatic=()=>{for(const file of activate.names)activate.files.set(`/operation/after-${file}`,'late saved-file drift');};
 await activate.api.activateCandidate(activate.s);
 assert.equal(activate.s.status,'active');
 assert.deepEqual(activate.names.map(file=>activate.files.get(`/proxy/${file}`)),expectedAfter);
 for(const file of activate.names)assert.equal(activate.reads.filter(path=>path===`/operation/after-${file}`).length,1);
 const restore=runtimePerformanceProxyHarness();restore.s.status='active';
 const expectedBefore=restore.names.map(file=>restore.files.get(`/operation/before-${file}`));
 for(const file of restore.names)restore.files.set(`/proxy/${file}`,restore.files.get(`/operation/after-${file}`));
 restore.hooks.beforeWrite=()=>{for(const file of restore.names)restore.files.set(`/operation/before-${file}`,'late rollback snapshot drift');};
 restore.api.restoreConfigs(restore.s);
 assert.equal(restore.s.status,'rolled-back');
 assert.deepEqual(restore.names.map(file=>restore.files.get(`/proxy/${file}`)),expectedBefore);
 for(const file of restore.names)assert.equal(restore.reads.filter(path=>path===`/operation/before-${file}`).length,1);
});

test('runtime public failure uses the verified all-file rollback and neither explicit path bypasses the gates',async()=>{
 const h=runtimePerformanceProxyHarness(),expected=h.names.map(file=>h.files.get(`/proxy/${file}`));
 h.hooks.failPublic=true;
 await assert.rejects(h.api.activateCandidate(h.s),/public_verification_failed/);
 assert.equal(h.s.status,'rolled-back');
 assert.deepEqual(h.names.map(file=>h.files.get(`/proxy/${file}`)),expected);
 assert.equal(h.effects.filter(effect=>effect==='/nginx:-s,reload').length,2);
 assert.equal(h.effects.includes('write:/active'),false);
 assert.equal(h.effects.includes('pm2:save'),false);
 for(const file of h.names)assert.equal(h.reads.filter(path=>path===`/operation/before-${file}`).length,2,'activation and rollback each validate all targets');
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(code,/else if\(action==='activate'\)\{[^}]*await activateCandidate\(s\);/);
 assert.match(code,/else if\(action==='rollback'\)\{[^}]*configUnchanged\(s,true\);if\(s.lane==='order-attention'\)restoreOrderAttentionConfigs\(s\);else restoreConfigs\(s\);/);
 assert.throws(()=>assertCatalogStaticRecoveryState({...staticIncident().s,lane:'runtime-performance'},staticIncident().active,staticIncident().target,staticIncident().baseline),/static_recovery_incident_not_owned/);
 for(const lane of ['traffic','performance','read-index','public-catalog-batch','order-attention']){
  const legacy=runtimePerformanceProxyHarness();
  assert.equal(legacy.api.readRuntimePerformanceSavedConfigs({...legacy.s,lane},true),null);
  assert.deepEqual(legacy.reads,[],'other lanes do not inherit this new snapshot check');
 }
});

const publicCatalogBatchFiles=[
 'src/app/api/orders/catalog/public/batch-route-handler.ts',
 'src/app/api/orders/catalog/public/batch/route.ts','src/app/api/orders/catalog/public/batch-route.test.ts',
 'src/app/api/orders/route.test.ts','src/app/site/[siteId]/SitePageClient.tsx',
 'src/components/blocks/BlockRenderer.tsx','src/components/blocks/ProductBlock.tsx',
 'src/lib/merchantPublicCatalog.ts','src/lib/merchantPublicCatalog.test.ts',
 'src/lib/publicCatalogCoordinator.ts','src/lib/publicCatalogCoordinator.test.ts',
 'src/lib/usePublicCatalogBlocks.ts','src/lib/usePublicCatalogBlocks.test.ts',
 'scripts/public-catalog-batch-browser-harness.mjs','scripts/fixtures/public-catalog-batch-browser.tsx',
 'docs/performance-public-catalog-batch-2026-09-25.md',
 'docs/ci-startup-single-snapshot-2026-09-25.md',
 'scripts/production-maintenance-next-startup-acceptance.mjs',
 'scripts/production-maintenance-next-startup-acceptance.test.mjs','scripts/test-helpers/startup-process-fact.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];

test('public catalog batch admits exactly 24 files and requires its distinct batch-handler anchor',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const start=policy.indexOf('const publicCatalogBatchAnchor =');
 const end=policy.indexOf(']);',start)+3;
 assert.ok(start>0&&end>start);
 const actual=Array.from(runInNewContext(`${policy.slice(start,end)}Array.from(publicCatalogBatchFiles)`));
 assert.equal(publicCatalogBatchFiles.length,24);
 assert.equal(new Set(publicCatalogBatchFiles).size,24);
 assert.deepEqual(actual.sort(),[...publicCatalogBatchFiles].sort());
 assert.equal(onlineReleaseLane(publicCatalogBatchFiles),'public-catalog-batch');
 assert.equal(onlineReleaseLane([publicCatalogBatchFiles[0]]),'public-catalog-batch');
 for(const file of publicCatalogBatchFiles.slice(1)){
  try { assert.notEqual(onlineReleaseLane([file]),'public-catalog-batch',file); }
  catch(error) { assert.match(error.message,/online_release_scope_rejected/); }
 }
 assert.throws(()=>assertOnlineTrafficScope([publicCatalogBatchFiles[0]]),/online_release_scope_rejected/);
 assert.throws(()=>onlineReleaseLane(publicCatalogBatchFiles.slice(16,20)),/online_release_scope_rejected/);
});

test('public catalog batch cannot admit old handlers, writers, guards or authority from another lane',()=>{
 const anchor=publicCatalogBatchFiles[0];
 for(const file of [
  'src/app/api/orders/catalog/public/route.ts','src/app/api/orders/catalog/public/route-handler.ts','src/app/api/orders/catalog/public/route.test.ts',
  'src/app/api/orders/catalog/route-handler.ts','src/app/api/orders/route-handler.ts',
  'src/app/api/bookings/route.ts','src/app/api/auth/signin/route.ts',
  'src/lib/merchantCatalog.ts','src/lib/merchantCatalogStore.ts','src/lib/merchantOrderCatalog.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantOrdersAtomic.server.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/data/platformControlStore.ts',
  'src/lib/superAdminVerification.ts','src/lib/merchantEnterpriseAutomation.server.ts',
  'src/lib/merchantCatalogReadIndex.ts','src/lib/accountTrafficResources.server.ts',
  'src/lib/accountTrafficCampaign.server.ts','src/lib/merchantBusinessCardQrExport.ts',
  'src/lib/visiblePolling.ts','src/app/admin/AdminClient.tsx',
  'src/components/admin/MerchantCatalogProductList.tsx','src/lib/merchantCustomerPagination.ts',
  'src/lib/merchantOrderAttention.server.ts','scripts/order-attention-pilot.ts',
  'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
  'scripts/supabase-migrations/202609250053_public_catalog_batch.sql',
  'scripts/apply-production-database-migrations.mjs','scripts/create-production-database-backup.mjs',
  'scripts/check-production-runtime-supervision.mjs','scripts/production-maintenance-runtime.mjs',
  'scripts/production-maintenance-next-startup-acceptance-extra.mjs','scripts/test-helpers/startup-process-extra.mjs',
  'scripts/deploy.production.sh','package.json','package-lock.json','.env.example','.github/workflows/ci.yml',
  'src/app/api/orders/catalog/public/batch-route-handler-extra.ts','src/lib/merchantPublicCatalogExtra.ts',
  'src/lib/publicCatalogCoordinatorExtra.ts','src/lib/usePublicCatalogBlocksExtra.ts',
  'scripts/fixtures/public-catalog-batch-other.tsx','docs/performance-public-catalog-other-2026-09-25.md',
  './src/app/api/orders/catalog/public/batch-route-handler.ts',
  'src/app/api/orders/catalog/public/../public/batch-route-handler.ts',
  'src\\app\\api\\orders\\catalog\\public\\batch-route-handler.ts',
 ])for(const files of [[anchor,file],[file,anchor]])assert.throws(()=>onlineReleaseLane(files),/public_catalog_batch_release_scope_rejected/,file);
 assert.equal(onlineReleaseLane(['src/lib/merchantCatalogReadIndex.ts']),'read-index');
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficResources.server.ts']),'traffic');
 assert.equal(onlineReleaseLane(['src/lib/visiblePolling.ts']),'performance');
 assert.equal(onlineReleaseLane(['src/lib/merchantOrderAttention.server.ts']),'order-attention');
});

test('public catalog batch is ready without a database and cannot invoke any migration or pilot helper',()=>{
 assert.equal(onlineReleaseStageStatus('public-catalog-batch'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('public-catalog-batch'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget]){
  assert.throws(()=>check('public-catalog-batch'),/public_catalog_batch_database_forbidden/);
 }
 for(const pending of [[],null,[{version:'202609240052'}]]){
  assert.throws(()=>assertPendingOnlineReleaseMigrations('public-catalog-batch',pending),/public_catalog_batch_database_forbidden/);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const denied=()=>{throw Error('unexpected_pilot_operation');};
 for(const command of ['prepare','enable','verify','disable'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'public-catalog-batch'},command,run:denied,atomic:denied,candidateEnvironment:denied,
 });
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),code.indexOf('function restoreOrderAttentionConfigs('));
 assert.throws(()=>runInNewContext(`${flag}setOrderAttentionCandidateFlag(s,'10000000')`,{
  s:{lane:'public-catalog-batch'},fail:message=>{throw Error(message);},verifyCandidate:denied,candidateEnvironment:denied,
 }),/order_attention_candidate_flag_invalid/);
});

test('public catalog batch preserves enabled analytics, pilot, retention and signing secret in candidate overrides',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 assert.ok(start>0&&end>start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-original-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'public-catalog-batch',target:'a'.repeat(40),port:3109,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [field,value] of Object.entries(env))assert.equal(effective[field],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(effective.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.faolla.com');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='public-catalog-batch'"));
 assert.ok(guard);
 const check=(patch={})=>runInNewContext(guard,{lane:'public-catalog-batch',env:{...env,...patch},fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}]){
  assert.throws(()=>check(patch),/public_catalog_batch_baseline_features_invalid/);
 }
});

test('public catalog batch candidate rejects missing identity and baseline feature drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const check=(patch={},expected='unchanged',present=true)=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'public-catalog-batch',name:'candidate',directory:'/candidate'},pm:()=>present?[{name:'candidate',pm2_env:{...env,...patch}}]:[],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:expected}),fail:message=>{throw Error(message);},
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://other.invalid'},
  {pm_cwd:'/old'},{status:'stopped'}]){
  assert.throws(()=>check(patch),/candidate_identity_invalid|public_catalog_batch_baseline_features_changed/);
 }
 assert.throws(()=>check({},'unchanged',false),/candidate_identity_invalid/);
 assert.throws(()=>check({FAOLLA_TRAFFIC_SIGNING_SECRET:''},''),/public_catalog_batch_baseline_features_changed/);
});

test('public catalog batch stage runs its exact regressions before the guarded build and normal smoke readiness',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 assert.ok(start>0&&end>start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{
  lane:'public-catalog-batch',run:()=>{throw Error('unexpected_test_discovery');},
 }));
 assert.deepEqual(tests,[
  'src/app/api/orders/catalog/public/batch-route.test.ts','src/app/api/orders/catalog/public/route.test.ts',
  'src/app/api/orders/route.test.ts','src/lib/merchantPublicCatalog.test.ts',
  'src/lib/publicCatalogCoordinator.test.ts','src/lib/usePublicCatalogBlocks.test.ts',
  'src/lib/merchantCatalogReadIndex.test.ts','src/lib/merchantCatalog.test.ts',
  'src/lib/merchantCatalogStore.test.ts','src/lib/merchantOrderCatalog.test.ts','src/lib/productBlock.test.ts',
  'scripts/production-maintenance-next-startup-acceptance.test.mjs',
  'scripts/production-maintenance-build-recovery-evidence.test.mjs','scripts/production-maintenance-route-build-evidence.test.mjs',
 ]);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 assert.equal(new Set([...tests,...fixed]).size,tests.length+fixed.length);
 for(const file of [...tests,...fixed])assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 assert.ok(code.slice(end).startsWith(`run('node',['--import','tsx','--test',...(lane==='booking-merge-cpu'||lane==='customer-code-performance'?['--test-concurrency=1']:[]),...tests,${fixed.map(file=>`'${file}'`).join(',')}]`));
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(build>end&&ready>build);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 assert.match(code,/await smoke\(s\);s.status=onlineReleaseStageStatus\(s.lane\);save\(s\)/);
 assert.match(code,/if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\)/);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.doesNotMatch(code,/run\([^\n]*(?:public-catalog-batch-browser|production-maintenance-next-startup-acceptance\.mjs)/);
});

const readIndexFiles=[
 'src/lib/merchantCatalogReadIndex.ts','src/lib/merchantCatalogReadIndex.test.ts',
 'src/lib/accountTrafficResources.server.ts','src/lib/accountTrafficResources.server.test.ts',
 'scripts/benchmark-catalog-read-index.mjs','docs/performance-read-index-2026-09-25.md',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];

test('read index admits exactly ten files with one anchor and no inherited traffic authority',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const start=policy.indexOf('const readIndexAnchor ='),end=policy.indexOf(']);',start)+3;
 assert.ok(start>0&&end>start);
 const declaration=policy.slice(start,end);
 assert.deepEqual(Array.from(runInNewContext(`${declaration}Array.from(readIndexFiles)`)),readIndexFiles);
 assert.equal(readIndexFiles.length,10);
 assert.equal(onlineReleaseLane(readIndexFiles),'read-index');
 assert.equal(onlineReleaseLane([readIndexFiles[0]]),'read-index');
 for(const file of readIndexFiles.slice(1)){
  try { assert.notEqual(onlineReleaseLane([file]),'read-index',file); }
  catch(error) { assert.match(error.message,/online_release_scope_rejected/); }
 }
 assert.throws(()=>assertOnlineTrafficScope([readIndexFiles[0]]),/online_release_scope_rejected/);
 // These readers were already permitted by the old analytics lane; do not
 // change that lane's meaning merely to introduce an independent new one.
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficResources.server.ts']),'traffic');
});

test('read index rejects source catalog writes, APIs, other lanes, migrations and neighboring filenames',()=>{
 const anchor=readIndexFiles[0];
 for(const file of [
  'src/lib/merchantCatalog.ts','src/lib/merchantCatalogStore.ts','src/lib/merchantOrderCatalog.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantOrdersAtomic.server.ts',
  'src/app/api/orders/catalog/route-handler.ts','src/app/api/orders/catalog/public/route-handler.ts',
  'src/app/api/orders/route-handler.ts','src/app/api/bookings/route.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/lib/superAdminVerification.ts','src/app/api/auth/signin/route.ts',
  'src/lib/merchantEnterpriseAutomation.server.ts','src/lib/merchantBookings.server.ts',
  'src/lib/accountTrafficCampaign.server.ts','src/components/admin/AccountTrafficPanel.tsx',
  'src/lib/merchantBusinessCardQrExport.ts','src/lib/visiblePolling.ts','src/app/admin/AdminClient.tsx',
  'src/components/admin/MerchantCatalogProductList.tsx','src/lib/merchantCustomerPagination.ts',
  'src/lib/merchantOrderAttention.server.ts','scripts/order-attention-pilot.ts',
  'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
  'scripts/supabase-migrations/202609250053_read_index.sql','scripts/apply-production-database-migrations.mjs',
  'scripts/create-production-database-backup.mjs','scripts/deploy.production.sh',
  'package.json','package-lock.json','.env.example','.github/workflows/ci.yml',
  'src/lib/merchantCatalogReadIndexExtra.ts','src/lib/merchantCatalogReadIndex.server.ts',
  'src/lib/accountTrafficResourcesExtra.server.ts','scripts/benchmark-other-read-index.mjs',
  'docs/performance-other-2026-09-25.md','./src/lib/merchantCatalogReadIndex.ts',
  'src/lib/../lib/merchantCatalogReadIndex.ts','src/lib\\merchantCatalogReadIndex.ts',
 ])for(const files of [[anchor,file],[file,anchor]])assert.throws(()=>onlineReleaseLane(files),/read_index_release_scope_rejected/,file);
});

test('read index stays no-database and never invokes pilot verification or reset operations',()=>{
 assert.equal(onlineReleaseStageStatus('read-index'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('read-index'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>check('read-index'),/read_index_database_forbidden/);
 for(const pending of [[],null,[{version:'202609240052'}]])assert.throws(()=>assertPendingOnlineReleaseMigrations('read-index',pending),/read_index_database_forbidden/);
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const denied=()=>{throw Error('unexpected_pilot_operation');};
 for(const command of ['prepare','enable','verify','disable'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'read-index'},command,run:denied,atomic:denied,candidateEnvironment:denied,
 });
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),code.indexOf('function restoreOrderAttentionConfigs('));
 assert.throws(()=>runInNewContext(`${flag}setOrderAttentionCandidateFlag(s,'10000000')`,{
  s:{lane:'read-index'},fail:message=>{throw Error(message);},verifyCandidate:denied,candidateEnvironment:denied,
 }),/order_attention_candidate_flag_invalid/);
});

test('read index inherits enabled analytics and pilot while only pausing candidate background work',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-original-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'read-index',target:'a'.repeat(40),port:3109,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [field,value] of Object.entries(env))assert.equal(effective[field],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='read-index'"));
 assert.ok(guard);
 const check=(patch={})=>runInNewContext(guard,{lane:'read-index',env:{...env,...patch},fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}])assert.throws(()=>check(patch),/read_index_baseline_features_invalid/);
});

test('read-index candidate rejects analytics secret, pilot, process and paused-state drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const check=(patch={},expected='unchanged')=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'read-index',name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:expected}),fail:message=>{throw Error(message);},
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://other.invalid'},
  {pm_cwd:'/old'},{status:'stopped'}])assert.throws(()=>check(patch),/changed|invalid/);
 assert.throws(()=>check({FAOLLA_TRAFFIC_SIGNING_SECRET:''},''),/read_index_baseline_features_changed/);
});

test('read-index stage includes all tracked traffic regressions once plus catalog and unchanged safety/build gates',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const tracked=execFileSync('git',['ls-files','src/lib/accountTraffic*.test.ts'],{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true}).trim().split('\n');
 assert.ok(tracked.length>0&&tracked.every(file=>/^src\/lib\/accountTraffic[A-Za-z.]*\.test\.ts$/.test(file)));
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'read-index',s:{directory:'/candidate'},run:(command,args,options)=>{
  assert.equal(command,'git');assert.deepEqual(Array.from(args),['ls-files','src/lib/accountTraffic*.test.ts']);
  assert.equal(options.cwd,'/candidate');return tracked.join('\n');
 }}));
 const expected=[...new Set(['src/lib/merchantCatalogReadIndex.test.ts','src/lib/accountTrafficResources.server.test.ts',...tracked,
  'src/lib/merchantCatalog.test.ts','src/lib/merchantCatalogStore.test.ts','src/lib/merchantOrderCatalog.test.ts','src/app/api/orders/catalog/public/route.test.ts'])];
 assert.deepEqual(tests,expected);
 assert.equal(new Set(tests).size,tests.length);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 for(const file of [...tests,...fixed])assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 assert.ok(code.slice(end).startsWith(`run('node',['--import','tsx','--test',...(lane==='booking-merge-cpu'||lane==='customer-code-performance'?['--test-concurrency=1']:[]),...tests,${fixed.map(file=>`'${file}'`).join(',')}]`));
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(start>0&&end>start&&build>end&&ready>build);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.doesNotMatch(code,/run\([^\n]*benchmark-catalog-read-index/);
});

const boundedListFiles=[
 'src/components/admin/MerchantCatalogProductList.tsx','src/lib/merchantCustomerPagination.ts',
 'src/components/admin/MerchantCatalogProductList.test.ts','src/components/admin/MerchantCatalogManagerPanel.tsx',
 'src/components/admin/MerchantCustomerManager.tsx','src/components/admin/MerchantCustomerManager.behavior.test.ts',
 'src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomerPagination.test.ts',
 'src/lib/merchantOrdersStore.ts','src/lib/merchantOrdersStore.test.ts','src/lib/merchantOrdersStore.metadata.test.ts',
 '.github/workflows/ci.yml','scripts/ci-workflow-contract.test.mjs','scripts/run-ci-tests.mjs','scripts/run-ci-tests.test.mjs',
 'scripts/production-maintenance-topology-workflow.test.mjs',
 'scripts/performance-bounded-lists-browser-harness.mjs','scripts/fixtures/performance-bounded-lists-browser.tsx',
 'docs/performance-bounded-lists-2026-09-25.md','scripts/online-traffic-release-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];

test('bounded lists has exact runtime anchors and cannot inherit another lane or arbitrary matching files',()=>{
 assert.equal(onlineReleaseLane(boundedListFiles),'bounded-lists');
 for(const anchor of boundedListFiles.slice(0,2)){
  assert.equal(onlineReleaseLane([anchor]),'bounded-lists');
  assert.equal(onlineReleaseLane(['src/components/admin/MerchantCustomerManager.tsx',anchor]),'bounded-lists');
  for(const file of [
   'src/app/admin/AdminClient.tsx','src/lib/visiblePolling.ts','src/lib/performanceTelemetry.ts',
   'src/lib/merchantCustomerDirectoryStore.ts','src/lib/merchantCustomers.ts',
   'src/lib/merchantOrdersAtomic.server.ts','src/lib/merchantOrdersV1Read.server.ts','src/lib/merchantOrders.server.ts',
   'src/lib/merchantOrderMembershipTransaction.server.ts','src/app/api/orders/route-handler.ts',
   'src/app/api/merchant-customers/route.ts','src/app/api/bookings/route.ts','src/lib/merchantBookings.server.ts',
   'src/app/api/auth/signin/route.ts','src/lib/merchantBusinessOrderPermissions.ts','src/lib/superAdminVerification.ts',
   'src/lib/accountTrafficCampaign.server.ts','src/lib/merchantBusinessCardQrExport.ts',
   'src/lib/merchantOrderAttention.server.ts','scripts/order-attention-pilot.ts',
   'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
   'scripts/supabase-migrations/202609250053_bounded_lists.sql',
   'scripts/apply-production-database-migrations.mjs','scripts/create-production-database-backup.mjs',
   'scripts/production-maintenance-runtime.mjs','scripts/deploy.production.sh',
   'package.json','package-lock.json','.env.local','.env.example',
   'src/lib/merchantCustomerPaginationExtra.ts','src/components/admin/MerchantCatalogProductListExtra.tsx',
   'scripts/run-ci-tests-extra.mjs','scripts/run-local-tests.mjs','docs/performance-other-2026-09-25.md',
   './src/lib/merchantCustomerPagination.ts','src/lib/../lib/merchantCustomerPagination.ts','src/lib\\merchantCustomerPagination.ts',
  ])for(const files of [[anchor,file],[file,anchor]])assert.throws(()=>onlineReleaseLane(files),/release_scope_rejected/,file);
 }
 for(const file of ['src/lib/merchantOrdersStore.ts','scripts/run-ci-tests.mjs','src/lib/merchantCustomerPagination.test.ts']){
  assert.throws(()=>onlineReleaseLane([file]),/online_release_scope_rejected/);
  assert.throws(()=>onlineReleaseLane(['src/lib/visiblePolling.ts',file]),/performance_release_scope_rejected/);
 }
 assert.equal(onlineReleaseLane(performanceRuntimeFiles),'performance');
 assert.equal(onlineReleaseLane(['src/lib/merchantBusinessCardQrExport.ts']),'qr-export');
 assert.equal(onlineReleaseLane(['src/lib/merchantOrderAttention.server.ts']),'order-attention');
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficCampaign.server.ts']),'traffic');
});

test('bounded lists permits stage and activate only and rejects all database helper entrypoints',()=>{
 assert.equal(onlineReleaseStageStatus('bounded-lists'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('bounded-lists'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>check('bounded-lists'),/bounded_lists_database_forbidden/);
 for(const pending of [[],null,[{version:'202609240052'}]])assert.throws(()=>assertPendingOnlineReleaseMigrations('bounded-lists',pending),/bounded_lists_database_forbidden/);
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const calls=[];
 for(const command of ['enable','verify'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'bounded-lists'},command,
  run:()=>{calls.push('operation');throw Error('unexpected_operation');},
  atomic:()=>{calls.push('write');throw Error('unexpected_write');},
 });
 assert.deepEqual(calls,[]);
 assert.doesNotMatch(code,/\['restart','merchant-space'|unlinkSync\(marker|maintenance.*prepare|reset.*--hard/);
 assert.match(code,/JSON.parse\(read\('\/var\/lib\/faolla-maintenance\/merchant-space\/state.json'\)\).phase!=='ended'/);
});

test('bounded lists preserves enabled pilot and analytics credentials without secret rotation or worker activation',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'existing-synthetic-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'bounded-lists',target:'a'.repeat(40),port:3105,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [key,value] of Object.entries(env))assert.equal(effective[key],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='bounded-lists'"));
 assert.ok(guard);
 const evaluate=(value)=>runInNewContext(guard,{lane:'bounded-lists',env:value,fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>evaluate(env));
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}]){
  assert.throws(()=>evaluate({...env,...patch}),/bounded_lists_baseline_features_invalid/);
 }
});

test('actual bounded-list candidate identity check rejects pilot, analytics and inherited secret drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const check=(patch={})=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'bounded-lists',name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'}),fail:message=>{throw Error(message);},
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},
  {FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{pm_cwd:'/old'},{status:'stopped'}])assert.throws(()=>check(patch),/changed|invalid/);
});

test('bounded-list candidate tests exist and run before the unchanged guarded build and smoke gates',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'bounded-lists',run:()=>{throw Error('unexpected_discovery');}}));
 assert.equal(new Set(tests).size,tests.length);
 for(const file of tests)assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 for(const file of ['src/components/admin/MerchantCatalogProductList.test.ts','src/lib/merchantCustomerPagination.test.ts',
  'src/lib/merchantOrdersStore.metadata.test.ts','src/lib/merchantOrdersV1Read.server.test.ts',
  'src/lib/merchantOrdersAtomic.server.test.ts','src/lib/merchantOrderAttention.server.test.ts',
  'scripts/run-ci-tests.test.mjs','scripts/ci-workflow-contract.test.mjs'])assert.ok(tests.includes(file),file);
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(start>0&&end>start&&build>end&&ready>build);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.doesNotMatch(code,/run\([^\n]*performance-bounded-lists-browser/);
});
test('actual performance candidate overrides never change analytics settings or generate secrets',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes={');
 const end=code.indexOf('const envText=',start);
 assert.ok(start>0&&end>start);
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{
  lane:'performance',target:'a'.repeat(40),port:3105,
  env:{FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'existing-secret'},
  randomBytes:()=>{throw Error('unexpected_secret_generation');},
 });
 for(const key of ['FAOLLA_TRAFFIC_ENABLED','FAOLLA_TRAFFIC_RETENTION_ENABLED','FAOLLA_TRAFFIC_SIGNING_SECRET'])assert.equal(Object.hasOwn(changes,key),false,key);
 assert.equal(changes.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(changes.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(changes.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(changes.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.faolla.com');
 assert.match(code,/if\(lane==='performance'&&\(env.FAOLLA_TRAFFIC_ENABLED!=='1'\|\|!env.FAOLLA_TRAFFIC_SIGNING_SECRET\)\)fail\('performance_analytics_baseline_invalid'\)/);
});
test('actual performance stage runs bounded regressions and retains the guarded build before candidate readiness',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests=');
 const end=code.indexOf("run('node',['--import','tsx','--test'",start);
 assert.ok(start>0&&end>start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'performance',run:()=>{throw Error('unexpected_test_discovery_command');}}));
 assert.deepEqual(tests,[
  'src/lib/performanceTelemetry.test.ts','src/lib/visiblePolling.test.ts','src/lib/merchantCustomers.test.ts',
  'src/lib/merchantCustomerListViewport.test.ts','src/lib/merchantCustomerImport.test.ts',
  'src/lib/merchantCustomerDirectoryStore.test.ts','src/app/api/merchant-customers/route.test.ts',
  'src/app/admin/AdminClient.attention.test.ts','src/app/admin/AdminClient.contract.test.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts','src/components/admin/MerchantCustomerManager.contract.test.ts',
  'scripts/repair-unlaunched-transport.test.mjs','src/lib/merchantBusinessCardWebsiteRoute.test.ts',
 ]);
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(build>end&&ready>build);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.doesNotMatch(code,/run\([^\n]*performance-phase1-browser/);
});
test('scope accepts analytics only, rejects auth, workers, dependencies and unrelated data migrations',()=>{
 for(const file of ['src/lib/accountTrafficCampaign.server.ts','src/app/api/traffic/collect/route-handler.ts','src/app/api/super-admin/traffic/campaign/route.test.ts','scripts/supabase-migrations/202609230051_account_traffic_outcomes_campaigns_export.sql'])assert.doesNotThrow(()=>assertOnlineTrafficScope([file]));
 for(const file of ['src/app/api/auth/signin/route.ts','package-lock.json','scripts/deploy.production.sh','src/lib/merchantEnterpriseAutomation.server.ts','scripts/supabase-migrations/202609230052_delete.sql'])assert.throws(()=>assertOnlineTrafficScope([file]));
 assert.throws(()=>assertOnlineTrafficScope([]));
});
test('owned upstream changes preserve fallback, real IP, cache, auth and all other nginx bytes',()=>{
 const before='proxy_pass http://127.0.0.1:3102;\nproxy_set_header X-Real-IP $remote_addr;\nproxy_cache off;\nproxy_pass http://127.0.0.1:3000;';
 assert.equal(onlineProxy(before,3102,3103,'a'.repeat(40)),before.replace(':3102;',':3103;'));
 assert.throws(()=>onlineProxy(before,3104,3103,'a'.repeat(40)));assert.throws(()=>onlineProxy(before,3102,3000,'a'.repeat(40)));
});
test('only explicitly approved additive migrations can run',()=>{
 assert.doesNotThrow(()=>assertPendingTrafficMigrations([{version:'202609230049'},{version:'202609230051'}]));
 assert.throws(()=>assertPendingTrafficMigrations([{version:'202609230048'}]));
});
test('website probe checks actual destination, independent of analytics attribute ordering',()=>{
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" data-traffic-action="website_click" href="https://www.haoyouduosevilla.com/">'),true);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" href="https://www.haoyouduosevilla.com/">'),true);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" href="https://haoyouduo.faolla.com/">'),false);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" data-href="https://www.haoyouduosevilla.com/" href="https://other.example/">'),false);
});
test('controller preserves legacy state, workers and assets; backup precedes apply and switch has rollback',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.ok(code.indexOf('verifyProductionDatabaseBackup({')<code.indexOf('through,apply:true'));
 assert.match(code,/COPYFILE_EXCL/);assert.match(code,/static_collision/);assert.match(code,/maintenance_state_changed/);
 assert.match(code,/catch\(error\)\{if\(s.lane==='order-attention'\)restoreOrderAttentionConfigs\(s\);else restoreConfigs\(s\);throw error;\}/);
 assert.doesNotMatch(code,/\['restart','merchant-space'|unlinkSync\(marker|maintenance.*prepare|reset.*--hard/);
});

const orderAttentionMigration={version:'202609240052',name:'order_attention_pilot',fileName:'202609240052_order_attention_pilot.sql'};
const orderAttentionFiles=[
 'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
 'src/lib/merchantOrderAttention.ts','src/lib/merchantOrderAttention.test.ts',
 'src/lib/merchantOrderAttention.server.ts','src/lib/merchantOrderAttention.server.test.ts',
 'src/lib/merchantOrderAttentionProjection.ts','src/lib/merchantOrderAttentionProjection.test.ts',
 'src/app/admin/AdminClient.tsx','src/app/admin/AdminClient.attention.test.ts',
 'src/app/api/orders/route-handler.ts','src/app/api/orders/route.attention.test.ts',
 'scripts/order-attention-pilot.ts','scripts/order-attention-pilot.test.ts',
 'scripts/order-attention-benchmark.ts',
 'scripts/order-attention-pilot-migration-contract.test.mjs',
 'scripts/order-attention-integration/run.mjs','scripts/order-attention-integration/run.test.mjs',
 'scripts/order-attention-integration/README.md','.github/workflows/ci.yml',
 'scripts/ci-workflow-contract.test.mjs','docs/order-attention-pilot-2026-09-24.md',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];
test('order attention pilot is an exact separate lane selected before its shared admin performance anchor',()=>{
 assert.equal(onlineReleaseLane(orderAttentionFiles),'order-attention');
 for(const anchor of [orderAttentionFiles[0],'src/lib/merchantOrderAttention.server.ts']){
  assert.equal(onlineReleaseLane([anchor]),'order-attention');
  assert.equal(onlineReleaseLane(['src/app/admin/AdminClient.tsx',anchor]),'order-attention');
  for(const file of [
   'src/lib/merchantOrderAttentionOther.ts','src/lib/merchantOrdersStore.ts','src/lib/merchantOrders.server.ts',
   'src/lib/merchantOrderMembershipTransaction.server.ts','src/lib/merchantBookings.server.ts',
   'src/app/api/bookings/route.ts','src/lib/merchantBusinessOrderPermissions.ts',
   'src/lib/superAdminVerification.ts','src/app/api/auth/signin/route.ts',
   'src/lib/merchantCustomers.ts','src/lib/visiblePolling.ts','src/lib/accountTrafficCampaign.server.ts',
   'src/lib/merchantBusinessCardQrExport.ts','src/lib/merchantEnterpriseAutomation.server.ts',
   'scripts/supabase-migrations/202609230049_account_traffic_analytics.sql',
   'scripts/supabase-migrations/202609240053_order_attention_pilot.sql',
   'scripts/supabase-migrations/202609240052_order_attention_other.sql',
   'scripts/apply-production-database-migrations.mjs','scripts/create-production-database-backup.mjs',
   'scripts/deploy.production.sh','package.json','package-lock.json','.env.example',
   'src/lib/../lib/merchantOrderAttention.ts','./src/lib/merchantOrderAttention.ts',
   'src/lib\\merchantOrderAttention.ts',
  ])assert.throws(()=>onlineReleaseLane([anchor,file]),/order_attention_release_scope_rejected/,file);
 }
 assert.throws(()=>onlineReleaseLane(['src/lib/merchantOrderAttentionProjection.ts']),/online_release_scope_rejected/);
 assert.throws(()=>assertOnlineTrafficScope([orderAttentionFiles[0]]),/online_release_scope_rejected/);
 assert.equal(onlineReleaseLane(['src/app/admin/AdminClient.tsx']),'performance');
});
test('order attention migration authority is exactly 052, never earlier pending migrations or another filename',()=>{
 assert.equal(onlineReleaseStageStatus('order-attention'),'staged');
 assert.equal(onlineReleaseActivationStatus('order-attention'),'database-ready');
 assert.equal(onlineReleaseMigrationTarget('order-attention'),'202609240052');
 assert.equal(onlineReleaseMigrationTarget('traffic'),'202609230051');
 assert.doesNotThrow(()=>assertPendingOnlineReleaseMigrations('order-attention',[orderAttentionMigration]));
 assert.doesNotThrow(()=>assertPendingOnlineReleaseMigrations('order-attention',[]));
 for(const pending of [null,{},[orderAttentionMigration,orderAttentionMigration],
  [{version:'202609230051'}],[{...orderAttentionMigration,version:202609240052}],
  [{...orderAttentionMigration,name:'other'}],[{...orderAttentionMigration,fileName:'other.sql'}],
  [orderAttentionMigration,{version:'202609240053'}],
 ])assert.throws(()=>assertPendingOnlineReleaseMigrations('order-attention',pending),/unapproved_order_attention_migration/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations('traffic',[orderAttentionMigration]),/unapproved_pending_migration/);
 for(const lane of ['performance','qr-export',undefined,'other']){
  assert.throws(()=>onlineReleaseMigrationTarget(lane));
  assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,[]));
 }
});
function orderAttentionProof(action='enable'){
 return {action,verified:true,siteId:'10000000',epoch:'00000000-0000-4000-8000-000000000001',
  generation:'9007199254740993',enabled:true,sourceRows:1,sourceBytes:3178,attentionCount:1,
  sourceSha256:'a'.repeat(64),summarySha256:'b'.repeat(64)};
}
test('pilot release requires an explicit exact verified owner-scope proof with bounded counts and lossless version',()=>{
 for(const action of ['enable','verify'])assert.deepEqual(assertOrderAttentionReleaseProof(orderAttentionProof(action),action),orderAttentionProof(action));
 for(const value of [null,[],{}, {...orderAttentionProof(),action:'prepare'},
  {...orderAttentionProof(),verified:false},{...orderAttentionProof(),siteId:'22222222'},
  {...orderAttentionProof(),enabled:false},{...orderAttentionProof(),generation:12},
  {...orderAttentionProof(),generation:'01'},{...orderAttentionProof(),generation:'9223372036854775808'},
  {...orderAttentionProof(),epoch:'invalid'},{...orderAttentionProof(),sourceRows:513},
  {...orderAttentionProof(),sourceBytes:8388609},{...orderAttentionProof(),attentionCount:-1},
  {...orderAttentionProof(),sourceSha256:'x'.repeat(64)},
  {...orderAttentionProof(),orders:[{customer:'must not be in a release proof'}]},
 ])assert.throws(()=>assertOrderAttentionReleaseProof(value,'enable'),/order_attention_verification_invalid/);
});
test('pilot candidate starts disabled with all workers paused and analytics credentials unchanged',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'order-attention',target:'a'.repeat(40),port:3105,
  env:{FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'original'},randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 assert.equal(changes.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID,'0');
 assert.equal(changes.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(changes.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(changes.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 for(const field of ['FAOLLA_TRAFFIC_ENABLED','FAOLLA_TRAFFIC_RETENTION_ENABLED','FAOLLA_TRAFFIC_SIGNING_SECRET','FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'])assert.equal(Object.hasOwn(changes,field),false);
 assert.match(code,/order_attention_analytics_baseline_invalid/);
 assert.match(code,/FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID!==\(s.orderAttentionEnabled\?'10000000':'0'\)/);
});
test('pilot operational verifier executes the pinned candidate with invocation-only target and rejects unverified output',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const state={lane:'order-attention',target:'c'.repeat(40),directory:'/owned-candidate'};
 for(const valid of [true,false]){
  const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'};const writes=[];const calls=[];
  const context={s:state,command:'enable',operation:'/private-operation',assertOrderAttentionReleaseProof,
   candidateEnvironment:()=>env,fail:message=>{throw Error(message);},atomic:(...args)=>writes.push(args),
   run:(command,args,options)=>{
    if(command==='git')return args[0]==='rev-parse'?state.target:'';
    calls.push({command,args:Array.from(args),cwd:options.cwd,target:options.env.FAOLLA_ORDER_ATTENTION_OPERATION_TARGET});
    return JSON.stringify({...orderAttentionProof(),verified:valid});
   }};
  if(valid)runInNewContext(`${verifier}verifyOrderAttention(s,command)`,context);
  else assert.throws(()=>runInNewContext(`${verifier}verifyOrderAttention(s,command)`,context),/order_attention_verification_invalid/);
  assert.deepEqual(calls,[{command:'node',args:['--import','tsx','scripts/order-attention-pilot.ts','enable'],cwd:state.directory,target:state.target}]);
  assert.equal(Object.hasOwn(env,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
  assert.equal(writes.length,valid?1:0);
 }
});
test('actual pilot database branch backs up before exactly 052 and requires enable proof before candidate restart',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database'){")+"}else if(action==='database'){".length;
 const end=code.indexOf("}else if(action==='activate'){",start);
 const branch=code.slice(start,end).replaceAll('import.meta.url','controllerModuleUrl');
 for(const proofValid of [true,false]){
  const calls=[];let migrated=false;
  const s={lane:'order-attention',status:'staged',directory:'/candidate',oldDirectory:'/old',name:'candidate'};
  const task=runInNewContext(`(async()=>{${branch}})()`,{
   s,operation:'/operation',controllerModuleUrl:import.meta.url,URL,
   assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations,
   configUnchanged:()=>calls.push('config'),verifyCandidate:()=>calls.push('candidate'),verifyBase:async()=>calls.push('baseline'),
   verifyOrderAttentionSource:()=>calls.push('source'),
   applyProductionDatabaseMigrations:async input=>{calls.push(input.apply?'apply':'dry');assert.equal(input.through,'202609240052');if(input.apply)migrated=true;return {pending:migrated?[]:[orderAttentionMigration]};},
   createProductionDatabaseBackup:async()=>{calls.push('backup');return {};},
   verifyProductionDatabaseBackup:async()=>{calls.push('verify-backup');return {};},
   verifyOrderAttention:()=>{calls.push('enable-proof');if(!proofValid)throw Error('proof_failed');return orderAttentionProof();},
   setOrderAttentionCandidateFlag:(_,flag)=>{assert.equal(flag,'10000000');calls.push('candidate-enable');},
   smoke:async()=>calls.push('smoke'),save:()=>calls.push('save'),atomic:()=>{},writeFileSync:()=>{},
   fileURLToPath:()=>'/controller',randomBytes:()=>({toString:()=> 'private-backup-key'}),
   run:(command,args)=>{assert.equal(command,'git');assert.deepEqual(Array.from(args),['rev-parse','HEAD']);return 'd'.repeat(40);},
   fail:message=>{throw Error(message);},console:{log:()=>{}},
  });
  if(proofValid){await task;assert.equal(s.status,'database-ready');}
  else {await assert.rejects(task,/proof_failed/);assert.equal(s.status,'staged');assert.equal(calls.includes('candidate-enable'),false);}
  assert.ok(calls.indexOf('verify-backup')>calls.indexOf('backup'));
  assert.ok(calls.indexOf('apply')>calls.indexOf('verify-backup'));
  assert.ok(calls.indexOf('enable-proof')>calls.indexOf('apply'));
  if(proofValid)assert.ok(calls.indexOf('candidate-enable')>calls.indexOf('enable-proof'));
 }
});
test('pilot re-verifies before static publication and restores web traffic before disabling only its candidate',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const activate=code.indexOf('async function activateCandidate(');
 assert.ok(code.indexOf("verifyOrderAttention(s,'verify')",activate)<code.indexOf('publishStatic(',activate));
 assert.match(code,/else if\(action==='activate'\)\{\s*if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\);\s*if\(s.lane==='attendance'\)await verifyAttendanceDatabaseProof\(s\);\s*await activateCandidate\(s\);/);
 const start=code.indexOf('function restoreOrderAttentionConfigs('),end=code.indexOf('function recoveryToolIdentity(',start);
 const calls=[];
 runInNewContext(`${code.slice(start,end)}restoreOrderAttentionConfigs({lane:'order-attention'})`,{
  restoreConfigs:()=>calls.push('restore-owned-web'),
  setOrderAttentionCandidateFlag:(_,flag)=>calls.push(`candidate:${flag}`),
 });
 assert.deepEqual(calls,['restore-owned-web','candidate:0']);
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),start);
 assert.match(flag,/run\('pm2',\['restart',s.name,'--update-env'\]/);
 assert.doesNotMatch(flag,/faolla_order_attention|disable'|merchant-space'/);
});

function staticIncident(){
 const target='1740b254851c11302b6c7fef536cf9ef92d75637',baseline='28c136d27d6f235683cb2eadbf2a5f1fceb34bac';
 const directory='/www/wwwroot/merchant-space.web-releases/';
 const active={target:baseline,port:3109,directory:`${directory}28c136d27d6f-online`,name:'merchant-space-online-28c136d27d6f'};
 const s={target,baseline,status:'rolled-back',lane:'public-catalog-batch',port:3110,oldPort:3109,
  directory:`${directory}1740b254851c-online`,name:'merchant-space-online-1740b254851c',
  oldDirectory:active.directory,oldName:active.name,previousActive:{...active},staticFiles:323,
  startedAt:'2026-09-25T08:33:33.264Z',rolledBackAt:'2026-09-25T08:37:03.614Z',
  baseDirectory:'/www/wwwroot/merchant-space.releases/base',
  processes:Array.from({length:11},(_,i)=>({cwd:`${directory}old${i}`,name:`old${i}`,pid:i+1})),
  configs:{'test.conf':{oldHash:'old',newHash:'new'}},
 };
 return {s,active,target,baseline};
}
test('static recovery tooling admits exactly six operational files, never application or authority changes',()=>{
 assert.equal(STATIC_RECOVERY_TOOL_FILES.length,6);
 assert.doesNotThrow(()=>assertStaticRecoveryToolScope(STATIC_RECOVERY_TOOL_FILES));
 for(const files of [[],null,['scripts/online-traffic-release.mjs'],
  [...STATIC_RECOVERY_TOOL_FILES,'src/lib/merchantCatalogStore.ts'],
  [...STATIC_RECOVERY_TOOL_FILES,'scripts/deploy.production.sh'],
  [...STATIC_RECOVERY_TOOL_FILES,'package-lock.json'],
  [...STATIC_RECOVERY_TOOL_FILES,'.github/workflows/ci.yml'],
  [...STATIC_RECOVERY_TOOL_FILES,'scripts/online-static-recovery-extra.mjs']]){
  assert.throws(()=>assertStaticRecoveryToolScope(files),/static_recovery_tool_scope_rejected/);
 }
 // No application stage lane inherits the recovery tool's authority.
 assert.throws(()=>onlineReleaseLane(STATIC_RECOVERY_TOOL_FILES));
 assert.throws(()=>onlineReleaseLane([...publicCatalogBatchFiles,'scripts/online-static-recovery.mjs']));
});
test('static retry is pinned to the explicit rolled-back incident and still-owned live baseline',()=>{
 const {s,active,target,baseline}=staticIncident();
 assert.doesNotThrow(()=>assertCatalogStaticRecoveryState(s,active,target,baseline));
 for(const patch of [{target:'a'.repeat(40)},{baseline:'b'.repeat(40)},{status:'ready-no-database'},
  {status:'active'},{status:'preparing'},{lane:'traffic'},{lane:'order-attention'},{port:3109},{oldPort:3108},
  {directory:'/other'},{oldDirectory:'/other'},{name:'other'},{oldName:'other'},
  {startedAt:'2026-09-25T08:32:33.264Z'},{rolledBackAt:'2026-09-25T08:38:03.614Z'},
  {staticFiles:322},{processes:[]},{previousActive:null},{previousActive:{...active,name:'other'}}]){
  assert.throws(()=>assertCatalogStaticRecoveryState({...s,...patch},active,target,baseline),/static_recovery_incident_not_owned/);
 }
 for(const patch of [{target:'a'.repeat(40)},{port:3110},{directory:'/other'},{name:'other'}]){
  assert.throws(()=>assertCatalogStaticRecoveryState(s,{...active,...patch},target,baseline),/static_recovery_incident_not_owned/);
 }
 assert.throws(()=>assertCatalogStaticRecoveryState(s,active,target,undefined));
 assert.throws(()=>assertCatalogStaticRecoveryState(s,active,'c'.repeat(40),baseline));
});
test('build umask is restored on both success and failure, without widening private file modes',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("console.log('online_build_started')"),end=code.indexOf("if(!existsSync(`${s.directory}/.next/BUILD_ID`))",start);
 for(const lane of ['traffic','attendance'])for(const shouldFail of [false,true]){
  let mask=0o077;const calls=[];
  const execute=()=>runInNewContext(code.slice(start,end),{
   lane,s:{directory:'/candidate',target:'a'.repeat(40)},operation:'/operation',env:{},console:{log(){}},
   hash:()=> 'verified',safeFile:()=> 'private-proof',save:()=>{},
   buildAttendanceOnlineCandidate(plan){assert.equal(plan.directory,'/candidate');assert.equal(mask,0o022);if(shouldFail)throw Error('build_failed');},
   process:{umask(next){const before=mask;mask=next;calls.push(next);return before;}},
   run(command,args){assert.equal(command,'nice');assert.equal(mask,0o022);assert.deepEqual(Array.from(args),['-n','10','npm','run','build']);if(shouldFail)throw Error('build_failed');},
  });
  if(shouldFail)assert.throws(execute,/build_failed/);else execute();
  assert.equal(mask,0o077);assert.deepEqual(calls,[0o022,0o077]);
 }
 assert.match(code,/writeFileSync\(`\$\{s.directory\}\/\.env.local`[^\n]+mode:0o600,flag:'wx'/);
});
test('actual static recovery revalidates source, tests, metadata and public bytes before allowing activation',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const implementation=code.slice(code.indexOf('async function recoverStaticPermissions('),code.indexOf('async function activateCandidate('));
 for(const stop of [null,'baseline','config','candidate','tool','tests','plan','public']){
  const {s,active,target,baseline}=staticIncident();const calls=[];
  const gate=name=>{calls.push(name);if(stop===name)throw Error(`failed_${name}`);};
  const context={s,target,baseline,app:'/www/wwwroot/merchant-space',operation:'/operation',activeFile:'/active',Buffer,
   assertCatalogStaticRecoveryState,WEB_RELEASE_FILES:['test.conf'],
   safeFile:path=>path==='/active'?JSON.stringify(active):path.includes('/after-')?'new':path.includes('/before-')?'old':'lock',
   hash:value=>String(value),readFileSync:()=>Buffer.from('private'),
   lstatSync:()=>({isSymbolicLink:()=>false,isFile:()=>true,uid:0,mode:0o100600}),
   verifyBase:async()=>gate('baseline'),configUnchanged:()=>gate('config'),verifyCandidate:()=>gate('candidate'),
   recoveryToolIdentity:()=>{gate('tool');return {revision:'b'.repeat(40),directory:'/tool'};},
   candidateEnvironment:()=>({}),existsSync:()=>true,
   realpathSync:path=>path==='/www/wwwroot/merchant-space/.next/static'?`${s.baseDirectory}/.next/static`:path,
   run:(command,args)=>{
    if(command==='git')return args[0]==='status'?'':args[0]==='show'?'lock':args[1]==='HEAD^{tree}'?'a0ba91eb5fd76ab6fe33805baf403eaaac4dddf4':s.target;
    assert.equal(command,'node');assert.equal(args.includes('build'),false);gate('tests');return '';
   },
   smoke:async()=>gate('smoke'),writeFileSync:(_path,_text,options)=>{assert.equal(options.mode,0o600);assert.equal(options.flag,'wx');gate('audit');},
   planStaticPermissionRecovery:()=>{gate('plan');return {manifest:{directories:[],files:Array.from({length:191},(_,i)=>({relativePath:`chunks/${i}.js`,sha256:'asset'}))},apply:()=>{gate('repair');return {ok:true};}};},
   request:async()=>{gate('public');return {arrayBuffer:async()=>Buffer.from('asset')};},
   save:()=>gate('save'),fail:message=>{throw Error(message);},
  };
  const task=runInNewContext(`${implementation}recoverStaticPermissions(s)`,context);
  if(stop){await assert.rejects(task,new RegExp(`failed_${stop}`));assert.equal(calls.includes('save'),false);if(stop!=='public')assert.equal(calls.includes('repair'),false);}
  else {await task;assert.equal(calls.filter(x=>x==='public').length,191);assert.ok(calls.indexOf('audit')<calls.indexOf('repair'));assert.ok(calls.indexOf('repair')<calls.indexOf('public'));assert.equal(calls.at(-1),'save');}
  assert.equal(s.status,'rolled-back','recovery must not pretend the application is ready or active');
 }
 assert.match(code,/else if\(action==='retry-static'\)\{\s*await recoverStaticPermissions\(s\);await activateCandidate\(s\);/);
 assert.doesNotMatch(implementation,/worktree','add|\['restart'|\['start'|applyProductionDatabaseMigrations|createProductionDatabaseBackup|s.status=/);
});
test('shared activation preserves normal cutover, all public checks and owned rollback on retry failure',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const implementation=code.slice(code.indexOf('async function activateCandidate('),code.indexOf('function bookingResumeOwnedPath('));
 for(const failedSmoke of [false,true]){
  const {s}=staticIncident();const calls=[];
  const task=runInNewContext(`${implementation}activateCandidate(s)`,{
   s,app:'/www/wwwroot/merchant-space',proxy:'/proxy',operation:'/operation',activeFile:'/active',nginx:'/nginx',WEB_RELEASE_FILES:['test.conf'],
   verifyOrderAttention:()=>calls.push('pilot-guard'),realpathSync:()=>'/www/wwwroot/merchant-space.releases/base/.next/static',
   publishStatic:()=>{calls.push('static');return 323;},save:()=>calls.push(`state:${s.status}`),
   atomic:(path)=>calls.push(path==='/active'?'active-record':'proxy-write'),safeFile:()=> 'owned-config',
   run:(command,args)=>{calls.push(command==='/nginx'?`nginx:${args.join(',')}`:`pm2:${args.join(',')}`);},
   smoke:async(_s,publicMode)=>{assert.equal(publicMode,true);calls.push('public-smoke');if(failedSmoke)throw Error('expected_public_failure');return 25;},
   request:async url=>{assert.equal(url,'https://launch.faolla.com/login');calls.push('launch');},
   verifyBase:async()=>calls.push('baseline'),verifyCandidate:()=>calls.push('candidate'),configUnchanged:()=>calls.push('config'),
   restoreConfigs:()=>{calls.push('owned-rollback');s.status='rolled-back';},restoreOrderAttentionConfigs:()=>{throw Error('unexpected_pilot_write');},
   setTimeout:callback=>callback(),console:{error(){}},fail:message=>{throw Error(message);},
  });
  if(failedSmoke){await assert.rejects(task,/public_verification_failed/);assert.equal(calls.filter(x=>x==='public-smoke').length,8);assert.equal(calls.at(-1),'owned-rollback');assert.equal(calls.includes('pm2:save'),false);assert.equal(calls.includes('active-record'),false);}
  else {await task;assert.equal(s.status,'active');assert.ok(calls.indexOf('launch')>calls.indexOf('public-smoke'));assert.ok(calls.indexOf('state:active')>calls.indexOf('config'));assert.equal(calls.at(-1),'active-record');}
  assert.ok(calls.indexOf('pilot-guard')<calls.indexOf('static'));assert.ok(calls.indexOf('static')<calls.indexOf('proxy-write'));
  assert.ok(calls.indexOf('nginx:-t')<calls.indexOf('nginx:-s,reload'));
 }
});

const customerProjectionEnabled='MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_ENABLED';
const customerProjectionSites='MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_SITE_IDS';
const customerProjectionOff={[customerProjectionEnabled]:'0',[customerProjectionSites]:''};
const customerProjectionFile=`${customerProjectionEnabled}=0\n${customerProjectionSites}=\n`;
function customerCodeSettingsSource(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('function assertCustomerCodeProjectionOff('),end=code.indexOf('function verifyOrderAttentionSource(',start);
 assert.ok(start>0&&end>start);
 return code.slice(start,end);
}
function customerCodeSettingsApi(overrides={}){
 return runInNewContext(`${customerCodeSettingsSource()}({assertCustomerCodeProjectionOff,assertCustomerCodeProjectionFile,verifyCustomerCodeCandidateSettings})`,{
  fail:message=>{throw Error(message);},...overrides,
 });
}
function customerCodeCandidateHarness(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const candidateEnv=code.slice(code.indexOf('function candidateEnvironment('),code.indexOf('function assertCustomerCodeProjectionOff('));
 const env={...customerProjectionOff,FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-unchanged-secret',
  FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'};
 const s={lane:'customer-code-performance',target:'a'.repeat(40),directory:'/candidate',name:'candidate'};
 const files=new Map([['/operation/runtime.json',JSON.stringify(env)],['/candidate/.env.local',customerProjectionFile]]);
 const p={name:'candidate',pid:3210,pm2_env:{...env,status:'online',pm_cwd:s.directory}};
 const actual={...env},reads=[],commands=[],hooks={head:s.target,status:'',process:p};
 const api=runInNewContext(`${candidateEnv}${customerCodeSettingsSource()}${source}({verifyCandidate,verifyCustomerCodeCandidateSettings})`,{
  operation:'/operation',webReleaseRuntimeEnvironment,
  safeFile:path=>{reads.push(path);if(!files.has(path))throw Error('missing_candidate_file');return files.get(path);},
  read:path=>{reads.push(path);assert.equal(path,'/proc/3210/environ');return Object.entries(actual).filter(([,value])=>value!==undefined).map(([key,value])=>`${key}=${value}`).join('\0')+'\0';},
  pm:()=>hooks.process?[hooks.process]:[],
  run:(command,args,options)=>{commands.push([command,Array.from(args),options.cwd]);return args[0]==='rev-parse'?hooks.head:hooks.status;},
  fail:message=>{throw Error(message);},
 });
 return {api,s,env,files,p,actual,reads,commands,hooks};
}

test('customer code flags require explicit candidate off values and permit only absent or off baseline settings',()=>{
 const api=customerCodeSettingsApi();
 assert.doesNotThrow(()=>api.assertCustomerCodeProjectionOff(customerProjectionOff));
 for(const values of [{},{[customerProjectionEnabled]:'0'},{[customerProjectionSites]:''},customerProjectionOff]){
  assert.doesNotThrow(()=>api.assertCustomerCodeProjectionOff(values,true));
 }
 for(const [key,values] of [[customerProjectionEnabled,[undefined,null,'','1','false',' 0','0 ',0,false,{}]],
  [customerProjectionSites,[undefined,null,'10000000','10000000,20000000',' ','invalid',0,false,[]]]]){
  for(const value of values){
   const candidate={...customerProjectionOff,[key]:value};
   assert.throws(()=>api.assertCustomerCodeProjectionOff(candidate),/customer_code_projection_must_remain_off/);
   if(value!==undefined)assert.throws(()=>api.assertCustomerCodeProjectionOff(candidate,true),/customer_code_projection_must_remain_off/);
  }
 }
});

test('customer code dotenv proof rejects duplicates and ambiguous assignments rather than silently overriding baseline intent',()=>{
 const api=customerCodeSettingsApi(),check=(text,allowAbsent=false)=>api.assertCustomerCodeProjectionFile(text,allowAbsent);
 for(const text of [customerProjectionFile,customerProjectionFile.replaceAll('\n','\r\n'),`# ${customerProjectionEnabled}=1\n  # ${customerProjectionSites}=10000000\n${customerProjectionFile}`])assert.doesNotThrow(()=>check(text));
 for(const text of ['',`OTHER_VALUE=unchanged\n# ${customerProjectionEnabled}=1\n`,`${customerProjectionEnabled}=0\n`,`${customerProjectionSites}=\n`]){
  assert.doesNotThrow(()=>check(text,true));assert.throws(()=>check(text),/customer_code_projection_env_file_invalid/);
 }
 for(const [key,value] of [[customerProjectionEnabled,'0'],[customerProjectionSites,'']]){
  for(const invalid of [` ${key}=${value}`,`export ${key}=${value}`,`${key} =${value}`,`${key}= ${value}`,`${key}="${value}"`,
   `${key}='${value}'`,`${key}=${value} # off`,`${key}=1`,`${key}=10000000`]){
   const other=customerProjectionFile.split('\n').filter(line=>!line.startsWith(`${key}=`)).join('\n');
   for(const allowAbsent of [false,true])assert.throws(()=>check(`${other}\n${invalid}\n`,allowAbsent),/customer_code_projection_env_file_invalid/);
  }
  for(const allowAbsent of [false,true])assert.throws(()=>check(`${customerProjectionFile}${key}=${value}\n`,allowAbsent),/customer_code_projection_env_file_invalid/);
 }
});

test('customer code source flags are refused before creating operation state or candidate files',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const stage=code.indexOf("if(action==='stage'){");
 const start=code.indexOf("if(lane==='customer-code-performance'){",stage),end=code.indexOf("if(hash(run('git'",start);
 const operation=code.indexOf('privateDirectory(operation)',stage);
 assert.ok(stage<start&&start<end&&end<operation);
 for(const side of ['pm2','proc','file','status','pid','analytics'])for(const invalid of [false,true]){
  const api=customerCodeSettingsApi(),prior={pid:3210,pm2_env:{status:'online',...customerProjectionOff}},old={directory:'/baseline'};
  const env={...customerProjectionOff,FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-secret',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000'};
  let file=customerProjectionFile;
  if(invalid){
   if(side==='pm2')prior.pm2_env[customerProjectionEnabled]='1';
   if(side==='proc')env[customerProjectionSites]='10000000';
   if(side==='file')file=customerProjectionFile.replace('=0','=1');
   if(side==='status')prior.pm2_env.status='stopped';
   if(side==='pid')prior.pid=0;
   if(side==='analytics')env.FAOLLA_TRAFFIC_SIGNING_SECRET='';
  }
  const checks=[];
  const invoke=()=>runInNewContext(code.slice(start,end),{lane:'customer-code-performance',prior,old,...api,webReleaseRuntimeEnvironment,
   read:path=>{checks.push(path);assert.equal(path,'/proc/3210/environ');return Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\0');},
   safeFile:path=>{checks.push(path);assert.equal(path,'/baseline/.env.local');return file;},fail:message=>{throw Error(message);},
  });
  if(invalid)assert.throws(invoke,/customer_code_/);else {assert.doesNotThrow(invoke);assert.deepEqual(checks,['/proc/3210/environ','/baseline/.env.local']);}
 }
 const repeat=code.indexOf('assertCustomerCodeProjectionOff(env,true)',end),changes=code.indexOf('const changes=',end);
 assert.ok(operation<repeat&&repeat<changes,'a fresh source environment read must be checked again before candidate overrides');
 assert.match(code.slice(repeat,changes),/assertCustomerCodeProjectionFile\(safeFile\(`\$\{old.directory\}\/\.env.local`\),true\)/);
});

test('customer code overrides affect only the new candidate and preserve analytics pilot and retention',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-secret',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000'};
 const before=structuredClone(env);
 const execute=lane=>runInNewContext(`${code.slice(start,end)}changes`,{lane,target:'a'.repeat(40),port:3110,env,randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 const changes=execute('customer-code-performance');
 for(const [key,value] of Object.entries(customerProjectionOff))assert.equal(changes[key],value);
 for(const key of Object.keys(env))assert.equal(Object.hasOwn(changes,key),false);
 for(const lane of ['booking-merge-cpu','runtime-performance','qr-export','performance','bounded-lists','read-index','public-catalog-batch','order-attention']){
  const old=execute(lane);for(const key of Object.keys(customerProjectionOff))assert.equal(Object.hasOwn(old,key),false,`${lane}:${key}`);
 }
 assert.deepEqual(env,before,'candidate construction must not alter the live inherited environment');
 assert.equal(changes.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');assert.equal(changes.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(changes.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');assert.equal(changes.PORT,'3110');
});

test('customer candidate validates off flags independently in saved JSON dotenv PM2 and the actual process environment',()=>{
 const good=customerCodeCandidateHarness();assert.equal(good.api.verifyCandidate(good.s).pid,3210);
 assert.deepEqual(good.reads,['/operation/runtime.json','/candidate/.env.local','/proc/3210/environ']);
 assert.deepEqual(good.commands,[['git',['rev-parse','HEAD'],'/candidate'],['git',['status','--porcelain=v1','--untracked-files=all'],'/candidate']]);
 for(const side of ['saved','file','pm2','actual'])for(const key of Object.keys(customerProjectionOff))for(const value of [undefined,'1','10000000',' ']){
  const h=customerCodeCandidateHarness();
  if(side==='saved')h.files.set('/operation/runtime.json',JSON.stringify({...h.env,[key]:value}));
  else if(side==='file')h.files.set('/candidate/.env.local',customerProjectionFile.split('\n').filter(line=>!line.startsWith(`${key}=`)).join('\n')+(value===undefined?'':`\n${key}=${value}\n`));
  else if(side==='pm2')h.p.pm2_env[key]=value;
  else h.actual[key]=value;
  assert.throws(()=>h.api.verifyCandidate(h.s),/customer_code_projection_/,`${side}:${key}:${String(value)}`);
 }
 for(const path of ['/operation/runtime.json','/candidate/.env.local']){
  const h=customerCodeCandidateHarness();h.files.delete(path);assert.throws(()=>h.api.verifyCandidate(h.s),/missing_candidate_file/);
 }
 for(const lane of ['booking-merge-cpu','runtime-performance','traffic','qr-export']){
  const h=customerCodeCandidateHarness();h.s.lane=lane;
  assert.equal(h.api.verifyCustomerCodeCandidateSettings(h.s),null);assert.deepEqual(h.reads,[]);
 }
});

test('customer candidate inherits immutable source and actual analytics retention pilot and paused worker checks',()=>{
 for(const side of ['saved','pm2','actual'])for(const [key,value] of [
  ['FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID','0'],['FAOLLA_TRAFFIC_ENABLED','0'],['FAOLLA_TRAFFIC_SIGNING_SECRET',''],
  ['MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED','1'],['MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED','1'],['FAOLLA_BACKGROUND_JOBS_PAUSED','0'],
 ]){
  const h=customerCodeCandidateHarness();
  if(side==='saved')h.files.set('/operation/runtime.json',JSON.stringify({...h.env,[key]:value}));
  else if(side==='pm2')h.p.pm2_env[key]=value;else h.actual[key]=value;
  assert.throws(()=>h.api.verifyCandidate(h.s),/customer_code_performance_|candidate_identity_invalid/,`${side}:${key}`);
 }
 for(const side of ['pm2','actual'])for(const key of ['FAOLLA_TRAFFIC_RETENTION_ENABLED','FAOLLA_TRAFFIC_SIGNING_SECRET']){
  const h=customerCodeCandidateHarness();(side==='pm2'?h.p.pm2_env:h.actual)[key]='changed';
  assert.throws(()=>h.api.verifyCandidate(h.s),/customer_code_performance_baseline_features_changed/);
 }
 for(const [field,value] of [['head','b'.repeat(40)],['status','?? unexpected.txt'],['status',' M src/lib/merchantCustomers.ts']]){
  const h=customerCodeCandidateHarness();h.hooks[field]=value;
  assert.throws(()=>h.api.verifyCandidate(h.s),/customer_code_performance_candidate_source_changed/);assert.deepEqual(h.reads,[]);
 }
 for(const patch of [{status:'stopped'},{pm_cwd:'/different'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://different.invalid'}]){
  const h=customerCodeCandidateHarness();Object.assign(h.p.pm2_env,patch);assert.throws(()=>h.api.verifyCandidate(h.s),/candidate_identity_invalid/);
 }
 const missing=customerCodeCandidateHarness();missing.hooks.process=null;assert.throws(()=>missing.api.verifyCandidate(missing.s),/candidate_identity_invalid/);
});

test('customer activation and rollback inherit all-file snapshot ownership and never partially apply invalid saved proxies',async()=>{
 for(const side of ['before','after'])for(const missing of [false,true]){
  const h=runtimePerformanceProxyHarness('customer-code-performance');
  if(missing)h.files.delete(`/operation/${side}-last.conf`);else h.files.set(`/operation/${side}-last.conf`,'unowned');
  await assert.rejects(h.api.activateCandidate(h.s),missing?/missing_fixture_file/:/customer_code_performance_saved_proxy_changed/);
  assert.deepEqual(h.effects,[]);assert.equal(h.s.status,'ready-no-database');
 }
 for(const invalid of ['saved-drift','saved-missing','current-drift']){
  const h=runtimePerformanceProxyHarness('customer-code-performance');h.s.status='active';
  for(const name of h.names)h.files.set(`/proxy/${name}`,h.files.get(`/operation/after-${name}`));
  if(invalid==='saved-drift')h.files.set('/operation/before-last.conf','unowned');
  if(invalid==='saved-missing')h.files.delete('/operation/before-last.conf');
  if(invalid==='current-drift')h.files.set('/proxy/last.conf','unowned');
  assert.throws(()=>h.api.restoreConfigs(h.s),invalid==='current-drift'?/rollback_proxy_not_owned/:invalid==='saved-missing'?/missing_fixture_file/:/customer_code_performance_saved_proxy_changed/);
  assert.deepEqual(h.effects,[]);assert.equal(h.s.status,'active');
 }
 const a=runtimePerformanceProxyHarness('customer-code-performance'),after=a.names.map(name=>a.files.get(`/operation/after-${name}`));
 a.hooks.beforeStatic=()=>{for(const name of a.names)a.files.set(`/operation/after-${name}`,'late drift');};
 await a.api.activateCandidate(a.s);assert.equal(a.s.status,'active');assert.deepEqual(a.names.map(name=>a.files.get(`/proxy/${name}`)),after);
 const r=runtimePerformanceProxyHarness('customer-code-performance'),before=r.names.map(name=>r.files.get(`/operation/before-${name}`));
 r.hooks.beforeWrite=()=>{for(const name of r.names)r.files.set(`/operation/before-${name}`,'late drift');};
 r.api.restoreConfigs(r.s);assert.equal(r.s.status,'rolled-back');assert.deepEqual(r.names.map(name=>r.files.get(`/proxy/${name}`)),before);
 const failed=runtimePerformanceProxyHarness('customer-code-performance'),original=failed.names.map(name=>failed.files.get(`/proxy/${name}`));
 failed.hooks.failPublic=true;await assert.rejects(failed.api.activateCandidate(failed.s),/public_verification_failed/);
 assert.deepEqual(failed.names.map(name=>failed.files.get(`/proxy/${name}`)),original);assert.equal(failed.s.status,'rolled-back');
 assert.equal(failed.effects.includes('pm2:save'),false);assert.equal(failed.effects.includes('write:/active'),false);
});

test('customer stage serializes focused and retention proofs and rechecks disabled settings around the real build before readiness',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("console.log('online_focused_tests')"),end=code.indexOf('\n }else{',start);
 assert.ok(start>0&&end>start);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 for(const failure of [null,'focused','rolling','build','missing-build','settings-before','settings-after-tests','settings-after-build','baseline','config','source-after-build','candidate']){
  const h=customerCodeCandidateHarness(),calls=[],commands=[];let settings=0,sources=0,mask=0o077;
  h.s.status='preparing';h.s.port=3110;
  const gate=name=>{calls.push(name);if(failure===name)throw Error(`failed_${name}`);};
  const mutate=()=>h.files.set('/operation/runtime.json',JSON.stringify({...h.env,[customerProjectionEnabled]:'1'}));
  if(failure==='settings-before')mutate();
  const task=runInNewContext(`(async()=>{${code.slice(start,end)}})()`,{
   lane:h.s.lane,s:h.s,env:h.env,port:3110,CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS,BOOKING_MERGE_CPU_FOCUSED_TESTS,
   console:{log(){}},process:{execPath:'/node',umask(next){const prior=mask;mask=next;return prior;}},
   verifyRuntimePerformanceSource:()=>gate(++sources===1?'source-before':'source-after-build'),
   verifyCustomerCodeCandidateSettings:s=>{calls.push(`settings-${++settings}`);return h.api.verifyCustomerCodeCandidateSettings(s);},
   run:(command,args,options)=>{
    commands.push([command,Array.from(args),options]);if(command!=='pm2')assert.equal(options.cwd,'/candidate');
    if(command==='node'){
     const phase=args.includes('--import')?'focused':'rolling';gate(phase);
     assert.equal(args.filter(value=>value==='--test-concurrency=1').length,1);
     if(phase==='focused'){
      assert.deepEqual(Array.from(args),['--import','tsx','--test','--test-concurrency=1',...CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS,...fixed]);
      assert.equal(options.env,h.env);if(failure==='settings-after-tests')mutate();
     }else assert.deepEqual(Array.from(args),['--test','--test-concurrency=1','scripts/online-release-retirement-policy.test.mjs','scripts/online-release-retirement.test.mjs','scripts/online-release-rolling-policy.test.mjs','scripts/online-release-rolling.test.mjs']);
    }else if(command==='nice'){
     assert.deepEqual(Array.from(args),['-n','10','npm','run','build']);assert.equal(mask,0o022);assert.equal(options.env,h.env);gate('build');
     if(failure==='settings-after-build')mutate();
    }else {assert.equal(command,'pm2');assert.equal(args[0],'start');assert.equal(args.includes('stop'),false);assert.equal(options.env,h.env);gate('start');}
   },
   existsSync:path=>{assert.equal(path,'/candidate/.next/BUILD_ID');return failure!=='missing-build';},
   verifyBase:async()=>gate('baseline'),configUnchanged:()=>gate('config'),smoke:async()=>gate('smoke'),
   verifyCandidate:s=>{gate('candidate');return h.api.verifyCandidate(s);},onlineReleaseStageStatus,
   save:()=>gate('save'),setTimeout:callback=>callback(),fail:message=>{throw Error(message);},
  });
  if(failure){
   await assert.rejects(task,/failed_|customer_code_projection_must_remain_off|build_missing/);
   assert.equal(calls.includes('save'),false);assert.equal(h.s.status,'preparing');
   if(failure!=='candidate')assert.equal(calls.includes('start'),false);
   if(['settings-before','focused','rolling','settings-after-tests'].includes(failure))assert.equal(calls.includes('build'),false);
  }else{
   await task;assert.equal(h.s.status,'ready-no-database');
   assert.deepEqual(calls,['source-before','settings-1','focused','rolling','settings-2','build','baseline','config','source-after-build','settings-3','start','smoke','candidate','save']);
   assert.deepEqual(commands.map(([command])=>command),['node','node','nice','pm2']);
  }
  assert.equal(mask,0o077,'build failure or success must restore the private original umask');
 }
});

test('customer finish-stage cannot bless missing builds dirty source wrong status or invalid actual projection settings',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const marker="if(action==='finish-stage'){",start=code.indexOf(marker)+marker.length,end=code.indexOf("}else if(action==='resume-booking-stage'){",start);
 assert.ok(start>marker.length&&end>start);
 assert.match(code.slice(start-100,start),/const s=JSON.parse\(safeFile\(stateFile\)\);await verifyBase\(s\);/);
 for(const failure of [null,'status','head','dirty','build','budget','config','actual-projection','smoke']){
  const h=customerCodeCandidateHarness(),calls=[];h.s.status=failure==='status'?'staged':'preparing';
  if(failure==='actual-projection')h.actual[customerProjectionEnabled]='1';
  const gate=name=>{calls.push(name);if(failure===name)throw Error(`failed_${name}`);};
  const task=runInNewContext(`(async()=>{${code.slice(start,end)}})()`,{
   s:h.s,onlineReleaseStageStatus,
   run:(command,args,options)=>{
    assert.equal(options.cwd,'/candidate');
    if(command==='git'){calls.push(args[0]);return args[0]==='rev-parse'?(failure==='head'?'b'.repeat(40):h.s.target):(failure==='dirty'?'?? untracked':'');}
    assert.equal(command,'node');assert.deepEqual(Array.from(args),['scripts/check-admin-bundle-budget.mjs']);gate('budget');
   },
   existsSync:path=>{assert.equal(path,'/candidate/.next/BUILD_ID');return failure!=='build';},configUnchanged:()=>gate('config'),
   verifyCandidate:s=>{calls.push('candidate');return h.api.verifyCandidate(s);},smoke:async()=>gate('smoke'),save:()=>gate('save'),fail:message=>{throw Error(message);},
  });
  if(failure){await assert.rejects(task,/resume_|failed_|customer_code_projection_must_remain_off/);assert.equal(calls.includes('save'),false);}
  else {await task;assert.equal(h.s.status,'ready-no-database');assert.deepEqual(calls,['rev-parse','status','budget','config','candidate','smoke','save']);}
 }
});

test('customer activate requires ready exact candidate and owned proxy while rollback remains available without a healthy candidate',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const marker="}else if(action==='activate'){",start=code.indexOf(marker)+marker.length,end=code.indexOf("}else if(action==='retry-static'){",start);
 for(const failure of [null,'status','actual-projection','config','smoke']){
  const h=customerCodeCandidateHarness(),calls=[];h.s.status=failure==='status'?'preparing':'ready-no-database';
  if(failure==='actual-projection')h.actual[customerProjectionSites]='10000000';
  const gate=name=>{calls.push(name);if(failure===name)throw Error(`failed_${name}`);};
  const task=runInNewContext(`(async()=>{${code.slice(start,end)}})()`,{
   s:h.s,onlineReleaseActivationStatus,verifyCandidate:s=>{calls.push('candidate');return h.api.verifyCandidate(s);},
   configUnchanged:()=>gate('config'),smoke:async()=>gate('smoke'),activateCandidate:async()=>gate('activate'),
   heldLock:{},settleOnlineRetention:async()=>gate('retention'),fail:message=>{throw Error(message);},
  });
  if(failure){await assert.rejects(task,/not_ready|customer_code_projection_must_remain_off|failed_/);assert.equal(calls.includes('activate'),false);}
  else {await task;assert.deepEqual(calls,['candidate','config','smoke','activate','retention']);}
 }
 const rollbackStart=code.indexOf("}else if(action==='rollback'){")+"}else if(action==='rollback'){".length;
 const rollbackEnd=code.indexOf('\n  }',rollbackStart),branch=code.slice(rollbackStart,rollbackEnd);
 for(const failure of [null,'status','missing-active','wrong-active','config']){
  const calls=[],s={lane:'customer-code-performance',status:failure==='status'?'ready-no-database':'active',target:'a'.repeat(40)};
  const execute=()=>runInNewContext(branch,{s,activeFile:'/active',existsSync:()=>failure!=='missing-active',safeFile:()=>JSON.stringify({target:failure==='wrong-active'?'b'.repeat(40):s.target}),
   configUnchanged:(_s,active)=>{assert.equal(active,true);calls.push('config');if(failure==='config')throw Error('failed_config');},
   restoreConfigs:()=>calls.push('restore'),verifyCandidate:()=>{throw Error('must_not_block_recovery_on_bad_candidate');},
   fail:message=>{throw Error(message);},
  });
  if(failure){assert.throws(execute,/rollback_not_current|failed_config/);assert.equal(calls.includes('restore'),false);}
  else {execute();assert.deepEqual(calls,['config','restore']);}
 }
});

test('customer private and public smoke require unauthenticated full and manager views to reject access without weakening old probes',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('async function smoke('),code.indexOf('function restoreConfigs('));
 const views=['/api/merchant-customers?siteId=10000000','/api/merchant-customers?siteId=10000000&view=manager-v1'];
 for(const publicMode of [false,true])for(const failure of [null,...views]){
  const calls=[],s={lane:'customer-code-performance',target:'a'.repeat(40),port:3110};
  const origin=publicMode?'https://www.faolla.com':'http://127.0.0.1:3110';
  const smoke=runInNewContext(`${releaseRequestSource()}${source}smoke`,{
   Headers,AbortSignal,URL,hasExpectedCardWebsite,fail:message=>{throw Error(message);},
   fetch:async(url,options)=>{
    const parsed=new URL(url),path=parsed.pathname+parsed.search;calls.push({url,path,options});
    assert.equal(options.redirect,'manual');assert.equal(options.headers.get('Connection'),'close');
    assert.equal(options.headers.has('Authorization'),false);assert.equal(options.headers.has('Cookie'),false);
    const protectedRoute=views.includes(path)||parsed.pathname.startsWith('/api/super-admin/');
    return {status:path===failure?200:protectedRoute?401:200,json:async()=>({buildId:s.target}),text:async()=>{
     if(path==='/card/luis-gpyv6u')return '<a class="button secondary" href="https://www.haoyouduosevilla.com/">Website</a>';
     if(path==='/card/luis-gpyv6u/contact')return 'URL:https://www.haoyouduosevilla.com/';
     return '<script src="/_next/static/chunks/exact.js"></script>';
    }};
   },
  });
  if(failure)await assert.rejects(smoke(s,publicMode),/^Error: online_http:200:\/api\/merchant-customers$/);
  else {
   assert.equal(await smoke(s,publicMode),1);
   for(const path of views)assert.equal(calls.filter(call=>call.url===origin+path).length,1);
   for(const path of ['/login','/admin','/super-admin','/card/luis-gpyv6u','/card/luis-gpyv6u/contact','/traffic-card-v1.js',
    '/api/super-admin/platform-merchant-snapshot','/_next/static/chunks/exact.js'])assert.ok(calls.some(call=>call.url===origin+path),path);
   const consoleProbe=calls.find(call=>call.path==='/api/super-admin/traffic?siteId=10000000');
   assert.equal(consoleProbe.url,(publicMode?'https://console.faolla.com':origin)+consoleProbe.path);
   assert.equal(consoleProbe.options.headers.get('Host'),'console.faolla.com');
  }
  const callsBefore=calls.length;await smoke({...s,lane:'booking-merge-cpu'},publicMode);
  assert.equal(calls.slice(callsBefore).some(call=>views.includes(call.path)),false,'legacy lanes must not gain new probe behavior');
 }
});

test('attendance lane admits only its reviewed exact source closure, not older pending migrations or preview tools',()=>{
 assert.equal(onlineReleaseLane(ATTENDANCE_RELEASE_FILES),'attendance');
 assert.equal(onlineReleaseStageStatus('attendance'),'staged');assert.equal(onlineReleaseActivationStatus('attendance'),'database-ready');
 assert.doesNotThrow(()=>assertOnlineReleaseDatabaseAllowed('attendance'));
 assert.throws(()=>onlineReleaseMigrationTarget('attendance'),/attendance_database_manager_required/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations('attendance',[]),/attendance_database_manager_required/);
 for(const foreign of ['package.json','src/lib/merchantAttendanceUnreviewed.ts','scripts/attendance-local-preview.mjs','scripts/package-attendance-pilot-app.mjs',
  'scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql','scripts/supabase-migrations/202610090165_attendance_unreviewed.sql']){
  assert.throws(()=>onlineReleaseLane(['src/lib/merchantAttendance.ts',foreign]),/attendance_release_scope_rejected/);
 }
 for(const bad of [[],['src/lib/merchantAttendance.ts','src/lib/merchantAttendance.ts'],['../src/lib/merchantAttendance.ts']])assert.throws(()=>assertAttendanceReleaseScope(bad),/attendance_release_scope_rejected/);
});

test('attendance manifest pins the 149 reviewed SQL names, unused 165, baseline and authorized single merchant',()=>{
 const copy=()=>structuredClone(ATTENDANCE_RELEASE_SCOPE);
 const ordinals=ATTENDANCE_RELEASE_SCOPE.migrations.map(x=>Number(/\d{8}(\d{4})_/.exec(x)[1]));
 assert.equal(ordinals.length,149);assert.equal(new Set(ordinals).size,149);assert.equal(ordinals.includes(165),false);assert.equal(ordinals.includes(114),true);
 assert.deepEqual(ordinals.slice().sort((a,b)=>a-b),Array.from({length:150},(_,i)=>61+i).filter(n=>n!==165));
 for(const mutate of [x=>{x.baseline='b'.repeat(40);},x=>{x.approvedSiteId='10000001';},x=>{x.migrationCount=150;},x=>{x.unusedOrdinals=[];},x=>{x.migrations.pop();},
  x=>{x.runtime.push('../foreign');},x=>{x.quality.push('src/lib/merchantAttendance.ts');},x=>{x.serverFlags.push('FAOLLA_ATTENDANCE_UNKNOWN_ENABLED','FAOLLA_ATTENDANCE_UNKNOWN_ENABLED');},x=>{x.disabledFlags=[];}]){
  const x=copy();mutate(x);assert.throws(()=>validateAttendanceReleaseScope(x),/attendance_release_/);
 }
 assert.ok(Object.isFrozen(ATTENDANCE_RELEASE_SCOPE.runtime));
 for(const file of ATTENDANCE_RELEASE_FOCUSED_TESTS)assert.ok(ATTENDANCE_RELEASE_FILES.includes(file),file);
});

test('attendance environment has explicit compile/runtime phases, exact cohort and permanently disabled runner/destructive gates',()=>{
 const credential=Object.fromEntries(ATTENDANCE_RELEASE_SCOPE.credentialKeys.map(k=>[k,'A'.repeat(43)]));
 for(const phase of ['staged','database-ready']){
  const env={...attendanceCandidateEnvironment(phase),...credential,FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000'};
  assert.doesNotThrow(()=>assertAttendanceCandidateEnvironment(env,phase));
  for(const key of ATTENDANCE_RELEASE_SCOPE.publicFlags)assert.equal(env[key],ATTENDANCE_RELEASE_SCOPE.disabledFlags.includes(key)?'0':'1');
  for(const key of ATTENDANCE_RELEASE_SCOPE.serverFlags)assert.equal(env[key],key==='FAOLLA_ATTENDANCE_ROLLOUT_ENABLED'?'1':phase==='database-ready'&&!ATTENDANCE_RELEASE_SCOPE.disabledFlags.includes(key)?'1':'0');
  for(const key of ATTENDANCE_RELEASE_SCOPE.siteKeys)assert.equal(env[key],key==='FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS'||phase==='database-ready'?'10000000':'');
  assert.equal(env.FAOLLA_ENTERPRISE_E2E_HARNESS,'');assert.equal(env.FAOLLA_BACKUP_RESTORE_HARNESS,'');
  for(const change of [{FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS:'*'},{FAOLLA_ATTENDANCE_ROLLOUT_ENABLED:'0'},
   {FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED:'1'},{FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED:'1'},
   {NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED:'1'},{FAOLLA_ATTENDANCE_UNREVIEWED_ENABLED:'1'},
   {FAOLLA_ATTENDANCE_ONSITE_QR_SECRET:'fake-placeholder'},{FAOLLA_ENTERPRISE_E2E_HARNESS:'1'}])assert.throws(()=>assertAttendanceCandidateEnvironment({...env,...change},phase),/attendance_release_environment_invalid/);
 }
 for(const [phase,id] of [['staged','10000000'],['database-ready',''],['database-ready','*'],['database-ready','10000001'],['active','10000000']])assert.throws(()=>attendanceCandidateEnvironment(phase,id),/attendance_release_environment_invalid/);
});

function attendanceProofFixture(){
 const target='a'.repeat(40),scopeSha256='c'.repeat(64),proofSha256='d'.repeat(64),baseline=ATTENDANCE_RELEASE_SCOPE.baseline;
 return {value:{schemaVersion:1,kind:'attendance-production-database-ready',target,baseline,scopeSha256,
  dbIdentity:{containerId:'0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416',containerName:'supabase-db',databaseName:'postgres',databaseOid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',dataSource:'/opt/supabase/docker/volumes/db/data'},
  registryCount:209,registryMaximum:'202610090210',backupVerified:true,compatibilityVerified:true,proofSha256},expected:{target,baseline,scopeSha256,proofSha256}};
}
test('attendance DB-ready contract requires exact live identity, 209 rows and both backup/compatibility evidence',()=>{
 const {value,expected}=attendanceProofFixture();assert.equal(assertAttendanceDatabaseReadyProof(value,expected),value);
 for(const [key,replacement] of Object.entries({target:'b'.repeat(40),baseline:'b'.repeat(40),scopeSha256:'b'.repeat(64),registryCount:210,registryMaximum:'202610090209',backupVerified:false,compatibilityVerified:false,proofSha256:'b'.repeat(64),extra:true,dbIdentity:'e'.repeat(64)})){
  assert.throws(()=>assertAttendanceDatabaseReadyProof({...value,[key]:replacement},expected),/attendance_database_ready_proof_invalid/);
 }
 for(const key of Object.keys(value.dbIdentity))assert.throws(()=>assertAttendanceDatabaseReadyProof({...value,dbIdentity:{...value.dbIdentity,[key]:'foreign'}},expected),/attendance_database_ready_proof_invalid/);
 assert.throws(()=>assertAttendanceDatabaseReadyProof({...value,dbIdentity:{...value.dbIdentity,extra:'foreign'}},expected),/attendance_database_ready_proof_invalid/);
 for(const key of Object.keys(value)){const x=structuredClone(value);delete x[key];assert.throws(()=>assertAttendanceDatabaseReadyProof(x,expected),/attendance_database_ready_proof_invalid/);}
});

test('attendance database action only verifies separate guarded DB manager, is resumable, and never reruns migration SQL',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),marker="if(s.lane==='attendance'){\n    if(!['staged','database-ready'].includes(s.status))";
 const start=code.indexOf(marker),end=code.indexOf('\n   }else{',start);assert.ok(start>0&&end>start);const branch=code.slice(start,end)+'\n}';
 assert.doesNotMatch(branch,/applyProductionDatabaseMigrations|createProductionDatabaseBackup|writeFileSync|through/);
 for(const status of ['staged','database-ready','preparing','active'])for(const transition of [false,true]){
  const calls=[],s={lane:'attendance',status,...(transition?{attendanceEnvironmentTransition:{}}:{})};
  const pending=runInNewContext(`(async()=>{${branch}})()`,{s,configUnchanged:()=>calls.push('config'),verifyCandidate:()=>calls.push('candidate'),verifyAttendanceDatabaseProof:async()=>calls.push('DB-readonly'),enableAttendanceCandidate:async()=>calls.push('enable-owned-candidate'),smoke:async()=>calls.push('smoke'),fail:x=>{throw Error(x);}});
  if(!['staged','database-ready'].includes(status)){await assert.rejects(pending,/database_not_staged/);assert.deepEqual(calls,[]);}
  else {await pending;assert.deepEqual(calls,status==='database-ready'?['config','candidate','DB-readonly','smoke']:transition?['config','enable-owned-candidate']:['config','candidate','enable-owned-candidate']);}
 }
});

test('attendance candidate enablement resumes only proof-bound before/after files and restarts no previous process',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),source=code.slice(code.indexOf('async function enableAttendanceCandidate('),code.indexOf('function assertCustomerCodeProjectionOff('));
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const changes=attendanceCandidateEnvironment('database-ready'),beforeRuntime=JSON.stringify(attendanceCandidateEnvironment('staged')),
  beforeEnv=Object.entries(attendanceCandidateEnvironment('staged')).map(([k,v])=>`${k}=${v}`).join('\n')+'\nUNRELATED=preserved\n',
  afterRuntime=JSON.stringify({...JSON.parse(beforeRuntime),...changes}),afterEnv=beforeEnv.split('\n').map(line=>{const key=line.slice(0,line.indexOf('='));return Object.hasOwn(changes,key)?`${key}=${changes[key]}`:line;}).join('\n');
 for(const initial of ['fresh','before-before','after-before','before-after','after-after','foreign-runtime','foreign-env']){
  const calls=[],s={name:'candidate-owned',directory:'/candidate',status:'staged'},files=new Map([['/operation/runtime.json',initial==='after-before'||initial==='after-after'?afterRuntime:initial==='foreign-runtime'?'foreign':beforeRuntime],['/candidate/.env.local',initial==='before-after'||initial==='after-after'?afterEnv:initial==='foreign-env'?'foreign':beforeEnv]]);
  if(initial!=='fresh'){s.attendanceDatabaseProofSha256='d'.repeat(64);s.attendanceEnvironmentTransition={beforeRuntime:hash(beforeRuntime),afterRuntime:hash(afterRuntime),beforeEnv:hash(beforeEnv),afterEnv:hash(afterEnv)};}
  const p={name:s.name,pm2_env:{status:'online',pm_cwd:s.directory,FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com'}};
  const enable=runInNewContext(`${source}enableAttendanceCandidate`,{hash,JSON,Object,Promise,operation:'/operation',attendanceCandidateEnvironment,
   verifyAttendanceDatabaseProof:async()=>{calls.push('DB-readonly');return {proofSha256:'d'.repeat(64)};},pm:()=>[p],safeFile:path=>files.get(path),
   verifyAttendanceCandidateSettings:(_s,_p,enabled)=>calls.push(enabled?'settings-on':'settings-off'),save:()=>calls.push('save'),
   atomic:(path,text)=>{calls.push('atomic');files.set(path,text);},run:(command,args,options)=>{assert.equal(command,'pm2');assert.deepEqual(Array.from(args),['restart','candidate-owned','--update-env']);assert.deepEqual(options.env,JSON.parse(afterRuntime));calls.push('restart-own');},
   smoke:async()=>calls.push('smoke'),verifyCandidate:()=>calls.push('candidate'),setTimeout,fail:x=>{throw Error(x);}});
  if(initial.startsWith('foreign')){await assert.rejects(enable(s),/attendance_enablement_not_owned|Unexpected token/);assert.equal(calls.includes('restart-own'),false);assert.equal(calls.includes('atomic'),false);}
  else {await enable(s);assert.equal(s.status,'database-ready');assert.equal(s.attendanceEnabled,true);assert.equal(files.get('/operation/runtime.json'),afterRuntime);assert.equal(files.get('/candidate/.env.local'),afterEnv);assert.equal(calls.filter(x=>x==='restart-own').length,1);assert.ok(calls.indexOf('DB-readonly')<calls.indexOf('restart-own'));assert.ok(calls.indexOf('smoke')<calls.indexOf('candidate'));}
 }
});

test('attendance activation rechecks the same proof before traffic switch but rollback does not depend on DB health',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),marker="}else if(action==='activate'){",start=code.indexOf(marker)+marker.length,end=code.indexOf("}else if(action==='retry-static'){",start),source=code.slice(start,end);
 for(const failure of [null,'proof','status']){
  const calls=[],s={lane:'attendance',status:failure==='status'?'staged':'database-ready'},gate=x=>{calls.push(x);if(failure===x)throw Error(`failed_${x}`);};
  const pending=runInNewContext(`(async()=>{${source}})()`,{s,onlineReleaseActivationStatus,verifyCandidate:()=>gate('candidate'),configUnchanged:()=>gate('config'),smoke:async()=>gate('smoke'),verifyAttendanceDatabaseProof:async()=>gate('proof'),activateCandidate:async()=>gate('traffic-switch'),settleOnlineRetention:async()=>gate('retention'),heldLock:{},fail:x=>{throw Error(x);}});
  if(failure){await assert.rejects(pending,/not_ready|failed_proof/);assert.equal(calls.includes('traffic-switch'),false);}else{await pending;assert.deepEqual(calls,['candidate','config','smoke','proof','traffic-switch','retention']);}
 }
 const r=code.slice(code.indexOf("}else if(action==='rollback'){"),code.indexOf('\n  }',code.indexOf("}else if(action==='rollback'){")));
 assert.doesNotMatch(r,/verifyAttendanceDatabaseProof|verifyCandidate|applyProduction/);assert.match(r,/configUnchanged\(s,true\)/);assert.match(r,/restoreConfigs\(s\)/);
});

test('attendance unauthenticated private/public smoke distinguishes DB-disabled vs ready routes without enabling QA harnesses',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),source=code.slice(code.indexOf('async function smoke('),code.indexOf('function restoreConfigs('));
 for(const publicMode of [false,true])for(const attendanceEnabled of [false,true]){
  const s={lane:'attendance',target:'a'.repeat(40),port:3110,attendanceEnabled},calls=[];
  const smoke=runInNewContext(`${releaseRequestSource()}${source}smoke`,{Headers,AbortSignal,URL,hasExpectedCardWebsite,fail:x=>{throw Error(x);},
   fetch:async(url,options)=>{const u=new URL(url),path=u.pathname+u.search;calls.push({url,path,options});assert.equal(options.headers.has('Authorization'),false);assert.equal(options.headers.has('Cookie'),false);
    const status=u.pathname.startsWith('/api/merchant-enterprise/attendance/')?(attendanceEnabled?401:404):u.pathname.startsWith('/test-harness/')?404:u.pathname.startsWith('/api/super-admin/')?401:200;
    return {status,json:async()=>({buildId:s.target}),text:async()=>path==='/card/luis-gpyv6u'?'<a class="button secondary" href="https://www.haoyouduosevilla.com/">Website</a>':path==='/card/luis-gpyv6u/contact'?'URL:https://www.haoyouduosevilla.com/':'<script src="/_next/static/chunks/exact.js"></script>'};},
  });
  await smoke(s,publicMode);
  for(const endpoint of ['admin','self','records']){const call=calls.find(x=>x.path===`/api/merchant-enterprise/attendance/${endpoint}?siteId=10000000`);assert.ok(call);assert.ok(call.url.startsWith(publicMode?'https://launch.faolla.com':'http://127.0.0.1:3110'));assert.equal(call.options.headers.get('Host'),'launch.faolla.com');}
  for(const endpoint of ['enterprise','employee-workspace'])assert.ok(calls.some(x=>x.path===`/test-harness/${endpoint}`));
  for(const path of ['/login','/admin','/super-admin','/card/luis-gpyv6u','/card/luis-gpyv6u/contact','/traffic-card-v1.js','/_next/static/chunks/exact.js'])assert.ok(calls.some(x=>x.path===path));
 }
});

function contactWechatControllerSource(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 return code.slice(code.indexOf('function contactWechatProtectedEnvironment('),code.indexOf('function verifyAttendanceSource('));
}
function contactWechatSettingsFixture(){
 const target='a'.repeat(40),operation='/operation',baseline=CONTACT_WECHAT_RELEASE_BASELINE;
 const inherited={...attendanceCandidateEnvironment('database-ready'),...Object.fromEntries(ATTENDANCE_RELEASE_SCOPE.credentialKeys.map(key=>[key,'A'.repeat(43)])),
  FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-signing-secret',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',
  FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',
  PATH:'/usr/bin:/bin',HOME:'/root',NODE_ENV:'production',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1',PM2_HOME:'/root/.pm2',PORT:'3103',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-secret'};
 const changes={FAOLLA_WEB_BUILD_ID:target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:target,FAOLLA_WEB_RELEASED_AT:'2026-10-11T12:00:00.000Z',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',PORT:'3104'};
 const env={...inherited,...changes},oldText='SUPER_ADMIN_PASSWORD=synthetic-file-only\nWEB_PUSH_PRIVATE_KEY=synthetic-file-only\nUNRELATED=unchanged\nPORT=3103\n',nextText=oldText.split('\n').filter(line=>!Object.keys(changes).some(key=>line.startsWith(`${key}=`))).join('\n')+'\n'+Object.entries(changes).map(([key,value])=>`${key}=${value}`).join('\n')+'\n';
 const files=new Map([['/operation/runtime.json',JSON.stringify(env)],['/old/.env.local',oldText],['/candidate/.env.local',nextText]]),hash=value=>createHash('sha256').update(value).digest('hex');
 const p={name:'candidate',pid:3211,pm2_env:{...env,status:'online',pm_cwd:'/candidate'}},prior={name:'baseline',pid:3210,pm2_env:{...inherited,status:'online',pm_cwd:'/old'}},actual={...env},baselineActual={...inherited};
 const s={lane:'contact-wechat-code-only',target,baseline,port:3104,directory:'/candidate',oldDirectory:'/old',oldName:'baseline',contactWechatBaselinePid:3210,
  contactWechatRuntimeSha256:hash(files.get('/operation/runtime.json')),contactWechatEnvironmentFileSha256:hash(nextText),contactWechatBaselineEnvironmentFileSha256:hash(oldText)};
 const api=runInNewContext(`${contactWechatControllerSource()}({contactWechatProtectedEnvironment,contactWechatEnvironmentDigest,verifyContactWechatSettings,assertContactWechatResponse,contactWechatContactProof,contactWechatClosure,verifyContactWechatSource})`,{
  hash,operation,CONTACT_WECHAT_RELEASE_BASELINE,CONTACT_WECHAT_APPROVED_SUPPORT_FILES,assertAttendanceCandidateEnvironment,
  candidateEnvironment:()=>JSON.parse(files.get('/operation/runtime.json')),
  safeFile:path=>{if(!files.has(path))throw Error('missing_fixture_file');return files.get(path);},
  pm:()=>[prior,p],webReleaseRuntimeEnvironment,
  read:path=>Object.entries(path==='/proc/3210/environ'?baselineActual:actual).map(([key,value])=>`${key}=${value}`).join('\0'),
  fail:message=>{throw Error(message);},
 });
 s.contactWechatInheritedEnvironmentKeys=Object.keys(api.contactWechatProtectedEnvironment(inherited));s.contactWechatInheritedEnvironmentSha256=api.contactWechatEnvironmentDigest(inherited);
 return {s,api,env,inherited,files,p,prior,actual,baselineActual,hash};
}
test('contact code-only inheritance checks exact baseline and candidate saved files PM2 and actual process values without exposing secrets',()=>{
 const good=contactWechatSettingsFixture();assert.doesNotThrow(()=>good.api.verifyContactWechatSettings(good.s,good.p));
 for(const side of ['saved','pm2','actual','baseline-pm2','baseline-actual'])for(const key of ['FAOLLA_TRAFFIC_SIGNING_SECRET','FAOLLA_TRAFFIC_ENABLED','FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID','FAOLLA_SUPER_ADMIN_ORIGIN','SUPABASE_SERVICE_ROLE_KEY','HOME','PATH']){
  const f=contactWechatSettingsFixture();
  if(side==='saved'){f.files.set('/operation/runtime.json',JSON.stringify({...f.env,[key]:'changed-synthetic'}));}
  else (side==='pm2'?f.p.pm2_env:side==='actual'?f.actual:side==='baseline-pm2'?f.prior.pm2_env:f.baselineActual)[key]='changed-synthetic';
  assert.throws(()=>f.api.verifyContactWechatSettings(f.s,f.p),error=>/contact_wechat_|attendance_release_/.test(error.message)&&!error.message.includes('synthetic-signing-secret'));
 }
 for(const side of ['saved','actual','baseline-actual']){
  const f=contactWechatSettingsFixture();if(side==='saved'){f.files.set('/operation/runtime.json',JSON.stringify({...f.env,STRIPE_SECRET_KEY:'synthetic'}));f.s.contactWechatRuntimeSha256=f.hash(f.files.get('/operation/runtime.json'));}
  else (side==='actual'?f.actual:f.baselineActual).STRIPE_SECRET_KEY='synthetic';
  assert.throws(()=>f.api.verifyContactWechatSettings(f.s,f.p),/contact_wechat_inherited_environment_changed/);
 }
 for(const patch of [{pid:9999},{pm2_env:{status:'stopped'}},{pm2_env:{status:'online',pm_cwd:'/foreign'}}]){const f=contactWechatSettingsFixture();Object.assign(f.prior,patch);assert.throws(()=>f.api.verifyContactWechatSettings(f.s,f.p),/contact_wechat_baseline_process_changed/);}
});
test('contact code-only file-only credentials remain exact and the only dotenv change is the fixed new candidate delta',()=>{
 for(const path of ['/old/.env.local','/candidate/.env.local','/operation/runtime.json']){const f=contactWechatSettingsFixture();f.files.set(path,f.files.get(path)+'\nchanged');assert.throws(()=>f.api.verifyContactWechatSettings(f.s,f.p),/contact_wechat_environment_file_changed|Unexpected/);}
 const f=contactWechatSettingsFixture();f.files.set('/candidate/.env.local',f.files.get('/candidate/.env.local').replace('synthetic-file-only','different'));f.s.contactWechatEnvironmentFileSha256=f.hash(f.files.get('/candidate/.env.local'));
 assert.throws(()=>f.api.verifyContactWechatSettings(f.s,f.p),/contact_wechat_environment_delta_invalid/);
 for(const key of ['PORT','NODE_OPTIONS','PM2_HOME','NEXT_TELEMETRY_DISABLED','FAOLLA_WEB_BUILD_ID','NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID','MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED']){const f=contactWechatSettingsFixture();f.actual[key]='changed';assert.throws(()=>f.api.verifyContactWechatSettings(f.s,f.p),/contact_wechat_candidate_environment_invalid/);}
});
test('contact code-only closure passes only the 17 fixed approved support byte hashes while sealing the complete changed-file closure',()=>{
 const code=contactWechatControllerSource(),hash=value=>createHash('sha256').update(value).digest('hex'),files=[...CONTACT_WECHAT_APPROVED_SUPPORT_FILES,'src/app/card/[card]/route.ts','src/lib/merchantBusinessCardWebsiteRoute.test.ts','scripts/contact-wechat-online-build.mjs'];
 const calls=[];
 const closure=runInNewContext(`${code}contactWechatClosure`,{app:'/app',hash,CONTACT_WECHAT_APPROVED_SUPPORT_FILES,run:(command,args)=>{assert.equal(command,'git');calls.push([...args]);return args[0]==='diff'?files.join('\n'):`synthetic-content:${args[1]}`;},
  assertContactWechatApprovedClosure:value=>{assert.equal(value.baseline,CONTACT_WECHAT_RELEASE_BASELINE);assert.deepEqual([...value.files],files);assert.deepEqual(Object.keys(value.sourceSha256ByFile),[...CONTACT_WECHAT_APPROVED_SUPPORT_FILES]);},fail:x=>{throw Error(x);}});
 const target='a'.repeat(40),digest=closure(target,CONTACT_WECHAT_RELEASE_BASELINE);assert.match(digest,/^[a-f0-9]{64}$/);assert.ok(calls.some(args=>args[1]===`${target}:src/app/card/[card]/route.ts`));
});
test('contact code-only VCF content and response type/disposition match baseline byte proof and actual emitted guidance is present',()=>{
 const f=contactWechatSettingsFixture(),response=new Response('synthetic',{headers:{'Content-Type':'text/vcard; charset=utf-8','Content-Disposition':'attachment; filename="synthetic.vcf"'}}),body='BEGIN:VCARD\r\nURL:https://example.invalid\r\nEND:VCARD\r\n';
 f.s.contactWechatContactProof=f.api.contactWechatContactProof(response,body);
 const card='function showWechatContactGuide(source) wechat-contact-guide contactSaveButtons MicroMessenger data-wechat-contact-download data-traffic-action="contact_download_click"';
 assert.doesNotThrow(()=>f.api.assertContactWechatResponse(f.s,card,response,body));
 for(const marker of ['showWechatContactGuide','wechat-contact-guide','contactSaveButtons','MicroMessenger','data-wechat-contact-download','contact_download_click'])assert.throws(()=>f.api.assertContactWechatResponse(f.s,card.replaceAll(marker,'removed'),response,body),/contact_wechat_guide_missing/);
 assert.throws(()=>f.api.assertContactWechatResponse(f.s,card,response,body+'\n'),/contact_wechat_contact_response_changed/);
 for(const changed of [{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="synthetic.vcf"'},{'Content-Type':'text/vcard; charset=utf-8','Content-Disposition':'inline'}])assert.throws(()=>f.api.assertContactWechatResponse(f.s,card,new Response(body,{headers:changed}),body),/contact_wechat_contact_response_changed/);
});
test('contact code-only preflight closure env inheritance and bounded resource admission precede candidate-state or source writes',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),stage=code.indexOf("if(action==='stage'){"),write=code.indexOf('privateDirectory(operation)',stage);
 for(const marker of ['contactWechatClosure(target,baseline)','contact_wechat_live_baseline_invalid','assertContactWechatBuildEnvironmentKeys(inherited)','assertAttendanceCandidateEnvironment(actual,\'database-ready\')','contactWechatAttendanceSmoke(`http://127.0.0.1:${old.port}`)','assertAttendanceBuildAdmission({meminfo:']){const position=code.indexOf(marker,stage);assert.ok(position>stage&&position<write,marker);}
 const build=code.indexOf('buildContactWechatOnlineCandidate({lane,baseline:s.baseline',write),proof=code.indexOf('s.contactWechatBuildProofSha256=',build),launch=code.indexOf("run('pm2',['start'",build),readiness=code.indexOf('s.status=onlineReleaseStageStatus(lane)',launch);
 assert.ok(write<build&&build<proof&&proof<launch&&launch<readiness);
 assert.match(code,/verifyContactWechatSource\(s,true\)/);assert.match(code,/bookingResumeDependencies\(`\$\{s.directory\}\/node_modules`\)!==s.contactWechatDependenciesSha256/);
 assert.equal(onlineReleaseStageStatus('contact-wechat-code-only'),'ready-no-database');assert.equal(onlineReleaseActivationStatus('contact-wechat-code-only'),'ready-no-database');
 assert.throws(()=>assertOnlineReleaseDatabaseAllowed('contact-wechat-code-only'),/contact_wechat_code_only_database_forbidden/);
});
test('contact code-only private/public attendance smoke retains enabled auth and rejects harness access, with real private Host transport only',async()=>{
 const code=contactWechatControllerSource();
 for(const publicMode of [false,true])for(const wrongStatus of [null,200,404]){
  const calls=[];const smoke=runInNewContext(`${code}contactWechatAttendanceSmoke`,{AbortSignal,request:async(url,statuses,host)=>{calls.push({url,status:statuses[0],host,transport:'public'});if(wrongStatus!==null)throw Error('wrong_status');},
   contactWechatReleaseProbeFetch:async(url,options)=>{calls.push({url,status:url.includes('/test-harness/')?404:401,host:options.headers.Host,transport:'private'});assert.equal(options.redirect,'manual');return {status:wrongStatus??(url.includes('/test-harness/')?404:401)};},fail:message=>{throw Error(message);}});
  if(wrongStatus!==null)await assert.rejects(smoke('http://127.0.0.1:3104',publicMode),/wrong_status|contact_wechat_http/);
  else {await smoke('http://127.0.0.1:3104',publicMode);assert.equal(calls.length,5);for(const call of calls){assert.equal(call.host,'launch.faolla.com');assert.equal(call.transport,publicMode?'public':'private');assert.ok(call.url.startsWith(publicMode?'https://launch.faolla.com':'http://127.0.0.1:3104'));}assert.deepEqual(calls.map(call=>call.status),[401,401,401,404,404]);}
 }
});
test('contact code-only post-publication bookkeeping appends only converge with null victim and cannot stop retire or reclaim',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),start=code.indexOf("if(s.lane==='contact-wechat-code-only'){",code.indexOf('async function settleOnlineRetention(')),end=code.indexOf('\n const result=await completePublicationRetention',start),branch=code.slice(start,end);
 assert.doesNotMatch(branch,/retire'|reclaimPublicationArtifacts|completePublicationRetention/);
 for(const failure of [null,'not-active','converge','window']){
  let history={entries:[{active:{target:'b'.repeat(40)}}]},calls=[];const s={lane:'contact-wechat-code-only',target:'a'.repeat(40),status:failure==='not-active'?'preparing':'active'};
  const result=await runInNewContext(`(async()=>{${branch}})()`,{s,heldLock:'held-lock',controllerModuleUrl:'file:///tool/scripts/online-traffic-release.mjs',URL,fileURLToPath:()=>'/tool/',activeFile:'/active',
   readOnlineRetentionHistory:()=>history,run:(command,args)=>{assert.equal(command,'git');assert.deepEqual([...args],['rev-parse','HEAD']);return 'c'.repeat(40);},
   runOnlineRetentionUnderHeldLocks:async value=>{calls.push(value);assert.deepEqual(Object.keys(value),['kind','activeTarget','victimTarget','toolRevision','lock']);assert.equal(value.kind,'converge');assert.equal(value.victimTarget,null);if(failure==='converge')throw Error('failed');history={entries:[{active:{target:s.target}}]};},
   inspectOnlineRetentionWindow:()=>({phase:failure==='window'?'changed':'stable',active:{target:s.target}}),safeFile:()=>JSON.stringify({target:s.target}),pm:()=>[],normalizeRetirementProcess:x=>x,
   fail:x=>{throw Error(x);},console:{error(){}},
  });
  assert.equal(result.retired,null);assert.equal(result.status,failure?'pending':'completed');assert.equal(calls.length,failure==='not-active'?0:1);
 }
});
test('contact code-only rollback reuses all-file snapshot validation and restores only the owned live baseline',async()=>{
 for(const invalid of ['saved-drift','saved-missing','current-drift']){
  const f=runtimePerformanceProxyHarness('contact-wechat-code-only');f.s.status='active';
  for(const name of f.names)f.files.set(`/proxy/${name}`,f.files.get(`/operation/after-${name}`));
  if(invalid==='saved-drift')f.files.set('/operation/before-last.conf','unowned');
  if(invalid==='saved-missing')f.files.delete('/operation/before-last.conf');
  if(invalid==='current-drift')f.files.set('/proxy/last.conf','unowned');
  assert.throws(()=>f.api.restoreConfigs(f.s),invalid==='current-drift'?/rollback_proxy_not_owned/:invalid==='saved-missing'?/missing_fixture_file/:/contact_wechat_saved_proxy_changed/);
  assert.deepEqual(f.effects,[]);assert.equal(f.s.status,'active');
 }
 const f=runtimePerformanceProxyHarness('contact-wechat-code-only'),before=f.names.map(name=>f.files.get(`/operation/before-${name}`));f.s.status='active';
 for(const name of f.names)f.files.set(`/proxy/${name}`,f.files.get(`/operation/after-${name}`));
 f.api.restoreConfigs(f.s);assert.equal(f.s.status,'rolled-back');assert.deepEqual(f.names.map(name=>f.files.get(`/proxy/${name}`)),before);
 assert.equal(f.effects.some(effect=>effect.includes('stop')||effect.includes('restart')),false);
});
