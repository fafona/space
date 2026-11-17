// One explicitly approved retained-build continuation. No generic rolled-back
// publication admission is changed by this fixed scope.
import {isDeepStrictEqual} from 'node:util';
import {assertUnchangedApplicationSource} from './release-toolchain-source.mjs';
export const CHAT_TARGET='a1f3b29cb345b7a804e8a1e5a062c74bcb7fbbf2';
export const CHAT_BASELINE='110b022d08d56d51aa86e650f83ced75e4b31cc6';
export const CHAT_REVIEWED_PARENT='3ec8cfb1a167a93e522a95221651806041eade8c';
export {CHAT_PINS} from './application-release-chat-pins.mjs';
export const CHAT_CONTINUATION_FILES=Object.freeze([
 "release/application-release.json",
 "scripts/application-release-chat-pins.mjs",
 "scripts/application-release-chat-policy.mjs",
 "scripts/application-release-chat-policy.test.mjs",
 "scripts/application-release-chat-source.mjs",
 "scripts/application-release-chat-continuation.mjs",
 "scripts/application-release-chat-continuation.test.mjs",
 "scripts/application-release-chat-native.mjs",
 "scripts/application-release-authority.mjs",
 "scripts/application-release-audit.mjs",
 "scripts/online-traffic-release.mjs",
 "scripts/online-release-retention-writer.mjs"
]);
const need=(v,c)=>{if(!v)throw Error('chat_continuation_'+c);};
export function assertChatContinuationDelta(applicationRows,toolRows){
 const old=new Map(applicationRows.map(x=>[x.file,x])),next=new Map(toolRows.map(x=>[x.file,x]));
 const changed=[...new Set([...old.keys(),...next.keys()])].filter(f=>!isDeepStrictEqual(old.get(f),next.get(f))).sort();
 need(isDeepStrictEqual(changed,[...CHAT_CONTINUATION_FILES].sort()),'exact_tool_scope');
 for(const file of changed)need(next.get(file)?.mode==='100644'&&(!old.has(file)||old.get(file).mode==='100644'),'tool_file_mode');
 return assertUnchangedApplicationSource(CHAT_TARGET,applicationRows,toolRows);
}
export function assertChatContinuationInvocation({argv,directory,platform,uid,executable}){
 const tool=directory.split('/').at(-1);
 need(platform==='linux'&&uid===0&&executable==='/usr/bin/node'&&/^[a-f0-9]{40}$/.test(tool)&&tool!==CHAT_TARGET&&
  directory==='/var/lib/faolla-online-code/'+tool&&Array.isArray(argv)&&argv.length===3&&argv[0]==='/usr/bin/node'&&
  argv[1]===directory+'/scripts/application-release-chat-continuation.mjs'&&['start','run','recover','audit'].includes(argv[2]),'invocation');
 return{toolRevision:tool,target:CHAT_TARGET,baseline:CHAT_BASELINE,action:argv[2]};
}
export function chatContinuationPhase(state,active){
 need(state?.target===CHAT_TARGET&&state.baseline===CHAT_BASELINE&&state.lane==='reviewed-application-code-only-v1'&&
  [CHAT_TARGET,CHAT_BASELINE].includes(active?.target),'state_identity');
 if(state.status==='rolled-back'&&active.target===CHAT_BASELINE)return'restored';
 if(state.status==='activating')return'partial';
 if(state.status==='active'&&active.target===CHAT_TARGET)return state.applicationCompletion?.status==='completed'?'completed':'active';
 throw Error('chat_continuation_unknown_phase');
}
export function assertChatOperationOwner(owner,{toolRevision,operation,operationBirth,deploy}){
 need(owner&&isDeepStrictEqual(Object.keys(owner).sort(),['kind','target','toolRevision','id','controller','operation','operationBirth','deploy','at'].sort())&&
  owner.kind==='chat-continuation-operation-owner'&&owner.target===CHAT_TARGET&&owner.toolRevision===toolRevision&&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.id??'')&&Number.isFinite(Date.parse(owner.at)),'owner_shape');
 const c=owner.controller;
 need(c&&isDeepStrictEqual(Object.keys(c).sort(),['pid','uid','parentPid','startTicks','executable','cwd','commandSha256','environmentSha256'].sort())&&
  Number.isSafeInteger(c.pid)&&c.pid>0&&Number.isSafeInteger(c.parentPid)&&c.parentPid>0&&c.uid===0&&/^[1-9]\d*$/.test(c.startTicks??'')&&
  c.cwd==='/var/lib/faolla-online-code/'+toolRevision&&c.executable==='/usr/bin/node'&&/^[a-f0-9]{64}$/.test(c.commandSha256??'')&&/^[a-f0-9]{64}$/.test(c.environmentSha256??''),'owner_controller');
 need(isDeepStrictEqual(owner.operation,operation)&&isDeepStrictEqual(owner.operationBirth,operationBirth)&&isDeepStrictEqual(owner.deploy,deploy),'owner_identity');return true;
}
export async function executeChatScopeClosure(operations,work){
 const value=await work();await operations.verify();
 const target=value?.actualTarget,proof=target===CHAT_TARGET?value.proof:value.publicProof;
 const publicProof=target===CHAT_TARGET?proof?.publicProof:proof;
 need([CHAT_TARGET,CHAT_BASELINE].includes(target)&&Array.isArray(publicProof)&&publicProof.length===2&&
  ['https://faolla.com','https://launch.faolla.com'].every(origin=>publicProof.filter(p=>p.origin===origin&&p.status===200&&p.buildId===target).length===1),'closure_public_proof');
 if(target===CHAT_TARGET)need(proof.kind==='ordinary-application-release-readonly-verified'&&proof.target===target&&proof.baseline===CHAT_BASELINE&&
  /^[a-f0-9]{64}$/.test(proof.certificateSha256??'')&&proof.workerPid>0&&proof.mailEnabled===false&&proof.businessDataWrittenByAudit===false&&proof.savedProcessConfigurationVerified===true,'closure_completion');
 else need(value.restored===true,'closure_restoration');
 await operations.seal(value);await operations.verify();await operations.archive();return value;
}

// A retained certificate predates this new activation. Never count old cycles
// as proof of this attempt; ordinary and older release profiles are untouched.
export function chatCycleAfter(state,certificate){
 const activated=Date.parse(state?.activatedAt),retained=Date.parse(certificate?.completedAt);
 need(state?.target===CHAT_TARGET&&certificate?.active?.target===CHAT_TARGET&&Number.isFinite(activated)&&Number.isFinite(retained),'cycle_boundary');
 return Math.max(activated,retained);
}

// A recovered rollback is not a publication. A recovered active release must
// pass a NEW independent audit and preservation check before its outer receipt.
export async function completeChatRecovery(value,operations){
 if(value?.actualTarget===CHAT_BASELINE){need(value.restored===true,'recovery_restoration');return value;}
 need(value?.actualTarget===CHAT_TARGET,'recovery_target');
 const proof=await operations.audit();
 const completed={...value,proof};
 await executeChatScopeClosure({verify:operations.verify,seal:operations.seal,archive:()=>{}},async()=>completed);
 return completed;
}
