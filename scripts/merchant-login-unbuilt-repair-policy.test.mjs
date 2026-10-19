import test from 'node:test';
import assert from 'node:assert/strict';
import {LOGIN_UNBUILT_REPAIR as p,LOGIN_UNBUILT_REPAIR_FILES as files,LOGIN_UNBUILT_REPAIR_PRESERVED as pins,
 assertLoginUnbuiltRepairReceipt as check,assertLoginUnbuiltRepairToolScope,loginUnitTestEnvironment,assertLoginUnbuiltState} from './merchant-login-unbuilt-repair-policy.mjs';
function receipt(){return {schemaVersion:1,kind:'merchant-login-unbuilt-test-environment-repair',target:p.target,baseline:p.baseline,toolRevision:'e'.repeat(40),originalStateSha256:p.stateSha256,sourceInputsSha256:p.sourceInputsSha256,dependencySha256:p.dependency.sha256,preservedFiles:{...pins},activeSha256:p.activeSha256,maintenanceSha256:p.maintenanceSha256,markerSha256:p.markerSha256,retentionHeadSha256:p.retentionHeadSha256,changedToolFiles:[...files],approvedTestEnvironmentIsolation:true,preparedAt:'2026-10-19T00:00:00.000Z'};}
test('one fixed unbuilt candidate and immutable evidence, never a generic pending override',()=>{
 assert.equal(p.target,'518d32cdf8088b285ed174833ac2ed7fe8e38282');assert.equal(p.baseline,'6d77f3dfb61d1b694cc807c17d14f334cfec62f0');assert.equal(p.port,3103);
 for(const x of [p,p.dependency,files,pins])assert.ok(Object.isFrozen(x));
 const r=receipt(),before=JSON.stringify(r);assert.equal(check(r),r);check(r,{target:p.target,toolRevision:r.toolRevision});assert.equal(JSON.stringify(r),before);
 for(const patch of [{target:'a'.repeat(40)},{baseline:p.target},{toolRevision:p.target},{toolRevision:p.baseline},{toolRevision:'e'.repeat(40)+'\n'},{originalStateSha256:'a'.repeat(64)},{sourceInputsSha256:'a'.repeat(64)},{dependencySha256:'a'.repeat(64)},{activeSha256:'a'.repeat(64)},{maintenanceSha256:'a'.repeat(64)},{markerSha256:'a'.repeat(64)},{retentionHeadSha256:'a'.repeat(64)},{approvedTestEnvironmentIsolation:false},{extra:true},{preparedAt:'2026-02-30T00:00:00.000Z'}])assert.throws(()=>check({...receipt(),...patch}));
 assert.throws(()=>check(receipt(),{target:'a'.repeat(40)}));assert.throws(()=>check(receipt(),{toolRevision:'a'.repeat(40)}));
});
test('receipt rejects missing, inherited, accessor, symbol and changed preserved evidence',()=>{
 for(const key of Object.keys(receipt())){const r=receipt();delete r[key];assert.throws(()=>check(r));}
 for(const make of [r=>Object.assign(Object.create({}),r),r=>Object.assign(r,{[Symbol('extra')]:true}),r=>Object.defineProperty(r,'target',{get(){return p.target;}}),r=>({...r,preservedFiles:{...pins,'state.json':'0'.repeat(64)}}),r=>({...r,preservedFiles:{...pins,extra:'a'.repeat(64)}})])assert.throws(()=>check(make(receipt())));
});
test('tool closure is exactly implementation/test pairs; application, SQL, dependencies and deletions stay excluded',()=>{
 assertLoginUnbuiltRepairToolScope([...files].reverse());
 for(const bad of [[],files.slice(1),[...files,files[0]],[...files,'src/lib/authSessionRecovery.ts'],[...files,'scripts/supabase-migrations/anything.sql'],[...files,'package.json'],files.map((f,i)=>i===0?f.toUpperCase():f)])assert.throws(()=>assertLoginUnbuiltRepairToolScope(bad));
 for(const f of files)assert.ok(f.startsWith('scripts/')&&/\.mjs$/.test(f));
});
test('unit subprocess has a fixed credential-free environment, unaffected by production settings',()=>{
 const keys=['NODE_ENV','NODE_OPTIONS','NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID','FAOLLA_CANONICAL_PORTAL_ORIGIN','SUPABASE_SERVICE_ROLE_KEY'];const before=keys.map(k=>[k,process.env[k]]);
 try{for(const k of keys)process.env[k]='synthetic-production-value';const a=loginUnitTestEnvironment();assert.deepEqual(a,{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NODE_ENV:'test',NEXT_TELEMETRY_DISABLED:'1'});a.NODE_ENV='production';assert.equal(loginUnitTestEnvironment().NODE_ENV,'test');for(const k of keys)assert.equal(process.env[k],'synthetic-production-value');}
 finally{for(const [k,v] of before)if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
function original(){return {target:p.target,baseline:p.baseline,directory:p.directory,name:p.name,port:p.port,lane:'merchant-login-recovery-code-only',status:'preparing',kept:{configurationSha256:'a'.repeat(64)}};}
test('only original preparing -> proof-added -> ready-no-database is accepted',()=>{
 const o=original(),proof='b'.repeat(64),built={...o,loginBuildProofSha256:proof},ready={...built,status:'ready-no-database'};
 assertLoginUnbuiltState(o,o);assertLoginUnbuiltState(built,o,{phase:'built',buildProofSha256:proof});assertLoginUnbuiltState(ready,o,{phase:'ready',buildProofSha256:proof});
 for(const [state,options] of [[built,{}],[ready,{phase:'built',buildProofSha256:proof}],[o,{phase:'ready',buildProofSha256:proof}],[{...ready,activatedAt:'now'},{phase:'ready',buildProofSha256:proof}],[{...ready,kept:{configurationSha256:'c'.repeat(64)}},{phase:'ready',buildProofSha256:proof}],[ready,{phase:'ready',buildProofSha256:'bad'}],[o,{phase:'active'}]])assert.throws(()=>assertLoginUnbuiltState(state,o,options));
 for(const patch of [{target:'a'.repeat(40)},{baseline:p.target},{port:3104},{lane:'attendance'},{status:'active'},{loginBuildProofSha256:proof}])assert.throws(()=>assertLoginUnbuiltState({...o,...patch},{...o,...patch}));
});
