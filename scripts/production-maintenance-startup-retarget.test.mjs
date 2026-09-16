import assert from "node:assert/strict";
import test from "node:test";
import { withStartupFixture } from "./production-maintenance-startup-recovery.test.mjs";
import { MAINTENANCE_STARTUP_UNUSED as UNUSED } from "./production-maintenance-startup-recovery.mjs";
import { validateStartupHandoffReport } from "./production-maintenance-startup-handoff.mjs";

test("unused startup target correction preserves the exact predecessor, attempt and expiry",{concurrency:false},async t=>withStartupFixture(t,async f=>{
  const old=f.api.buildMaintenanceStartupRecoveredState(f.failed,{...f.evidence,targetSha:UNUSED.targetSha,toolsSha:UNUSED.targetSha},{...f.context,targetSha:UNUSED.targetSha});
  f.mappings.set(JSON.stringify(old),UNUSED.stateDigest);
  const source=Buffer.from(f.apiUrl.split(",")[1].split("#")[0],"base64").toString("utf8")
    .replace("stateBytes:2634610",`stateBytes:${Buffer.byteLength(JSON.stringify(old))}`);
  const api=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64")+"#retarget");
  const context={...f.context,targetSha:"8".repeat(40),previousTargetSha:UNUSED.targetSha,expectedRevision:52,expectedDigest:UNUSED.stateDigest,now:f.now+2000,
    stoppedBaseline:{...f.context.stoppedBaseline,observedAt:f.now+1000}};
  const evidence={...api.createMaintenanceStartupInspection(old,context),toolsSha:context.targetSha,leaseRunId:"900000000000000053",leaseRunAttempt:1,
    mainCIrunId:"900000000000000054",historyDigest:"a".repeat(64),historyCheckedAt:f.now+1000};
  const next=api.buildMaintenanceStartupRecoveredState(old,evidence,context);
  assert.equal(next.version,14);assert.equal(next.revision,53);assert.equal(next.activeAttempt,old.activeAttempt);
  assert.equal(next.startupRecovery.expiresAt,old.startupRecovery.expiresAt);
  const restored=f.copy(next);restored.targetSha=old.targetSha;restored.revision=52;delete restored.startupRecovery.retarget;
  assert.deepEqual(restored,old);
  api.assertMaintenanceStartupProgress(old,next);
  assert.throws(()=>api.buildMaintenanceStartupRecoveredState(next,evidence,context));
  for(const mutate of [s=>s.activeAttempt++,s=>s.startupRecovery.expiresAt++,s=>s.startupRecovery.evidence.historyDigest="c".repeat(64),
    s=>s.startupRecovery.retarget.evidence.stateDigest="d".repeat(64),s=>s.startupRecovery.retarget.evidence.targetSha="9".repeat(40),s=>s.launchDisk=f.copy(f.failed.launchDisk)]){
    const bad=f.copy(next);mutate(bad);assert.throws(()=>api.validateMaintenanceStartupState(bad,{bootId:old.bootId,now:context.now}));
    assert.throws(()=>api.assertMaintenanceStartupProgress(old,bad));
  }
  const changed=f.copy(old);changed.phase="failed-held";assert.throws(()=>api.validateMaintenanceStartupPredecessor(changed,{bootId:old.bootId,now:context.now}));
  assert.throws(()=>api.validateMaintenanceStartupPredecessor(old,{bootId:old.bootId,now:old.startupRecovery.expiresAt}));
}));

test("production startup handoff accepts port 3000 and rejects the erroneous 4000",{concurrency:false},async t=>withStartupFixture(t,async f=>{
  const b=f.context.stoppedBaseline,target=b.current.target,parts=b.current.runtimeIdentity.split(":"),legacy=`${parts[0]}:${parts[1]}:${BigInt(parts[4])/1000000000n}`;
  const values={LINK_TARGET:target,RUNTIME_DIR:target,RUNTIME_PARENT:"/www/wwwroot/merchant-space.releases",RELEASE_NAME:target.split("/").at(-1),
    BUILD_PREFIX:f.failed.targetSha.slice(0,12),BUILD_ID:f.failed.targetSha,RUNTIME_IDENTITY:legacy,WEB_CWD_IDENTITY:legacy,
    WEB_PID:"123",WEB_PROCESS_START_TICKS:"123",WEB_PROCESS_IDENTITY:"1:2",ENVIRONMENT_DIRECTORY_IDENTITY:"1:2:3",ENVIRONMENT_FILE_IDENTITY:"1:2:3",ENVIRONMENT_SHA256:"e".repeat(64),
    SUPABASE_INTERNAL_URL:"http://127.0.0.1:8000",NEXT_PUBLIC_SUPABASE_URL:"https://example.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"fixture-only",
    STAFF_ROLLOUT_STATUS:"present",STAFF_ALLOW_LEGACY_EMPTY_ORIGIN:"0",MERCHANT_STAFF_BUSINESS_RBAC_MODE:"enforce",MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS:"10000000",
    FAOLLA_CANONICAL_PORTAL_ORIGIN:"https://launch.faolla.com",AUTOMATION_WORKER_STATE:"running",AUTOMATION_WORKER_RUNNING:"1"};
  for(const k of ["SUPABASE_INTERNAL_URL","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY"])values[k+"_B64"]=Buffer.from(values[k]).toString("base64");
  const report={version:4,operationId:f.failed.operationId,targetSha:f.targetSha,expectedOldSha:f.failed.expectedOldSha,state:"held",
    fields:Object.fromEntries(Object.entries(values).map(([k,v])=>["PREVIOUS_"+k,v])),budgetBaseline:{version:4,predecessorStateDigest:b.stateDigest,previousTargetSha:f.failed.targetSha,stoppedBaseline:b}};
  const request={appDir:"/www/wwwroot/merchant-space",appName:"merchant-space",appPort:3000,operationId:f.failed.operationId,targetSha:f.targetSha,expectedOldSha:f.failed.expectedOldSha};
  assert.equal(Object.keys(validateStartupHandoffReport(report,request).fields).length,27);
  assert.throws(()=>validateStartupHandoffReport(report,{...request,appPort:4000}));
  assert.throws(()=>validateStartupHandoffReport(report,{...request,appPort:3001}));
}));
