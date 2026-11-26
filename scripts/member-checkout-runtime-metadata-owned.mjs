// Owned Linux CI only. Reads its own child's /proc metadata and one ephemeral
// Kong with no network, host mounts, published ports, credentials or customers.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {projectCheckoutProcStatus,projectCheckoutProcStat,projectCheckoutProcessSnapshot,projectCheckoutKongAdminListener} from './member-checkout-runtime-metadata.mjs';
const branch='refs/heads/acceptance/member-checkout-runtime-plan-20261126';
assert.equal(process.platform,'linux');assert.equal(process.version,'v20.20.1');
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REPOSITORY,'fafona/space');assert.equal(process.env.GITHUB_REF,branch);
assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(process.env.GITHUB_RUN_ID??'',/^[0-9]+$/);
const temporary=fs.realpathSync(process.env.RUNNER_TEMP);assert.ok(temporary.startsWith('/home/runner/work/_temp'));
const nonce=randomUUID(),name='faolla-checkout-metadata-'+process.env.GITHUB_RUN_ID+'-'+nonce.slice(0,8),label='io.faolla.checkout-metadata-owner='+nonce;
let child=null,container=null,imageId=null,childExited=false,containerRemoved=false,lastCommandFailure=null,phase='start';
const checks=[],observations={},sha=v=>createHash('sha256').update(v).digest('hex');
const run=(args,{optional=false,timeout=15000}={})=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:262144,shell:false});if(r.error||r.signal||r.status!==0){lastCommandFailure={phase,verb:args[0],status:r.status,signal:r.signal??null,errorCode:r.error?.code??null,stderr:(r.stderr??'').slice(-4000)};if(optional)return null;throw Error('owned_docker_command_failed');}return r.stdout.trim();};
const mark=(name,fn)=>{fn();checks.push(name);};
const inspect=()=>JSON.parse(run(['inspect','--type=container','--format','{"id":{{json .Id}},"image":{{json .Image}},"owner":{{json (index .Config.Labels "io.faolla.checkout-metadata-owner")}},"ports":{{json .HostConfig.PortBindings}},"networkMode":{{json .HostConfig.NetworkMode}},"binds":{{json .HostConfig.Binds}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"running":{{json .State.Running}}}',container]));
let failure=null;
try{
 phase='owned-process';child=spawn(process.execPath,['-e',"process.title='next-server (v15)';process.send({ready:true,pid:process.pid});setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc'],shell:false});
 child.once('exit',()=>{childExited=true;});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned_child_ready_timeout')),5000);child.once('error',reject);child.once('message',v=>{clearTimeout(timer);try{assert.equal(v.ready,true);assert.equal(v.pid,child.pid);resolve();}catch(e){reject(e);}});});
 const pid=child.pid,statBefore=fs.readFileSync('/proc/'+pid+'/stat','utf8'),status=fs.readFileSync('/proc/'+pid+'/status','utf8'),cwdBefore=fs.readlinkSync('/proc/'+pid+'/cwd'),statAfter=fs.readFileSync('/proc/'+pid+'/stat','utf8'),cwdAfter=fs.readlinkSync('/proc/'+pid+'/cwd');
 const identity=projectCheckoutProcStatus(status),a=projectCheckoutProcStat(statBefore,pid),b=projectCheckoutProcStat(statAfter,pid);
 mark('actual-linux-next-style-comm-and-ids',()=>{assert.equal(identity.nameSha256,a.nameSha256);assert.equal(a.startTicks,b.startTicks);assert.equal(identity.uids[1],process.geteuid());assert.equal(identity.gids[1],process.getegid());assert.ok(status.includes('next-server (v1'));});
 mark('owned-working-directory-not-accepted-as-production',()=>{assert.throws(()=>projectCheckoutProcessSnapshot({pid,statBefore,status,cwdBefore,statAfter,cwdAfter}),/metadata_runtime_directory_changed/);});
 observations.process={nativeProcRead:true,pidStartBound:true,uid:identity.uids[1],gid:identity.gids[1],nameSha256:identity.nameSha256,productionCwdVerified:false,publicTargetVerified:false};
 phase='owned-image';run(['pull','kong:2.8.1'],{timeout:120000});imageId=run(['image','inspect','--format','{{.Id}}','kong:2.8.1']);assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
 phase='owned-container-create';
 container=run(['create','--name',name,'--label',label,'--network','none','--read-only','--user','0:0','--tmpfs','/usr/local/kong:rw,nosuid,nodev,size=134217728','--tmpfs','/tmp:rw,nosuid,nodev,size=33554432','--env','KONG_DATABASE=off','--env','KONG_PROXY_LISTEN=off','--env','KONG_ADMIN_LISTEN=127.0.0.1:8001 reuseport backlog=16384, 127.0.0.1:8444 ssl reuseport backlog=16384','--env','KONG_ADMIN_ACCESS_LOG=off','--env','KONG_ADMIN_ERROR_LOG=/dev/stderr','--env','KONG_NGINX_WORKER_PROCESSES=1',imageId]);assert.match(container,/^[a-f0-9]{64}$/);
 mark('owned-container-no-network-host-mounts-or-public-ports',()=>{const c=inspect();assert.equal(c.id,container);assert.equal(c.image,imageId);assert.equal(c.owner,nonce);assert.equal(c.networkMode,'none');assert.ok(c.ports===null||Object.keys(c.ports).length===0);assert.ok(c.binds===null||c.binds.length===0);assert.equal(c.readonly,true);});
 phase='owned-container-start';run(['start',container]);
 const fieldOnly="set -eu\n[ -f /usr/local/kong/.kong_env ] || exit 4\n[ ! -L /usr/local/kong/.kong_env ] || exit 4\nLC_ALL=C awk '/^admin_listen[[:space:]]*=/ {if(length($0)>1024)exit 5;print;n++} END{if(n!=1)exit 6}' /usr/local/kong/.kong_env";
 phase='owned-generated-field';let line=null;const deadline=Date.now()+45000;while(Date.now()<deadline){line=run(['exec',container,'sh','-c',fieldOnly],{optional:true,timeout:4000});if(line!==null)break;await new Promise(r=>setTimeout(r,300));}assert.notEqual(line,null,'owned_kong_field_not_ready');
 const projected=projectCheckoutKongAdminListener(line);
 mark('actual-kong-2.8.1-generated-multi-listener-projection',()=>{assert.equal(run(['exec',container,'kong','version']),'2.8.1');assert.equal(projected.state,'observed');assert.equal(projected.listeners.length,2);assert.equal(projected.plainLoopback8001,true);assert.equal(projected.networkReadAuthorized,false);assert.ok(projected.listeners[1].tls);});
 // A bounded format diagnosis only. No real/owned Admin API or plugin payload.
 mark('old-single-listener-regex-refuses-this-real-generated-format',()=>{const old=/^admin_listen\s*=\s*(.+)$/.exec(line);assert.ok(old);assert.equal(/^(?:off|(?:127\.0\.0\.1|0\.0\.0\.0):8001(?:\s+reuseport)?)$/.test(old[1]),false);});
 observations.kong={version:'2.8.1',imageId,generatedFieldSha256:sha(line),projection:projected,fullConfigurationRead:false,pluginsRead:false,adminApiCalled:false,productionImageEquivalenceVerified:false};
}catch(e){failure=/^[a-z_]+$/.test(e?.message??'')?e.message:'owned_metadata_acceptance_failed';observations.failure={phase,code:failure,lastCommandFailure};}
finally{
 if(child&&!childExited){child.kill('SIGTERM');await new Promise(resolve=>{if(childExited)return resolve();const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
 if(container){try{const c=inspect();assert.equal(c.id,container);assert.equal(c.image,imageId);assert.equal(c.owner,nonce);assert.equal(c.networkMode,'none');if(failure)observations.ownedContainerLogs=run(['logs','--tail','20',container],{optional:true})?.slice(-6000)??null;phase='owned-cleanup';run(['rm','--force',container]);containerRemoved=run(['inspect','--type=container',container],{optional:true})===null;}catch{failure??='owned_container_cleanup_failed';}}
}
const cleanupPassed=childExited&&containerRemoved,report={version:1,kind:'owned-linux-runtime-metadata-acceptance',commit:process.env.GITHUB_SHA,branch,passed:failure===null&&cleanupPassed,checks,observations,cleanup:{childExited,containerRemoved,passed:cleanupPassed},error:failure,productionConnected:false,oldEvidenceChanged:false,productionSourcePromoted:false,productionAuthorized:false,installationAuthorized:false,deploymentAuthorized:false,stripeEnabled:false};
fs.writeFileSync(path.join(temporary,'checkout-runtime-metadata-owned.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleanupPassed,productionConnected:false,error:failure}));if(!report.passed)process.exitCode=1;
