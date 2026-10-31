// Minimal source-only bootstrap. Copy this exact Git blob to
// /var/lib/faolla-application-release-bootstrap/<reviewed-main-sha>.mjs.
// The immutable, already deployed reviewer independently verifies current main
// and every required CI job before any new source can execute. No web, worker,
// database, runtime configuration or routing change is performed here.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
const TRUSTED_REVIEWER='3c44a3f417cd455b823536b8c14b852b82ca2395';
const REPOSITORY='/www/wwwroot/merchant-space',TOOLS='/var/lib/faolla-online-code';
const BOOT='/var/lib/faolla-application-release-bootstrap',FILE='scripts/application-release-install.mjs';
const need=(value,reason)=>{if(!value)throw Error('application_release_install_'+reason);};
const same=(a,b)=>need(isDeepStrictEqual(a,b),'changed');
const identity=st=>[st.dev,st.ino,st.uid,st.mode,st.nlink];
export function applicationReleaseInstallGitPlan(revision){
 need(typeof revision==='string'&&/^[a-f0-9]{40}$/.test(revision),'revision');
 const directory=TOOLS+'/'+revision;
 return [{cwd:REPOSITORY,args:['worktree','add','--detach','--no-checkout',directory,revision]},
  {cwd:directory,args:['-c','index.sparse=false','sparse-checkout','set','--no-cone','--stdin'],input:'/*\n!/public/downloads/\n'},
  {cwd:directory,args:['config','--worktree','core.sparseCheckoutCone','false']},
  {cwd:directory,args:['config','--worktree','index.sparse','false']},
  {cwd:directory,args:['read-tree','-mu','HEAD']}];
}
export async function installApplicationReleaseSource(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.argv.length===2,'runtime');
 const entry=fileURLToPath(import.meta.url),revision=path.basename(entry,'.mjs');
 need(/^[a-f0-9]{40}$/.test(revision)&&entry===BOOT+'/'+revision+'.mjs','entry');
 const reviewer=await import('file://'+TOOLS+'/'+TRUSTED_REVIEWER+'/scripts/release-toolchain-source.mjs');
 reviewer.inspectPinnedExecutionSource({revision:TRUSTED_REVIEWER,directory:TOOLS+'/'+TRUSTED_REVIEWER});
 reviewer.ownedReleasePath(BOOT,{directory:true,privateMode:true});reviewer.ownedReleasePath(entry,{privateMode:true});
 const lock=REPOSITORY+'.deploy.lock',operation='/var/lib/faolla-maintenance/merchant-space/operation.lock';
 reviewer.ownedReleasePath(lock,{privateMode:true});const fd=fs.openSync(lock,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW),witness=identity(fs.fstatSync(fd));
 const held=()=>{same(identity(reviewer.ownedReleasePath(lock,{privateMode:true})),witness);same(identity(fs.fstatSync(fd)),witness);need(!fs.existsSync(operation),'operation_busy');};
 try{
  const acquired=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},timeout:10000});
  need(acquired.status===0&&!acquired.error&&!acquired.signal,'lock_busy');held();
  const review=await reviewer.collectRemoteReleaseReview(revision);
  reviewer.sourceGit(REPOSITORY,['fetch','--no-tags','origin','refs/heads/main:refs/remotes/origin/main']);
  need(reviewer.sourceGit(REPOSITORY,['rev-parse','origin/main']).toString().trim()===revision,'main_changed');
  same(fs.readFileSync(entry),reviewer.sourceGit(REPOSITORY,['show',revision+':'+FILE]));
  const directory=TOOLS+'/'+revision;
  const protectedFiles=['/var/lib/faolla-online-release/active.json','/var/lib/faolla-online-retention.head.json','/root/.pm2/dump.pm2'];
  const original=protectedFiles.map(file=>{reviewer.ownedReleasePath(file);return fs.readFileSync(file);});
  if(!fs.existsSync(directory))for(const command of applicationReleaseInstallGitPlan(revision)){
   held();reviewer.sourceGit(command.cwd,command.args,command.input);if(command.args[0]==='worktree')fs.chmodSync(directory,0o700);
  }
  const installed=reviewer.inspectPinnedExecutionSource({revision,directory});held();reviewer.assertReviewFresh(review,revision);
  protectedFiles.forEach((file,index)=>same(fs.readFileSync(file),original[index]));
  return{kind:'reviewed-application-release-source-installed',revision,directory,inventorySha256:installed.inventorySha256,sourceFiles:installed.sourceFiles,
   processControlPerformed:false,routeChanged:false,businessDataWritten:false,publicationAuthority:false,at:new Date().toISOString()};
 }finally{fs.closeSync(fd);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 installApplicationReleaseSource().then(value=>console.log(JSON.stringify(value)),error=>{console.error(JSON.stringify({kind:'application-release-source-refused',code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'unconfirmed'}));process.exitCode=1;});
