// Owned CI only: one synthetic Node container; no host mount/public port or
// production credentials. This is not a production connector or read permit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const branch='refs/heads/acceptance/member-checkout-proc-table-20261126';
assert.equal(process.platform,'linux');assert.equal(process.version,'v20.20.1');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REPOSITORY,'fafona/space');assert.equal(process.env.GITHUB_REF,branch);assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(process.env.GITHUB_RUN_ID??'',/^[0-9]+$/);
const temp=fs.realpathSync(process.env.RUNNER_TEMP);assert.ok(temp.startsWith('/home/runner/work/_temp'));
const owner=randomUUID(),label='io.faolla.proc-table-owner',created=[];let phase='start',error=null,diagnostic=null,failureDiagnostic=null,observations=null;
function run(args,{timeout=15000,optional=false}={}){
 const r=spawnSync('docker',args,{encoding:'utf8',shell:false,timeout,maxBuffer:262144});
 if(r.error||r.signal||r.status!==0){diagnostic={phase,verb:args[0],status:r.status,signal:r.signal??null,code:r.error?.code??null,stdout:(r.stdout??'').slice(-3000),stderr:(r.stderr??'').slice(-3000)};if(optional)return null;throw Error('owned_proc_command_failed');}return r.stdout.trim();
}
function inspect(c){
 const r=JSON.parse(run(['inspect','--type=container','--format','{"id":{{json .Id}},"image":{{json .Image}},"owner":{{json (index .Config.Labels "io.faolla.proc-table-owner")}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"binds":{{json .HostConfig.Binds}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"running":{{json .State.Running}},"exitCode":{{json .State.ExitCode}}}',c.id]));
 assert.equal(r.id,c.id);assert.equal(r.image,c.image);assert.equal(r.owner,owner);assert.equal(r.network,'none');assert.equal(r.readonly,true);assert.ok(r.ports===null||Object.keys(r.ports).length===0);assert.ok(r.binds===null||r.binds.length===0);return r;
}
try{
 const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64'),hash=s=>createHash('sha256').update(s).digest('hex');
 const metadata=fs.readFileSync(new URL('./member-checkout-runtime-metadata.mjs',import.meta.url),'utf8'),reader=fs.readFileSync(new URL('./member-checkout-proc-table-reader.mjs',import.meta.url),'utf8');
 let binder=fs.readFileSync(new URL('./member-checkout-active-runtime.mjs',import.meta.url),'utf8');const needle="'./member-checkout-runtime-metadata.mjs'";assert.equal(binder.split(needle).length,2);binder=binder.replace(needle,JSON.stringify(data(metadata)));
 const target=hash(owner).slice(0,40),name='merchant-space-online-'+target.slice(0,12),directory='/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online';
 const source=`import fs from 'node:fs';import net from 'node:net';import assert from 'node:assert/strict';
const {readCheckoutProcNetworkTable:read}=await import(${JSON.stringify(data(reader))});
const {projectCheckoutActiveRuntime:bind}=await import(${JSON.stringify(data(binder))});
const checks=[],proofs=[];const mark=(name,fn)=>{fn();checks.push(name)};
process.title='next-server (v15)';const target=${JSON.stringify(target)},name=${JSON.stringify(name)},directory=${JSON.stringify(directory)},pid=process.pid,port=3103;
fs.mkdirSync(directory,{recursive:true});process.chdir(directory);fs.mkdirSync('/var/lib/faolla-online-release',{recursive:true});fs.mkdirSync('/root/.pm2/pids',{recursive:true});
const activeFile='/var/lib/faolla-online-release/active.json',pidName=name+'-0.pid',pidFile='/root/.pm2/pids/'+pidName;
fs.writeFileSync(activeFile,JSON.stringify({target,port,directory,name}),{flag:'wx',mode:0o600});fs.writeFileSync(pidFile,String(pid)+'\\n',{flag:'wx',mode:0o600});
const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
const id=s=>({dev:String(s.dev),ino:String(s.ino),nlink:Number(s.nlink),uid:Number(s.uid),gid:Number(s.gid),mode:Number(s.mode),bytes:Number(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)});
const identity=file=>id(fs.statSync(file,{bigint:true}));
const network=()=>{const out=[];for(const [family,file]of [['tcp4','/proc/net/tcp'],['tcp6','/proc/net/tcp6']]){const r=read(fs,file);proofs.push(r.proof);for(const line of r.wire.split('\\n').slice(1).filter(v=>v.trim())){const x=line.trim().split(/\\s+/);if(x[3]==='0A'&&parseInt(x[1].split(':')[1],16)===port)out.push({family,localAddress:x[1].split(':')[0],port,state:x[3],uid:Number(x[7]),inode:x[9]});}}return out;};
const sockets=()=>[...new Set(fs.readdirSync('/proc/'+pid+'/fd').map(fd=>{try{return fs.readlinkSync('/proc/'+pid+'/fd/'+fd)}catch{return ''}}).filter(s=>/^socket:\\[[0-9]+\\]$/.test(s)))];
const proc=kind=>fs.readFileSync('/proc/'+pid+'/'+kind,'utf8'),exe='/proc/'+pid+'/exe';
const x={activeWireBefore:fs.readFileSync(activeFile,'utf8'),activeWireAfter:fs.readFileSync(activeFile,'utf8'),activeIdentityBefore:identity(activeFile),activeIdentityAfter:identity(activeFile),pidRecordName:pidName,pidWireBefore:fs.readFileSync(pidFile,'utf8'),pidWireAfter:fs.readFileSync(pidFile,'utf8'),pidIdentityBefore:identity(pidFile),pidIdentityAfter:identity(pidFile),process:{pid,statBefore:proc('stat'),statAfter:proc('stat'),status:proc('status'),cwdBefore:fs.readlinkSync('/proc/'+pid+'/cwd'),cwdAfter:fs.readlinkSync('/proc/'+pid+'/cwd')},executableBefore:fs.readlinkSync(exe),executableAfter:fs.readlinkSync(exe),executableIdentityBefore:identity(exe),executableIdentityAfter:identity(exe),listenersBefore:network(),listenersAfter:network(),socketLinksBefore:sockets(),socketLinksAfter:sockets()};
const binding=bind(x);
mark('actual-linux-fixed-tcp4-and-tcp6-procfs-and-fd-metadata',()=>{assert.equal(proofs.length,4);assert.ok(proofs.every(p=>p.procfsVerified&&p.descriptorMetadataStable&&p.pathIdentityStable&&!p.ordinaryFilePolicyChanged&&!p.productionAuthorized));});
mark('actual-active-record-pid-cwd-executable-uid-and-owned-listener-bound',()=>{assert.equal(binding.activeRecordProcessAndListenerBound,true);assert.equal(binding.executableMetadataBound,true);assert.equal(binding.pid,pid);assert.equal(binding.uids[1],process.geteuid());assert.equal(binding.port,port);});
const proxy=()=>Object.create(fs);
mark('observed-two-path-times-reproduced-old-comparison-refuses-new-profile-keeps-identity',()=>{const f=proxy();let calls=0;f.lstatSync=(...a)=>{const s=fs.lstatSync(...a);if(++calls===2){s.mtimeNs+=123456789n;s.ctimeNs+=123456789n;}return s;};const r=read(f,'/proc/net/tcp');assert.deepEqual(r.proof.pathTimestampDifferencesAfter,['mtimeNs','ctimeNs']);assert.ok(r.proof.descriptorMetadataStable&&r.proof.pathIdentityStable);assert.equal(r.identity.uid,0);});
mark('non-proc-filesystem-refuses-and-closes-actual-fd',()=>{const f=proxy();let closed=0;fs.writeFileSync('/www/owned-ordinary-table','',{flag:'wx',mode:0o444});f.openSync=()=>fs.openSync('/www/owned-ordinary-table',fs.constants.O_RDONLY);f.closeSync=fd=>{closed++;return fs.closeSync(fd)};assert.throws(()=>read(f,'/proc/net/tcp'),/proc_table_filesystem_refused/);assert.equal(closed,1);});
mark('descriptor-time-change-still-refuses-and-closes-actual-fd',()=>{const f=proxy();let calls=0,closed=0;f.fstatSync=(...a)=>{const s=fs.fstatSync(...a);if(++calls===2)s.ctimeNs+=1n;return s;};f.closeSync=fd=>{closed++;return fs.closeSync(fd)};assert.throws(()=>read(f,'/proc/net/tcp'),/metadata_file_changed/);assert.equal(closed,1);});
mark('path-inode-change-still-refuses-and-closes-actual-fd',()=>{const f=proxy();let calls=0,closed=0;f.lstatSync=(...a)=>{const s=fs.lstatSync(...a);if(++calls===2)s.ino+=1n;return s;};f.closeSync=fd=>{closed++;return fs.closeSync(fd)};assert.throws(()=>read(f,'/proc/net/tcp'),/metadata_file_changed/);assert.equal(closed,1);});
mark('unchanged-binder-refuses-wrong-socket-pid-reuse-and-ordinary-file-time',()=>{for(const mutate of [q=>q.socketLinksAfter=['socket:[9999999999]'],q=>q.activeIdentityAfter.mtimeNs='9999999999',q=>{const a=q.process.statAfter.lastIndexOf(') ');const fields=q.process.statAfter.slice(a+2).trim().split(/\\s+/);fields[19]=String(Number(fields[19])+1);q.process.statAfter=q.process.statAfter.slice(0,a+2)+fields.join(' ');}]){const q=structuredClone(x);mutate(q);assert.throws(()=>bind(q));}});
mark('root-observed-not-public-ingress-supervisor-or-signer-authority',()=>{assert.equal(binding.rootApplicationObserved,true);for(const k of ['publicIngressVerified','pm2SupervisorVerified','executableBytesVerified','signerIsolationApproved','productionAuthorized','installationAuthorized','deploymentAuthorized'])assert.equal(binding[k],false);});
await new Promise(r=>server.close(r));console.log(JSON.stringify({passed:true,checks,procTableProofs:proofs,binding,ownedListenerClosed:true,productionConnected:false,environmentRead:false,commandLineRead:false}));`;
 phase='image';run(['pull','node:20.20.1-bookworm-slim'],{timeout:120000});const image=run(['image','inspect','--format','{{.Id}}','node:20.20.1-bookworm-slim']);assert.match(image,/^sha256:[a-f0-9]{64}$/);
 phase='create';const id=run(['create','--label',label+'='+owner,'--name','faolla-proc-table-'+owner.slice(0,8),'--network','none','--read-only','--user','0:0','--tmpfs','/www:rw,nosuid,nodev,size=33554432','--tmpfs','/root/.pm2:rw,nosuid,nodev,size=33554432','--tmpfs','/var/lib/faolla-online-release:rw,nosuid,nodev,size=33554432',image,'node','--input-type=module','-e',source]);assert.match(id,/^[a-f0-9]{64}$/);const c={id,image,removed:false};created.push(c);inspect(c);
 phase='run';run(['start',id]);const deadline=Date.now()+30000;while(Date.now()<deadline&&inspect(c).running)await new Promise(r=>setTimeout(r,100));assert.equal(inspect(c).exitCode,0);
 phase='verify';observations=JSON.parse(run(['logs',id]));assert.equal(observations.passed,true);assert.equal(observations.checks.length,8);assert.equal(observations.productionConnected,false);assert.equal(observations.ownedListenerClosed,true);assert.equal(observations.environmentRead,false);assert.equal(observations.commandLineRead,false);
}catch(e){error=/^[a-z_]{1,80}$/.test(e?.message??'')?e.message:'owned_proc_table_failed';failureDiagnostic={phase,code:e?.code??null,...diagnostic};}
finally{
 for(const c of created.filter(v=>!v.removed).reverse()){try{inspect(c);if(error){const logs=spawnSync('docker',['logs','--tail','12',c.id],{encoding:'utf8',timeout:10000,maxBuffer:16384,shell:false});const cut=s=>s.length<=3000?s:s.slice(0,2000)+'\n[OWNED-LOG-BOUNDED]\n'+s.slice(-1000);failureDiagnostic={...failureDiagnostic,containerStdout:cut(logs.stdout??''),containerStderr:cut(logs.stderr??'')};}run(['rm','--force',c.id]);c.removed=run(['inspect','--type=container',c.id],{optional:true})===null;}catch{error??='owned_proc_cleanup_failed';}}
}
const cleanupPassed=created.length===1&&created.every(c=>c.removed),passed=error===null&&cleanupPassed;
const report={version:1,kind:'owned-proc-table-reader-acceptance',commit:process.env.GITHUB_SHA,branch,passed,observations,error,diagnostic:error?failureDiagnostic:null,cleanup:{created:created.length,removed:created.filter(c=>c.removed).length,passed:cleanupPassed},productionConnected:false,productionReadPermissionConsumed:false,productionAuthorized:false,installationAuthorized:false,deploymentAuthorized:false,stripeEnabled:false};
fs.writeFileSync(path.join(temp,'checkout-proc-table-owned.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed,checks:observations?.checks?.length??0,cleanupPassed,error,productionConnected:false}));if(!passed)process.exitCode=1;
