import {assertBookingReadyClosure as assertBookingHandoffToolClosure} from './booking-ready-policy.mjs';
// A new routing edge, not a rewrite of the original staged 52f rollback files.
// Once authority may have flipped, only C or the compatible 6c can be selected.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_BASELINE as BASELINE,
  assertBookingHandoffWindow} from './booking-handoff-policy.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT,verifyBookingAtomicRuntimeCohort} from './booking-handoff-runtime.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {assertOnlineToolOwnedPath,createOnlineReleaseToolPlan,verifyOnlineReleaseTool,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {retentionCanonicalText} from './online-release-retention-policy.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';

const APP='/www/wwwroot/merchant-space',RELEASE='/var/lib/faolla-online-release';
const hash=x=>createHash('sha256').update(x).digest('hex'),need=(v,c)=>{if(!v)throw Error('booking_handoff_routing_'+c);};
const equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c),sha=/^[a-f0-9]{40}(?![\s\S])/;
const location=s=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,s[k]]));
export const BOOKING_ROUTING_BASELINE_HASHES=Object.freeze({
  'e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf':'ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c',
  'no_store_entries_www.faolla.com.conf':'2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52',
  'faolla_contact_card_release.conf':'dfe65825dd3ed7f398541525277135f0a4ef3019424e7fcabb3d9c5c9dba3777',
});
function anchor(s,target){
  need(s?.target===target&&s.name==='merchant-space-online-'+target.slice(0,12)&&s.directory===APP+'.web-releases/'+target.slice(0,12)+'-online'&&
    Number.isSafeInteger(s.port)&&s.port>=3104&&s.port<=3110,'anchor');
}
export function createBookingAtomicRoutingPlan({before,primary,rollback,window}){
  assertBookingHandoffWindow(window);anchor(primary,CANDIDATE);anchor(rollback,APPLICATION);need(primary.port!==rollback.port,'ports');
  equal(Object.keys(before).sort(),[...WEB_RELEASE_FILES].sort(),'files');
  for(const file of WEB_RELEASE_FILES)need(typeof before[file]==='string'&&hash(before[file])===BOOKING_ROUTING_BASELINE_HASHES[file],'baseline_changed');
  const rewrite=(file,phase)=>{
    const original=before[file],port=phase==='rollback'?rollback.port:phase==='primary'?primary.port:3103;
    let next=original.replaceAll('proxy_pass http://127.0.0.1:3103;','proxy_pass http://127.0.0.1:'+port+';');
    if(file==='faolla_contact_card_release.conf'){
      need((next.match(/proxy_pass http:\/\/127\.0\.0\.1:3000;/g)??[]).length===1,'card_fallback_count');
      next=next.replace('proxy_pass http://127.0.0.1:3000;','proxy_pass http://127.0.0.1:'+rollback.port+';');
      let index=0;next=next.replaceAll('add_header X-Faolla-Card-Release "'+BASELINE+'" always;',()=>{
        const target=index++===0?(phase==='primary'?CANDIDATE:phase==='rollback'?APPLICATION:BASELINE):APPLICATION;
        return 'add_header X-Faolla-Card-Release "'+target+'" always;';
      });need(index===2,'card_header_count');
    }
    return next;
  };
  const phases=Object.fromEntries(['armed','primary','rollback'].map(phase=>[phase,Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,rewrite(file,phase)]))]));
  return {schemaVersion:1,kind:'booking-compatible-atomic-routing',window:structuredClone(window),primary:location(primary),rollback:location(rollback),before:structuredClone(before),phases};
}
export function assertBookingAtomicRoutingPlan(plan){
  equal(plan,createBookingAtomicRoutingPlan({before:plan?.before,primary:plan?.primary,rollback:plan?.rollback,window:plan?.window}),'plan_changed');return true;
}
/** Mixed owned bytes can occur if the controller died between renames. A
 * recovery to 6c may complete such a batch; arbitrary edited bytes still fail. */
export function assertBookingRoutingCurrent(plan,current,{phase}={}){
  assertBookingAtomicRoutingPlan(plan);equal(Object.keys(current).sort(),[...WEB_RELEASE_FILES].sort(),'current_files');
  if(phase!==undefined){need(Object.hasOwn(plan.phases,phase),'phase');equal(current,plan.phases[phase],'current_phase');}
  else for(const file of WEB_RELEASE_FILES)need([plan.before[file],...Object.values(plan.phases).map(v=>v[file])].includes(current[file]),'unowned_current');
  return true;
}
/** Strict forward/recovery state machine. This API cannot restore the legacy
 * baseline. The before-activation abort path must independently prove inactive. */
export async function executeBookingRoutingPhase(operations,plan,phase){
  assertBookingAtomicRoutingPlan(plan);need(['armed','primary','rollback'].includes(phase),'phase');
  const before=await operations.read();assertBookingRoutingCurrent(plan,before);
  if(phase==='armed')equal(before,plan.before,'arming_requires_baseline');
  if(phase==='primary')equal(before,plan.phases.armed,'primary_requires_armed');
  await operations.authorize(phase,plan);await operations.begin({phase,before,at:operations.now()});
  equal(await operations.read(),before,'pre_write_changed');
  for(const file of WEB_RELEASE_FILES)await operations.replace(file,before[file],plan.phases[phase][file]);
  assertBookingRoutingCurrent(plan,await operations.read(),{phase});
  await operations.syntax();await operations.reload();await operations.verify(phase);
  const receipt={schemaVersion:1,kind:'booking-compatible-routing-applied',phase,planSha256:hash(retentionCanonicalText(plan)),
    files:Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,hash(plan.phases[phase][f])])),completedAt:operations.now()};
  await operations.complete(receipt);return receipt;
}

function readBytes(file,privateMode=true,allowEmpty=false){
  assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);need((allowEmpty||s.size>0)&&s.size<=32*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const id=s=>Object.fromEntries(['dev','ino','uid','nlink','mode','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
  try{equal(id(fs.fstatSync(fd)),id(s),'file_replaced');const b=fs.readFileSync(fd);equal(id(fs.fstatSync(fd)),id(s),'file_changed');equal(id(fs.lstatSync(file)),id(s),'file_replaced');need(b.length===s.size,'file_changed');return b;}finally{fs.closeSync(fd);}
}
const read=(file,privateMode=true)=>readBytes(file,privateMode).toString('utf8');
function sync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeOnce(file,text){assertOnlineToolOwnedPath(path.dirname(file));const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));equal(read(file),text,'write_readback');}
function toolIdentity(lock,toolRevision){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);
  const adopted=reviewedBookingExecution(toolRevision);if(adopted)return adopted.tool;
  need(sha.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');
  verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
  const files=runOnlineToolGit(APP,['diff','--name-only',CANDIDATE,toolRevision]).toString().trim().split('\n');
  assertBookingHandoffToolClosure({baseline:CANDIDATE,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
}
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},timeout:10000,maxBuffer:32*1024**2,windowsHide:true});need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;}

/** Copies only immutable content, with a full collision preflight before the
 * first copy. Existing chunks are never removed, truncated or overwritten. */
export function publishBookingImmutableAssets({lock,toolRevision}){
  toolIdentity(lock,toolRevision);const destination=fs.realpathSync(APP+'/.next/static');
  need(destination===APP+'/.next/static'||destination.endsWith('/.next/static')&&
    [APP+'.releases/',APP+'.web-releases/'].some(prefix=>destination.startsWith(prefix)),'static_directory');assertOnlineToolOwnedPath(destination);
  const files=[],walk=(source,relative='')=>{
    assertOnlineToolOwnedPath(source);for(const e of fs.readdirSync(source,{withFileTypes:true})){
      const key=relative?relative+'/'+e.name:e.name;need(!e.isSymbolicLink()&&!/[\\\r\n\0]/.test(e.name),'static_entry');
      if(e.isDirectory())walk(source+'/'+e.name,key);else {need(e.isFile(),'static_type');const bytes=readBytes(source+'/'+e.name,false,true);files.push({key,source:source+'/'+e.name,sha256:hash(bytes)});}
    }
  };
  for(const target of [APPLICATION,CANDIDATE]){
    const directory=APP+'.web-releases/'+target.slice(0,12)+'-online';
    need(runOnlineToolGit(directory,['rev-parse','HEAD']).toString().trim()===target&&!runOnlineToolGit(directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'asset_source');
    walk(directory+'/.next/static');
  }
  const byKey=new Map();for(const f of files){need(!byKey.has(f.key)||byKey.get(f.key).sha256===f.sha256,'cohort_static_collision');byKey.set(f.key,f);}
  for(const f of byKey.values()){
    let current=path.dirname(destination+'/'+f.key);for(;current!==destination;current=path.dirname(current)){
      try{assertOnlineToolOwnedPath(current);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    try{need(hash(readBytes(destination+'/'+f.key,false,true))===f.sha256,'existing_static_collision');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  let copied=0;
  for(const f of byKey.values()){
    assertOnlineRetentionHeldLocks(lock);const target=destination+'/'+f.key;
    try{fs.lstatSync(target);need(hash(readBytes(target,false,true))===f.sha256,'static_race');continue;}catch(error){if(error.code!=='ENOENT')throw error;}
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});assertOnlineToolOwnedPath(path.dirname(target));
    fs.copyFileSync(f.source,target,fs.constants.COPYFILE_EXCL);const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(target));
    need(hash(readBytes(target,false,true))===f.sha256,'static_readback');copied++;
  }
  const receipt={schemaVersion:1,kind:'booking-immutable-assets',files:byKey.size,copied,inventorySha256:hash(retentionCanonicalText([...byKey.values()].map(({key,sha256})=>({key,sha256})).sort((a,b)=>a.key.localeCompare(b.key)))),completedAt:new Date().toISOString()};
  writeOnce(ROOT+'/static-assets.json',retentionCanonicalText(receipt));return receipt;
}

export async function applyBookingAtomicRouting({lock,toolRevision,phase}){
  toolIdentity(lock,toolRevision);const text=read(ROOT+'/routing-plan.json'),plan=JSON.parse(text);assertBookingAtomicRoutingPlan(plan);equal(text,retentionCanonicalText(plan),'plan_encoding');
  // The host controller separately owns the active/inactive DB decision and
  // independent recovery watchdog. This function never guesses or falls back.
  const readCurrent=()=>Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,read(WEB_RELEASE_PROXY+'/'+f,false)]));
  return executeBookingRoutingPhase({now:()=>new Date().toISOString(),read:readCurrent,
    authorize:()=>{toolIdentity(lock,toolRevision);assertBookingHandoffWindow(plan.window,{nowMs:Date.now()});
      const cohort=verifyBookingAtomicRuntimeCohort({lock,toolRevision});equal(location(cohort.active),plan.primary,'actual_primary_changed');equal(location(cohort.rollback),plan.rollback,'actual_rollback_changed');
      const runtimeReady=JSON.parse(read(ROOT+'/runtime-ready.json'));need(runtimeReady.kind==='booking-atomic-private-runtime-ready','runtime_not_ready');
      const assets=JSON.parse(read(ROOT+'/static-assets.json'));need(assets.kind==='booking-immutable-assets'&&assets.files>0,'assets_not_ready');
      equal(location(JSON.parse(read(RELEASE+'/'+CANDIDATE+'/state.json'))),plan.primary,'primary_changed');
      equal(location(JSON.parse(read(RELEASE+'/'+APPLICATION+'/state.json'))),plan.rollback,'rollback_changed');
      if(phase==='primary'){
        const activation=JSON.parse(read(ROOT+'/activation.json'));
        need(activation.before?.active===false&&activation.after?.active===true&&activation.before.generation===activation.after.generation&&activation.after.protocol===2,'activation_not_committed');
      }
      if(phase==='rollback')read(ROOT+'/activation-attempt.json');
    },
    begin:proof=>writeOnce(ROOT+'/routing-attempt-'+phase+'.json',retentionCanonicalText(proof)),
    replace:(file,before,after)=>{
      assertOnlineRetentionHeldLocks(lock);const target=WEB_RELEASE_PROXY+'/'+file;equal(read(target,false),before,'proxy_changed');if(before===after)return;
      const temporary=target+'.booking-'+plan.window.id+'-'+phase+'.tmp';writeOnce(temporary,after);equal(read(target,false),before,'proxy_changed');fs.renameSync(temporary,target);sync(WEB_RELEASE_PROXY);equal(read(target,false),after,'proxy_readback');
    },
    syntax:()=>{run('/www/server/nginx/sbin/nginx',['-t']);},reload:()=>{run('/www/server/nginx/sbin/nginx',['-s','reload']);},
    verify:async selected=>{
      const target=selected==='armed'?BASELINE:selected==='primary'?CANDIDATE:APPLICATION;
      for(const origin of ['https://faolla.com','https://launch.faolla.com']){
        let confirmed=false;
        for(let i=0;i<10&&!confirmed;i++){
          try{const response=await fetch(origin+'/api/app-web-version?bookingHandoff='+plan.window.id,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(1000)}),v=await response.json();
            confirmed=response.status===200&&v.ok===true&&v.buildId===target;}catch{/* read-only confirmation may be repeated */}
          if(!confirmed)await new Promise(r=>setTimeout(r,100));
        }
        need(confirmed,'public_version');
      }
      assertBookingRoutingCurrent(plan,readCurrent(),{phase:selected});
    },
    complete:receipt=>writeOnce(ROOT+'/routing-applied-'+phase+'.json',retentionCanonicalText(receipt)),
  },plan,phase);
}
