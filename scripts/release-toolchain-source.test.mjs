import test from 'node:test';import assert from 'node:assert/strict';
import {RELEASE_REPOSITORY,RELEASE_REQUIRED_JOBS,RELEASE_SAFETY_JOB,validateReviewRuns,toolOnlySourcePath,parseSourceTree,assertUnchangedApplicationSource,commonGitDirectory} from './release-toolchain-source.mjs';
test('Git 2.27 common-dir output is resolved without a newer --path-format flag or accepting unknown-option output',()=>{
 assert.equal(commonGitDirectory('/var/lib/tools/commit','/www/wwwroot/app/.git'),'/www/wwwroot/app/.git');
 assert.equal(commonGitDirectory('/work/repo/tools/commit','../../.git'),'/work/repo/.git');
 for(const output of ['','--path-format=absolute\n/www/wwwroot/app/.git','/path\nother',' /path','/path\u0000'])assert.throws(()=>commonGitDirectory('/work/tool',output));
});
const sha='a'.repeat(40),old='b'.repeat(40),nowMs=Date.parse('2026-10-28T05:00:00.000Z');
function fixture(){const runs=[['.github/workflows/ci.yml',1],['.github/workflows/release-toolchain.yml',2]].map(([path,id])=>({id,path,head_sha:sha,head_branch:'main',event:'push',run_attempt:1,status:'completed',conclusion:'success',repository:{full_name:RELEASE_REPOSITORY},head_repository:{full_name:RELEASE_REPOSITORY}}));
 return {revision:sha,main:sha,runs,jobsByRun:{1:RELEASE_REQUIRED_JOBS.map(name=>({name,run_attempt:1,status:'completed',conclusion:'success'})),2:[{name:RELEASE_SAFETY_JOB,run_attempt:1,status:'completed',conclusion:'success'}]},nowMs};}
test('source review independently binds exact current main and both complete CI workflows, never a provided green flag',()=>{
 const r=validateReviewRuns(fixture());assert.equal(r.productionEligible,true);assert.equal(r.runs[0].jobs.length,12);assert.equal(r.runs[1].jobs.length,1);
 for(const patch of [{main:old},{revision:'main'},{runs:[]},{jobsByRun:{}}])assert.throws(()=>validateReviewRuns({...fixture(),...patch}));
});
test('the latest failed, pending or cancelled run never falls back to an older green run',()=>{
 for(const state of ['failure','cancelled','skipped','neutral',null]){const f=fixture();f.runs.push({...f.runs[0],id:3,conclusion:state});assert.throws(()=>validateReviewRuns(f));}
});
test('missing, extra, duplicate, skipped, stale-attempt and foreign-repository jobs fail source admission',()=>{
 for(const mutate of [f=>f.jobsByRun[1].pop(),f=>f.jobsByRun[1].push({...f.jobsByRun[1][0]}),f=>f.jobsByRun[1][0].conclusion='skipped',
 f=>f.jobsByRun[1][0].run_attempt=2,f=>f.runs[0].repository.full_name='foreign/repo',f=>f.runs[0].head_repository.full_name='unreviewed/fork',f=>f.runs[0].event='pull_request',f=>f.runs[0].head_branch='feature']){
  const f=fixture();mutate(f);assert.throws(()=>validateReviewRuns(f));
 }
 const f=fixture();f.runs.forEach(r=>{r.event='pull_request';r.head_branch='feature';});assert.equal(validateReviewRuns({...f,production:false}).productionEligible,false);
});
test('application inputs include unknown scripts and runtime source, while reviewed release/test-only edits are independent',()=>{
 assert.equal(toolOnlySourcePath('scripts/release-toolchain-pm2-worker.test.py'),true);assert.equal(toolOnlySourcePath('scripts/arbitrary-runtime.py'),false);
 const row=(file,oid=old)=>({mode:'100644',oid,file}),a=[row('src/app/[merchantEntry]/page.tsx'),row('package.json'),row('package-lock.json'),row('scripts/run-merchant-worker.ts'),row('scripts/release-toolchain.mjs')];
 const b=[...a.slice(0,-1),row('scripts/release-toolchain.mjs',sha),row('scripts/release-toolchain-new.mjs',sha)];assert.doesNotThrow(()=>assertUnchangedApplicationSource(old,a,b));
 for(const file of ['src/app/[merchantEntry]/page.tsx','package.json','scripts/run-merchant-worker.ts','scripts/arbitrary.mjs','scripts/supabase-migrations/new.sql']){
  assert.equal(toolOnlySourcePath(file),false);assert.throws(()=>assertUnchangedApplicationSource(old,a,[...b,row(file,sha)]));
 }
});
test('real Git tree paths support route brackets and asset @ names, but refuse traversal, control bytes, links and duplicate paths',()=>{
 const row=file=>'100644 blob '+sha+'\t'+file+'\0';assert.equal(parseSourceTree(Buffer.from(row('src/app/[merchantEntry]/page.tsx')+row('ios/Icon@2x.png'))).length,2);
 for(const text of [row('../escape'),row('/absolute'),row('a\nb'),row('same')+row('same'),'120000 blob '+sha+'\tlink\0'])assert.throws(()=>parseSourceTree(Buffer.from(text)));
});
