// Real Linux/Nginx/PG15/process/FD acceptance with synthetic rows ONLY. This is
// not a production actuator: DB writes target three NEW databases in the fixed
// network-none owned pilot. Nginx and all processes have private owned roots.
import * as fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {executeBookingHandoffHost} from './booking-handoff-host.mjs';
import {executeBookingIngressDrain,BOOKING_HANDOFF_PURE_PROBE} from './booking-handoff-execution.mjs';
import {runBookingWatchdogSequence} from './booking-handoff-watchdog.mjs';
import {executeBookingFailureRecoverySequence,BOOKING_RECOVERY_BARRIER_SQL} from './booking-handoff-recovery.mjs';
import {bookingIngressSnippet} from './booking-handoff-ingress.mjs';
import {bookingHandoffActivationSnapshotSql,BOOKING_ACTIVATION_BODY_SHA256} from './booking-handoff-activation.mjs';
import {isolatedBookingRepairActivationAcceptanceSql,planBookingRuleOptionRepair} from './booking-handoff-rule-repair.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT} from './booking-handoff-runtime.mjs';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_BASELINE as BASELINE,BOOKING_HANDOFF_NATIVE_SOURCES} from './booking-handoff-policy.mjs';
import {BOOKING_SCOPE} from './booking-publication-policy.mjs';
import {verifyOnlineReleaseTool,createOnlineReleaseToolPlan,assertOnlineToolOwnedPath} from './prepare-online-release-tool.mjs';
import {bookingHostSql,bookingHostRead,bookingHostWriteOnce,bookingHostEnvironment} from './booking-handoff-host-io.mjs';
import {parseRetirementSockets} from './online-release-retirement.mjs';

const FILE=fileURLToPath(import.meta.url),PILOT='0d0a85a8ff50b585f690ba80a56d7d215adca2df1fa7c820840ff3389687d907',NGINX='/www/server/nginx/sbin/nginx';
const CASES=['normal','controller-death-before-commit','controller-death-after-commit'];
const need=(v,c)=>{if(!v)throw Error('booking_native_'+c);},equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c),hash=v=>createHash('sha256').update(v).digest('hex');
const env=()=>({...bookingHostEnvironment(),NODE_OPTIONS:'',NODE_PATH:'',PM2_NODE_OPTIONS:''}),now=()=>new Date().toISOString(),wait=ms=>new Promise(r=>setTimeout(r,ms));
function run(bin,args,options={}){const r=spawnSync(bin,args,{encoding:'utf8',env:env(),timeout:10000,maxBuffer:16*1024**2,windowsHide:true,...options});need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;}
const read=file=>bookingHostRead(file),json=file=>JSON.parse(read(file));
function write(file,value){bookingHostWriteOnce(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
function fact(pid){const root='/proc/'+pid,text=fs.readFileSync(root+'/stat','utf8'),f=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);need(fs.lstatSync(root).uid===0,'process_owner');
 return {pid,startTicks:f[19],state:f[0],executable:f[0]==='Z'?null:fs.realpathSync(root+'/exe'),cwd:f[0]==='Z'?null:fs.realpathSync(root+'/cwd'),commandSha256:hash(fs.readFileSync(root+'/cmdline'))};}
const binding=f=>Object.fromEntries(Object.entries(f).filter(([k])=>k!=='state'));
function alive(expected){try{const actual=fact(expected.pid);return actual.state!=='Z'&&isDeepStrictEqual(binding(actual),binding(expected));}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return false;throw e;}}
async function stop(expected){if(!alive(expected))return;need(expected.cwd.startsWith('/var/lib/faolla-booking-full-rehearsal-')||expected.executable===NGINX&&
 fs.readFileSync('/proc/'+expected.pid+'/cmdline','utf8').includes('/var/lib/faolla-booking-full-rehearsal-'),'stop_not_owned');process.kill(expected.pid,'SIGTERM');
 for(let i=0;i<100&&alive(expected);i++)await wait(20);if(alive(expected)){process.kill(expected.pid,'SIGKILL');for(let i=0;i<100&&alive(expected);i++)await wait(20);}need(!alive(expected),'fixture_not_stopped');}
const rootPattern=/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+$/;
function ownedCase(directory){
 need(/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+\/runtime-(normal|controller-death-before-commit|controller-death-after-commit)$/.test(directory),'case_path');
 assertOnlineToolOwnedPath(directory);need((fs.lstatSync(directory).mode&0o777)===0o700,'case_mode');
 const root=path.dirname(directory),owner=json(root+'/owner.json'),config=json(directory+'/owner.json');
 need(rootPattern.test(root)&&owner.kind==='booking-full-native-isolated-owner'&&owner.root===root&&owner.sourceSha256===hash(fs.readFileSync(FILE))&&
  config.root===root&&config.directory===directory&&CASES.includes(config.name)&&config.sourceSha256===owner.sourceSha256,'case_owner');
 return config;
}
function pilotIdentity(){
 const marker=JSON.parse(bookingHostRead('/opt/faolla-attendance-pilot/.pilot-owner.json',{privateMode:false}));
 need(marker.owner==='attendance-pilot-20261009'&&marker.root==='/opt/faolla-attendance-pilot'&&marker.project==='faolla-attendance-pilot','pilot_owner');
 const p=JSON.parse(run('docker',['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"privileged":{{json .HostConfig.Privileged}},"mounts":{{json .Mounts}}}',PILOT]));
 need(p.id===PILOT&&p.name==='/faolla-attendance-pilot-db'&&p.image==='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d'&&p.running===true&&
  p.network==='none'&&p.privileged===false&&!Object.keys(p.ports??{}).length&&p.labels?.['com.docker.compose.project']==='faolla-attendance-pilot'&&
  p.labels?.['io.faolla.isolated-pilot']==='attendance-pilot-20261009'&&p.mounts?.length&&p.mounts.every(m=>m.Type==='bind'&&m.Source.startsWith('/opt/faolla-attendance-pilot/')&&!m.Source.includes('/../'))&&
  p.mounts.some(m=>m.Source==='/opt/faolla-attendance-pilot/runtime/db/data'&&m.RW===true),'pilot_identity');return p;
}
function pgArgs(database){need(database==='postgres'||/^faolla_booking_activation_[a-f0-9]{16}$/.test(database),'database_name');return ['exec','-i',PILOT,'sh','-lc',
 'set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -h 127.0.0.1 -U supabase_admin -d '+database+' --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'];}
const pg=(db,sql)=>run('docker',pgArgs(db),{input:sql,timeout:55000}).trim();
function pgAsync(db,sql){const child=spawn('docker',pgArgs(db),{env:env(),stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});child.stdin.end(sql);
 const promise=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0&&!signal?resolve(stdout.trim()):reject(Error('booking_native_async_sql_unconfirmed')));});
 promise.catch(()=>{});return {child,promise,stderr:()=>stderr};}
const snapshot=db=>JSON.parse(pg(db,bookingHandoffActivationSnapshotSql));
const rows=db=>JSON.parse(pg(db,"begin read only;select jsonb_agg(to_jsonb(p) order by id) from public.pages p;rollback;"));
export function bookingNativeConfigText(c,phase,gated){need(['baseline','armed','primary','rollback'].includes(phase),'routing_phase');const target=phase==='baseline'||phase==='armed'?BASELINE:phase==='primary'?CANDIDATE:APPLICATION,
 port=target===BASELINE?c.ports.baseline:target===CANDIDATE?c.ports.primary:c.ports.rollback;
 return `user root;working_directory ${c.directory};pid ${c.directory}/nginx.pid;error_log ${c.directory}/nginx-error.log;worker_processes 1;events {worker_connections 64;}
http {${c.lua.join('\n')}access_log off;server {listen 127.0.0.1:${c.ports.ingress};server_name localhost;${gated?bookingIngressSnippet(c.window):''}
location / {proxy_pass http://127.0.0.1:${port};proxy_set_header Connection close;}}}`;
}
function reload(c,phase,gated){ownedCase(c.directory);const file=c.directory+'/nginx.conf',before=fs.readFileSync(file,'utf8'),after=bookingNativeConfigText(c,phase,gated);
 write(c.directory+'/nginx-'+randomUUID()+'.before',before);fs.writeFileSync(file,after,{mode:0o600});const master=json(c.directory+'/nginx-process.json');need(alive(master),'nginx_identity');
 run(NGINX,['-p',c.directory+'/', '-c',file,'-t']);run(NGINX,['-p',c.directory+'/', '-c',file,'-s','reload']);
}
async function probe(c,uri='/api/app-web-version',method='GET'){
 const r=await fetch('http://127.0.0.1:'+c.ports.ingress+uri,{method,headers:{Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(1500)});return {status:r.status,value:await r.json()};
}
async function until(predicate,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}need(false,'condition_timeout');}
function launch(role,directory,{fd}={}){ownedCase(directory);const output=fs.openSync(directory+'/'+role+'-'+randomUUID()+'.log',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{return spawn('/usr/bin/node',[FILE,role,directory],{cwd:directory,env:env(),detached:role==='watchdog'||role==='worker',stdio:['ignore',output,output,...(fd===undefined?[]:[fd])]});}
 finally{fs.closeSync(output);}}
async function spawned(child){await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});return fact(child.pid);}
function assertFd(c){need(fs.readlinkSync('/proc/self/fd/3')===c.directory+'/deploy.lock','inherited_fd');const s=fs.fstatSync(3),t=fs.lstatSync(c.directory+'/deploy.lock');
 equal([s.dev,s.ino,s.uid,s.mode,s.nlink],[t.dev,t.ino,0,0o100600,1],'inherited_inode');
 const contender=spawnSync('flock',['--nonblock',c.directory+'/deploy.lock','/usr/bin/true'],{env:env(),timeout:2000});need(contender.status===1,'kernel_lock_not_held');}
async function pauseFixture(c){
 const file=c.directory+'/legacy.json',before=json(file);if(before.paused){need(before.restarts===1&&alive(before.process),'legacy_paused_identity');return {confirmed:true,attempted:false};}
 need(before.restarts===0&&!fs.existsSync(c.directory+'/legacy-restart-attempt.json'),'fixture_restart_replay');write(c.directory+'/legacy-restart-attempt.json',{before,at:now()});
 await stop(before.process);const child=launch('worker',c.directory),after=await spawned(child);child.unref();
 fs.writeFileSync(file,JSON.stringify({paused:true,restarts:1,process:after}),{mode:0o600});need(alive(after),'legacy_restart_missing');return {confirmed:true,attempted:true};
}
async function childWeb(role,c){
 const key=role.slice(4),target=key==='primary'?CANDIDATE:key==='rollback'?APPLICATION:BASELINE;
 const server=createServer((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fixture:true,ok:true,buildId:target,path:req.url}));});
 await new Promise(r=>server.listen(c.ports[key],'127.0.0.1',r));await new Promise(()=>{});
}
async function watchdog(c){
 assertFd(c);const parent=json(c.directory+'/controller.json'),self=fact(process.pid);write(c.directory+'/watchdog.json',self);
 const started=process.hrtime.bigint(),elapsed=Date.now()-Date.parse(c.window.startedAt);
 await runBookingWatchdogSequence({verify:()=>{ownedCase(c.directory);assertFd(c);},armed:()=>write(c.directory+'/watchdog-armed.json',{process:self,at:now()}),
  completed:()=>{if(!fs.existsSync(c.directory+'/worker-enabled.json'))return false;const gate=json(c.directory+'/worker-enabled.json');return gate.completed===true&&gate.target===CANDIDATE&&fs.existsSync(c.directory+'/journal-completed.json');},
  parentState:()=>alive(parent)?'owned':'absent',elapsedMs:()=>elapsed+Number((process.hrtime.bigint()-started)/1000000n),wait,stopOwnedParent:()=>stop(parent),
  recover:async()=>{
   const legacy=json(c.directory+'/legacy.json'),before=c.before;let database;
   const receipt=await executeBookingFailureRecoverySequence({verify:()=>assertFd(c),parentGone:()=>need(!alive(parent),'controller_alive'),now,
    capture:()=>({configurationSha256:hash(fs.readFileSync(c.directory+'/nginx.conf')),legacy}),
    databaseBarrier:()=>{const value=JSON.parse(pg(c.database,BOOKING_RECOVERY_BARRIER_SQL));need(value.systemIdentifier===before.systemIdentifier&&value.databaseOid===before.databaseOid&&value.serverVersionNum==='150008','barrier_actual_identity');
     database={...value,barrierCompleted:true,activationAttempted:fs.existsSync(c.directory+'/activation-attempt.json'),activationCommitted:fs.existsSync(c.directory+'/activation.json'),originalRowsUntouched:value.savedBookingRowsSha256===before.savedBookingRowsSha256};return database;},
    legacyState:()=>({paused:legacy.paused,originalIntact:!legacy.paused&&legacy.restarts===0&&alive(legacy.process)}),begin:a=>write(c.directory+'/recovery-attempt.json',a),
    disableBookingWorker:()=>need(!fs.existsSync(c.directory+'/worker-enabled.json'),'unexpected_completed_gate'),pauseLegacyOnce:()=>pauseFixture(c),
    route:phase=>reload(c,phase==='baseline'?'baseline':'rollback',true),unfence:()=>reload(c,database.active?'rollback':'baseline',false),
    publicProof:async phase=>{const target=phase==='baseline'?BASELINE:APPLICATION;await until(async()=>{const p=await probe(c);return p.status===200&&p.value.buildId===target;});return [{status:200,buildId:target}];},
    publicationMetadata:phase=>write(c.directory+'/recovered-publication.json',{phase,at:now()}),persistProcesses:()=>write(c.directory+'/recovered-processes.json',{legacy:json(c.directory+'/legacy.json'),at:now()}),
    complete:r=>write(c.directory+'/recovery.json',r),
   },{window:c.window});return receipt;
  },finish:(outcome,recovery)=>write(c.directory+'/watchdog-finished.json',{outcome,recovery,completedAt:now()}),
 });
}
async function controller(c){
 assertFd(c);write(c.directory+'/controller.json',fact(process.pid));let watchdogProcess;
 await executeBookingHandoffHost({nowMs:()=>Date.now(),admit:()=>{ownedCase(c.directory);assertFd(c);},preflight:()=>equal(snapshot(c.database),c.before,'preflight_actual'),plans:()=>c.window,
  arm:async()=>{const child=launch('watchdog',c.directory,{fd:3});watchdogProcess=await spawned(child);child.unref();await until(()=>fs.existsSync(c.directory+'/watchdog-armed.json'));return watchdogProcess;},
  gateAndDrain:()=>executeBookingIngressDrain({now,nowMs:()=>Date.now(),authorize:()=>{assertFd(c);need(alive(watchdogProcess),'watchdog_dead');},
   workers:()=>{const master=json(c.directory+'/nginx-process.json');const children=fs.readFileSync('/proc/'+master.pid+'/task/'+master.pid+'/children','utf8').trim().split(/\s+/).filter(Boolean).map(Number);return children.map(fact);},
   begin:a=>write(c.directory+'/ingress-attempt.json',a),install:()=>reload(c,'baseline',true),syntax:()=>{},reload:()=>{},
   probeGate:async()=>{await until(async()=>{const p=await probe(c,'/api/bookings');return p.status===503&&p.value.operation===c.window.id;});
    for(const [method,uri]of [['POST','/api/publish'],['POST','/api/personal-guest-merge']])need((await probe(c,uri,method)).status===503,'gate_endpoint');
    for(const uri of ['/login','/api/orders','/api/merchant-enterprise/attendance'])need((await probe(c,uri)).status===200,'unrelated_blocked');},
   drain:workers=>{const sockets=parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']));return {oldWorkersRemaining:workers.filter(p=>{
    try{const current=fact(p.pid);return current.state!=='Z'&&current.startTicks===p.startTicks;}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return false;throw e;}
   }).length,applicationConnections:sockets.established.filter(s=>[c.ports.baseline,c.ports.primary,c.ports.rollback].includes(s.localPort)).length};},wait,
   automation:()=>{const all=rows(c.database),records=all.find(p=>p.slug==='__merchant_booking_records__:v1').blocks.records,
    directory='/www/wwwroot/merchant-space.web-releases/'+CANDIDATE.slice(0,12)+'-online',input={publishedRows:[],publishedAt:{},records,settings:{},observedAt:now(),throughAt:c.window.deadlineAt};
    const raw=run('/usr/bin/node',['--input-type=module','-e',BOOKING_HANDOFF_PURE_PROBE],{cwd:directory,input:JSON.stringify(input),env:{PATH:'/usr/bin:/bin',HOME:'/root',NODE_ENV:'test',TSX_TSCONFIG_PATH:directory+'/tsconfig.json'},timeout:15000});
    const actual=JSON.parse(raw.trim());need(actual.automationEligibleRecords===0,'actual_synthetic_automation');return {...actual,datasetSha256:hash(JSON.stringify(all))};},complete:r=>write(c.directory+'/drain.json',r),
  },{window:c.window}),armCompatibleFallback:()=>reload(c,'armed',true),
  activate:async()=>{
   write(c.directory+'/activation-attempt.json',{before:c.before,at:now()});const statement=isolatedBookingRepairActivationAcceptanceSql({before:c.before,databaseName:c.database,plan:c.plan,backupSealSha256:hash(read(c.directory+'/original-rows.json'))});
   if(c.name==='controller-death-before-commit'){
    const command=pgAsync(c.database,statement.replace(/commit;$/,'select pg_sleep(2);rollback;'));command.child.unref();
    await until(()=>pg(c.database,"begin read only;select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep';rollback;")==='1');
    write(c.directory+'/actual-uncommitted-transaction-observed.json',{at:now()});process.kill(process.pid,'SIGKILL');await new Promise(()=>{});
   }
   const output=pg(c.database,statement).split(/\r?\n/);need(output.length===2,'isolated_receipts');const activation=JSON.parse(output[0]),repair=JSON.parse(output[1]);
   equal(activation.before,{...c.before,savedBookingRowsSha256:repair.afterSavedRowsSha256},'isolated_before_rebased');equal(activation.after,{...activation.before,active:true},'isolated_transition');
   equal(snapshot(c.database),activation.after,'isolated_commit_read');write(c.directory+'/activation.json',activation);write(c.directory+'/repair.json',repair);
   if(c.name==='controller-death-after-commit'){write(c.directory+'/actual-committed-transaction-observed.json',{at:now()});process.kill(process.pid,'SIGKILL');await new Promise(()=>{});}
  },pauseOriginalOnce:()=>pauseFixture(c),routePrimary:()=>reload(c,'primary',true),unfence:()=>reload(c,'primary',false),
  publication:async()=>{await until(async()=>{const p=await probe(c);return p.status===200&&p.value.buildId===CANDIDATE;});write(c.directory+'/publication.json',{target:CANDIDATE,at:now()});},
  // Native IO evidence, NOT a fabricated production retention certificate. The
  // actual five-file certificate validator is separately tested with its strict
  // predecessor contract, and the real host runs it before its worker gate.
  journal:()=>{for(const name of ['prepared','before','recovery-pm2','after','certificate'])write(c.directory+'/journal-'+name+'.json',{fixture:true,phase:name,database:snapshot(c.database),at:now()});write(c.directory+'/journal-completed.json',{files:5});},
  worker:()=>write(c.directory+'/worker-enabled.json',{completed:true,target:CANDIDATE,at:now()}),
  finishSupervisor:async()=>{await until(()=>fs.existsSync(c.directory+'/watchdog-finished.json'));need(json(c.directory+'/watchdog-finished.json').outcome==='committed','normal_watchdog');await until(()=>!alive(watchdogProcess));},
 });write(c.directory+'/controller-completed.json',{completed:true,at:now()});
}
async function seed(database){
 need(/^faolla_booking_activation_[a-f0-9]{16}$/.test(database),'seed_database');pg('postgres',`create database "${database}" with template template0 owner supabase_admin;`);
 pg(database,`create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.faolla_schema_migrations(version bigint primary key,name text not null);
insert into public.faolla_schema_migrations select n,'synthetic-registry-'||n from generate_series(1,209) n;
grant usage on schema public to service_role;grant select,insert,update,delete on public.pages to service_role;
create function public.set_current_timestamp_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_current_timestamp_updated_at();`);
 const records={version:1,records:Array.from({length:17},(_,i)=>({id:'synthetic-'+i,siteId:'12345678',status:'completed',createdAt:'2026-05-01T00:00:00Z'}))},
  rules={version:1,snapshots:Object.fromEntries([['12345678',3],['87654321',6]].map(([id,count])=>[id,{version:1,siteId:id,publishedAt:'2026-05-01T00:00:00Z',
   entries:Array.from({length:count},()=>({viewport:'desktop',blockId:'synthetic-booking',availableTimeRanges:['10:00-11:00'],timeSlotRules:[],blockedDates:[],holidayDates:[],maxBookingsPerSlot:null}))}]))};
 const quote=v=>"'"+v.replaceAll("'","''")+"'";
 for(const [tenant,slug,blocks]of [['__faolla_booking_persistence__','__merchant_booking_records__:v1',records],['__faolla_booking_persistence__','__merchant_booking_rules__:v1',rules],
  ['__faolla_booking_persistence__','__merchant_booking_rules__:v1:backup',{version:1,snapshots:{}}],['__faolla_booking_persistence__','__merchant_booking_workbench__:v1',{version:1,settingsBySiteId:{}}],
  ['12345678',null,[]],['87654321',null,[]],['unrelated','ordinary-page',[{preserved:true}]]])
  pg(database,`insert into public.pages(merchant_id,slug,blocks,created_at,updated_at) values(${quote(tenant)},${slug===null?'null':quote(slug)},${quote(JSON.stringify(blocks))}::jsonb,'2026-05-01T00:00:00Z','2026-05-01T00:00:00Z');`);
 for(const name of ['202610250211_booking_atomic_preparation.sql','202610250212_booking_atomic_runtime.sql']){
  const source=fs.readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8');need(hash(source.replaceAll('\r\n','\n'))===BOOKING_SCOPE.pins['scripts/supabase-migrations/'+name],'migration_source');pg(database,source);
 }
 const initial=JSON.parse(pg(database,"begin read only;select jsonb_agg(jsonb_build_object('row',to_jsonb(p),'rowSha256',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')) order by id) from public.pages p;rollback;")),
  rule=initial.find(p=>p.row.slug==='__merchant_booking_rules__:v1'),published=initial.filter(p=>['12345678','87654321'].includes(p.row.merchant_id));
 const plan=planBookingRuleOptionRepair({rulesRow:{...rule.row,rowSha256:rule.rowSha256},publishedRows:published.map(p=>({...p.row,rowSha256:p.rowSha256})),buildSnapshot:id=>{
  const next=structuredClone(rules.snapshots[id]);for(const e of next.entries)Object.assign(e,{storeOptions:['A','B','C'],itemOptions:['1','2','3','4','5'],titleOptions:['Ms','Mr']});return next;}});
 return {before:snapshot(database),plan,initial:initial.map(p=>p.row)};
}
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function production(){
 const daemon=Number(fs.readFileSync('/root/.pm2/pm2.pid','utf8').trim());need(fs.readFileSync('/proc/'+daemon+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','formal_daemon');
 const all=JSON.parse(run('/usr/bin/node',['/usr/lib/node_modules/pm2/bin/pm2','jlist']));
 const files=['/var/lib/faolla-online-release/active.json','/www/server/nginx/conf/nginx.conf','/www/server/panel/vhost/nginx/www.faolla.com.conf',
  ...['e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf','no_store_entries_www.faolla.com.conf','faolla_contact_card_release.conf'].map(f=>'/www/server/panel/vhost/nginx/proxy/www.faolla.com/'+f)];
 return {daemon:binding(fact(daemon)),processes:all.map(p=>({name:p.name,pid:p.pid,status:p.pm2_env.status,restarts:p.pm2_env.restart_time,cwd:p.pm2_env.pm_cwd,environmentSha256:hash(JSON.stringify(p.pm2_env.env))})),
  files:Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(f))])),current:fs.realpathSync('/www/wwwroot/merchant-space.current'),
  registry:bookingHostSql("begin read only;select encode(sha256(convert_to(jsonb_agg(to_jsonb(m) order by version)::text,'UTF8')),'hex') from public.faolla_schema_migrations m;rollback;")};
}
async function nativeMain(){
 need(process.argv.length===2,'arguments');const directory=path.dirname(path.dirname(FILE)),toolRevision=path.basename(directory);
 need(directory==='/var/lib/faolla-online-code/'+toolRevision&&/^[a-f0-9]{40}$/.test(toolRevision),'prepared_source');verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
 pilotIdentity();const formal=production(),root=fs.mkdtempSync('/var/lib/faolla-booking-full-rehearsal-');fs.chmodSync(root,0o700);fs.mkdirSync(root+'/cases',{mode:0o700});
 const sourceHashes=Object.fromEntries(BOOKING_HANDOFF_NATIVE_SOURCES.map(f=>[f,hash(fs.readFileSync(new URL('./'+f,import.meta.url)))]));
 write(root+'/owner.json',{kind:'booking-full-native-isolated-owner',root,sourceSha256:sourceHashes['booking-handoff-native-acceptance.mjs'],toolRevision,productionBefore:formal,sourceHashes});
 const results=[];let postgresSystemIdentifier;
 for(const name of CASES){
  const runtime=root+'/runtime-'+name;fs.mkdirSync(runtime,{mode:0o700});let children=[],nginx,controllerProcess;const started=Date.now();
  try{
   const database='faolla_booking_activation_'+randomBytes(8).toString('hex'),seeded=await seed(database);postgresSystemIdentifier=seeded.before.systemIdentifier;
   need(seeded.before.serverVersionNum==='150008'&&postgresSystemIdentifier!=='7612049595342295079','actual_pg15');write(runtime+'/original-rows.json',seeded.initial);
   const ports={};for(const key of ['baseline','primary','rollback','ingress'])ports[key]=await freePort();need(new Set(Object.values(ports)).size===4,'ports');
   const lua=fs.readFileSync('/www/server/nginx/conf/nginx.conf','utf8').split(/\r?\n/).filter(l=>/^\s*lua_package_(?:c?path)\s+/.test(l));need(lua.length>=1&&lua.length<=2&&lua.every(l=>!l.includes('$')&&/;\s*$/.test(l)),'lua_paths');
   const window={id:randomUUID(),startedAt:now(),deadlineAt:new Date(Date.now()+600000).toISOString()};
   // Exact ten-minute duration, with no fixture timing override of the seven-
   // minute production supervisor. Failure cases trigger by actual parent death.
   window.deadlineAt=new Date(Date.parse(window.startedAt)+600000).toISOString();
   const c={name,root,directory:runtime,sourceSha256:sourceHashes['booking-handoff-native-acceptance.mjs'],database,before:seeded.before,plan:seeded.plan,ports,lua,window};write(runtime+'/owner.json',c);
   for(const role of ['web-baseline','web-primary','web-rollback','worker']){const child=launch(role,runtime),f=await spawned(child);children.push(f);if(role==='worker')write(runtime+'/legacy.json',{process:f,paused:false,restarts:0});}
   write(runtime+'/nginx.conf',bookingNativeConfigText(c,'baseline',false));run(NGINX,['-p',runtime+'/', '-c',runtime+'/nginx.conf','-t']);
   const child=spawn(NGINX,['-p',runtime+'/', '-c',runtime+'/nginx.conf','-g','daemon off;'],{cwd:runtime,env:env(),stdio:'ignore'});await spawned(child);
   await until(()=>fs.existsSync(runtime+'/nginx.pid'));nginx=fact(Number(fs.readFileSync(runtime+'/nginx.pid','utf8').trim()));need(nginx.pid===child.pid&&nginx.executable===NGINX,'fixture_nginx_master');write(runtime+'/nginx-process.json',nginx);children.push(nginx);
   await until(async()=>{try{return (await probe(c)).value.buildId===BASELINE;}catch{return false;}});
   const fd=fs.openSync(runtime+'/deploy.lock',fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);run('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd]});
   let controller;try{controller=launch('controller',runtime,{fd});controllerProcess=await spawned(controller);children.push(controllerProcess);}finally{fs.closeSync(fd);}
   const ended=new Promise(resolve=>controller.once('exit',(code,signal)=>resolve({code,signal})));
   await until(()=>fs.existsSync(runtime+'/watchdog-armed.json'));const supervisor=json(runtime+'/watchdog.json');children.push(supervisor);
   need(fs.readlinkSync('/proc/'+supervisor.pid+'/fd/3')===runtime+'/deploy.lock','actual_inherited_fd');
   need(spawnSync('flock',['--nonblock',runtime+'/deploy.lock','/usr/bin/true'],{timeout:2000}).status===1,'actual_kernel_lock');
   const exit=await ended;if(name==='normal')need(exit.code===0&&!exit.signal,'normal_controller_exit');else need(exit.signal==='SIGKILL','induced_controller_death');
   if(name!=='normal'){need(!alive(controllerProcess),'controller_not_dead');need(spawnSync('flock',['--nonblock',runtime+'/deploy.lock','/usr/bin/true'],{timeout:2000}).status===1,'lock_not_inherited_after_death');}
   await until(()=>fs.existsSync(runtime+'/watchdog-finished.json'),170000);await until(()=>!alive(supervisor));const finished=json(runtime+'/watchdog-finished.json');
   need(finished.outcome===(name==='normal'?'committed':'recovered-failure'),'watchdog_outcome');
   const actual=snapshot(database),after=rows(database),oldRule=seeded.initial.find(p=>p.id===seeded.plan.rowId),newRule=after.find(p=>p.id===oldRule.id);
   if(name==='controller-death-before-commit'){need(actual.active===false,'uncommitted_authority');equal(after,seeded.initial,'uncommitted_rows_not_rolled_back');need(finished.recovery.target===BASELINE,'inactive_recovery_target');}
   else{need(actual.active===true,'committed_authority');equal(newRule.blocks,seeded.plan.next,'repaired_options');equal({...newRule,blocks:oldRule.blocks,updated_at:oldRule.updated_at},oldRule,'only_approved_audit_and_blocks');
    equal(after.filter(p=>p.id!==oldRule.id),seeded.initial.filter(p=>p.id!==oldRule.id),'other_rows_preserved');need(json(runtime+'/legacy.json').restarts===1,'single_fixture_restart');
    if(name!=='normal')need(finished.recovery.target===APPLICATION,'active_recovery_target');}
   need(after.find(p=>p.slug==='__merchant_booking_records__:v1').blocks.records.length===17,'records_preserved');
   const expected=name==='normal'?CANDIDATE:name==='controller-death-before-commit'?BASELINE:APPLICATION,p=await probe(c);need(p.status===200&&p.value.buildId===expected,'public_target');
   need(!fs.readFileSync(runtime+'/nginx.conf','utf8').includes('faolla_booking_handoff'),'gate_not_closed');
   const finalLegacy=json(runtime+'/legacy.json');if(!children.some(f=>f.pid===finalLegacy.process.pid))children.push(finalLegacy.process);
   for(const f of [...children].reverse())await stop(f);need(children.every(f=>!alive(f)),'process_leak');
   need(spawnSync('flock',['--nonblock',runtime+'/deploy.lock','/usr/bin/true'],{timeout:2000}).status===0,'kernel_lock_not_released');
   equal(production(),formal,'production_changed');const receipt={name,completed:true,elapsedMs:Date.now()-started,inheritedKernelLock:true,realNginx:true,realPostgres:true,realProcesses:true,ownedFixturesOnly:true,
    actualDatabase:{name:database,...actual},rowsPreserved:true,optionsRepaired:name!=='controller-death-before-commit',gateClosed:true,target:expected,controllerExit:exit,watchdog:finished,allFixturesStopped:true,completedAt:now()};
   need(receipt.elapsedMs>0&&receipt.elapsedMs<=600000,'actual_window_exceeded');const receiptFile=root+'/cases/'+name+'.json';write(receiptFile,receipt);results.push({name,completed:true,elapsedMs:receipt.elapsedMs,inheritedKernelLock:true,realNginx:true,realPostgres:true,realProcesses:true,ownedFixturesOnly:true,receiptFile,receiptSha256:hash(read(receiptFile))});
  }finally{
   // Stop the two possible controllers first, so cleanup cannot race another
   // fixture routing write or restart. Never enumerate-and-kill other apps.
   for(const file of ['controller.json','watchdog.json']){try{await stop(json(runtime+'/'+file));}catch(e){if(e.code!=='ENOENT')throw e;}}
   try{const legacy=json(runtime+'/legacy.json');if(!children.some(f=>f.pid===legacy.process.pid))children.push(legacy.process);}catch(e){if(e.code!=='ENOENT')throw e;}
   for(const f of [...children].reverse())await stop(f);
  }
 }
 equal(production(),formal,'production_changed');for(const [file,digest]of Object.entries(sourceHashes))need(hash(fs.readFileSync(new URL('./'+file,import.meta.url)))===digest,'source_changed');
 const report={schemaVersion:1,kind:'booking-full-native-handoff-acceptance',toolRevision,candidate:CANDIDATE,rollback:APPLICATION,productionMutated:false,originalTimerMutated:false,mailEnabled:false,
  postgresServerVersionNum:'150008',postgresSystemIdentifier,allFixturesStopped:true,cases:results,sourceHashes,activationBodySha256:BOOKING_ACTIVATION_BODY_SHA256,
  scope:'shared handoff/watchdog/recovery sequences with real isolated IO; production-specific attesters and certificate validation remain mandatory on the real host',completedAt:now()};
 write(root+'/acceptance.json',report);write(ROOT+'/native-handoff-acceptance.json',report);console.log(JSON.stringify({kind:report.kind,root,cases:results.map(c=>({name:c.name,elapsedMs:c.elapsedMs})),productionMutated:false,allFixturesStopped:true}));
}
async function main(){
 need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');
 if(process.argv.length===2)return nativeMain();need(process.argv.length===4,'child_arguments');const role=process.argv[2],c=ownedCase(process.argv[3]);
 need(['controller','watchdog','worker','web-baseline','web-primary','web-rollback'].includes(role),'child_role');
 if(role.startsWith('web-'))return childWeb(role,c);if(role==='worker')return new Promise(()=>{setInterval(()=>{},1000);});
 if(role==='watchdog')return watchdog(c);return controller(c);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error('booking_native_acceptance_unconfirmed_evidence_preserved');process.exitCode=1;});
