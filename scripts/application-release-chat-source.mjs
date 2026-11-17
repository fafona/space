// Read-only source/built-artifact binding. This does NOT issue a lock or
// publication capability; the dedicated authority separately owns that scope.
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertUnchangedApplicationSource,inspectPinnedExecutionSource,collectRemoteReleaseReview,assertReviewFresh,parseSourceTree,sourceGit,ownedReleasePath} from './release-toolchain-source.mjs';
import {CHAT_REVIEWED_PARENT,CHAT_TARGET as TARGET,CHAT_BASELINE as BASELINE,CHAT_PINS as P,assertChatContinuationDelta,assertChatContinuationInvocation} from './application-release-chat-policy.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
const APP='/www/wwwroot/merchant-space',ROOT='/var/lib/faolla-online-release/'+TARGET;
const need=(v,c)=>{if(!v)throw Error('chat_continuation_source_'+c);};
export const chatHash=b=>createHash('sha256').update(b).digest('hex');
export const chatMetadata=s=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,String(s[k])]));
export function assertChatPinnedFile(file,pin){
 ownedReleasePath(file,{privateMode:true});const before=fs.lstatSync(file,{bigint:true}),bytes=bookingHostRead(file);
 need(chatHash(bytes)===pin.sha256&&isDeepStrictEqual(chatMetadata(before),pin.metadata)&&isDeepStrictEqual(chatMetadata(fs.lstatSync(file,{bigint:true})),pin.metadata),'pinned_file_changed');return bytes;
}
export function chatBuildTree(root){
 ownedReleasePath(root,{directory:true});const rows=[];
 const walk=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const p=dir+'/'+e.name,n=prefix+e.name;need(!e.isSymbolicLink(),'build_symlink');
  if(e.isDirectory())walk(p,n+'/');else{ownedReleasePath(p);const s=fs.lstatSync(p),bytes=fs.readFileSync(p);need(s.isFile()&&['dev','ino','mode','size','mtimeMs','ctimeMs'].every(k=>s[k]===fs.lstatSync(p)[k]),'build_changed');rows.push([n,s.mode,chatHash(bytes)]);}
 }};walk(root);return{files:rows.length,sha256:chatHash(JSON.stringify(rows))};
}
export function assertChatPreserved({originalState=true}={}){
 for(const entry of P.history)assertChatPinnedFile(entry.file,entry.pin);
 assertChatPinnedFile('/var/lib/faolla-online-retention.head.json',P.head);
 assertChatPinnedFile(P.gate.file,P.gate);
 // Activation runs the original pm2 save; its exact initial file is pinned
 // on admission, then the original semantic live/saved audit owns acceptance.
 if(originalState){assertChatPinnedFile('/root/.pm2/dump.pm2',P.dump);assertChatPinnedFile('/var/lib/faolla-online-release/active.json',P.active);}
 for(const [file,pin]of Object.entries(P.preserved))if(originalState||file!==ROOT+'/state.json')assertChatPinnedFile(file,pin);
 assertChatPinnedFile(P.candidate.directory+'/.env.local',P.applicationEnvironment);
 need(isDeepStrictEqual(chatBuildTree(P.candidate.directory+'/.next'),P.build),'built_artifacts_changed');
 need(sourceGit(P.candidate.directory,['rev-parse','HEAD']).toString().trim()===TARGET&&
  !sourceGit(P.candidate.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'application_source_changed');
 if(!originalState){
  const current=bookingHostRead(ROOT+'/state.json');
  if(chatHash(current)!==P.preserved[ROOT+'/state.json'].sha256){
   const revision=path.basename(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
   const original=bookingHostRead('/var/lib/faolla-chat-continuation/'+TARGET+'/'+revision+'/original-state.json');
   need(chatHash(original)===P.preserved[ROOT+'/state.json'].sha256,'original_state_changed');
   const mutable=new Set(['status','activatedAt','rolledBackAt','applicationCompletion','applicationRetention','checkedAssets','staticFiles','retentionRollbackHeadSha256']);
   const immutable=text=>Object.fromEntries(Object.entries(JSON.parse(text)).filter(([key])=>!mutable.has(key)));
   need(isDeepStrictEqual(immutable(current),immutable(original)),'immutable_state_changed');
  }
 }
 return{target:TARGET,baseline:BASELINE,build:P.build,originalBuildProofSha256:P.preserved[ROOT+'/attendance-build-proof.json'].sha256};
}
export async function inspectReviewedChatSource(){
 const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 const invocation=assertChatContinuationInvocation({argv:process.argv,directory,platform:process.platform,uid:process.getuid?.(),executable:process.execPath});
 need(process.cwd()===directory,'cwd');
 const tool=inspectPinnedExecutionSource({revision:invocation.toolRevision,directory}),application=inspectPinnedExecutionSource({revision:TARGET,directory:'/var/lib/faolla-online-code/'+TARGET});
 const inputs=assertChatContinuationDelta(parseSourceTree(sourceGit(APP,['ls-tree','-r','-z',CHAT_REVIEWED_PARENT])),tool.rows);
 assertUnchangedApplicationSource(TARGET,application.rows,tool.rows);
 need(sourceGit(APP,['rev-parse','origin/main']).toString().trim()===invocation.toolRevision,'not_main');
 const review=await collectRemoteReleaseReview(invocation.toolRevision);assertReviewFresh(review,invocation.toolRevision);
 // Independently bind the recorded immutable application tree too, not just
 // the working copy's clean flag or the new tool's unchanged-source assertion.
 need(isDeepStrictEqual(parseSourceTree(sourceGit(APP,['ls-tree','-r','-z',TARGET])),application.rows),'application_tree');
 return{...invocation,tool,application,inputs,review};
}
