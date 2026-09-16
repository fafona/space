import { lstatSync, readlinkSync, realpathSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal, types } from "node:util";
import { assertLeaseStopped, assertLeaseGenerationsStopped, assertStartupPredecessorGenerationsStopped } from "./production-maintenance-lease-inspection.mjs";
import { inspectPm2Registry, pm2RegistryDigest, validatePm2Registry } from "./production-maintenance-pm2-adapter.mjs";
import { validateMaintenanceStartupPredecessor, maintenanceStartupHistoricalState, validateMaintenanceStartupBaseline,
  MAINTENANCE_STARTUP_PREDECESSOR as PIN } from "./production-maintenance-startup-recovery.mjs";
import { validateStartupHandoffReport } from "./production-maintenance-startup-handoff.mjs";
import { captureMaintenancePreflightValue as capture } from "./production-maintenance-preflight-recovery.mjs";

const fail=()=>{throw new Error("maintenance_startup_inspection_unverified");};
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity=s=>["dev","ino","size","mtimeNs","ctimeNs","nlink","uid","mode"].map(k=>String(s[k])).join(":");
const APP="/www/wwwroot/merchant-space";
function current(app,runtime){
  if(app!==APP||runtime!=="/www/wwwroot/merchant-space.releases/e83c91abbf8e-20260915004149")fail();
  const link=app+".current",before=lstatSync(link,{bigint:true}),dir=lstatSync(runtime,{bigint:true});
  if(!before.isSymbolicLink()||before.uid!==0n||before.nlink!==1n||readlinkSync(link)!==runtime||realpathSync(link)!==runtime||
    !dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0n||(dir.mode&0o022n)!==0n||realpathSync(runtime)!==runtime)fail();
  const value={target:runtime,linkIdentity:identity(before),runtimeIdentity:identity(dir)};
  if(identity(lstatSync(link,{bigint:true}))!==value.linkIdentity||identity(lstatSync(runtime,{bigint:true}))!==value.runtimeIdentity||readlinkSync(link)!==runtime)fail();
  return value;
}
function options(raw){
  if(!raw||types.isProxy(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))fail();
  const value={};for(const key of Reflect.ownKeys(raw)){const d=Object.getOwnPropertyDescriptor(raw,key);if(!["runtime","now","readCurrent"].includes(key)||!d?.enumerable||!Object.hasOwn(d,"value"))fail();value[key]=d.value;}
  return {runtime:value.runtime??{},now:value.now??Date.now,readCurrent:value.readCurrent??current};
}
async function prepare(raw,overrides){
  raw=capture(raw);
  const io=options(overrides),clock={bootId:PIN.bootId,now:io.now()};
  const old=raw?.version===14?maintenanceStartupHistoricalState(raw,clock):validateMaintenanceStartupPredecessor(raw,clock);
  if(!process.argv[1]||process.argv[1]==="-")fail();
  const api=await import("./production-maintenance-runtime.mjs"),candidate=api.validateCandidateProof(old.candidate,old.runtime);
  const projection={version:1,input:{...old.runtime.input,expectedOldSha:PIN.targetSha},bootId:PIN.bootId,
    disk:candidate.disk,environment:candidate.environment,daemon:candidate.daemon,web:candidate.web,worker:{state:"absent",managed:null}};
  api.validateRuntimeProof(projection);return {io,old,api,projection,authority:raw};
}
async function stopped(p){
  const registries=[],inspect=p.io.runtime.pm2Registry??inspectPm2Registry;
  const runtime={...p.io.runtime,pm2Registry:async(...args)=>{const value=validatePm2Registry(await inspect(...args));registries.push(pm2RegistryDigest(value));return value;}};
  const assertHistoricalStopped=p.authority.version===13?assertStartupPredecessorGenerationsStopped:assertLeaseStopped;
  await assertHistoricalStopped(p.authority,{runtime,now:p.io.now});
  if(await p.api.assertRuntimeStopped(p.projection,runtime)!==true||registries.length<5||registries.some(d=>d!==registries[0]))fail();
  if(p.authority.version===14)maintenanceStartupHistoricalState(p.authority,{bootId:PIN.bootId,now:p.io.now()});
  return registries[0];
}
export async function assertStartupStopped(raw,overrides={}){try{await stopped(await prepare(raw,overrides));return true;}catch{fail();}}
export async function assertStartupGenerationsStopped(raw,overrides={}){
  try{
    const p=await prepare(raw,overrides);await assertLeaseGenerationsStopped(p.authority,{runtime:p.io.runtime,now:p.io.now});
    const {captureProcessFact}=await import("./check-production-runtime-supervision.mjs");
    const read=p.io.runtime.readProcess??(pid=>{try{lstatSync(`/proc/${pid}`);}catch(e){if(e.code==="ENOENT")return null;throw e;}return captureProcessFact(pid);});
    const inRuntime=p.io.runtime.processesInRuntime??(runtime=>{const entries=readdirSync("/proc").filter(n=>/^[1-9][0-9]*$/.test(n));if(entries.length>16384)fail();return entries.flatMap(n=>{try{const path=realpathSync(`/proc/${n}/cwd`);return path===runtime||path.startsWith(runtime+"/")?[Number(n)]:[];}catch(e){if(e.code==="ENOENT")return [];throw e;}});});
    const inspect=p.io.runtime.pm2Registry??inspectPm2Registry;
    let previous=null;
    for(let i=0;i<2;i++){
      await p.api.readRuntimeHandoffEnvironment(p.projection,p.io.runtime);
      for(const fact of p.projection.web.processes){const actual=read(fact.pid);if(actual!==null&&actual.startTicks===fact.startTicks)fail();}
      if(inRuntime(p.projection.disk.runtime).length!==0)fail();
      const entries=validatePm2Registry(await inspect(p.old.runtime.daemon,PIN.bootId));
      if(entries.some(e=>e.pm2_env.pm_cwd===p.projection.disk.runtime||e.pm2_env.pm_exec_path.startsWith(p.projection.disk.runtime+"/")||
        e.pm_id===p.projection.web.pm2.pmId&&e.pm2_env.created_at===p.projection.web.pm2.createdAt))fail();
      const digest=pm2RegistryDigest(entries);if(previous!==null&&previous!==digest)fail();previous=digest;
    }
    await assertLeaseGenerationsStopped(p.authority,{runtime:p.io.runtime,now:p.io.now});return true;
  }catch{fail();}
}
export async function captureStartupBaseline(raw,overrides={}){
  try{
    const p=await prepare(raw,overrides),before=p.io.readCurrent(APP,p.projection.disk.runtime),registry=await stopped(p),after=p.io.readCurrent(APP,p.projection.disk.runtime);
    if(!equal(before,after))fail();
    const result=validateMaintenanceStartupBaseline({version:4,stateDigest:PIN.stateDigest,candidateDigest:hash(p.old.candidate),launchDiskDigest:hash(p.old.launchDisk),
      launchJournalDigest:hash(p.old.launchJournal),runtimeDigest:hash(p.old.runtime),current:after,bootId:PIN.bootId,pm2RegistryDigest:registry,observedAt:p.io.now()});
    if(raw.version===14){const frozen=raw.startupRecovery.stoppedBaseline;if(!equal({...result,observedAt:frozen.observedAt},frozen))fail();}
    return result;
  }catch{fail();}
}
export async function verifyStartupBaseline(raw,baseline,overrides={}){
  const expected=validateMaintenanceStartupBaseline(baseline),actual=await captureStartupBaseline(raw,overrides);
  if(actual.observedAt<expected.observedAt||!equal({...actual,observedAt:expected.observedAt},expected))fail();return true;
}
export async function readStartupHandoffFields(originalRuntime,raw,baseline,overrides={}){
  try{
    await verifyStartupBaseline(raw,baseline,overrides);const p=await prepare(raw,overrides);
    if(!equal(originalRuntime,p.old.runtime)||raw.version!==14||raw.phase!=="held"||raw.candidate!==null)fail();
    await p.api.readRuntimeHandoffEnvironment(originalRuntime,p.io.runtime);
    const fields=await p.api.readDeploymentHandoffFields(p.projection,p.io.runtime);
    fields.PREVIOUS_AUTOMATION_WORKER_STATE=originalRuntime.worker.state;fields.PREVIOUS_AUTOMATION_WORKER_RUNNING=originalRuntime.worker.state==="running"?"1":"0";
    const report=validateStartupHandoffReport({version:4,operationId:raw.operationId,targetSha:raw.targetSha,expectedOldSha:raw.expectedOldSha,state:"held",fields,
      budgetBaseline:{version:4,predecessorStateDigest:PIN.stateDigest,previousTargetSha:PIN.targetSha,stoppedBaseline:baseline}},{...originalRuntime.input,operationId:raw.operationId,targetSha:raw.targetSha});
    await verifyStartupBaseline(raw,baseline,overrides);return report.fields;
  }catch{fail();}
}
