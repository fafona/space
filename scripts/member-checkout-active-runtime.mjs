// Pure binding of approved release metadata to an actual process/listener.
// Does not read hosts or certify public ingress, PM2 ownership, executable bytes,
// signing isolation, installation permission or production deployment readiness.
import {createHash} from 'node:crypto';
import {projectCheckoutProcessSnapshot} from './member-checkout-runtime-metadata.mjs';
const need=(v,c)=>{if(!v)throw Error(c);};
const hash=v=>createHash('sha256').update(v).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function fileIdentity(v,kind){
 need(exact(v,['dev','ino','nlink','uid','gid','mode','bytes','mtimeNs','ctimeNs']),'active_metadata_file_identity_invalid');
 for(const k of ['dev','ino','mtimeNs','ctimeNs'])need(typeof v[k]==='string'&&/^[0-9]{1,24}$/.test(v[k]),'active_metadata_file_identity_invalid');
 for(const k of ['nlink','uid','gid','mode','bytes'])need(Number.isSafeInteger(v[k])&&v[k]>=0,'active_metadata_file_identity_invalid');
 need(v.nlink===1&&v.uid===0&&(v.mode&0o170000)===0o100000&&(v.mode&0o022)===0&&v.bytes>0&&v.bytes<=(kind==='executable'?268435456:4096),'active_metadata_file_identity_invalid');
 if(kind==='executable')need((v.mode&0o111)!==0,'active_metadata_executable_invalid');return JSON.stringify(['dev','ino','nlink','uid','gid','mode','bytes','mtimeNs','ctimeNs'].map(k=>v[k]));
}
function listenerProjection(rows,port,uid){
 need(Array.isArray(rows)&&rows.length>0&&rows.length<=4,'active_listener_unverified');const out=[];
 for(const r of rows){need(exact(r,['family','localAddress','port','state','uid','inode'])&&['tcp4','tcp6'].includes(r.family)&&r.port===port&&r.state==='0A'&&r.uid===uid&&typeof r.inode==='string'&&/^[1-9][0-9]{0,19}$/.test(r.inode),'active_listener_unverified');need(r.family==='tcp4'?['0100007F','00000000'].includes(r.localAddress):['00000000000000000000000000000000','00000000000000000000000001000000'].includes(r.localAddress),'active_listener_unverified');out.push(JSON.stringify(r));}
 need(new Set(out).size===out.length,'active_listener_unverified');return out.sort();
}
export function projectCheckoutActiveRuntime(input){
 need(exact(input,['activeWireBefore','activeWireAfter','activeIdentityBefore','activeIdentityAfter','pidRecordName','pidWireBefore','pidWireAfter','pidIdentityBefore','pidIdentityAfter','process','executableBefore','executableAfter','executableIdentityBefore','executableIdentityAfter','listenersBefore','listenersAfter','socketLinksBefore','socketLinksAfter']),'active_binding_input_invalid');
 const x=input;need(typeof x.activeWireBefore==='string'&&Buffer.byteLength(x.activeWireBefore)<=4096&&x.activeWireBefore===x.activeWireAfter,'active_release_changed');
 let a;try{a=JSON.parse(x.activeWireBefore);}catch{throw Error('active_release_invalid');}
 need(x.activeWireBefore===JSON.stringify(a)||x.activeWireBefore===JSON.stringify(a)+'\n','active_release_noncanonical');
 need(exact(a,['target','port','directory','name'])&&/^[a-f0-9]{40}$/.test(a.target)&&Number.isInteger(a.port)&&[3000,3100,3101,3102,3103,3104,3105,3106,3107,3108,3109].includes(a.port),'active_release_invalid');
 const short=a.target.slice(0,12);need(a.name==='merchant-space-online-'+short&&a.directory==='/www/wwwroot/merchant-space.web-releases/'+short+'-online','active_release_invalid');
 need(fileIdentity(x.activeIdentityBefore)===fileIdentity(x.activeIdentityAfter)&&x.activeIdentityBefore.bytes===Buffer.byteLength(x.activeWireBefore),'active_release_changed');
 need(typeof x.pidRecordName==='string'&&x.pidRecordName.startsWith(a.name+'-')&&/^[0-9]+\.pid$/.test(x.pidRecordName.slice(a.name.length+1)),'active_pid_record_invalid');
 need(typeof x.pidWireBefore==='string'&&x.pidWireBefore===x.pidWireAfter&&/^[1-9][0-9]{0,7}\n?$/.test(x.pidWireBefore),'active_pid_record_changed');
 need(fileIdentity(x.pidIdentityBefore)===fileIdentity(x.pidIdentityAfter)&&x.pidIdentityBefore.bytes===Buffer.byteLength(x.pidWireBefore),'active_pid_record_changed');
 const p=projectCheckoutProcessSnapshot(x.process);need(p.pid===Number(x.pidWireBefore.trim())&&p.cwd===a.directory,'active_process_mismatch');
 need(x.executableBefore===x.executableAfter&&['/usr/bin/node','/usr/local/bin/node'].includes(x.executableBefore),'active_metadata_executable_invalid');
 need(fileIdentity(x.executableIdentityBefore,'executable')===fileIdentity(x.executableIdentityAfter,'executable'),'active_executable_changed');
 const l=listenerProjection(x.listenersBefore,a.port,p.uids[1]),r=listenerProjection(x.listenersAfter,a.port,p.uids[1]);need(JSON.stringify(l)===JSON.stringify(r),'active_listener_changed');
 const links=v=>{need(Array.isArray(v)&&v.length>0&&v.length<=128&&v.every(s=>typeof s==='string'&&/^socket:\[[1-9][0-9]{0,19}\]$/.test(s))&&new Set(v).size===v.length,'active_socket_owner_unverified');return new Set(v);};
 const b=links(x.socketLinksBefore),c=links(x.socketLinksAfter);for(const q of x.listenersBefore)need(b.has('socket:['+q.inode+']')&&c.has('socket:['+q.inode+']'),'active_socket_owner_unverified');
 return {version:1,state:'observed',activeRecordSha256:hash(x.activeWireBefore),target:a.target,port:a.port,directory:a.directory,name:a.name,pid:p.pid,startTicks:p.startTicks,uids:p.uids,gids:p.gids,groups:p.groups,listenerInodes:x.listenersBefore.map(v=>v.inode).sort(),activeRecordProcessAndListenerBound:true,executableMetadataBound:true,executableBytesVerified:false,pm2SupervisorVerified:false,publicIngressVerified:false,rootApplicationObserved:p.uids[1]===0,signerIsolationApproved:false,productionAuthorized:false,installationAuthorized:false,deploymentAuthorized:false};
}
