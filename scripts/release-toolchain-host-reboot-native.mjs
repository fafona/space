// Real private PM2 resurrection, NOT a simulated kernel reboot. Proves the
// observed normalization/cohort behavior and explicitly refuses same-boot use.
import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {normalizeResurrectedRetirementProcess as normalizeRetirementProcess,assertResurrectedManagerDefinition} from './release-toolchain-process-observation.mjs';
import {assertHostBootCohort,assertDifferentHostBoot,assertHostBootRetainedBuild} from './release-toolchain-host-reboot-contract.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {withOwnedCiPm2ProcessWitness} from './release-toolchain-proc-witness.mjs';
import {inspectResurrectedPm2Registry,captureResurrectedPm2DumpTarget,persistResurrectedPm2Dump,verifyResurrectedPm2Dump} from './release-toolchain-resurrection-pm2-adapter.mjs';
import {assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {observeCiProcessAlive} from './release-toolchain-ci-process-exit.mjs';
const need=(v,c)=>{if(!v)throw Error('host_reboot_native_'+c);},pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function acceptRealPm2Resurrection(root){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.version==='v20.20.1'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&/^\/var\/lib\/faolla-eq-[A-Za-z0-9]+$/.test(root)&&!['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'].some(p=>fs.existsSync(p)),'scope');
 const nextProof=JSON.parse(fs.readFileSync(root+'/reports/retained-next-build-binding-verified.json','utf8')),buildBytes=fs.readFileSync(root+'/app/.next/BUILD_ID','utf8');
 need(nextProof.kind==='real-next-retained-build-binding-verified'&&nextProof.realNextVersion==='16.3.4'&&['actualHttpRevisionObserved','actualBuildIdDistinct','buildArtifactUnchanged'].every(k=>nextProof[k]===true)&&nextProof.formalHostTouched===false&&nextProof.publicationAuthority===false,'actual_next_build_proof');
 assertHostBootRetainedBuild({target:nextProof.toolRevision,buildBytes,proof:nextProof.proof});need(buildBytes.trim()!==nextProof.toolRevision,'actual_next_build_identity_distinct');
 const bootRoot=fs.mkdtempSync('/var/lib/faolla-eq-');fs.chmodSync(bootRoot,0o700);
 const home=bootRoot+'/pm2',app=bootRoot+'/app',pm2=root+'/dependencies/node_modules/pm2/bin/pm2';
 for(const p of [home,app])fs.mkdirSync(p,{mode:0o700});
 const env={PATH:'/usr/bin:/bin',HOME:root,PM2_HOME:home,NODE_OPTIONS:'',NODE_PATH:'',PM2_NODE_OPTIONS:'',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
 const run=args=>{const r=spawnSync('/usr/bin/node',[pm2,...args],{cwd:app,env,encoding:'utf8',timeout:20000,maxBuffer:2097152});need(r.status===0&&!r.signal&&!r.error,'command');return r.stdout;};
 const boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();let daemon;const children=new Map();
 const live=f=>observeCiProcessAlive(f,{readStat:pid=>fs.readFileSync('/proc/'+pid+'/stat','utf8'),capture:captureProcessFact});
 const rows=()=>{need(live(daemon),'daemon');const parsed=JSON.parse(run(['jlist']));need(live(daemon)&&parsed.length===2,'cohort');for(const p of parsed.filter(p=>p.pid>0)){const f=captureProcessFact(p.pid);need(f.uid===0&&f.parentPid===daemon.pid&&f.cwd===app,'child');children.set(f.pid,f);}return parsed;};
 const stop=async()=>{if(!daemon)return;need(live(daemon),'daemon');process.kill(daemon.pid,'SIGINT');for(let i=0;i<200&&live(daemon);i++)await pause(25);need(!live(daemon),'daemon_exit');for(const f of children.values()){for(let i=0;i<200&&live(f);i++)await pause(25);need(!live(f),'child_exit');}daemon=null;};
 let report;
 try{
  fs.writeFileSync(app+'/timer.cjs','setInterval(()=>{},1000);\n',{mode:0o600,flag:'wx'});
  const config={apps:['reboot-gap','reboot-online','reboot-stopped'].map(name=>({name,script:app+'/timer.cjs',cwd:app,interpreter:'/usr/bin/node',watch:false,autorestart:false,env:{KEEP:'synthetic-only',FAOLLA_BACKGROUND_JOBS_PAUSED:'1'}}))};
  fs.writeFileSync(app+'/ecosystem.config.cjs','module.exports='+JSON.stringify(config)+';\n',{mode:0o600,flag:'wx'});
  run(['start',app+'/ecosystem.config.cjs']);daemon=captureProcessFact(Number(fs.readFileSync(home+'/pm2.pid','utf8').trim()));need(daemon.uid===0&&daemon.executable==='/usr/bin/node','daemon');
  const initial=JSON.parse(run(['jlist']));need(initial.length===3&&initial[0].name==='reboot-gap','gap_cohort');for(const p of initial){const f=captureProcessFact(p.pid);need(f.uid===0&&f.parentPid===daemon.pid&&f.cwd===app,'child');children.set(f.pid,f);}
  // Delete ONLY this owned synthetic placeholder registration, retaining all
  // files/logs. The resulting ID gap makes resurrection genuinely renumber the
  // two surviving definitions, including the still-stopped historical PID path.
  run(['delete','reboot-gap']);rows();run(['stop','reboot-stopped']);const original=rows();run(['save']);const dump=fs.readFileSync(home+'/dump.pm2'),oldRows=original.map(normalizeRetirementProcess);await stop();
  run(['resurrect']);daemon=captureProcessFact(Number(fs.readFileSync(home+'/pm2.pid','utf8').trim()));const current=rows(),now=current.map(normalizeRetirementProcess),proofs=oldRows.map(p=>{
   const saved=JSON.parse(dump).find(r=>r.name===p.name),row=current.find(r=>r.name===p.name);
   return assertResurrectedManagerDefinition({saved,current:row.pm2_env,before:p,after:normalizeRetirementProcess(row),home});
  });assertHostBootCohort(oldRows,now,proofs);
  need(now.find(p=>p.name==='reboot-stopped').status==='stopped'&&now.find(p=>p.name==='reboot-stopped').pid===0,'stopped_resurrected');
  need(oldRows.every(p=>now.find(r=>r.name===p.name).pmId!==p.pmId),'ids_not_reassigned');
  const stopped=current.find(p=>p.name==='reboot-stopped');need(stopped.pm2_env.pm_pid_path!==home+'/pids/reboot-stopped-'+stopped.pm_id+'.pid','stopped_path_not_historical');
  let refused=false;try{assertDifferentHostBoot(boot,fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim());}catch{refused=true;}need(refused,'same_boot_accepted');
  await withOwnedCiPm2ProcessWitness(bootRoot,async verify=>{
   const {commandLine,...fact}=captureProcessFact(daemon.pid);need(commandLine[0]==='PM2 v6.0.14: God Daemon ('+home+')','daemon');
   const registry=await inspectResurrectedPm2Registry(fact,boot);assertCompletePm2DumpSet(current,registry);verify();
   const target=await captureResurrectedPm2DumpTarget(fact,boot),receipt=await persistResurrectedPm2Dump(fact,boot,registry,target);need(await verifyResurrectedPm2Dump(fact,boot,registry,receipt)===true,'persistence');verify();
  });
  report={kind:'real-pm2-resurrection-contract-verified',realPm2Version:'6.0.14',realProcessesObserved:true,actualDumpResurrected:true,stoppedRegistrationPreserved:true,wholeEnvironmentVerified:true,sameKernelBootRefused:true,kernelRebootNotSimulated:true,actualPersistenceAfterResurrection:true,unmodifiedSharedValidators:true,managerIdsActuallyReassigned:true,stoppedPidPathHistorical:true,productionAuthority:false,formalHostTouched:false,savedDumpSha256:hash(dump),sourceHashes:Object.fromEntries(['release-toolchain-host-reboot-native.mjs','release-toolchain-host-reboot-contract.mjs','release-toolchain-host-reboot-pm2.py','release-toolchain-resurrection-pm2.py','release-toolchain-resurrection-pm2-adapter.mjs','release-toolchain-process-observation.mjs'].map(file=>[file,hash(fs.readFileSync(new URL('./'+file,import.meta.url)))]))};
 }finally{await stop();need([...children.values()].every(f=>!live(f)),'cleanup');}
 report.allOwnedProcessesStopped=true;report.actualNextBuildBindingVerified=true;
 fs.writeFileSync(root+'/reports/host-reboot-resurrection-verified.json',JSON.stringify(report)+'\n',{mode:0o600,flag:'wx'});return report;
}
