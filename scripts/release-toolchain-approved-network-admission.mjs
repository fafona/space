// Read-only host observation of one approved delta, with immutable failed
// qualification provenance. No writer, retry, baseline reset or capability.
import fs from 'node:fs';import{spawnSync}from'node:child_process';
import{captureNftFirewall}from'./production-maintenance-nft.mjs';
import{bookingHostRead}from'./booking-handoff-host-io.mjs';import{ownedReleasePath}from'./release-toolchain-source.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
import{APPROVED_NETWORK_CHANGE as N,approvedNetworkBindingSha256,assertApprovedNetworkPolicy}from'./release-toolchain-approved-network-policy.mjs';
const FILES=Object.freeze({'/etc/firewalld/firewalld.conf':'4ac04cdf9b635396d70ed52b19a825977342146e9e2c8fe4df975e2459338c7f','/etc/firewalld/zones/public.xml':N.configurationSha256,'/etc/firewalld/zones/docker.xml':'d9013c6cfce4c58428f6394f012979511fe86986384c4048983025c52d6b59fb'});
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C',LC_ALL:'C'},timeout:10000,maxBuffer:8*1024**2,windowsHide:true});need(r.status===0&&!r.signal&&!r.error&&r.stderr==='','operation_unconfirmed');return{stdout:r.stdout,stderr:r.stderr};}
export function assertApprovedPublicationNetworkProof(value){
 need(value?.kind==='approved-publication-network-policy'&&value.bindingSha256===approvedNetworkBindingSha256()&&value.historicalSha256===N.historicalSha256&&value.historicalPolicySha256===N.historicalPolicySha256&&value.configurationSha256===sha256(canonicalJson(FILES))&&value.failedQualificationManifestSha256===N.failedManifestSha256&&value.dockerIsolationRestored===true&&value.policyChanged===true&&value.firewalldRunning===true&&value.processControlPerformed===false&&value.networkChanged===false&&value.publicationAuthority===false&&canonicalJson(value.approvedPorts)===canonicalJson(['61000-62000/tcp','61000-62000/udp'])&&value.policySha256===N.approvedPolicySha256&&/^[a-f0-9]{64}$/.test(value.currentInstanceSha256??''),'evidence_invalid');
 return value;
}
export function observeApprovedPublicationNetwork(){
 need(process.platform==='linux'&&process.getuid?.()===0,'unsupported_runtime');
 for(const[file,digest]of Object.entries(FILES)){ownedReleasePath(file);need(sha256(bookingHostRead(file,{privateMode:false}))===digest,'network_policy_changed');}
 need(run('systemctl',['show','firewalld','-p','ActiveState','-p','SubState','-p','UnitFileState']).stdout==='ActiveState=active\nSubState=running\nUnitFileState=enabled\n','network_policy_changed');
 ownedReleasePath(N.failedQualification,{directory:true,privateMode:true});
 const names=fs.readdirSync(N.failedQualification).sort();need(names.length===15&&names.includes('failed.json')&&!names.includes('verified.json'),'evidence_invalid');
 const manifest=names.map(file=>{need(/^[a-z-]+\.json$/.test(file),'evidence_invalid');return{file,sha256:sha256(bookingHostRead(N.failedQualification+'/'+file,{binary:true}))};});
 need(sha256(canonicalJson(manifest))===N.failedManifestSha256&&sha256(bookingHostRead(N.failedQualification+'/failed.json',{binary:true}))===N.failedReceiptSha256,'evidence_invalid');
 const historical=JSON.parse(bookingHostRead('/var/lib/faolla-maintenance/merchant-space/state.json')).ingress.firewall;need(sha256(canonicalJson(historical))===N.historicalSha256,'network_policy_changed');
 const current=captureNftFirewall({run,readText:file=>fs.readFileSync(file,'utf8')}),proof=assertApprovedNetworkPolicy(historical,current);
 return Object.freeze(assertApprovedPublicationNetworkProof({...proof,configurationSha256:sha256(canonicalJson(FILES)),failedQualificationManifestSha256:N.failedManifestSha256,firewalldRunning:true,processControlPerformed:false,networkChanged:false}));
}
