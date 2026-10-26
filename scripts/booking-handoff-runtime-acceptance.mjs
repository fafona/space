// Real installed PM2, synthetic loopback web/worker processes in a private
// PM2_HOME. No app code, DB access, production restart, reload or mail sending.
import * as fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {bookingAtomicRuntimeCommands,BOOKING_ATOMIC_NEXT_ENV_PROBE} from './booking-handoff-runtime.mjs';

assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(process.argv.length,2);
const hash=x=>createHash('sha256').update(x).digest('hex'),minimal={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
const command=(bin,args,env=minimal)=>{
  const r=spawnSync(bin,args,{env,encoding:'utf8',timeout:10000,maxBuffer:16*1024**2});
  assert.equal(r.status,0,'fixture_command_unconfirmed');assert.equal(r.error,undefined);assert.equal(r.signal,null);return r.stdout;
};
const cli=fs.realpathSync(command('which',['pm2']).trim());
assert.equal(JSON.parse(fs.readFileSync(path.dirname(path.dirname(cli))+'/package.json','utf8')).version,'6.0.14');
const realPm=()=>JSON.parse(command('/usr/bin/node',[cli,'jlist'],{...minimal,PM2_HOME:'/root/.pm2'}));
const realSnapshot=()=>({processes:realPm().map(p=>({name:p.name,pid:p.pid,id:p.pm_id,cwd:p.pm2_env.pm_cwd,status:p.pm2_env.status,
  restartCount:p.pm2_env.restart_time,environmentSha256:hash(JSON.stringify(p.pm2_env.env))})),
  active:hash(fs.readFileSync('/var/lib/faolla-online-release/active.json')),current:fs.realpathSync('/www/wwwroot/merchant-space.current')});
// PM2 sets process.title within its original argv allocation. A short private
// path keeps the ENTIRE daemon identity verifiable; never relax the comparison
// to a truncated title that could describe a different PM2_HOME.
const before=realSnapshot(),root=fs.mkdtempSync('/var/lib/fbr-');fs.chmodSync(root,0o700);
const write=(file,text)=>fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
const home=root+'/p';fs.mkdirSync(home,{mode:0o700});
write(root+'/owner.json',JSON.stringify({kind:'booking-atomic-runtime-isolated-pm2-acceptance',pid:process.pid,home,productionBefore:before}));
const fixtureEnv={...minimal,PM2_HOME:home,NODE_ENV:'production',NODE_OPTIONS:'',PM2_NODE_OPTIONS:'',NODE_PATH:'',NEXT_TELEMETRY_DISABLED:'1'};
const pm=(args,env=fixtureEnv)=>command('/usr/bin/node',[cli,...args],env);
const fact=pid=>{
  const st=fs.readFileSync('/proc/'+pid+'/stat','utf8'),f=st.slice(st.lastIndexOf(')')+2).trim().split(/\s+/);
  return {pid,uid:fs.lstatSync('/proc/'+pid).uid,startTicks:f[19],cwd:fs.realpathSync('/proc/'+pid+'/cwd'),executable:fs.realpathSync('/proc/'+pid+'/exe')};
};
const rawEnv=pid=>Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(v=>{const at=v.indexOf('=');return [v.slice(0,at),v.slice(at+1)];}));
const freePort=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
let daemon,completed=false,checks=0;
try{
  // No production secrets are copied into these synthetic processes.
  const nonce=randomUUID(),primary={name:'fixture-primary-'+nonce,directory:root+'/primary',port:await freePort()},rollback={name:'fixture-rollback-'+nonce,directory:root+'/rollback',port:await freePort()};
  assert.notEqual(primary.port,rollback.port);
  const dummy=`const http=require('node:http');const args=process.argv.slice(2);const i=args.indexOf('-p');
const mode=process.env.MERCHANT_BOOKING_STORAGE_MODE;const output={fixture:true,mode,worker:process.env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED,background:process.env.FAOLLA_BACKGROUND_JOBS_PAUSED};
if(i>=0){http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(output));}).listen(Number(args[i+1]),'127.0.0.1');}
else{if(mode!=='atomic-v2'||output.worker!=='1'||output.background!=='0'||process.env.PORT)throw Error('fixture_worker_environment');setInterval(()=>{},1000);}
`;
  for(const s of [primary,rollback]){fs.mkdirSync(s.directory+'/node_modules/next/dist/bin',{recursive:true,mode:0o700});write(s.directory+'/node_modules/next/dist/bin/next',dummy);}
  write(root+'/worker.cjs',dummy);
  const legacy=s=>({...fixtureEnv,PWD:s.directory,PORT:String(s.port),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',
    MERCHANT_BOOKING_STORAGE_MODE:'legacy',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0'});
  const atomic=s=>({...legacy(s),MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'}),workerRuntime={...atomic(primary),FAOLLA_BACKGROUND_JOBS_PAUSED:'0',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1'};
  delete workerRuntime.PORT;
  const plan={primary,rollback,runtimeByName:{[primary.name]:atomic(primary),[rollback.name]:atomic(rollback)},worker:{name:'fixture-worker-'+nonce,directory:primary.directory,script:root+'/worker.cjs',runtime:workerRuntime}};
  const commands=bookingAtomicRuntimeCommands(plan);
  write(root+'/commands.json',JSON.stringify(commands));
  pm(['ping']);daemon=fact(Number(fs.readFileSync(home+'/pm2.pid','utf8')));
  const daemonCommand=fs.readFileSync('/proc/'+daemon.pid+'/cmdline','utf8').replace(/\0+$/,'');
  assert.ok(daemonCommand.endsWith('('+home+')'));assert.equal(daemon.uid,0);
  pm(['start',primary.directory+'/node_modules/next/dist/bin/next','--name',primary.name,'--cwd',primary.directory,'--interpreter','/usr/bin/node','--','start','-H','127.0.0.1','-p',String(primary.port)],legacy(primary));
  const read=()=>JSON.parse(pm(['jlist']));
  const primaryBefore=read().find(p=>p.name===primary.name);assert.equal(primaryBefore.pm2_env.restart_time,0);
  const verify=async(s,expected)=>{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      const p=read().find(p=>p.name===s.name);
      if(p?.pm2_env.status==='online'){
        const actual=rawEnv(p.pid);for(const [key,value]of Object.entries(expected))assert.equal(actual[key],value,key);
        assert.equal(fact(p.pid).cwd,s.directory);
        try{const r=await fetch('http://127.0.0.1:'+s.port,{signal:AbortSignal.timeout(500)}),v=await r.json();
          if(v.mode===expected.MERCHANT_BOOKING_STORAGE_MODE){assert.equal(v.worker,'0');assert.equal(v.background,'1');return p;}}
        catch{/* startup read probe only */}
      }
      await new Promise(r=>setTimeout(r,50));
    }
    throw Error('fixture_not_ready');
  };
  await verify(primary,legacy(primary));checks++;
  pm(commands.primary.args,commands.primary.environment);
  const primaryAfter=await verify(primary,atomic(primary));assert.notEqual(primaryAfter.pid,primaryBefore.pid);
  assert.equal(primaryAfter.pm2_env.restart_time,primaryBefore.pm2_env.restart_time+1);checks++;
  pm(commands.rollback.args,commands.rollback.environment);await verify(rollback,atomic(rollback));checks++;
  pm(commands.worker.args,commands.worker.environment);
  await new Promise(r=>setTimeout(r,500));const rows=read(),worker=rows.find(p=>p.name===plan.worker.name);
  assert.equal(rows.length,3);assert.equal(worker.pm2_env.status,'online');assert.equal(worker.pm2_env.restart_time,0);
  const actual=rawEnv(worker.pid);for(const [key,value]of Object.entries(workerRuntime))assert.equal(actual[key],value);
  assert.equal(actual.PORT,undefined);assert.equal(worker.pm2_env.PORT,undefined);checks++;
  // Check the actual host-installed Next loader too, without application imports
  // or network calls. The one-key runtime override wins over existing env files.
  const active=JSON.parse(fs.readFileSync('/var/lib/faolla-online-release/active.json','utf8'));
  const real=realPm().find(p=>p.name===active.name);assert.ok(real&&real.pid>0);
  // A PM2 child's raw /proc environment contains NODE_CHANNEL_FD=3. Reusing
  // that IPC descriptor in an unrelated Node child aborts before JS executes.
  // The real adapter uses the original saved build runtime (which deliberately
  // excludes PM2 transport keys), so rehearse those exact input bytes too.
  const actualReal=rawEnv(real.pid),inherited=JSON.parse(fs.readFileSync('/var/lib/faolla-online-release/'+active.target+'/runtime.json','utf8'));
  for(const [key,value]of Object.entries(inherited))assert.equal(actualReal[key],value,key);
  assert.equal(inherited.NODE_CHANNEL_FD,undefined);assert.equal(inherited.NODE_CHANNEL_SERIALIZATION_MODE,undefined);
  const testEnv={...inherited,MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0'};
  const next=JSON.parse(command('/usr/bin/node',['-e',BOOKING_ATOMIC_NEXT_ENV_PROBE,active.directory],testEnv));
  assert.equal(next.kind,'booking-atomic-next-environment');assert.equal(next.mailDisabled,true);checks++;
  assert.deepEqual(realSnapshot(),before);checks++;
  write(root+'/acceptance.json',JSON.stringify({kind:'booking-atomic-runtime-isolated-pm2-acceptance',checks,productionUnchanged:true,
    commandBuilderSha256:hash(bookingAtomicRuntimeCommands.toString()),nextEnvironmentProof:next,notFullHandoffRehearsal:true,completedAt:new Date().toISOString()}));
  completed=true;
}finally{
  let cleaned=false;
  if(daemon){
    assert.deepEqual(fact(daemon.pid),daemon);
    assert.ok(fs.readFileSync('/proc/'+daemon.pid+'/cmdline','utf8').replace(/\0+$/,'').endsWith('('+home+')'));
    const rows=JSON.parse(pm(['jlist']));
    for(const p of rows){assert.ok(p.pm2_env.pm_cwd.startsWith(root+'/'));assert.ok(p.pm2_env.pm_exec_path.startsWith(root+'/'));if(p.pid>0)assert.equal(rawEnv(p.pid).PM2_HOME,home);}
    pm(['kill']);const end=Date.now()+5000;
    while(fs.existsSync('/proc/'+daemon.pid)&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
    assert.equal(fs.existsSync('/proc/'+daemon.pid),false);cleaned=true;
  }
  assert.deepEqual(realSnapshot(),before);
  write(root+'/cleanup.json',JSON.stringify({completed,cleaned,checks,productionUnchanged:true,completedAt:new Date().toISOString()}));
  console.log(JSON.stringify({directory:root,completed,checks,fixtureStopped:cleaned,productionUnchanged:true}));
}
