import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { withStartupFixture } from "./production-maintenance-startup-recovery.test.mjs";
import { MAINTENANCE_STARTUP_PREDECESSOR as PIN } from "./production-maintenance-startup-recovery.mjs";
test("startup controller requires repeated live checks and a single exact CAS",{concurrency:false},async t=>withStartupFixture(t,async f=>{
  const source=readFileSync(new URL("./production-maintenance-control.mjs",import.meta.url),"utf8")
    .replaceAll(/from "(\.\/[^"\n]+)"/g,(_all,p)=>`from ${JSON.stringify(p==="./production-maintenance-lease.mjs"?f.controllerLeaseApiUrl:p==="./production-maintenance-startup-recovery.mjs"?f.apiUrl:new URL(p,import.meta.url).href)}`);
  const {runMaintenanceAction,parseMaintenanceRequest,validateMaintenanceState}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
  const lease=await import(f.controllerLeaseApiUrl),events=[];
  const argv=["recover-startup","--app-dir",f.failed.appDir,"--app-name",f.failed.appName,"--app-port",String(f.failed.appPort),"--target-sha",f.targetSha,
    "--previous-target-sha",PIN.targetSha,"--expected-old-sha",PIN.expectedOldSha,"--expected-operation-id",f.failed.operationId,
    "--lease-evidence",lease.encodeMaintenanceLeaseEvidence(f.evidence),"--json"];
  const request=parseMaintenanceRequest(argv);
  const ops={bootId:()=>PIN.bootId,now:()=>f.now,readLeaseSnapshot:async()=>({state:f.copy(f.failed),revision:51,digest:PIN.stateDigest}),validateProofs:()=>events.push("proof"),
    assertPreflightDiskHeadroom:async()=>events.push("disk"),verifyIngress:async()=>events.push("ingress"),assertStartupStopped:async()=>events.push("stopped"),
    assertDatabaseQuiet:async()=>events.push("database"),captureStartupBaseline:async()=>f.context.stoppedBaseline,verifyStartupBaseline:async()=>events.push("baseline"),
    readStartupSourceProof:async()=>{events.push("source");return {sourceDiffDigest:f.context.sourceDiffDigest};},
    readStartupMigrationProof:async()=>{events.push("migration");return f.context.migrationDigest;},
    commitStartup:async(snapshot,next)=>{events.push("CAS");assert.equal(snapshot.digest,PIN.stateDigest);f.api.assertMaintenanceStartupProgress(snapshot.state,next);return next;}};
  assert.equal((await runMaintenanceAction(request,ops)).state,"held");
  assert.equal(events.filter(x=>x==="CAS").length,1);
  for(const name of ["disk","ingress","stopped","database","baseline","source","migration"])assert.equal(events.filter(x=>x===name).length,2,name);
  for(const name of ["verifyIngress","assertStartupStopped","assertDatabaseQuiet","verifyStartupBaseline","readStartupSourceProof","readStartupMigrationProof"]){
    let committed=false;await assert.rejects(runMaintenanceAction(request,{...ops,[name]:async()=>{throw Error("unverified");},commitStartup:async()=>{committed=true;}}));assert.equal(committed,false);
  }
  const next=f.api.buildMaintenanceStartupRecoveredState(f.failed,f.evidence,f.context);
  validateMaintenanceState(next,{...request,action:"check-held"},PIN.bootId,f.now);
  assert.throws(()=>parseMaintenanceRequest(argv.map(x=>x==="recover-startup"?"start-candidate":x)));
}));
