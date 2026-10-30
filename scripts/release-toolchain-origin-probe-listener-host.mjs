// Read-only listener lifecycle evidence; no reload, write or signal authority.
import * as fs from 'node:fs';
import {ORIGIN_PROBE_LISTENER,originProbeSocketInodes,assertOriginProbeSocketOwnership,isOriginProbeIngressPlan,assertPublicationIngressPlan,originProbeEpollAcceptors} from './release-toolchain-origin-probe-ingress.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export function readOriginProbeListenerInodes(port=ORIGIN_PROBE_LISTENER.port){return originProbeSocketInodes(fs.readFileSync('/proc/net/tcp','utf8'),fs.readFileSync('/proc/net/tcp6','utf8'),port);}
export function assertOriginProbeListenerAbsent(){need(readOriginProbeListenerInodes().length===0,'owned_resource_changed');return true;}
export function observeOwnedOriginProbeListener(masterPid,cohort,port=ORIGIN_PROBE_LISTENER.port){
 const evidence=readOwnedOriginProbeSocketEvidence(masterPid,cohort,port);return assertOriginProbeSocketOwnership(evidence.inodes,evidence.owners,cohort,masterPid);
}
export function readOwnedOriginProbeSocketEvidence(masterPid,cohort,port){
 const inodes=readOriginProbeListenerInodes(port),owners={};for(const pid of [masterPid,...cohort.map(w=>w.pid)]){need(Number.isSafeInteger(pid)&&pid>1,'invalid_contract');const sockets={},epolls=[],active=[];for(const fd of fs.readdirSync('/proc/'+pid+'/fd'))try{const target=fs.readlinkSync('/proc/'+pid+'/fd/'+fd),match=/^socket:\[([1-9][0-9]*)\]$/.exec(target);if(match)sockets[fd]=match[1];if(target==='anon_inode:[eventpoll]')epolls.push(fd);}catch(e){if(e.code!=='ENOENT')throw e;}
  // Nginx workers inherit ALL reuseport descriptors but register only their
  // own listen socket with epoll (ngx_event_process_init). FD ownership alone
  // therefore cannot establish which socket each worker actually accepts.
  for(const fd of epolls)active.push(...originProbeEpollAcceptors(fs.readFileSync('/proc/'+pid+'/fdinfo/'+fd,'utf8'),sockets,inodes));
  owners[pid]={socketInodes:Object.values(sockets),epollSocketInodes:active};
 }need(JSON.stringify(readOriginProbeListenerInodes(port))===JSON.stringify(inodes),'owned_resource_changed');return{inodes,owners};
}
export async function confirmOriginProbeListenerRemoved(plan,verify){
 assertPublicationIngressPlan(plan);if(!isOriginProbeIngressPlan(plan))return null;const end=Date.now()+10000;
 for(;;){verify();if(readOriginProbeListenerInodes().length===0){verify();return{kind:'temporary-origin-probe-listener-removed',listener:{...ORIGIN_PROBE_LISTENER},observedAt:new Date().toISOString(),listenerAbsent:true,publicationAuthority:false};}need(Date.now()<end,'cleanup_unconfirmed');await new Promise(resolve=>setTimeout(resolve,25));}
}
