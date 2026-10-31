// Explicit user-approved policy delta. This is NOT equivalence with the old
// policy, a caller-selected baseline, or permission to ignore further drift.
import {isDeepStrictEqual} from 'node:util';
import {validateNftFirewall} from './production-maintenance-nft.mjs';
import {assertRestoredNetworkPolicy} from './release-toolchain-restored-network-policy.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const APPROVED_NETWORK_CHANGE=Object.freeze({
 kind:'retained-cloud-ports-restored-docker-isolation-v1',
 historicalSha256:'30c402dcbbb400398e94fd278fac2f9a36c5942970ad0e8f2b2f6adc95fa6edd',
 historicalPolicySha256:'10e39f3236f8e2ed446b5fd8bdc96a181a6a73e36999127e2126bf3c8b2f26b0',
 approvedPolicySha256:'84368bd11f33264115dadd5a12a77a96d3a4489df675fdf5961930e03adf2a6f',
 configurationSha256:'dcf6595b93f4c858fa42f5132c632b5ead861f19694b7e80504944c3b97e51bc',
 failedQualification:'/var/lib/faolla-booking-active-qualifications/b49808d6-1950-4cb4-b029-97086873d7a7/95379c986a5ed0ea5e444b7b061fcef2ebc5c4d1/attempt_1793418826351_6842eef7-e5bb-481e-a626-d3ccc7846635',
 failedManifestSha256:'202558981c9be4d858c8294da1268a555175de912a6b5f98da19257dc5d97fd2',
 failedReceiptSha256:'67837ce2f6fd72ee738b518020385b56681eaac84fe40f184cb06eac97c3cc87',
});
export const approvedNetworkBindingSha256=()=>sha256(canonicalJson(APPROVED_NETWORK_CHANGE));
const same=(a,b)=>need(isDeepStrictEqual(a,b),'network_policy_changed');
export function approvedCloudPortRules(){return ['tcp','udp'].map(protocol=>({rule:{family:'inet',table:'firewalld',chain:'filter_IN_public_allow',expr:[{match:{op:'==',left:{payload:{protocol,field:'dport'}},right:{range:[61000,62000]}}},{match:{op:'==',left:{ct:{key:'state'}},right:{set:[8,64]}}},{accept:null}]}}));}
const withoutHandle=row=>{const{handle,...rule}=row.rule;void handle;return{rule};};
export function assertApprovedNetworkPolicy(historical,current){
 const old=validateNftFirewall(historical),actual=validateNftFirewall(current),expected=approvedCloudPortRules(),seen=[];
 const allow=actual.baseline.nftables.filter(x=>x.rule?.family==='inet'&&x.rule.table==='firewalld'&&x.rule.chain==='filter_IN_public_allow');
 same(allow.slice(-2).map(withoutHandle),expected);
 const projected=structuredClone(actual);projected.baseline.nftables=projected.baseline.nftables.filter(row=>{
  if(!row.rule)return true;const i=expected.findIndex(x=>isDeepStrictEqual(x,withoutHandle(row)));
  if(i<0)return true;need(!seen.includes(i),'network_policy_changed');seen.push(i);return false;
 });same(seen,[0,1]);
 // All legacy saves and all remaining nft expressions/order/policies still
 // pass the ORIGINAL complete equivalence checker, including six isolation
 // rules. No rule is reconstructed or ignored by the admission path.
 const original=assertRestoredNetworkPolicy(old,projected),approved=assertRestoredNetworkPolicy(actual,actual);
 return Object.freeze({kind:'approved-publication-network-policy',bindingSha256:approvedNetworkBindingSha256(),historicalSha256:original.historicalSha256,historicalPolicySha256:original.policySha256,policySha256:approved.policySha256,currentInstanceSha256:approved.currentInstanceSha256,approvedPorts:['61000-62000/tcp','61000-62000/udp'],dockerIsolationRestored:true,policyChanged:true,publicationAuthority:false});
}
// A pure, bounded plan for this already-diagnosed six-rule loss. The actual
// administrative repair is separate from admission and never runs on publish.
export function planMissingDockerIsolationRestoration(historical,current){
 const old=validateNftFirewall(historical),actual=validateNftFirewall(current),expected=structuredClone(actual),rules=[];
 for(const chain of ['DOCKER-ISOLATION-STAGE-1','DOCKER-ISOLATION-STAGE-2']){
  const select=x=>x.rule?.family==='ip'&&x.rule.table==='filter'&&x.rule.chain===chain;
  const prior=old.baseline.nftables.filter(select),present=actual.baseline.nftables.filter(select);
  need(prior.length===4&&present.length===1,'network_policy_changed');same(withoutHandle(present[0]),withoutHandle(prior[3]));
  const index=expected.baseline.nftables.findIndex(select);expected.baseline.nftables.splice(index,1,...prior.slice(0,3),present[0]);
  const legacy=old.legacy4.split('\n').filter(x=>x.startsWith('[0:0] -A '+chain+' '));need(legacy.length===4,'network_policy_changed');
  const currentLegacy=actual.legacy4.split('\n').filter(x=>x.startsWith('[0:0] -A '+chain+' '));same(currentLegacy,[legacy[3]]);
  expected.legacy4=expected.legacy4.replace(legacy[3],legacy.join('\n'));
  rules.push(...prior.slice(0,3).map(withoutHandle));
 }
 assertApprovedNetworkPolicy(old,expected);
 return Object.freeze({expected,batch:{nftables:rules.toReversed().map(({rule})=>({insert:{rule}}))},rules:6});
}
