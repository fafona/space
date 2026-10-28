// CI ONLY. Real pinned Next -> real private PM2 -> the unchanged production
// connect-only restart framing -> actual /proc and manager-log validation.
// Does not fabricate production PIDs, change production helper allowlists,
// contact a formal daemon, or claim the rest of the publication chain passed.
import * as fs from'node:fs';import path from'node:path';import net from'node:net';
import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import{randomBytes,randomUUID,createHash}from'node:crypto';import assert from'node:assert/strict';
import{BOOKING_HANDOFF_PM2_PROVENANCE as FRAMEWORK,assertBookingHandoffWindow}from'./booking-handoff-policy.mjs';
import{normalizeRetirementProcess,parseRetirementSockets}from'./online-release-retirement.mjs';import{bookingLegacyRpcExpected}from'./booking-handoff-legacy.mjs';
import{capturePm2TerminationAnchor,inspectPm2SigintTermination,assertManagedPauseEnvironmentTransition}from'./release-toolchain-pm2-transition.mjs';
import{stageFailureDiagnostic}from'./release-toolchain-diagnostics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),need=(v,c)=>{if(!v)throw Error('equivalence_'+c);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),ANCHORS=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
need(process.platform==='linux'&&process.getuid?.()===0&&process.version==='v20.20.1'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&process.argv.length===2&&!ANCHORS.some(f=>fs.existsSync(f)),'ci_only');
const revision=path.basename(source);need(/^[a-f0-9]{40}$/.test(revision)&&source==='/var/lib/faolla-online-code/'+revision,'source');
const application='/var/lib/faolla-release-toolchain-application-'+revision,npmCli=process.env.FAOLLA_EQ_NPM_CLI;
need(typeof npmCli==='string'&&path.isAbsolute(npmCli)&&fs.realpathSync(npmCli)===npmCli&&npmCli.endsWith('/npm/bin/npm-cli.js'),'npm');
const root=fs.mkdtempSync('/var/lib/faolla-eq-');fs.chmodSync(root,0o700);const home=root+'/pm2',release=root+'/app',name='eq-next';
for(const d of [home,release,release+'/node_modules',release+'/pages',release+'/scripts',root+'/reports'])fs.mkdirSync(d,{mode:0o700});
const env={PATH:'/usr/bin:/bin',HOME:root,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',PM2_HOME:home,NODE_OPTIONS:'',NODE_PATH:'',PM2_NODE_OPTIONS:'',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',FAOLLA_RELEASE_PRODUCTION_EQ:'1',NEXT_TELEMETRY_DISABLED:'1',DEBUG:'next:start-server'};
const run=(bin,args,input,timeout=30000,cwd=root)=>{const r=spawnSync(bin,args,{input,encoding:'utf8',env,cwd,timeout,killSignal:'SIGKILL',maxBuffer:2*1024**2,windowsHide:true});
 if(r.error||r.signal||r.status!==0){seal('command-failure.json',{kind:'ci-only-synthetic-command-failure',stage,program:path.basename(bin),action:args[1]??args[0],cwd,exitCode:r.status,signal:r.signal,errorCode:r.error?.code??null,stdout:String(r.stdout??'').slice(0,16384),stderr:String(r.stderr??'').slice(0,16384),syntheticInputsOnly:true});need(false,'command');}return r.stdout;};
const seal=(name,value)=>{const f=root+'/reports/'+name,fd=fs.openSync(f,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const bridge=String.raw`import importlib.util,json,os,socket,sys,time
v=json.loads(sys.stdin.buffer.read(524289))
if os.getuid()!=0 or os.environ.get('FAOLLA_RELEASE_PRODUCTION_EQ')!='1' or os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted' or any(os.path.exists(x) for x in ['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current']): raise RuntimeError('ci_only')
s=importlib.util.spec_from_file_location('fixed_pause',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
if v['action']=='identity': result=m._peer._read_daemon_identity(v['pid'])
else:
 p=v['socket'];r=v['root'];st=os.lstat(r)
 if not r.startswith('/var/lib/faolla-eq-') or os.path.realpath(r)!=r or st.st_uid!=0 or st.st_mode&0o777!=0o700 or p!=r+'/pm2/rpc.sock': raise RuntimeError('scope')
 d=m._peer._validate_expected(v['daemon']);chain=m._peer._path_chain(p,0)
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
  deadline=time.monotonic()+30;c.settimeout(30);c.connect(p);session=m._Session(c,d,p,chain,deadline)
  if session.call('getVersion',{})!='6.0.14': raise RuntimeError('version')
  rows=session.call('getMonitorData',{})
  if v['action']=='registry': result=rows
  elif v['action']=='restart':
   t=v['expected'];matched=[x for x in rows if x.get('name')=='eq-next' or x.get('pm_id')==0]
   if len(matched)!=1: raise RuntimeError('target')
   row=matched[0];e=row['pm2_env'];snap={'name':row['name'],'pid':row['pid'],'pm_id':row['pm_id'],'pm2_env':{k:e.get(k,False if k=='shutdown_with_message' else None) for k in m._FIELDS}}
   if snap!=t or t['name']!='eq-next' or t['pm_id']!=0 or e['pm_cwd']!=r+'/app' or e['pm_exec_path']!=r+'/app/node_modules/next/dist/bin/next' or e['env'].get('FAOLLA_BACKGROUND_JOBS_PAUSED')!='0': raise RuntimeError('stale_target')
   m._control._check_target_process(v['process'],d)
   ack=session.call('restartProcessId',m._ARGUMENT,mutation=True)
   if type(ack) not in (dict,list) or type(ack) is dict and ack.get('error'): raise RuntimeError('ack')
   result={'acknowledged':True,'sharedProductionFraming':True}
  else: raise RuntimeError('action')
print(json.dumps(result,separators=(',',':')))
`;
function python(value,{reject=false}={}){const r=spawnSync('/usr/bin/python3',['-I','-S','-B','-c',bridge,source+'/scripts/booking-handoff-pm2-pause.py'],{cwd:root,env,input:JSON.stringify(value),encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:2*1024**2});if(reject){need(r.status!==0&&!r.error&&!r.signal,'expected_refusal');return;}need(r.status===0&&!r.error&&!r.signal&&r.stderr==='','peer_transport');return JSON.parse(r.stdout);}
let daemon,stage='prepare',passed=false;const owned=new Map();
function fact(pid){const s=fs.readFileSync('/proc/'+pid+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/);need(fs.lstatSync('/proc/'+pid).uid===0&&f[0]!=='Z','process');return{pid,startTicks:f[19],parentPid:Number(f[1]),cwd:fs.realpathSync('/proc/'+pid+'/cwd'),executable:fs.realpathSync('/proc/'+pid+'/exe')};}
function alive(p){try{const now=fact(p.pid);assert.deepEqual(Object.fromEntries(['pid','startTicks','cwd','executable'].map(k=>[k,now[k]])),Object.fromEntries(['pid','startTicks','cwd','executable'].map(k=>[k,p[k]])));return true;}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH'||e.message==='equivalence_process')return false;throw e;}}
function assertDaemon(){need(daemon&&alive(daemon)&&fs.readFileSync('/proc/'+daemon.pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon ('+home+')','daemon_identity');}
function privateAppProcesses(){const found=[];for(const entry of fs.readdirSync('/proc')){if(!/^[1-9][0-9]*$/.test(entry))continue;const pid=Number(entry);try{if(fs.realpathSync('/proc/'+pid+'/cwd')!==release)continue;const p=fact(pid);need(p.executable==='/usr/bin/node','fixture_app_executable');found.push(p);}catch(error){if(['ENOENT','ESRCH','EACCES'].includes(error.code))continue;throw error;}}return found;}
const registry=()=>{assertDaemon();const r=python({action:'registry',daemon:daemonPeer,root,socket:home+'/rpc.sock'});need(Array.isArray(r)&&r.length<=2,'registry');for(const row of r.filter(p=>p.pid>0)){const f=fact(row.pid);need(f.parentPid===daemon.pid&&f.cwd===release&&f.executable==='/usr/bin/node','child_identity');owned.set(row.pid,f);}return r;};
const raw=pid=>Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const manager=p=>({exitCode:p.exit_code??null,nodeVersion:p.node_version??null,version:p.version??null,previousRestartDelay:p.prev_restart_delay??null,unstableRestarts:p.unstable_restarts??null});
let daemonPeer;
async function ready(port){for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+port,{headers:{Connection:'close'},signal:AbortSignal.timeout(500)});await r.arrayBuffer();if(r.status===200)return;}catch{}await sleep(100);}throw Error('equivalence_health');}
function applicationConnections(port){return parseRetirementSockets('',run('/usr/bin/ss',['-tnpH'])).established.filter(s=>s.localPort===port);}
try{
 for(const n of fs.readdirSync(application+'/node_modules')){if(n==='next')fs.cpSync(application+'/node_modules/next',release+'/node_modules/next',{recursive:true});else fs.symlinkSync(application+'/node_modules/'+n,release+'/node_modules/'+n);}
 need(JSON.parse(fs.readFileSync(release+'/node_modules/next/package.json','utf8')).version==='16.3.4','next_version');
 fs.writeFileSync(release+'/pages/index.js',"export default function Page(){return 'Real Next process fixture';}\n",{mode:0o600,flag:'wx'});fs.writeFileSync(release+'/package.json','{"name":"private-next-equivalence","private":true}\n',{mode:0o600,flag:'wx'});
 stage='real-next-build';run('/usr/bin/node',[release+'/node_modules/next/dist/bin/next','build','--webpack'],undefined,120000,release);
 stage='pinned-pm2-install';run('/usr/bin/node',[npmCli,'install','--prefix',root+'/dependencies','--cache',root+'/cache','--registry=https://registry.npmjs.org','--ignore-scripts','--no-audit','--no-fund','pm2@6.0.14'],undefined,180000);
 const pm2=root+'/dependencies/node_modules/pm2';need(JSON.parse(fs.readFileSync(pm2+'/package.json','utf8')).version==='6.0.14','pm2_version');
 const framework={nodeVersion:process.version,managerVersion:'6.0.14',frameworkSources:Object.fromEntries(Object.keys(FRAMEWORK.frameworkSources).map(f=>[f,sha(fs.readFileSync(pm2+'/'+f))]))};assert.deepEqual(framework,FRAMEWORK);
 stage='owned-daemon';run('/usr/bin/node',[pm2+'/bin/pm2','ping']);daemon=fact(Number(fs.readFileSync(home+'/pm2.pid','utf8').trim()));daemonPeer=python({action:'identity',pid:daemon.pid});assertDaemon();assert.deepEqual(registry(),[]);
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 fs.writeFileSync(release+'/scripts/unrelated.cjs',"setInterval(()=>{},1000);\n",{mode:0o600,flag:'wx'});
 const config={apps:[{name,script:release+'/node_modules/next/dist/bin/next',cwd:release,args:['start','-H','127.0.0.1','-p',String(port)],interpreter:'/usr/bin/node',exec_mode:'fork',watch:false,autorestart:true,kill_timeout:10000,env:{FAOLLA_BACKGROUND_JOBS_PAUSED:'0',NODE_ENV:'production',KEEP:'synthetic-only'}}]};
 const configFile=root+'/ecosystem.config.cjs';
 const common=(await import(pm2+'/lib/Common.js')).default;need(common.isConfigFile(configFile)==='js'&&common.isConfigFile(root+'/ecosystem.cjs')===null,'pm2_config_recognition');
 fs.writeFileSync(configFile,'module.exports='+JSON.stringify(config)+';\n',{mode:0o600,flag:'wx'});run('/usr/bin/node',[pm2+'/bin/pm2','start',configFile]);
 const started=registry();need(started.length===1&&started[0].name===name&&started[0].pm_id===0&&started[0].pm2_env.pm_cwd===release&&started[0].pm2_env.pm_exec_path===release+'/node_modules/next/dist/bin/next','started_real_next');await ready(port);
 run('/usr/bin/node',[pm2+'/bin/pm2','start',release+'/scripts/unrelated.cjs','--name','eq-unrelated','--cwd',release]);
 // Model the stable existing production host, not a process restarted within
 // PM2's pinned default min_uptime (1000ms), which increments unstable_restarts.
 const warming=registry().find(p=>p.name===name);need(warming&&[undefined,1000].includes(warming.pm2_env.min_uptime),'fixture_min_uptime');
 await sleep(Math.max(0,1500-(Date.now()-warming.pm2_env.pm_uptime)));
 for(let i=0;i<100&&applicationConnections(port).length;i++)await sleep(25);
 need(applicationConnections(port).length===0,'fixture_requests_not_drained');
 const rows=registry(),beforeRow=rows.find(p=>p.name===name),other=rows.find(p=>p.name==='eq-unrelated');need(beforeRow.pm_id===0&&beforeRow.pm2_env.status==='online'&&other?.pid>0,'initial_processes');
 need(Date.now()-beforeRow.pm2_env.pm_uptime>=1500&&beforeRow.pm2_env.unstable_restarts===0,'stable_initial_process');
 const beforeFact=fact(beforeRow.pid),beforeOther={row:other,raw:raw(other.pid),identity:fact(other.pid)},beforeRaw=raw(beforeRow.pid),before=normalizeRetirementProcess(beforeRow),anchor=capturePm2TerminationAnchor(home+'/pm2.log');
 const start=Date.now(),window={id:randomUUID(),startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()};
 stage='actual-peer-bound-restart';const request={action:'restart',daemon:daemonPeer,root,socket:home+'/rpc.sock',expected:bookingLegacyRpcExpected(beforeRow),process:python({action:'identity',pid:beforeRow.pid})};
 seal('restart-intent.json',{window,before,anchor,requestSha256:sha(JSON.stringify(request)),sourceHashes:{transport:sha(fs.readFileSync(source+'/scripts/booking-handoff-pm2-pause.py')),validator:sha(fs.readFileSync(source+'/scripts/release-toolchain-pm2-transition.mjs'))}});
 need(python(request).acknowledged===true,'ack');await ready(port);let afterRow;
 for(let i=0;i<100;i++){afterRow=registry().find(p=>p.name===name);if(afterRow.pid!==before.pid&&afterRow.pm2_env.status==='online')break;await sleep(100);}
 const after=normalizeRetirementProcess(afterRow),afterRaw=raw(after.pid),value={beforeRaw,afterRaw,beforeConfigured:beforeRow.pm2_env.env,afterConfigured:afterRow.pm2_env.env,legacyBefore:before,legacyAfter:after,beforePmUptime:beforeRow.pm2_env.pm_uptime,afterPmUptime:afterRow.pm2_env.pm_uptime,beforePmDerived:manager(beforeRow.pm2_env),afterPmDerived:manager(afterRow.pm2_env),framework,window,observedAt:new Date().toISOString()};
 seal('transition-observed.json',{value,unverified:true,syntheticInputsOnly:true});
 const termination=inspectPm2SigintTermination(anchor,before,after);seal('termination-observed.json',{termination,unverified:true});
 stage='actual-transition-proof';need(value.afterPmDerived.exitCode===130,'actual_next_sigint_not_130');assertManagedPauseEnvironmentTransition(value,{framework:FRAMEWORK,assertWindow:assertBookingHandoffWindow,expectedExitCode:130,terminationEvidence:termination,logFile:home+'/pm2.log'});
 const afterOther=registry().find(p=>p.name==='eq-unrelated');assert.deepEqual(afterOther,beforeOther.row);assert.deepEqual(raw(afterOther.pid),beforeOther.raw);assert.deepEqual(fact(afterOther.pid),beforeOther.identity);need(!alive(beforeFact),'old_process_still_alive');
 stage='negative-proof-cases';for(const mutate of [v=>v.afterRaw.KEEP='changed',v=>v.afterPmDerived.exitCode=1,v=>v.legacyAfter.restartCount++,v=>v.afterConfigured.RESEND_API_KEY='forbidden']){const changed=structuredClone(value);mutate(changed);assert.throws(()=>assertManagedPauseEnvironmentTransition(changed,{framework:FRAMEWORK,assertWindow:assertBookingHandoffWindow,expectedExitCode:130,terminationEvidence:termination,logFile:home+'/pm2.log'}));}
 const stable=registry();python(request,{reject:true});assert.deepEqual(registry(),stable);
 seal('transition-verified.json',{value,termination,sharedProductionFraming:true,realNext:true,realPm2:true,staleAttemptRefusedWithoutSend:true,unrelatedProcessUnchanged:true});passed=true;
}catch(e){
 // Synthetic fixture only: neither this isolated HOME nor these two generated
 // programs inherit server/CI credentials. Keep actual startup error evidence.
 const logs={};for(const name of ['pm2.log','logs/eq-next-error.log','logs/eq-next-out.log']){const file=home+'/'+name;if(!fs.existsSync(file))continue;const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&s.nlink===1&&fs.realpathSync(file)===file,'diagnostic_log');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=Buffer.alloc(Math.min(s.size,16384));fs.readSync(fd,b,0,b.length,Math.max(0,s.size-b.length));logs[name]=b.toString('utf8');}finally{fs.closeSync(fd);}}
 seal('fixture-logs.json',{kind:'ci-only-synthetic-fixture-logs',logs,syntheticInputsOnly:true});
 seal('failure.json',{stage,diagnostic:stageFailureDiagnostic(e,{stage:'switch',toolRevision:revision,knownFiles:['release-toolchain-pm2-real-acceptance.mjs','release-toolchain-pm2-transition.mjs']}),detailsRedacted:true});throw e;
}finally{
 // No CLI cleanup (which could auto-boot a missing daemon). Signal only the
 // exact owned identities, then retain every fixture and report for inspection.
 if(daemon){assertDaemon();for(const p of privateAppProcesses()){need(p.parentPid===daemon.pid,'fixture_app_parent');owned.set(p.pid,p);}process.kill(daemon.pid,'SIGINT');for(let i=0;i<100&&alive(daemon);i++)await sleep(50);need(!alive(daemon),'daemon_cleanup');for(const p of owned.values()){if(!alive(p))continue;process.kill(p.pid,'SIGTERM');for(let i=0;i<100&&alive(p);i++)await sleep(50);need(!alive(p),'child_cleanup');}}
 need(privateAppProcesses().length===0,'untracked_fixture_process');
 seal('cleanup-verified.json',{allOwnedProcessesStopped:true,formalHostTouched:false,passed,at:new Date().toISOString()});
}
console.log(JSON.stringify({kind:'release-toolchain-real-pm2-next-transition-acceptance',root,revision,realNextVersion:'16.3.4',realPm2Version:'6.0.14',nodeVersion:process.version,actualExitCode:130,signal:'SIGINT',sharedProductionPeerFraming:true,unrelatedProcessUnchanged:true,staleAttemptRefused:true,allOwnedProcessesStopped:true,formalHostTouched:false,fullPublicationAuthority:false,mailEnabled:false}));
