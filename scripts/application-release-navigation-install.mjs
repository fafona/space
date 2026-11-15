// Source-only bootstrap for the approved fixed navigation continuation while
// its exact abandoned operation inode remains untouched. No publication power.
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const TRUSTED='3c44a3f417cd455b823536b8c14b852b82ca2395',TARGET='3bbbe054fab2e6a1634599a90d4fbaa94edec946';
const APP='/www/wwwroot/merchant-space',TOOLS='/var/lib/faolla-online-code',BOOT='/var/lib/faolla-application-release-bootstrap';
const need=(v,c)=>{if(!v)throw Error('navigation_source_install_'+c);},hash=b=>createHash('sha256').update(b).digest('hex');
const metadata=s=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,String(s[k])]));
export async function installNavigationContinuationSource(){
 const entry=fileURLToPath(import.meta.url),revision=path.basename(entry,'.mjs');
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.argv.length===2&&/^[a-f0-9]{40}$/.test(revision)&&entry===BOOT+'/'+revision+'.mjs','invocation');
 const reviewer=await import('file://'+TOOLS+'/'+TRUSTED+'/scripts/release-toolchain-source.mjs');
 reviewer.inspectPinnedExecutionSource({revision:TRUSTED,directory:TOOLS+'/'+TRUSTED});
 reviewer.ownedReleasePath(BOOT,{directory:true,privateMode:true});reviewer.ownedReleasePath(entry,{privateMode:true});
 const lock=APP+'.deploy.lock';reviewer.ownedReleasePath(lock,{privateMode:true});const fd=fs.openSync(lock,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
 try{
  const result=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},timeout:10000});need(result.status===0&&!result.error&&!result.signal,'lock_busy');
  const lockIdentity=metadata(fs.fstatSync(fd,{bigint:true}));
  const review=await reviewer.collectRemoteReleaseReview(revision);
  reviewer.sourceGit(APP,['fetch','--no-tags','origin','refs/heads/main:refs/remotes/origin/main']);
  need(reviewer.sourceGit(APP,['rev-parse','origin/main']).toString().trim()===revision,'main_changed');
  need(fs.readFileSync(entry).equals(reviewer.sourceGit(APP,['show',revision+':scripts/application-release-navigation-install.mjs'])),'bootstrap_changed');
  // Read reviewed data, never execute an uninstalled successor module.
  const policy=reviewer.sourceGit(APP,['show',revision+':scripts/application-release-navigation-policy.mjs']).toString();
  const encoded=/^export const NAVIGATION_PINS=Object\.freeze\((\{[^\r\n]+\})\);$/m.exec(policy);need(encoded,'pins_missing');
  const p=JSON.parse(encoded[1]);need(p.target===TARGET,'fixed_scope');
  const held=()=>{
   need(isDeepStrictEqual(metadata(fs.fstatSync(fd,{bigint:true})),lockIdentity)&&isDeepStrictEqual(metadata(fs.lstatSync(lock,{bigint:true})),lockIdentity),'lock_changed');
   reviewer.ownedReleasePath(p.operation.path,{directory:true,privateMode:true});need(isDeepStrictEqual(metadata(fs.lstatSync(p.operation.path,{bigint:true})),p.operation.metadata)&&fs.readdirSync(p.operation.path).length===0,'operation_changed');
   for(const [file,pin]of [[p.owner.file,p.owner],['/var/lib/faolla-online-release/active.json',p.active],['/var/lib/faolla-online-retention.head.json',p.head],['/root/.pm2/dump.pm2',p.dump],...Object.entries(p.preserved)]){
    reviewer.ownedReleasePath(file,{privateMode:true});need(hash(fs.readFileSync(file))===pin.sha256&&isDeepStrictEqual(metadata(fs.lstatSync(file,{bigint:true})),pin.metadata),'preserved_changed');
   }
   try{const text=fs.readFileSync('/proc/'+p.owner.controller.pid+'/stat','utf8'),f=text.slice(text.lastIndexOf(')')+2).split(/\s+/);need(f[19]!==p.owner.controller.startTicks||f[0]==='Z','original_controller_alive');}
   catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
  };
  held();reviewer.inspectPinnedExecutionSource({revision:TARGET,directory:TOOLS+'/'+TARGET});
  const original=await import('file://'+TOOLS+'/'+TARGET+'/scripts/application-release-install.mjs');
  const destination=TOOLS+'/'+revision;
  if(!fs.existsSync(destination))for(const command of original.applicationReleaseInstallGitPlan(revision)){
   held();reviewer.sourceGit(command.cwd,command.args,command.input);if(command.args[0]==='worktree')fs.chmodSync(destination,0o700);
  }
  const source=reviewer.inspectPinnedExecutionSource({revision,directory:destination});held();reviewer.assertReviewFresh(review,revision);
  return{kind:'navigation-continuation-source-installed',revision,directory:destination,inventorySha256:source.inventorySha256,sourceFiles:source.sourceFiles,operationInodePreserved:true,processControlPerformed:false,routeChanged:false,businessDataWritten:false,publicationAuthority:false,at:new Date().toISOString()};
 }finally{fs.closeSync(fd);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const reference=setInterval(()=>{},1000);
 try{console.log(JSON.stringify(await installNavigationContinuationSource()));}catch(e){console.error(JSON.stringify({kind:'navigation-source-install-refused',code:/^[a-z_]{1,160}$/.test(e?.message??'')?e.message:'unconfirmed'}));process.exitCode=1;}finally{clearInterval(reference);}
}
