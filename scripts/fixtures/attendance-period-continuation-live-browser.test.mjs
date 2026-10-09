//Pure/static contract checks only. Actual browser/SQL execution belongs to root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {periodContinuationLiveEndpoint,periodContinuationLiveDate,periodContinuationLiveLimits,periodContinuationLiveAllowedRequest,
 periodContinuationLiveFactsSql,verifyPeriodContinuationLiveBrowser,runPeriodContinuationLiveBrowser} from './attendance-period-continuation-live-browser.mjs';
const source=readFileSync(new URL('./attendance-period-continuation-live-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-period-continuation-live-browser-entry.tsx',import.meta.url),'utf8');
const has=(...values)=>values.forEach(v=>assert(source.includes(v),v));
const ordered=(...values)=>{let at=-1;for(const v of values){at=source.indexOf(v,at+1);assert(at>=0,v);}};
const origin='http://127.0.0.1:43210',names=['merchants','merchant_attendance_events','merchant_attendance_period_closures','merchant_attendance_period_artifacts',
 'merchant_attendance_period_versions','merchant_attendance_period_entries','merchant_attendance_period_artifact_metadata','merchant_attendance_period_storage'];

test('inert export requires owned synthetic context and shares run/verify ABI',async()=>{
 assert.equal(verifyPeriodContinuationLiveBrowser,runPeriodContinuationLiveBrowser);
 await assert.rejects(verifyPeriodContinuationLiveBrowser({}),/period_live_owned_synthetic_context_required/);
 assert.doesNotMatch(source,/process\.argv|initdb|CREATE DATABASE|pg_dump|writeFile|mkdir|native\.connect\(/i);
});
test('network permits only exact loopback static GET and dedicated V2 GET/POST',()=>{
 for(const path of ['/','/qa.js','/qa.css','/favicon.ico',periodContinuationLiveEndpoint+'?mode=list'])assert(periodContinuationLiveAllowedRequest(origin+path,'GET',origin));
 assert(periodContinuationLiveAllowedRequest(origin+periodContinuationLiveEndpoint,'POST',origin));
 for(const [url,method]of [[origin+'/qa.js','POST'],[origin+'/qa.js?token=1','GET'],[origin+'/other','GET'],['https://www.faolla.com'+periodContinuationLiveEndpoint,'GET'],
  [origin+periodContinuationLiveEndpoint,'DELETE'],[origin+'/#x','GET'],[origin+'/\n','GET'],['http://user:pass@127.0.0.1:43210/','GET'],['http://localhost:43210/','GET']]){
  assert.equal(periodContinuationLiveAllowedRequest(url,method,origin),false,url);
 }
 assert.equal(periodContinuationLiveAllowedRequest(origin+'/','GET','http://127.0.0.1'),false);
});
test('allowance hash leaves all source rows intact and initially excludes only target quota',()=>{
 const text=periodContinuationLiveFactsSql(names,{siteId:'99990001'});assert.match(text,/merchant_attendance_period_storage r where r\.merchant_id<>'99990001'/);
 assert(!text.includes('not(r.merchant_id='));assert.match(text,/merchant_attendance_events r\s*\)/);
 for(const bad of [{siteId:'BAD'}, {siteId:'99990001',operations:[id(1),id(1)]}, {siteId:'99990001',periodId:'BAD'},
  {siteId:'99990001',operations:[id(1),id(2),id(3),id(4)]}])assert.throws(()=>periodContinuationLiveFactsSql(names,bad));
 assert.throws(()=>periodContinuationLiveFactsSql(['merchant_bad;drop'],{siteId:'99990001'}));
});
test('new-row allowance is exact merchant+period+browser operation list, never entire tables',()=>{
 const pid=id(400),ops=[id(501),id(502),id(503)],text=periodContinuationLiveFactsSql(names,{siteId:'99990001',periodId:pid,operations:ops});
 assert.match(text,new RegExp(`period_id='${pid}'`));
 assert(text.includes(`operation_id=any(array[${ops.map(v=>"'"+v+"'").join(',')}]::uuid[])`));
 assert(text.includes(`artifact_id='${ops[0]}'`));assert(!text.includes(`artifact_id='${ops[1]}'`));
 assert.match(text,/merchant_attendance_events r\s*\)/);
 has('select old_row.value','except select to_jsonb(current_row)','period_live_outside_exact_new_rows','period_live_quota_sum',
  'assert.equal(d.definitions(),definitions)','assert.equal(d.tableCatalog(),catalog)');
});
test('old215 period is recover-only; only new2010 day can receive three actual operations',()=>{
 assert.equal(periodContinuationLiveDate,'2010-01-05');assert.equal(periodContinuationLiveLimits.posts,3);
 has("if(q.periodId===oldPeriodId){assert.equal(q.mode,'recover')",'q.operationId,legacy.command.operationId',
  "['send','confirm','seal'][operations.length]","['owner','self','owner'][operations.length]",'period_live_new_id_used','period_live_operation_used',
  "assert.equal(parsed.command.periodId,target)","assert.equal(prepared.preview.period,null)");
 assert.doesNotMatch(source,/(?:insert into|update|delete from) public\./i);
});
test('both handler and service are actual; only authentication, entitlement and local gate injected',()=>{
 has("require('../../src/app/api/merchant-enterprise/attendance/period-closures-v2/route-handler.ts')",'handlePeriodClosuresV2(request',
  "authenticationMethods:['password']",'execute:input=>executePeriodClosuresV2(input,service)',"assert current_user='service_role'",
  'set constraints all immediate;set constraints all deferred','period_live_get_rejection_changed_facts',
  "['faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1']");
 assert(entry.includes('actorId={access==="owner"?seed.owner:seed.employee}'));
 assert(entry.includes('credentials:"omit",redirect:"error"'));
});
test('initial render makes noHTTP and legacy restore comes from actual original creation receipt',()=>{
 has("stage='initial';await page.goto(origin);await open();assert.equal(requests.length,0)",
  'e.operation_id=a.artifact_id','v.version=1',"parsePeriodClosureCommand(oldQuery,legacy.command)",
  'format:1,actorId:d.owner','format1LocalPendingSynthetic:true','format1ReceiptFromRealV1:true');
 assert.doesNotMatch(entry,/useEffect\(|initialize\(|\.load\(|fetch\([^,]+\)/);
 assert(entry.includes('import Launcher from "../../src/components/enterprise/MerchantAttendancePeriodClosureLauncher"'));
});
test('seal commits through actual handler before truncated successful response, no retry route',()=>{
 ordered('const response=await handle(',"assert.equal(response.status,200,output)","const truncate=method==='POST'",'sealSaved=body.data',
  'body:truncate?output.slice(0,8):output');
 has('bodyTruncatedAfterCommit:true,networkDisconnectSimulated:false','pending.command.operationId,operations[2]',
  'sealSaved.period.sealed,true',"stage='flagoff_recover'",'recovered.data.operation,sealSaved.operation','recovered.moduleEnabled,false');
});
test('fresh writes and old-format GET recovery cannot mutate or export old/fixed-recovery state',()=>{
 ordered("stage='self_confirm'",'self.data.artifact,sent.data.artifact',"stage='owner_seal_loss'", "stage='flagoff_recover'", "stage='legacy_format1'");
 has('legacyRecovered.data.period.periodId,oldPeriodId','legacyRecovered.data.artifactVersion,1',
  'legacyRecovered.data.artifact,JSON.parse(old207.artifactText)',"getByRole('button',{name:'下载本保存版本 CSV',exact:true}).isDisabled(),true",
  'assert.deepEqual([proof.heads,proof.artifacts,proof.versions,proof.entries],[1,1,1,3])');
});
test('resources remain memory-only and teardown attempts every owned resource plus original facts',()=>{
 has('bundle:true,write:false','server.listen(0,\'127.0.0.1\'',"serviceWorkers:'block'",'Date.now()<deadline',
  "name:'period live context'","name:'period live browser'","name:'period live inflight'","name:'period live listener'",
  "name:'period live esbuild'","name:'period live original facts'",'runAttendanceCleanupSteps(cleanup)','assert.equal(unchanged.sourceChanged,false)',
  "perCaseRollback:false,cleanupOwner:'parent207 owned namespace and public baseline'",'diskBundles:false,screenshots:false');
});
