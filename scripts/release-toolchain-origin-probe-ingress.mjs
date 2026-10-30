// New, explicit recovered-publication profile. The original shared-listener
// gate builder/validator is unchanged and continues to reject this profile.
import {isDeepStrictEqual} from 'node:util';
import {createActiveBookingIngressPlan,assertActiveBookingIngressPlan} from './release-toolchain-active-generation-ingress.mjs';
import {BOOKING_INGRESS_MAIN_SHA256,BOOKING_INGRESS_VHOST} from './booking-handoff-ingress.mjs';
import {parseNginx} from './production-maintenance-nginx-profile.mjs';
import {sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const ORIGIN_PROBE_LISTENER=Object.freeze({address:'127.0.0.1',port:3147,tls:true,reuseport:true,temporary:true});
const KIND='booking-recovered-loopback-reuseport-ingress-gate',same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid');
const snippet='\n    # Temporary release-only per-worker TLS probe; never a public listener.\n    listen 127.0.0.1:3147 ssl reuseport;\n';
// Text-only seam for syntax tests; it cannot produce an accepted release plan.
export function appendOriginProbeListenerText(text){
 const tree=parseNginx(text,BOOKING_INGRESS_VHOST);need(tree.length===1&&tree[0].name==='server','evidence_invalid');const at=tree[0].body,afterText=text.slice(0,at)+snippet+text.slice(at),after=parseNginx(afterText,BOOKING_INGRESS_VHOST);
 const original=tree[0].children.filter(n=>n.name==='listen').map(n=>n.args),listeners=after[0].children.filter(n=>n.name==='listen').map(n=>n.args);same(listeners,[['127.0.0.1:3147','ssl','reuseport'],...original]);
 return afterText;
}
export function createOriginProbeIngressPlan(options){
 const base=createActiveBookingIngressPlan(options),afterText=appendOriginProbeListenerText(base.afterText);
 return{...base,schemaVersion:3,kind:KIND,probeListener:{...ORIGIN_PROBE_LISTENER},afterText,afterSha256:sha256(afterText),probeSnippetSha256:sha256(snippet)};
}
export function isOriginProbeIngressPlan(plan){return plan?.kind===KIND;}
export function assertPublicationIngressPlan(plan){
 if(!isOriginProbeIngressPlan(plan))return assertActiveBookingIngressPlan(plan);
 same(plan,createOriginProbeIngressPlan({vhostText:plan.beforeText,mainSha256:BOOKING_INGRESS_MAIN_SHA256,window:plan.window}));return true;
}
export function publicationIngressRestorationText(plan,current){assertPublicationIngressPlan(plan);need(current===plan.beforeText||current===plan.afterText,'owned_resource_changed');return plan.beforeText;}
// Read-only /proc socket evidence. Any wildcard/IPv6/foreign listener at the
// reserved port fails; each current worker must own one DIFFERENT socket.
export function originProbeSocketInodes(tcp,tcp6,port=ORIGIN_PROBE_LISTENER.port){
 need(Number.isSafeInteger(port)&&port>1024&&port<65536,'invalid_contract');const rows=[];
 for(const [text,ipv6]of [[tcp,false],[tcp6,true]]){need(typeof text==='string'&&Buffer.byteLength(text)<=4*1024**2,'evidence_invalid');for(const line of text.trim().split('\n').slice(1)){const fields=line.trim().split(/\s+/);need(fields.length>=10&&/^[A-Fa-f0-9]+:[A-Fa-f0-9]{4}$/.test(fields[1]),'evidence_invalid');if(fields[3]!=='0A'||parseInt(fields[1].split(':')[1],16)!==port)continue;need(!ipv6&&fields[1].split(':')[0]==='0100007F'&&/^[1-9][0-9]*$/.test(fields[9]),'owned_resource_changed');rows.push(fields[9]);}}
 need(new Set(rows).size===rows.length,'evidence_invalid');return rows.sort();
}
export function assertOriginProbeSocketOwnership(inodes,owners,cohort,masterPid){
 need(Array.isArray(cohort)&&cohort.length>0&&cohort.length<=128&&cohort.every(w=>Number.isSafeInteger(w?.pid)&&w.pid>1&&/^[1-9][0-9]*$/.test(w.startTicks??''))&&new Set(cohort.map(w=>w.pid)).size===cohort.length&&Array.isArray(inodes)&&inodes.length===cohort.length&&inodes.every(i=>/^[1-9][0-9]*$/.test(i))&&new Set(inodes).size===inodes.length&&Number.isSafeInteger(masterPid)&&masterPid>1,'gate_not_confirmed');
 same(Object.keys(owners).map(Number).sort((a,b)=>a-b),[masterPid,...cohort.map(w=>w.pid)].sort((a,b)=>a-b));
 same([...owners[masterPid]].filter(i=>inodes.includes(i)).sort(),inodes);const perWorker=cohort.map(w=>{const own=owners[w.pid].filter(i=>inodes.includes(i));need(own.length===1,'gate_not_confirmed');return own[0];});same([...perWorker].sort(),inodes);return{socketInodes:inodes,workerSockets:cohort.map((w,i)=>({...w,socketInode:perWorker[i]}))};
}
