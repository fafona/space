// Admission is an in-process witness, never a caller-supplied green JSON or
// a replacement for the legacy network guard. No network writer exists here.
import fs from'node:fs';import{AsyncLocalStorage}from'node:async_hooks';import{spawnSync}from'node:child_process';
import{captureNftFirewall}from'./production-maintenance-nft.mjs';import{assertRestoredNetworkPolicy}from'./release-toolchain-restored-network-policy.mjs';import{SETTLED_PRE_INGRESS as S,settledPreIngressBindingSha256}from'./release-toolchain-settled-pre-ingress-contract.mjs';
import{bookingHostRead}from'./booking-handoff-host-io.mjs';import{ownedReleasePath}from'./release-toolchain-source.mjs';import{reviewedBookingExecution}from'./release-toolchain-authority.mjs';import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
import{preSupervisorBindingSha256}from'./release-toolchain-pre-supervisor-contract.mjs';
const active=new AsyncLocalStorage(),issued=new WeakSet();
const FILES=Object.freeze({'/etc/firewalld/firewalld.conf':'4ac04cdf9b635396d70ed52b19a825977342146e9e2c8fe4df975e2459338c7f','/etc/firewalld/zones/public.xml':'3901eeaee167c5863d4d0b21531dedf4e3670c53019ad5b679b0755b645c4354','/etc/firewalld/zones/docker.xml':'d9013c6cfce4c58428f6394f012979511fe86986384c4048983025c52d6b59fb'});
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C',LC_ALL:'C'},timeout:10000,maxBuffer:8*1024**2,windowsHide:true});need(r.status===0&&!r.signal&&!r.error&&r.stderr==='','operation_unconfirmed');return{stdout:r.stdout,stderr:r.stderr};}
export function observeRestoredPublicationNetwork(){
 need(process.platform==='linux'&&process.getuid?.()===0,'unsupported_runtime');
 for(const[file,digest]of Object.entries(FILES)){ownedReleasePath(file);need(sha256(bookingHostRead(file,{privateMode:false}))===digest,'network_policy_changed');}
 need(run('systemctl',['show','firewalld','-p','ActiveState','-p','SubState','-p','UnitFileState']).stdout==='ActiveState=active\nSubState=running\nUnitFileState=enabled\n','network_policy_changed');
 const current=captureNftFirewall({run,readText:file=>fs.readFileSync(file,'utf8')}),historical=JSON.parse(bookingHostRead('/var/lib/faolla-maintenance/merchant-space/state.json')).ingress.firewall;
 need(sha256(canonicalJson(historical))===S.historicalFirewallSha256,'network_policy_changed');const proof=assertRestoredNetworkPolicy(historical,current);need(proof.policySha256===S.firewallPolicySha256,'network_policy_changed');
 return Object.freeze({...proof,configurationSha256:sha256(canonicalJson(FILES)),firewalldRunning:true,processControlPerformed:false,networkChanged:false});
}
export async function withPublicationNetworkAdmission(toolRevision,work){
 const authority=reviewedBookingExecution(toolRevision);need(authority&&typeof work==='function'&&!active.getStore(),'invalid_contract');
 if(!authority.prepared.settledPreIngress&&!authority.prepared.preSupervisor)return work();
 need(authority.prepared.preSupervisor?authority.prepared.preSupervisor.bindingSha256===preSupervisorBindingSha256():authority.prepared.settledPreIngress.bindingSha256===settledPreIngressBindingSha256(),'source_changed');const baseline=observeRestoredPublicationNetwork(),context={toolRevision,authority,baseline,closed:false};issued.add(context);
 try{return await active.run(context,async()=>{assertAdmittedPublicationNetwork();const result=await work();assertAdmittedPublicationNetwork();return result;});}finally{context.closed=true;}
}
export function assertAdmittedPublicationNetwork(){const context=active.getStore();if(!context)return null;need(issued.has(context)&&!context.closed&&reviewedBookingExecution(context.toolRevision)===context.authority,'source_changed');const actual=observeRestoredPublicationNetwork();need(canonicalJson(actual)===canonicalJson(context.baseline),'network_policy_changed');return Object.freeze({...actual,publicationAuthority:false});}
