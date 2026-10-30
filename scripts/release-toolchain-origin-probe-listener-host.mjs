// Read-only listener lifecycle evidence; no reload, write or signal authority.
import * as fs from 'node:fs';
import {ORIGIN_PROBE_LISTENER,originProbeSocketInodes,assertOriginProbeSocketOwnership,isOriginProbeIngressPlan,assertPublicationIngressPlan} from './release-toolchain-origin-probe-ingress.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export function readOriginProbeListenerInodes(port=ORIGIN_PROBE_LISTENER.port){return originProbeSocketInodes(fs.readFileSync('/proc/net/tcp','utf8'),fs.readFileSync('/proc/net/tcp6','utf8'),port);}
export function assertOriginProbeListenerAbsent(){need(readOriginProbeListenerInodes().length===0,'owned_resource_changed');return true;}
export function observeOwnedOriginProbeListener(masterPid,cohort,port=ORIGIN_PROBE_LISTENER.port){
 const owners={};for(const pid of [masterPid,...cohort.map(w=>w.pid)]){need(Number.isSafeInteger(pid)&&pid>1,'invalid_contract');owners[pid]=[];for(const fd of fs.readdirSync('/proc/'+pid+'/fd'))try{const target=fs.readlinkSync('/proc/'+pid+'/fd/'+fd),match=/^socket:\[([1-9][0-9]*)\]$/.exec(target);if(match)owners[pid].push(match[1]);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return assertOriginProbeSocketOwnership(readOriginProbeListenerInodes(port),owners,cohort,masterPid);
}
export async function confirmOriginProbeListenerRemoved(plan,verify){
 assertPublicationIngressPlan(plan);if(!isOriginProbeIngressPlan(plan))return null;const end=Date.now()+10000;
 for(;;){verify();if(readOriginProbeListenerInodes().length===0){verify();return{kind:'temporary-origin-probe-listener-removed',listener:{...ORIGIN_PROBE_LISTENER},observedAt:new Date().toISOString(),listenerAbsent:true,publicationAuthority:false};}need(Date.now()<end,'cleanup_unconfirmed');await new Promise(resolve=>setTimeout(resolve,25));}
}
