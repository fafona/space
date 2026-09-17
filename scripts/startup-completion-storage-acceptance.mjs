// Native, isolated durability acceptance using the exact read-only predecessor.
// Synthetic audit is NEVER authority and can only reach the private copy below.
import * as fs from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import assert from "node:assert/strict";
import {STARTUP_REPAIR as P,STARTUP_COMPLETION as C,buildStartupRepairedState,validateStartupCompletionPredecessor} from "./production-maintenance-startup-repair.mjs";
import {validateMaintenanceState,validateMaintenanceSubproofBindings} from "./production-maintenance-control.mjs";
import {createMaintenanceLaunchJournalStorage} from "./production-maintenance-launch-journal-storage.mjs";
import {assertMaintenanceRecoveryProgress} from "./production-maintenance-recovery.mjs";
const hash=b=>createHash("sha256").update(b).digest("hex");
export async function acceptStartupCompletionStorage(){
 if(process.platform!=="linux"||process.getuid?.()!==0||process.env.FAOLLA_STARTUP_STORAGE_ACCEPTANCE!=="1")throw Error("startup_storage_acceptance_opt_in_required");
 const production="/var/lib/faolla-maintenance/merchant-space",bytes=fs.readFileSync(production+"/state.json");
 assert.equal(hash(bytes),P.stateDigest);
 const predecessor=JSON.parse(bytes),now=Date.now(),bootId=fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim();
 validateStartupCompletionPredecessor(predecessor,{bootId,now});
 const folder=fs.mkdtempSync("/root/.faolla-storage-"),identity=fs.lstatSync(folder),stateFile=folder+"/state.json",tempFile=folder+"/state.launch-journal.tmp";
 fs.chmodSync(folder,0o700);fs.writeFileSync(stateFile,bytes,{flag:"wx",mode:0o600});
 const target="e".repeat(40),request={action:"complete-startup",appDir:P.appDir,appName:P.appName,appPort:P.appPort,targetSha:target,previousTargetSha:P.previousTargetSha,expectedOldSha:P.expectedOldSha,operationId:P.operationId};
 const next=buildStartupRepairedState(predecessor,{version:2,completion:C,predecessor,targetSha:target,repairedAt:now,runId:"999999999999990",mainCIrunId:"999999999999991",sourceDigest:"a".repeat(64),historyDigest:"b".repeat(64),historyCheckedAt:now,migrationDigest:"2190b7868b879233c8d4852810d7d2ee186271005104c78bc229484b60d58388"},{bootId,now});
 const mapping=new Map([[production,folder],[production+"/state.json",stateFile],[production+"/state.launch-journal.tmp",tempFile]]);
 const parents=new Set(["/","/var","/var/lib","/var/lib/faolla-maintenance"]);
 const mapped=p=>{if(mapping.has(p))return mapping.get(p);if(parents.has(p))return p;throw Error("test_path_denied");};
 const events=[],fds=new Map();
 const io={...fs,
  lstatSync:(p,...args)=>fs.lstatSync(mapped(p),...args),
  realpathSync:p=>{assert.equal(fs.realpathSync(mapped(p)),mapped(p));return p;},
  openSync:(p,flags,...args)=>{const write=flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND);if(write)assert.equal(p,production+"/state.launch-journal.tmp");const fd=fs.openSync(mapped(p),flags,...args);fds.set(fd,p);return fd;},
  readSync:(...args)=>{events.push("read");return fs.readSync(...args);},
  writeSync:(fd,...args)=>{assert.equal(fds.get(fd),production+"/state.launch-journal.tmp");events.push("write");return fs.writeSync(fd,...args);},
  fsyncSync:fd=>{assert(mapping.has(fds.get(fd)));events.push(fds.get(fd)===production?"sync-dir":"sync-file");fs.fsyncSync(fd);},
  closeSync:fd=>{fs.closeSync(fd);fds.delete(fd);},
  renameSync:(from,to)=>{assert.equal(from,production+"/state.launch-journal.tmp");assert.equal(to,production+"/state.json");events.push("rename");fs.renameSync(tempFile,stateFile);},
 };
 const captureState=value=>{validateMaintenanceState(value,{...request,targetSha:value.startupRepair?target:P.previousTargetSha},bootId,Date.now());validateMaintenanceSubproofBindings(value);return value;};
 const makeStore=()=>createMaintenanceLaunchJournalStorage({appName:P.appName,withExistingOperationLock:async f=>f(),captureState},io);
 try{
  const before=await makeStore().readOperationUnderExistingOperationLock();
  assertMaintenanceRecoveryProgress(predecessor,next);
  const after=await makeStore().replaceOperationUnderExistingOperationLock({expectedRevision:before.revision,expectedDigest:before.digest,next});
  assert.deepEqual(after.state,next);assert(events.indexOf("sync-file")<events.indexOf("rename"));assert(events.indexOf("rename")<events.indexOf("sync-dir"));assert(events.lastIndexOf("read")>events.indexOf("sync-dir"));
  const reread=await makeStore().readOperationUnderExistingOperationLock();assert.deepEqual(reread,after);
  validateMaintenanceState(reread.state,{...request,action:"check-held",targetSha:target},bootId,Date.now());
  assert.equal(hash(JSON.stringify(reread.state.startupRepair.predecessor)),P.stateDigest);
  await assert.rejects(makeStore().replaceOperationUnderExistingOperationLock({expectedRevision:before.revision,expectedDigest:before.digest,next}));
  let rejected=0;
  for(const key of ["startupRepair","runtime","database","tokenHash","createdAt","daemonRepair","recovery"]){
   const bad=structuredClone(after.state);bad.revision++;delete bad[key];const count=events.filter(e=>e==="write").length;
   await assert.rejects(makeStore().replaceOperationUnderExistingOperationLock({expectedRevision:after.revision,expectedDigest:after.digest,next:bad}));assert.equal(events.filter(e=>e==="write").length,count);rejected++;
  }
  const later=structuredClone(after.state);later.revision++;
  assertMaintenanceRecoveryProgress(after.state,later);
  await makeStore().replaceOperationUnderExistingOperationLock({expectedRevision:after.revision,expectedDigest:after.digest,next:later});
  assert.equal(hash(fs.readFileSync(production+"/state.json")),P.stateDigest);
  return {passed:true,durableCommit:true,normalHeldValidation:true,independentReadback:true,staleReplayRejected:true,mutationsRejected:rejected,productionStateUnchanged:true};
 }finally{
  for(const fd of fds.keys())fs.closeSync(fd);
  const current=fs.lstatSync(folder);assert.equal(current.ino,identity.ino);assert.equal(current.dev,identity.dev);assert.equal(fs.realpathSync(folder),folder);
  for(const file of [stateFile,tempFile])if(fs.existsSync(file))fs.unlinkSync(file);
  fs.rmdirSync(folder);
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await acceptStartupCompletionStorage()));}catch(e){console.error(JSON.stringify({passed:false,code:/^[a-z_]+$/.test(e.message)?e.message:"startup_storage_acceptance_failed"}));process.exitCode=1;}
}
