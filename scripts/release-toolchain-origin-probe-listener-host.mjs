// Read-only listener lifecycle evidence; no reload, write or signal authority.
import * as fs from 'node:fs';
import {ORIGIN_PROBE_LISTENER,originProbeSocketInodes,assertOriginProbeSocketOwnership,isOriginProbeIngressPlan,assertPublicationIngressPlan} from './release-toolchain-origin-probe-ingress.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export function readOriginProbeListenerInodes(port=ORIGIN_PROBE_LISTENER.port){return originProbeSocketInodes(fs.readFileSync('/proc/net/tcp','utf8'),fs.readFileSync('/proc/net/tcp6','utf8'),port);}
export function assertOriginProbeListenerAbsent(){need(readOriginProbeListenerInodes().length===0,'owned_resource_changed');return true;}
export function observeOwnedOriginProbeListener(masterPid,cohort,port=ORIGIN_PROBE_LISTENER.port){
 const evidence=readOwnedOriginProbeSocketEvidence(masterPid,cohort,port);return assertOriginProbeSocketOwnership(evidence.inodes,evidence.owners,cohort,masterPid);
}
export function readOwnedOriginProbeSocketEvidence(masterPid,cohort,port){
 const owners={};for(const pid of [masterPid,...cohort.map(w=>w.pid)]){need(Number.isSafeInteger(pid)&&pid>1,'invalid_contract');const sockets={},epolls=[],active=[];for(const fd of fs.readdirSync('/proc/'+pid+'/fd'))try{const target=fs.readlinkSync('/proc/'+pid+'/fd/'+fd),match=/^socket:\[([1-9][0-9]*)\]$/.exec(target);if(match)sockets[fd]=match[1];if(target==='anon_inode:[eventpoll]')epolls.push(fd);}catch(e){if(e.code!=='ENOENT')throw e;}
  // Nginx workers inherit ALL reuseport descriptors but register only their
  // own listen socket with epoll (ngx_event_process_init). FD ownership alone
  // therefore cannot establish which socket each worker actually accepts.
  for(const fd of epolls){const text=fs.readFileSync('/proc/'+pid+'/fdinfo/'+fd,'utf8');need(Buffer.byteLength(text)<=4*1024**2,'evidence_invalid');for(const line of text.split('\n')){if(!line.startsWith('tfd:'))continue;const m=/^tfd:\s*(\d+)\s+events:\s*[0-9a-f]+\s+data:\s*[0-9a-f]+\s+pos:\s*\d+\s+ino:\s*([0-9a-f]+)\s+sdev:/i.exec(line);need(m,'evidence_invalid');if(sockets[m[1]]){const inode=BigInt('0x'+m[2]).toString();need(inode===sockets[m[1]],'owned_resource_changed');active.push(inode);}}}
  owners[pid]={socketInodes:Object.values(sockets),epollSocketInodes:active};
 }return{inodes:readOriginProbeListenerInodes(port),owners};
}
export async function confirmOriginProbeListenerRemoved(plan,verify){
 assertPublicationIngressPlan(plan);if(!isOriginProbeIngressPlan(plan))return null;const end=Date.now()+10000;
 for(;;){verify();if(readOriginProbeListenerInodes().length===0){verify();return{kind:'temporary-origin-probe-listener-removed',listener:{...ORIGIN_PROBE_LISTENER},observedAt:new Date().toISOString(),listenerAbsent:true,publicationAuthority:false};}need(Date.now()<end,'cleanup_unconfirmed');await new Promise(resolve=>setTimeout(resolve,25));}
}
