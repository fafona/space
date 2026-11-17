// One explicitly approved retained-build continuation. No generic rolled-back
// publication admission is changed by this fixed scope.
import {isDeepStrictEqual} from 'node:util';
import {assertUnchangedApplicationSource} from './release-toolchain-source.mjs';
import {createHash} from 'node:crypto';
export const STARTUP_TARGET='4963116f54bcab64ae397e06ecf323838fe2e3be';
export const STARTUP_BASELINE='dadbced2d579b991a62f83edde6cc87bc964a280';
export const STARTUP_PINS=Object.freeze({"target":"4963116f54bcab64ae397e06ecf323838fe2e3be","baseline":"dadbced2d579b991a62f83edde6cc87bc964a280","preserved":{"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf":{"sha256":"cfee2a86ff0b9d73b2f19e37607d4c4d877f6d87529a657d240754589c79f59d","metadata":{"dev":"64769","ino":"2363870","mode":"33152","uid":"0","nlink":"1","size":"686","mtimeNs":"1794871467963832286","ctimeNs":"1794871467963832286","birthtimeNs":"1794871467963832286"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/after-faolla_contact_card_release.conf":{"sha256":"823e54d12d470a324cfa0597f27778ae241a4c8ea0f1dc624a901bb99643fc0c","metadata":{"dev":"64769","ino":"2363874","mode":"33152","uid":"0","nlink":"1","size":"1466","mtimeNs":"1794871467964832295","ctimeNs":"1794871467964832295","birthtimeNs":"1794871467964832295"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/after-no_store_entries_www.faolla.com.conf":{"sha256":"3fdc070ff0770d955bc07d4d28b5df7d94ba773676c24492efcd235b106024f9","metadata":{"dev":"64769","ino":"2363872","mode":"33152","uid":"0","nlink":"1","size":"3932","mtimeNs":"1794871467964832295","ctimeNs":"1794871467964832295","birthtimeNs":"1794871467964832295"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/attendance-build-proof.json":{"sha256":"98067be71845c1baf1d9e0191ed9d5503ee19e0c6a859b119f76433e3b4d8bfc","metadata":{"dev":"64769","ino":"2363897","mode":"33152","uid":"0","nlink":"1","size":"317","mtimeNs":"1794871843196627960","ctimeNs":"1794871843196627960","birthtimeNs":"1794871843195627950"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf":{"sha256":"ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c","metadata":{"dev":"64769","ino":"2363869","mode":"33152","uid":"0","nlink":"1","size":"686","mtimeNs":"1794871467963832286","ctimeNs":"1794871467963832286","birthtimeNs":"1794871467963832286"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/before-faolla_contact_card_release.conf":{"sha256":"2407039bef8f15a27cfeb37ac0eb7db89e1c83f190a543495e460f0df8bd6bfa","metadata":{"dev":"64769","ino":"2363873","mode":"33152","uid":"0","nlink":"1","size":"1466","mtimeNs":"1794871467964832295","ctimeNs":"1794871467964832295","birthtimeNs":"1794871467964832295"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/before-no_store_entries_www.faolla.com.conf":{"sha256":"2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52","metadata":{"dev":"64769","ino":"2363871","mode":"33152","uid":"0","nlink":"1","size":"3932","mtimeNs":"1794871467964832295","ctimeNs":"1794871467964832295","birthtimeNs":"1794871467964832295"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/runtime.json":{"sha256":"d33847670232aeb9a8158935a69d5889e6855b592c993be025bd6d37f85a3516","metadata":{"dev":"64769","ino":"2363877","mode":"33152","uid":"0","nlink":"1","size":"15506","mtimeNs":"1794871473645889763","ctimeNs":"1794871473645889763","birthtimeNs":"1794871473645889763"}},"/var/lib/faolla-online-release/4963116f54bcab64ae397e06ecf323838fe2e3be/state.json":{"sha256":"6b7c3b8513fbeb649850482260d43f505ba38fffc52ba09659176dfa0ebc14d9","metadata":{"dev":"64769","ino":"2363900","mode":"33152","uid":"0","nlink":"1","size":"43862","mtimeNs":"1794872728551746737","ctimeNs":"1794872728551746737","birthtimeNs":"1794872728551746737"}}},"build":{"files":2107,"sha256":"9136b3e13ff4db60c795ce4d00c555ed7241f8f5b22c99af67287901b3830650"},"applicationEnvironment":{"sha256":"d52aefaec37aebce8f7f0d3a94bd1ceccccab558c83c884a4cc0a5b0a6ae2348","metadata":{"dev":"64769","ino":"4487585","mode":"33152","uid":"0","nlink":"1","size":"15537","mtimeNs":"1794871473644889752","ctimeNs":"1794871473644889752","birthtimeNs":"1794871473644889752"}},"candidate":{"name":"merchant-space-online-4963116f54bc","directory":"/www/wwwroot/merchant-space.web-releases/4963116f54bc-online","port":3106},"active":{"sha256":"61d274086498ff094f5ff2784c6ca4ffb82273f1591e43a6de566a4138e8e399","metadata":{"dev":"64769","ino":"607746","mode":"33152","uid":"0","nlink":"1","size":"184","mtimeNs":"1794872728551746737","ctimeNs":"1794872728551746737","birthtimeNs":"1794872728551746737"},"target":"dadbced2d579b991a62f83edde6cc87bc964a280"},"head":{"headSha256":"fe5931c9b3cf07ab493f236df1b621d1c282c1735e6c75756aa69a85142d4ec3","policy":"current-plus-one-v2","sequence":66,"version":2,"pin":{"sha256":"0b34077c3665a4f6cdf5bfedb19262e6438cd8066122e571ba52c9c8b44f69ee","metadata":{"dev":"64769","ino":"436095","mode":"33152","uid":"0","nlink":"1","size":"139","mtimeNs":"1794893894090444697","ctimeNs":"1794893894093444731","birthtimeNs":"1794893894090444697"}}},"history":[{"file":"/var/lib/faolla-online-retention/000065/certificate.json","pin":{"sha256":"94f82e1240c3fe642a8d2d1640240b1111f8bcd56492f5d32a53a4e6d08c7ac1","metadata":{"dev":"64769","ino":"2363899","mode":"33152","uid":"0","nlink":"1","size":"33897","mtimeNs":"1794872046033679768","ctimeNs":"1794872046033679768","birthtimeNs":"1794872046033679768"}},"sequence":65,"kind":"converge","previousSha256":"6fdaa00fd53088ff452f61841a801fe348e5baefa33c4ee68bf3e9671589c09f","active":"4963116f54bcab64ae397e06ecf323838fe2e3be","rollback":"dadbced2d579b991a62f83edde6cc87bc964a280","worker":{"args":[],"automationEnabled":"0","autorestart":true,"backgroundPaused":"0","createdAt":1794287111984,"cronRestart":null,"cwd":"/www/wwwroot/merchant-space.web-releases/f274ad615550-online","environmentSha256":"3090c20facd7105887baf497cc2117a49c7fec3ef868355c4822fce86992ca08","execMode":"fork_mode","executable":"/var/lib/faolla-online-code/37fe3c3b8220c73090ba953c7d046a63a5ab1bfc/scripts/booking-atomic-worker.mjs","interpreter":"/usr/bin/node","invitationEnabled":"0","killTimeout":null,"name":"merchant-space-booking-atomic-f274ad615550","nodeArgs":[],"pid":685108,"pmId":24,"port":null,"restartCount":1,"shutdownWithMessage":false,"status":"online","watch":false},"completedAt":"2026-11-16T23:34:05.240Z"},{"file":"/var/lib/faolla-online-retention/000066/certificate.json","pin":{"sha256":"816f713b4d5d5c777f168d9bce50a702d741406260fbfc50a69e207732947d20","metadata":{"dev":"64769","ino":"2889925","mode":"33152","uid":"0","nlink":"1","size":"35453","mtimeNs":"1794893893213434845","ctimeNs":"1794893893213434845","birthtimeNs":"1794893893213434845"}},"sequence":66,"kind":"booking-worker","previousSha256":"16f2864ac509dcd56652e4ea0e0c294621cac13e00d03016eb2cd1c4f27c41fb","active":"4963116f54bcab64ae397e06ecf323838fe2e3be","rollback":"dadbced2d579b991a62f83edde6cc87bc964a280","worker":{"args":[],"automationEnabled":"0","autorestart":true,"backgroundPaused":"0","createdAt":1794893889115,"cronRestart":null,"cwd":"/www/wwwroot/merchant-space.web-releases/f274ad615550-online","environmentSha256":"3090c20facd7105887baf497cc2117a49c7fec3ef868355c4822fce86992ca08","execMode":"fork_mode","executable":"/var/lib/faolla-online-code/83cc1d52a6c223bf8437990d31105db052b78d54/scripts/booking-atomic-worker.mjs","interpreter":"/usr/bin/node","invitationEnabled":"0","killTimeout":null,"name":"merchant-space-booking-atomic-f274ad615550","nodeArgs":[],"pid":1981274,"pmId":24,"port":null,"restartCount":2,"shutdownWithMessage":false,"status":"online","watch":false},"completedAt":"2026-11-17T05:38:12.282Z"}],"gate":{"file":"/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa/worker-enabled.json","sha256":"803239b45780b35ad7c265da57f39f053764cf79d8c7d4c9e8799f1ebc9ecab6","metadata":{"dev":"64769","ino":"4386129","mode":"33152","uid":"0","nlink":"1","size":"323","mtimeNs":"1793447213688877793","ctimeNs":"1793447213688877793","birthtimeNs":"1793447213688877793"}},"workerRecovery":{"file":"/var/lib/faolla-booking-registry-recovery/83cc1d52a6c223bf8437990d31105db052b78d54/completed.json","sha256":"533a753b652a0b754638f6de37c8606ac897594d3eaf3545018f475f76110da1","metadata":{"dev":"64769","ino":"2363914","mode":"33152","uid":"0","nlink":"1","size":"841","mtimeNs":"1794894032731936650","ctimeNs":"1794894032731936650","birthtimeNs":"1794894032731936650"}},"processes":[{"name":"merchant-space-booking-atomic-f274ad615550","pid":1981274,"pmId":24,"restartCount":2,"status":"online","directory":"/www/wwwroot/merchant-space.web-releases/f274ad615550-online","executable":"/var/lib/faolla-online-code/83cc1d52a6c223bf8437990d31105db052b78d54/scripts/booking-atomic-worker.mjs","port":null},{"name":"merchant-space-online-dadbced2d579","pid":787160,"pmId":43,"restartCount":0,"status":"online","directory":"/www/wwwroot/merchant-space.web-releases/dadbced2d579-online","executable":"/www/wwwroot/merchant-space.web-releases/dadbced2d579-online/node_modules/next/dist/bin/next","port":"3103"},{"name":"merchant-space-online-4963116f54bc","pid":1198076,"pmId":44,"restartCount":0,"status":"online","directory":"/www/wwwroot/merchant-space.web-releases/4963116f54bc-online","executable":"/www/wwwroot/merchant-space.web-releases/4963116f54bc-online/node_modules/next/dist/bin/next","port":"3106"}],"originalRollbackHead":"16f2864ac509dcd56652e4ea0e0c294621cac13e00d03016eb2cd1c4f27c41fb","stateStatus":"rolled-back","stateKeys":["activatedAt","applicationBaselineEnvironmentFileSha256","applicationBaselinePid","applicationBuildProofSha256","applicationDependenciesSha256","applicationDependencyLockSha256","applicationEnvironmentFileSha256","applicationInheritedEnvironmentSha256","applicationManifestSha256","applicationPriorStatesSha256","applicationRetention","applicationRuntimeSha256","baseDirectory","baseline","checkedAssets","configs","directory","lane","maintenanceHash","markerHash","name","oldDirectory","oldName","oldPort","port","previousActive","processes","retentionHeadSha256","retentionRollbackHeadSha256","rolledBackAt","startedAt","staticFiles","status","target"],"configs":{"e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf":{"oldHash":"ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c","newHash":"cfee2a86ff0b9d73b2f19e37607d4c4d877f6d87529a657d240754589c79f59d"},"no_store_entries_www.faolla.com.conf":{"oldHash":"2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52","newHash":"3fdc070ff0770d955bc07d4d28b5df7d94ba773676c24492efcd235b106024f9"},"faolla_contact_card_release.conf":{"oldHash":"2407039bef8f15a27cfeb37ac0eb7db89e1c83f190a543495e460f0df8bd6bfa","newHash":"823e54d12d470a324cfa0597f27778ae241a4c8ea0f1dc624a901bb99643fc0c"}},"operationLockPresent":false,"sourceHead":"4963116f54bcab64ae397e06ecf323838fe2e3be","sourceDirty":"","at":"2026-11-17T06:10:44.943Z"});
export const STARTUP_CONTINUATION_FILES=Object.freeze([
 "docs/booking-registry-capacity-recovery-20261117.md",
 "docs/startup-retained-continuation-20261117.md",
 "scripts/application-release-audit.mjs",
 "scripts/application-release-authority.mjs",
 "scripts/application-release-startup-continuation.mjs",
 "scripts/application-release-startup-continuation.test.mjs",
 "scripts/application-release-startup-native.mjs",
 "scripts/application-release-startup-policy.mjs",
 "scripts/application-release-startup-policy.test.mjs",
 "scripts/application-release-startup-source.mjs",
 "scripts/attendance-staged-tool-repair.test.mjs",
 "scripts/online-release-retention-writer.mjs",
 "scripts/online-traffic-release.mjs",
 "scripts/online-unpublished-candidate.test.mjs",
 "scripts/release-toolchain-pm2-observation.mjs",
 "scripts/release-toolchain-pm2-real-acceptance.mjs",
 "scripts/release-toolchain-registry-capacity-adapter.mjs",
 "scripts/release-toolchain-registry-capacity-dump.py",
 "scripts/release-toolchain-registry-capacity-native.test.py",
 "scripts/release-toolchain-registry-capacity.py",
 "scripts/release-toolchain-registry-capacity.test.py",
 "scripts/release-toolchain-registry-recovery-pm2.py",
 "scripts/release-toolchain-registry-recovery-policy.mjs",
 "scripts/release-toolchain-registry-recovery.mjs",
 "scripts/release-toolchain-registry-recovery.test.mjs",
 "scripts/release-toolchain-worker-release-ci.mjs",
 "scripts/release-toolchain-worker-release-contract.mjs"
]);
const need=(v,c)=>{if(!v)throw Error('startup_continuation_'+c);};
export function assertStartupContinuationDelta(applicationRows,toolRows){
 const old=new Map(applicationRows.map(x=>[x.file,x])),next=new Map(toolRows.map(x=>[x.file,x]));
 const changed=[...new Set([...old.keys(),...next.keys()])].filter(f=>!isDeepStrictEqual(old.get(f),next.get(f))).sort();
 need(isDeepStrictEqual(changed,[...STARTUP_CONTINUATION_FILES].sort()),'exact_tool_scope');
 for(const file of changed)need(next.get(file)?.mode==='100644'&&(!old.has(file)||old.get(file).mode==='100644'),'tool_file_mode');
 return assertUnchangedApplicationSource(STARTUP_TARGET,applicationRows,toolRows);
}
export function assertStartupContinuationInvocation({argv,directory,platform,uid,executable}){
 const tool=directory.split('/').at(-1);
 need(platform==='linux'&&uid===0&&executable==='/usr/bin/node'&&/^[a-f0-9]{40}$/.test(tool)&&tool!==STARTUP_TARGET&&
  directory==='/var/lib/faolla-online-code/'+tool&&Array.isArray(argv)&&argv.length===3&&argv[0]==='/usr/bin/node'&&
  argv[1]===directory+'/scripts/application-release-startup-continuation.mjs'&&['start','run','recover','audit'].includes(argv[2]),'invocation');
 return{toolRevision:tool,target:STARTUP_TARGET,baseline:STARTUP_BASELINE,action:argv[2]};
}
export function startupContinuationPhase(state,active){
 need(state?.target===STARTUP_TARGET&&state.baseline===STARTUP_BASELINE&&state.lane==='reviewed-application-code-only-v1'&&
  [STARTUP_TARGET,STARTUP_BASELINE].includes(active?.target),'state_identity');
 if(state.status==='rolled-back'&&active.target===STARTUP_BASELINE)return'restored';
 if(state.status==='activating')return'partial';
 if(state.status==='active'&&active.target===STARTUP_TARGET)return state.applicationCompletion?.status==='completed'?'completed':'active';
 throw Error('startup_continuation_unknown_phase');
}
export function assertStartupOperationOwner(owner,{toolRevision,operation,operationBirth,deploy}){
 need(owner&&isDeepStrictEqual(Object.keys(owner).sort(),['kind','target','toolRevision','id','controller','operation','operationBirth','deploy','at'].sort())&&
  owner.kind==='startup-continuation-operation-owner'&&owner.target===STARTUP_TARGET&&owner.toolRevision===toolRevision&&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.id??'')&&Number.isFinite(Date.parse(owner.at)),'owner_shape');
 const c=owner.controller;
 need(c&&isDeepStrictEqual(Object.keys(c).sort(),['pid','uid','parentPid','startTicks','executable','cwd','commandSha256','environmentSha256'].sort())&&
  Number.isSafeInteger(c.pid)&&c.pid>0&&Number.isSafeInteger(c.parentPid)&&c.parentPid>0&&c.uid===0&&/^[1-9]\d*$/.test(c.startTicks??'')&&
  c.cwd==='/var/lib/faolla-online-code/'+toolRevision&&c.executable==='/usr/bin/node'&&/^[a-f0-9]{64}$/.test(c.commandSha256??'')&&/^[a-f0-9]{64}$/.test(c.environmentSha256??''),'owner_controller');
 need(isDeepStrictEqual(owner.operation,operation)&&isDeepStrictEqual(owner.operationBirth,operationBirth)&&isDeepStrictEqual(owner.deploy,deploy),'owner_identity');return true;
}
export async function executeStartupScopeClosure(operations,work){
 const value=await work();await operations.verify();
 const target=value?.actualTarget,proof=target===STARTUP_TARGET?value.proof:value.publicProof;
 const publicProof=target===STARTUP_TARGET?proof?.publicProof:proof;
 need([STARTUP_TARGET,STARTUP_BASELINE].includes(target)&&Array.isArray(publicProof)&&publicProof.length===2&&
  ['https://faolla.com','https://launch.faolla.com'].every(origin=>publicProof.filter(p=>p.origin===origin&&p.status===200&&p.buildId===target).length===1),'closure_public_proof');
 if(target===STARTUP_TARGET)need(proof.kind==='ordinary-application-release-readonly-verified'&&proof.target===target&&proof.baseline===STARTUP_BASELINE&&
  /^[a-f0-9]{64}$/.test(proof.certificateSha256??'')&&proof.workerPid>0&&proof.mailEnabled===false&&proof.businessDataWrittenByAudit===false&&proof.savedProcessConfigurationVerified===true,'closure_completion');
 else need(value.restored===true,'closure_restoration');
 await operations.seal(value);await operations.verify();await operations.archive();return value;
}

// A fixed maintenance suffix, not a fabricated publication state or a generic
// rollback override. The original generic validator sees the committed CAS.
export function startupRollbackHeadBinding(original,history){
 const p=STARTUP_PINS,hash=b=>createHash('sha256').update(b).digest('hex');
 need(hash(original)===p.preserved['/var/lib/faolla-online-release/'+STARTUP_TARGET+'/state.json'].sha256,'original_state_changed');
 const state=JSON.parse(original);
 need(state.status==='rolled-back'&&state.target===STARTUP_TARGET&&state.baseline===STARTUP_BASELINE&&
  state.retentionRollbackHeadSha256===p.originalRollbackHead&&!state.applicationCompletion,'rebind_state');
 assertStartupMaintenanceSuffix(history);
 const after=startupHeadBindingText(original);
 return{kind:'startup-certified-worker-head-binding',target:STARTUP_TARGET,baseline:STARTUP_BASELINE,
  originalSha256:hash(original),beforeHead:p.originalRollbackHead,afterHead:history.headSha256,
  afterSha256:hash(after),after};
}
export function assertStartupMaintenanceSuffix(history){
 const p=STARTUP_PINS,last=history?.entries?.at(-1),introduced=history?.entries?.at(-2);
 need(history?.headSha256===p.head.headSha256&&history.entries.length===66&&
  last.sequence===66&&last.kind===p.history[1].kind&&last.previousSha256===p.originalRollbackHead&&
  introduced.sequence===65&&introduced.kind==='converge'&&
  [last,introduced].every(c=>c.active.target===STARTUP_TARGET&&c.rollback.target===STARTUP_BASELINE)&&
  last.processes.some(w=>isDeepStrictEqual(w,p.history[1].worker)),'rebind_maintenance_suffix');
 return true;
}
// Pure text transformation, not an admission/lock/publication capability.
// The host wrapper first binds the exact original bytes and real history.
export function startupHeadBindingText(original){
 const state=JSON.parse(original),p=STARTUP_PINS;
 need(state.status==='rolled-back'&&state.target===STARTUP_TARGET&&state.baseline===STARTUP_BASELINE&&
  state.retentionRollbackHeadSha256===p.originalRollbackHead&&!state.applicationCompletion,'rebind_state');
 return JSON.stringify({...state,retentionRollbackHeadSha256:p.head.headSha256},null,2);
}
