// Pure projections for the NEXT approved metadata collector. No host IO,
// connectors, command execution, credentials, installation or authority.
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const need=(v,code)=>{if(!v)throw Error(code);};
const uint=(s,max=4294967295)=>/^(?:0|[1-9][0-9]*)$/.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)<=max;
function lines(raw,max){need(typeof raw==='string'&&Buffer.byteLength(raw)<=max&&!raw.includes('\0'),'metadata_input_invalid');return raw.split('\n');}
function one(rows,key){const found=rows.filter(v=>v.startsWith(key+':'));need(found.length===1,'metadata_field_invalid');return found[0].slice(key.length+1).trim();}
export function projectCheckoutProcStatus(raw){
 const rows=lines(raw,16384),name=one(rows,'Name');
 // Linux comm is untrusted display metadata, not an executable/role identity.
 // Punctuation in e.g. `next-server (v1` is valid. Never return/evaluate it.
 need(name.length>0&&Buffer.byteLength(name)<=64&&!/[\u0000-\u001f\u007f]/u.test(name),'metadata_process_name_invalid');
 const ids=key=>{const s=one(rows,key);need(/^[0-9]+(?:[ \t]+[0-9]+){3}$/.test(s),'metadata_process_ids_invalid');const a=s.split(/[ \t]+/);need(a.every(v=>uint(v)),'metadata_process_ids_invalid');return a.map(Number);};
 const groupText=one(rows,'Groups');need(groupText===''||/^[0-9]+(?:[ \t]+[0-9]+)*$/.test(groupText),'metadata_process_groups_invalid');
 const groups=groupText===''?[]:groupText.split(/[ \t]+/);need(groups.length<=128&&groups.every(v=>uint(v)),'metadata_process_groups_invalid');
 need(new Set(groups).size===groups.length,'metadata_process_groups_invalid');
 return {nameSha256:hash(name),uids:ids('Uid'),gids:ids('Gid'),groups:groups.map(Number)};
}
export function projectCheckoutProcStat(raw,expectedPid){
 need(Number.isSafeInteger(expectedPid)&&expectedPid>0&&expectedPid<=99999999,'metadata_pid_invalid');
 need(typeof raw==='string'&&Buffer.byteLength(raw)<=8192&&!raw.includes('\0'),'metadata_stat_invalid');
 const first=raw.indexOf(' ('),last=raw.lastIndexOf(') ');need(first>0&&last>first&&raw.slice(0,first)===String(expectedPid),'metadata_stat_invalid');
 const comm=raw.slice(first+2,last);need(comm.length>0&&Buffer.byteLength(comm)<=64&&!/[\u0000-\u001f\u007f]/u.test(comm),'metadata_stat_invalid');
 const fields=raw.slice(last+2).trim().split(/\s+/);need(fields.length>=20&&fields.length<=64&&/^[RSDZTWXxKPI]$/.test(fields[0]),'metadata_stat_invalid');
 need(fields.slice(1).every(v=>/^-?[0-9]+$/.test(v))&&uint(fields[19],Number.MAX_SAFE_INTEGER),'metadata_stat_invalid');
 return {pid:expectedPid,startTicks:fields[19],nameSha256:hash(comm)};
}
export function checkoutRuntimeDirectory(value){
 return typeof value==='string'&&(value==='/www/wwwroot/merchant-space'||/^\/www\/wwwroot\/merchant-space\.web-releases\/[a-f0-9]{8,40}(?:-online)?$/.test(value));
}
export function projectCheckoutProcessSnapshot({pid,statBefore,status,cwdBefore,statAfter,cwdAfter}){
 const a=projectCheckoutProcStat(statBefore,pid),b=projectCheckoutProcStat(statAfter,pid),s=projectCheckoutProcStatus(status);
 need(a.startTicks===b.startTicks&&a.nameSha256===b.nameSha256&&a.nameSha256===s.nameSha256,'metadata_process_replaced');
 need(checkoutRuntimeDirectory(cwdBefore)&&cwdBefore===cwdAfter,'metadata_runtime_directory_changed');
 return {state:'observed',pid,startTicks:a.startTicks,cwd:cwdBefore,...s,publicTargetBindingVerified:false,executableIdentityVerified:false,signerIsolationApproved:false,productionAuthorized:false};
}
export function projectCheckoutKongAdminListener(raw){
 const unknown=reason=>({state:'unknown',reason,plainLoopback8001:false,networkReadAuthorized:false});
 if(typeof raw!=='string'||Buffer.byteLength(raw)>1024||raw.includes('\0'))return unknown('listener_projection_invalid');
 const rows=raw.split(/\r?\n/).filter(v=>v.trim()!=='');if(rows.length!==1)return unknown('listener_projection_invalid');
 const match=/^admin_listen[ \t]*=[ \t]*(.+)$/.exec(rows[0]);if(!match)return unknown('listener_projection_invalid');
 if(match[1].trim()==='off')return {state:'observed',disabled:true,listeners:[],plainLoopback8001:false,networkReadAuthorized:false};
 const parts=match[1].split(',').map(v=>v.trim());if(parts.length<1||parts.length>8||parts.some(v=>!v))return unknown('listener_projection_invalid');
 const listeners=[];
 for(const p of parts){
  const tokens=p.split(/[ \t]+/),address=/^(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):([1-9][0-9]{0,4})$/.exec(tokens[0]);
  if(!address||Number(address[2])>65535)return unknown('listener_address_unsupported');
  const flags=tokens.slice(1);if(flags.length>8||new Set(flags).size!==flags.length||flags.some(f=>!['ssl','http2','reuseport','proxy_protocol','deferred','bind'].includes(f)&&!/^backlog=[1-9][0-9]{0,7}$/.test(f)))return unknown('listener_flags_unsupported');
  if(flags.filter(f=>f.startsWith('backlog=')).length>1)return unknown('listener_flags_unsupported');
  const listener={address:address[1],port:Number(address[2]),tls:flags.includes('ssl'),proxyProtocol:flags.includes('proxy_protocol'),flags:[...flags].sort()};
  if(listeners.some(v=>v.address===listener.address&&v.port===listener.port))return unknown('listener_duplicate_binding');listeners.push(listener);
 }
 return {state:'observed',disabled:false,listeners,plainLoopback8001:listeners.some(v=>['127.0.0.1','0.0.0.0'].includes(v.address)&&v.port===8001&&!v.tls&&!v.proxyProtocol),networkReadAuthorized:false};
}
