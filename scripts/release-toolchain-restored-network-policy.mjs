// Read-only equivalence proof for a restored firewalld instance. Runtime
// handles are not policy, but no policy/opaque xt field may be ignored. The
// complete legacy saves remain mandatory alongside the strict nft reader.
import {isDeepStrictEqual} from 'node:util';
import {validateNftFirewall} from './production-maintenance-nft.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'network_policy_changed');
const reorderable=new Set(['filter:FORWARD','filter:DOCKER','nat:DOCKER','nat:POSTROUTING']);
function legacyChains(text){
 const result=new Map();let table=null;
 for(const line of text.split('\n')){
  if(line.startsWith('*')){table=line.slice(1);continue;}
  const rule=/^\[0:0\] -A ([A-Za-z0-9_.:-]+) (.+)$/.exec(line);
  if(rule){const key=table+':'+rule[1];if(!result.has(key))result.set(key,[]);result.get(key).push(rule[2]);}
 }
 return result;
}
function normalizedLegacy(text){
 const chains=legacyChains(text),user=chains.get('filter:DOCKER-USER');
 const forward=chains.get('filter:FORWARD');
 if(forward){need(isDeepStrictEqual(user,['-j RETURN']),'network_policy_changed');same([...forward.slice(0,2)].sort(),['-j DOCKER-ISOLATION-STAGE-1','-j DOCKER-USER']);}
 for(const[key,rows]of chains){
  if(!reorderable.has(key))continue;
  if(key==='filter:FORWARD')continue;
  if(key==='nat:DOCKER'){const first=rows.findIndex(x=>!x.endsWith('-j RETURN'));need(first<0||rows.slice(first).every(x=>!x.endsWith('-j RETURN')),'network_policy_changed');}
  if(key==='nat:POSTROUTING'){const first=rows.findIndex(x=>x.includes('/32'));need(first<0||rows.slice(first).every(x=>x.includes('/32')),'network_policy_changed');}
  const independent=[];
  for(const row of rows){
   let match;
   if(key==='filter:DOCKER')match=/^-d (172\.[0-9]+\.[0-9]+\.[0-9]+)\/32 ! -i (br-[a-f0-9]{12}) -o \2 -p tcp -m tcp --dport ([0-9]+) -j ACCEPT$/.exec(row);
   if(key==='nat:DOCKER'){
    if(/^-i (?:docker0|br-[a-f0-9]{12}) -j RETURN$/.test(row))continue;
    match=/^! -i br-[a-f0-9]{12} -p tcp -m tcp --dport ([0-9]+) -j DNAT --to-destination (172\.[0-9]+\.[0-9]+\.[0-9]+):\1$/.exec(row);
   }
   if(key==='nat:POSTROUTING'){
    if(/^-s 172\.[0-9]+\.0\.0\/16 ! -o (?:docker0|br-[a-f0-9]{12}) -j MASQUERADE$/.test(row))continue;
    match=/^-s (172\.[0-9]+\.[0-9]+\.[0-9]+)\/32 -d \1\/32 -p tcp -m tcp --dport ([0-9]+) -j MASQUERADE$/.exec(row);
   }
   need(match,'network_policy_changed');
   // The exact same distinct rules must be present in both snapshots. This
   // is not a general permission to sort overlapping routing/firewall rules.
   const identity=key==='nat:DOCKER'?match[1]:key==='filter:DOCKER'?match[1]+':'+match[3]:match[1]+':'+match[2];
   need(!independent.includes(identity),'network_policy_changed');independent.push(identity);
  }
 }
 const normalized=new Map([...chains].map(([key,rows])=>[key,reorderable.has(key)?key==='filter:FORWARD'?[...rows.slice(0,2)].sort().concat(rows.slice(2)):key==='nat:DOCKER'?rows.filter(x=>x.endsWith('-j RETURN')).concat(rows.filter(x=>!x.endsWith('-j RETURN')).sort()):key==='nat:POSTROUTING'?rows.filter(x=>!x.includes('/32')).concat(rows.filter(x=>x.includes('/32')).sort()):[...rows].sort():rows]));
 // Retain all table declarations, chain policies, headers and table order.
 const used=new Set();let table=null;return text.split('\n').flatMap(line=>{if(line.startsWith('*'))table=line.slice(1);const rule=/^\[0:0\] -A ([A-Za-z0-9_.:-]+) (.+)$/.exec(line);if(!rule)return[line];const key=table+':'+rule[1];if(used.has(key))return[];used.add(key);return normalized.get(key).map(value=>'[0:0] -A '+rule[1]+' '+value);}).join('\n');
}
function normalizedNft(snapshot){
 const rows=snapshot.baseline.nftables.map(row=>{const[k,value]=Object.entries(row)[0];if(k==='metainfo')return row;const{handle,...rest}=value;void handle;return{[k]:rest};});
 const sorted=new Map();for(const row of rows){const r=row.rule;if(r&&r.family==='ip'&&reorderable.has(r.table+':'+r.chain)){const key=r.table+':'+r.chain;if(!sorted.has(key))sorted.set(key,[]);sorted.get(key).push(row);}}
 // Legacy proofs above establish the only permitted reorderings, including
 // every opaque xt match/target. nft still preserves every rule expression.
 for(const values of sorted.values())values.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0);
 const index=new Map();return rows.map(row=>{const r=row.rule,key=r?.table+':'+r?.chain;if(r?.family!=='ip'||!sorted.has(key))return row;const n=index.get(key)??0;index.set(key,n+1);return sorted.get(key)[n];});
}
export function assertRestoredNetworkPolicy(historical,current){
 const old=validateNftFirewall(historical),actual=validateNftFirewall(current);
 const omit=x=>{const{baseline,legacy4,...rest}=x;void baseline;void legacy4;return rest;};same(omit(old),omit(actual));same(normalizedLegacy(old.legacy4),normalizedLegacy(actual.legacy4));
 const policy=normalizedNft(old);same(policy,normalizedNft(actual));return Object.freeze({kind:'restored-network-policy-equivalent',policySha256:sha256(canonicalJson(policy)),historicalSha256:sha256(canonicalJson(old)),currentInstanceSha256:sha256(canonicalJson(actual)),runtimeHandlesRebound:true,policyChanged:false,publicationAuthority:false});
}
