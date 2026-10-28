// Source-only installation. Does not edit refs/origin/main, app candidates or PM2.
import * as fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {collectRemoteReleaseReview,sourceGit,parseSourceTree,assertUnchangedApplicationSource,inspectPinnedExecutionSource,ownedReleasePath} from './release-toolchain-source.mjs';
import {requireToolchain as need,canonicalJson,publicFailure} from './release-toolchain-contracts.mjs';
const REPO='/www/wwwroot/merchant-space',TOOLS='/var/lib/faolla-online-code',MAINTENANCE='/var/lib/faolla-maintenance/merchant-space';
const APP='f274ad615550c83717aa7af2ad32339608e6f8aa';
const sparse='/*\n!/public/downloads/\n';
export async function installReviewedReleaseTool(revision,{qualificationOnly=false}={}){
 need(process.platform==='linux'&&process.getuid()===0&&/^[a-f0-9]{40}$/.test(revision??''),'invalid_contract');
 const review=await collectRemoteReleaseReview(revision,{production:!qualificationOnly});
 for(const p of [REPO,TOOLS,MAINTENANCE])ownedReleasePath(p,{directory:true});
 // Fetch only this exact object into FETCH_HEAD. Never move a branch/main ref.
 sourceGit(REPO,['fetch','--no-tags','origin',revision]);
 const source=parseSourceTree(sourceGit(REPO,['ls-tree','-r','-z',revision]));assertUnchangedApplicationSource(APP,parseSourceTree(sourceGit(REPO,['ls-tree','-r','-z',APP])),source);
 const directory=TOOLS+'/'+revision,lock=REPO+'.deploy.lock';ownedReleasePath(lock);const fd=fs.openSync(lock,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
 let operation,identity;
 try{
  const st=fs.fstatSync(fd),disk=fs.lstatSync(lock);need(st.dev===disk.dev&&st.ino===disk.ino,'owned_resource_changed');
  const r=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],timeout:10000});need(r.status===0&&!r.error&&!r.signal,'journal_busy');
  ownedReleasePath(MAINTENANCE+'/state.json',{privateMode:true});need(JSON.parse(fs.readFileSync(MAINTENANCE+'/state.json','utf8')).phase==='ended','operation_unconfirmed');
  operation=MAINTENANCE+'/operation.lock';fs.mkdirSync(operation,{mode:0o700});identity=fs.lstatSync(operation);
  need(!fs.existsSync(directory),'attempt_replay_forbidden');
  sourceGit(REPO,['worktree','add','--detach','--no-checkout',directory,revision]);fs.chmodSync(directory,0o700);
  sourceGit(directory,['-c','index.sparse=false','sparse-checkout','set','--no-cone','--stdin'],sparse);
  sourceGit(directory,['config','--worktree','core.sparseCheckoutCone','false']);sourceGit(directory,['config','--worktree','index.sparse','false']);sourceGit(directory,['read-tree','-mu','HEAD']);
  const actual=inspectPinnedExecutionSource({revision,directory});
  return {kind:'release-toolchain-source-installed',revision,directory,sourceFiles:actual.sourceFiles,inventorySha256:actual.inventorySha256,qualificationOnly,productionEligible:review.productionEligible,applicationPublished:false};
 }finally{
  try{if(identity){const s=fs.lstatSync(operation);need(s.dev===identity.dev&&s.ino===identity.ino&&fs.readdirSync(operation).length===0,'owned_resource_changed');fs.rmdirSync(operation);}}finally{fs.closeSync(fd);}
 }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [action,sha,...extra]=process.argv.slice(2);need(extra.length===0&&['install','install-qualification'].includes(action),'invalid_contract');
 installReviewedReleaseTool(sha,{qualificationOnly:action==='install-qualification'}).then(r=>console.log(canonicalJson(r)),e=>{console.error(canonicalJson(publicFailure(e,{stage:'source'})));process.exitCode=1;});
}
