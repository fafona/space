// Actual-host isolated HTTP/1 acceptance using the installed Nginx binary.
// Does NOT reload/modify production or prove HTTPS/QUIC/full cutover recovery.
import * as fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
const nginx='/www/server/nginx/sbin/nginx',hash=v=>createHash('sha256').update(v).digest('hex');
assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(process.argv.length,2);
const policySource=fs.readFileSync(new URL('./booking-handoff-policy.mjs',import.meta.url),'utf8');
const ingressOriginal=fs.readFileSync(new URL('./booking-handoff-ingress.mjs',import.meta.url),'utf8');
const m=await import('./booking-handoff-ingress.mjs');
const vhost='/www/server/panel/vhost/nginx/www.faolla.com.conf',main='/www/server/nginx/conf/nginx.conf';
const web=['e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf','no_store_entries_www.faolla.com.conf','faolla_contact_card_release.conf'];
const production=()=>{
 const result=spawnSync('pm2',['jlist'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2'},timeout:10000,maxBuffer:16*1024**2});
 assert.equal(result.status,0);
 return {files:Object.fromEntries([vhost,main,'/var/lib/faolla-online-release/active.json',
  ...web.map(f=>'/www/server/panel/vhost/nginx/proxy/www.faolla.com/'+f)].map(f=>[f,hash(fs.readFileSync(f))])),
  processes:JSON.parse(result.stdout).map(p=>({name:p.name,pid:p.pid,status:p.pm2_env.status,restarts:p.pm2_env.restart_time,cwd:p.pm2_env.pm_cwd})),
  current:fs.realpathSync('/www/wwwroot/merchant-space.current')};
};
const before=production(),start=Date.now(),window={id:randomUUID(),startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()};
const plan=m.createProductionBookingIngressPlan({vhostText:fs.readFileSync(vhost,'utf8'),mainSha256:hash(fs.readFileSync(main)),window});
assert.equal(m.bookingIngressRestorationText(plan,plan.afterText),plan.beforeText);
const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,reorder(value[k])])):value;
assert.equal(m.bookingIngressRestorationText(JSON.parse(JSON.stringify(reorder(plan))),plan.afterText),plan.beforeText);
const directory=fs.mkdtempSync('/var/lib/faolla-booking-ingress-rehearsal-');fs.chmodSync(directory,0o700);
fs.mkdirSync(directory+'/logs',{mode:0o700});
const write=(name,text)=>fs.writeFileSync(directory+'/'+name,text,{flag:'wx',mode:0o600});
write('source-evidence.json',JSON.stringify({moduleSha256:hash(ingressOriginal),policySha256:hash(policySource),
  productionPlanSha256:hash(JSON.stringify(plan)),productionBefore:before}));
const backendHits=[],backend=createServer((req,res)=>{backendHits.push([req.method,req.url]);req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fixture:true,method:req.method,path:req.url}));});
let child,childResult,timeoutStart,nginxPid,nginxStart,completed=false,checks=0,childStdout='',childStderr='';
const fact=pid=>{
 const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8'),end=stat.lastIndexOf(')'),fields=stat.slice(end+2).trim().split(/\s+/);
 return {pid,start:fields[19],parent:Number(fields[1]),exe:fs.realpathSync('/proc/'+pid+'/exe'),uid:fs.lstatSync('/proc/'+pid).uid};
};
try{
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));const backendPort=backend.address().port;
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const luaPaths=fs.readFileSync(main,'utf8').split(/\r?\n/).filter(line=>/^\s*lua_package_(?:c?path)\s+/.test(line));
 assert.ok(luaPaths.length>=1&&luaPaths.length<=2&&luaPaths.some(line=>/^\s*lua_package_path\s+/.test(line)));
 assert.ok(luaPaths.every(line=>!line.includes('$')&&/;\s*$/.test(line)));
 const config=`pid ${directory}/nginx.pid;error_log ${directory}/error.log;events { worker_connections 32; }
 http { ${luaPaths.join('\n')} access_log off;server { listen 127.0.0.1:${port};server_name localhost;
 ${m.bookingIngressSnippet(window)}
 location / { proxy_pass http://127.0.0.1:${backendPort};proxy_set_header Connection close; }
 } }`;
 write('nginx.conf',config);
 const syntax=spawnSync(nginx,['-p',directory+'/', '-c',directory+'/nginx.conf','-t'],{encoding:'utf8',timeout:10000});
 write('syntax.json',JSON.stringify({status:syntax.status,stdout:syntax.stdout,stderr:syntax.stderr}));assert.equal(syntax.status,0);
 child=spawn('/usr/bin/timeout',['--signal=TERM','--kill-after=5s','45s',nginx,'-p',directory+'/', '-c',directory+'/nginx.conf','-g','daemon off;'],{stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',data=>{childStdout=(childStdout+data).slice(-8192);});child.stderr.on('data',data=>{childStderr=(childStderr+data).slice(-8192);});
 childResult=new Promise(resolve=>{child.on('error',error=>resolve({error:String(error)}));child.on('exit',(code,signal)=>resolve({code,signal}));});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});timeoutStart=fact(child.pid);
 assert.equal(timeoutStart.exe,fs.realpathSync('/usr/bin/timeout'));
 const until=Date.now()+5000;
 while(Date.now()<until){
  try{const text=fs.readFileSync(directory+'/nginx.pid','utf8').trim();if(/^[1-9][0-9]*$/.test(text)){nginxPid=Number(text);nginxStart=fact(nginxPid);break;}}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.ok(nginxPid,'fixture_nginx_pid_not_ready');
 assert.equal(nginxStart.parent,child.pid);assert.equal(nginxStart.exe,fs.realpathSync(nginx));assert.equal(nginxStart.uid,0);
 const probe=(method,path)=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,method,path,headers:{Host:'localhost',Connection:'close'}},res=>{
   let text='';res.on('data',chunk=>{if(text.length<65536)text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,text}));
  });req.setTimeout(3000,()=>req.destroy(Error('fixture_request_timeout')));req.on('error',reject);req.end();
 });
 const protectedPaths=[['GET','/api/bookings'],['POST','/api/bookings'],['PATCH','/api/bookings/self-service'],
  ['DELETE','/api/bookings/workbench'],['OPTIONS','/api/bookings/calendar'],['GET','/api/bookings/customer-calendar?x=1'],
  ['GET','/api/%62ookings'],['GET','/api%2fbookings'],['GET','/api//bookings'],['GET','/x/../api/bookings'],
  ['POST','/api/publish'],['POST','/api/publish/'],['POST','/api/%70ublish'],['POST','/api/personal-guest-merge?x=1']];
 for(const [method,path]of protectedPaths){const result=await probe(method,path);assert.equal(result.status,503,method+' '+path);assert.equal(JSON.parse(result.text).operation,window.id);checks++;}
 assert.equal(backendHits.length,0);
 const allowed=[['GET','/'],['POST','/api/auth/signin'],['POST','/api/orders'],['GET','/api/merchant-enterprise/attendance'],
  ['GET','/api/publish'],['GET','/api/personal-guest-merge'],['POST','/api/publish-preview'],['GET','/card/example'],
  ['GET','/_next/static/example.js'],['POST','/api/orders?next=/api/bookings']];
 for(const [method,path]of allowed){const result=await probe(method,path);assert.equal(result.status,200,method+' '+path);assert.equal(JSON.parse(result.text).fixture,true);checks++;}
 assert.equal(backendHits.length,allowed.length);
 assert.deepEqual(production(),before);completed=true;
 write('acceptance.json',JSON.stringify({kind:'booking-only-ingress-isolated-http1-acceptance',completed,checks,
  moduleSha256:hash(ingressOriginal),policySha256:hash(policySource),productionPlanSha256:hash(JSON.stringify(plan)),
  protectedHits:protectedPaths.length,allowedHits:allowed.length,productionUnchanged:true,
  notFullHandoffRehearsal:true,notHttpsOrQuicProof:true,databaseWrites:false,completedAt:new Date().toISOString()}));
 assert.deepEqual(fact(nginxPid),nginxStart);process.kill(nginxPid,'SIGTERM');await childResult;nginxPid=undefined;
 console.log(JSON.stringify({kind:'booking-only-ingress-isolated-http1-acceptance',directory,checks,productionUnchanged:true,completed:true,fixtureStopped:true}));
}finally{
 if(nginxPid){try{assert.deepEqual(fact(nginxPid),nginxStart);process.kill(nginxPid,'SIGTERM');}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(child&&child.exitCode===null&&child.signalCode===null){
  try{assert.deepEqual(fact(child.pid),timeoutStart);child.kill('SIGTERM');}catch(error){if(error.code!=='ENOENT')throw error;}
  await childResult;
 }
 await new Promise(resolve=>backend.close(resolve));write('cleanup.json',JSON.stringify({completed,checks,productionUnchanged:JSON.stringify(production())===JSON.stringify(before),completedAt:new Date().toISOString()}));
 write('child-output.json',JSON.stringify({stdout:childStdout,stderr:childStderr}));
 if(!completed)console.log(JSON.stringify({directory,completed,checks,childResult:childResult?await childResult:null,stderr:childStderr}));
}
