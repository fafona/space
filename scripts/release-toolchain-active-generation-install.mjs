// Source-only bootstrap for the one approved ACTIVE incident. The old source
// installer remains unchanged. No operation directory is removed or recreated.
// Copy this exact committed file to the fixed SHA-named bootstrap path; it
// verifies its bytes against independently reviewed main before any install.
import * as fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const OLD='0fdad28d24245a84f7ced1656b5e1f2313bee0e7',REPO='/www/wwwroot/merchant-space',TOOLS='/var/lib/faolla-online-code',BOOT='/var/lib/faolla-release-bootstrap-active';
const APP='f274ad615550c83717aa7af2ad32339608e6f8aa',DEPLOY=REPO+'.deploy.lock',OPERATION='/var/lib/faolla-maintenance/merchant-space/operation.lock';
const FILE='scripts/release-toolchain-active-generation-install.mjs',need=(v,c)=>{if(!v)throw Error('active_install_'+c);};
const digest=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>need(isDeepStrictEqual(a,b),'resource_changed'),fact=s=>Object.fromEntries(['dev','ino','uid','mode','nlink'].map(k=>[k,s[k]]));
export function activeToolInstallGitPlan(revision){
 need(/^[a-f0-9]{40}$/.test(revision??''),'revision');const directory=TOOLS+'/'+revision;
 return[{cwd:REPO,args:['worktree','add','--detach','--no-checkout',directory,revision]},
  {cwd:directory,args:['-c','index.sparse=false','sparse-checkout','set','--no-cone','--stdin'],input:'/*\n!/public/downloads/\n'},
  {cwd:directory,args:['config','--worktree','core.sparseCheckoutCone','false']},
  {cwd:directory,args:['config','--worktree','index.sparse','false']},
  {cwd:directory,args:['read-tree','-mu','HEAD']}];
}
export function assertActiveBootstrapBytes(actual,committed){need(Buffer.isBuffer(actual)&&Buffer.isBuffer(committed)&&actual.length>0&&actual.length<=128*1024&&actual.equals(committed),'bootstrap_source_changed');return true;}
// Only the new read-only observer/pure validators are loaded from exact Git
// blobs here. Every host reader comes from the fully pinned installed OLD tool.
function incidentObserverUrl(git,revision){
 const selected=new Set(['release-toolchain-active-generation-contract.mjs','release-toolchain-pm2-transition.mjs','release-toolchain-active-generation-incident.mjs','release-toolchain-recovery-probe.mjs','release-toolchain-pm2-observation.mjs']),cache=new Map();
 const url=name=>{if(cache.has(name))return cache.get(name);need(selected.has(name),'observer_source');const bytes=git(REPO,['show',revision+':scripts/'+name]);need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<256*1024,'observer_source');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);need(Buffer.from(text).equals(bytes),'observer_source');
  const source=text.replace(/from\s*'\.\/([^']+)'/g,(_,dependency)=>'from '+JSON.stringify(selected.has(dependency)?url(dependency):'file://'+TOOLS+'/'+OLD+'/scripts/'+dependency));
  const value='data:text/javascript;base64,'+Buffer.from(source).toString('base64');cache.set(name,value);return value;};return url('release-toolchain-active-generation-incident.mjs');
}
function stableObservation(value){const copy=structuredClone(value);delete copy.observedAt;delete copy.historicalPause.observedAt;delete copy.recordProof.observedAt;copy.publicProof=copy.publicProof.map(({origin,status,buildId})=>({origin,status,buildId}));return copy;}
export async function installReviewedActiveBookingTool(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.argv.length===2&&fs.realpathSync(process.execPath)==='/usr/bin/node','runtime');
 const entry=fileURLToPath(import.meta.url),revision=path.basename(entry,'.mjs');need(/^[a-f0-9]{40}$/.test(revision)&&entry===BOOT+'/'+revision+'.mjs'&&revision!==OLD,'bootstrap_path');
 const source=await import('file://'+TOOLS+'/'+OLD+'/scripts/release-toolchain-source.mjs');
 source.ownedReleasePath(BOOT,{directory:true,privateMode:true});source.ownedReleasePath(entry,{privateMode:true});source.ownedReleasePath(DEPLOY,{privateMode:true});source.ownedReleasePath(OPERATION,{directory:true,privateMode:true});
 const old=source.inspectPinnedExecutionSource({revision:OLD,directory:TOOLS+'/'+OLD});need(old.inventorySha256==='3f0b3b37c767cce128be9e4c4804a6c78c79b5797f1b5dd09b9f480241024990','installed_reader_source');
 const io=await import('file://'+TOOLS+'/'+OLD+'/scripts/booking-handoff-host-io.mjs'),deploy=fact(fs.lstatSync(DEPLOY)),operation=fact(fs.lstatSync(OPERATION));
 const fd=fs.openSync(DEPLOY,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);let audit,stage='kernel-lock';
 const held=()=>{same(fact(fs.fstatSync(fd)),deploy);same(fact(source.ownedReleasePath(DEPLOY,{privateMode:true})),deploy);same(fact(source.ownedReleasePath(OPERATION,{directory:true,privateMode:true})),operation);same(fs.readdirSync(OPERATION),[]);};
 const seal=(name,value)=>io.bookingHostWriteOnce(audit+'/'+name,JSON.stringify(value)+'\n');
 try{
  held();const lock=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],env:io.bookingHostEnvironment(),timeout:10000,windowsHide:true});need(lock.status===0&&!lock.error&&!lock.signal,'kernel_lock_busy');held();
  const refs=source.sourceGit(REPO,['for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/remotes']).toString();
  stage='independent-main-and-ci';const review=await source.collectRemoteReleaseReview(revision);held();
  source.sourceGit(REPO,['fetch','--no-tags','origin',revision]);held();
  assertActiveBootstrapBytes(io.bookingHostRead(entry,{binary:true}),source.sourceGit(REPO,['show',revision+':'+FILE]));
  const application=source.assertUnchangedApplicationSource(APP,source.parseSourceTree(source.sourceGit(REPO,['ls-tree','-r','-z',APP])),source.parseSourceTree(source.sourceGit(REPO,['ls-tree','-r','-z',revision])));
  stage='current-active-incident';const {inspectActiveBookingIncident}=await import(incidentObserverUrl(source.sourceGit,revision)),start=Date.now(),window={id:randomUUID(),startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()},before=await inspectActiveBookingIncident({window});held();
  audit=BOOT+'/'+revision+'.install';fs.mkdirSync(audit,{mode:0o700});io.bookingHostSync(BOOT);
  seal('started.json',{kind:'active-incident-source-only-install-started',revision,priorReader:OLD,review,application,window,before,at:new Date().toISOString(),publicationAuthority:false});
  const directory=TOOLS+'/'+revision;need(!fs.existsSync(directory),'installation_replay');source.ownedReleasePath(TOOLS,{directory:true});
  stage='source-worktree-install';for(const command of activeToolInstallGitPlan(revision)){held();source.sourceGit(command.cwd,command.args,command.input);if(command.args[0]==='worktree')fs.chmodSync(directory,0o700);held();}
  stage='complete-byte-and-host-revalidation';const installed=source.inspectPinnedExecutionSource({revision,directory});held();
  const after=await inspectActiveBookingIncident({window});same(stableObservation(after),stableObservation(before));held();source.assertReviewFresh(review,revision);
  same(source.sourceGit(REPO,['for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/remotes']).toString(),refs);
  const result={kind:'active-incident-source-only-tool-installed',revision,directory,sourceFiles:installed.sourceFiles,inventorySha256:installed.inventorySha256,oldOperationRetained:true,applicationPublished:false,productionDatabaseMutated:false,trafficChanged:false,mailEnabled:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal('completed.json',result);held();return result;
 }catch(error){if(audit)try{seal('failed.json',{kind:'active-incident-source-only-install-failed',stage,code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'operation_unconfirmed',errorSha256:digest(String(error?.message??'unknown')),detailsRedacted:true,originalOperationRetained:true,applicationPublished:false,at:new Date().toISOString()});}catch{}throw error;}
 finally{fs.closeSync(fd);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)installReviewedActiveBookingTool().then(value=>console.log(JSON.stringify(value)),error=>{console.error(JSON.stringify({kind:'active-incident-source-only-install-refused',code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'operation_unconfirmed',errorSha256:digest(String(error?.message??'unknown')),detailsRedacted:true,applicationPublished:false}));process.exitCode=1;});
