// In-process reviewed authority for the NEW ordinary application profile.
// Historic lane admission is unchanged. Inert legacy candidates are preserved
// by an exact immutable state inventory, never cleared, resumed or relabelled.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual} from 'node:util';
import {APPLICATION_RELEASE_LANE,APPLICATION_RELEASE_MANIFEST,applicationReleaseHash,assertApplicationReleaseManifest,assertApplicationReleasePackage} from './application-release-policy.mjs';
import {inspectPinnedExecutionSource,collectRemoteReleaseReview,assertReviewFresh,ownedReleasePath,sourceGit,parseSourceTree} from './release-toolchain-source.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
const active=new AsyncLocalStorage(),issued=new WeakSet(),ROOT='/var/lib/faolla-online-release',REPOSITORY='/www/wwwroot/merchant-space';
const need=(value,reason)=>{if(!value)throw Error('application_release_authority_'+reason);};
export function assertApplicationPriorStates(rows){
 need(Array.isArray(rows)&&rows.length>0&&new Set(rows.map(row=>row.target)).size===rows.length,'prior_states');
 for(const row of rows)need(/^[a-f0-9]{40}$/.test(row.target??'')&&/^[a-f0-9]{64}$/.test(row.sha256??'')&&
  Number.isSafeInteger(row.device)&&row.device>=0&&Number.isSafeInteger(row.inode)&&row.inode>0&&row.mode===0o100600&&row.uid===0&&row.links===1,'prior_states');
 return applicationReleaseHash(rows);
}
function priorStates(target){
 ownedReleasePath(ROOT,{directory:true,privateMode:true});
 const rows=[];
 for(const name of fs.readdirSync(ROOT).sort()){
  if(name==='active.json'||name===target)continue;
  need(/^[a-f0-9]{40}$/.test(name),'prior_entry');
  ownedReleasePath(ROOT+'/'+name,{directory:true,privateMode:true});
  const file=ROOT+'/'+name+'/state.json',st=ownedReleasePath(file,{privateMode:true}),text=bookingHostRead(file),value=JSON.parse(text);
  need(value.target===name&&typeof value.status==='string','prior_state_identity');
  rows.push({target:name,sha256:applicationReleaseHash(text),device:st.dev,inode:st.ino,mode:st.mode,uid:st.uid,links:st.nlink});
 }
 return {rows,sha256:assertApplicationPriorStates(rows)};
}
export function reviewedApplicationExecution(revision,target){
 const context=active.getStore();
 if(!context)return null;
 need(issued.has(context)&&context.target===target&&context.target===revision,'context');
 assertOnlineRetentionHeldLocks(context.lock);
 const current=priorStates(target);need(isDeepStrictEqual(current,context.prior),'prior_states_changed');
 return context.public;
}
// A separate, exact-invocation capability for an explicitly selected standby.
// This never authorizes the default writer to ignore historical pending state.
export function reviewedApplicationStandbyExecution(revision,activeTarget,victimTarget,kind){
 const context=active.getStore();if(!context?.standby)return null;
 reviewedApplicationExecution(revision,revision);
 need(kind==='retire'&&context.standby.activeTarget===activeTarget&&context.standby.victimTarget===victimTarget,'standby_scope');
 return context.standby;
}
export async function withApplicationStandbyExecution({target,baseline,victimTarget,action},work){
 const directory='/var/lib/faolla-online-code/'+target;
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&
  process.cwd()===directory&&process.argv.length===6&&process.argv[1]===directory+'/scripts/application-release-standby.mjs'&&
  process.argv[2]===action&&['inspect','retire'].includes(action)&&process.argv[3]===target&&process.argv[4]===baseline&&process.argv[5]===victimTarget&&
  /^[a-f0-9]{40}$/.test(victimTarget??'')&&![target,baseline].includes(victimTarget)&&typeof work==='function','standby_invocation');
 const context=active.getStore();need(context&&!context.standby,'standby_context');reviewedApplicationExecution(target,target);
 need(context.public.baseline===baseline,'standby_baseline');
 const actual=JSON.parse(bookingHostRead(ROOT+'/active.json'));
 need([target,baseline].includes(actual.target),'standby_active');
 context.standby=Object.freeze({kind:'reviewed-application-standby-retirement',toolRevision:target,activeTarget:actual.target,victimTarget});
 try{return await work(context.standby);}finally{delete context.standby;}
}
export async function withReviewedApplicationExecution({target,baseline,lock},work){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(target??'')&&/^[a-f0-9]{40}$/.test(baseline??'')&&typeof work==='function','invocation');
 assertOnlineRetentionHeldLocks(lock);
 const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 need(directory==='/var/lib/faolla-online-code/'+target,'source');
 const review=await collectRemoteReleaseReview(target),source=inspectPinnedExecutionSource({revision:target,directory});
 const manifest=JSON.parse(sourceGit(REPOSITORY,['show',target+':'+APPLICATION_RELEASE_MANIFEST]));
 const proof=assertApplicationReleaseManifest(manifest,{baseline,baselineRows:parseSourceTree(sourceGit(REPOSITORY,['ls-tree','-r','-z',baseline])),targetRows:source.rows});
 assertApplicationReleasePackage(JSON.parse(sourceGit(REPOSITORY,['show',baseline+':package.json'])),JSON.parse(sourceGit(REPOSITORY,['show',target+':package.json'])));
 const prior=priorStates(target),state=ROOT+'/'+target+'/state.json';
 if(fs.existsSync(state))need(JSON.parse(bookingHostRead(state)).applicationPriorStatesSha256===prior.sha256,'prior_states_changed');
 assertReviewFresh(review,target);
 const context={target,lock,prior,public:Object.freeze({kind:APPLICATION_RELEASE_LANE,target,baseline,manifestSha256:proof.manifestSha256,
  priorStatesSha256:prior.sha256,legacyStatesPreserved:true,legacyCandidatesResumed:false})};
 context.public=Object.freeze({...context.public,review:Object.freeze(structuredClone(review))});
 issued.add(context);
 return active.run(context,()=>work(context.public));
}
