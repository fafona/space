// Only preparation for156. No process/connection starts at import; caller owns
// the existing stopped-PG wrapper and exact guarded synthetic namespace.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {prepareBoundClocksNativeFixture,boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {sourcesNativeDependencies,sourcesNativePlan} from '../merchant-attendance-sources-native.mjs';
import {groupsQueryInput,groupsNativeSave} from '../merchant-attendance-groups-native.mjs';
import {lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';

export async function prepareShiftRuleViewNativeFixture(native,scope){
  const data=await prepareBoundClocksNativeFixture(native,scope),{exec,owned,site,owner,worker,auth,plainLocation}=data;
  // Dependency bodies only: neither the large128 fixture nor the153/155 checks.
  for(const name of sourcesNativeDependencies){
    const version=name.slice(0,12);assert(/^\d{12}$/.test(version));
    if(exec(`select count(*) from public.faolla_schema_migrations where version=${version};`)==='0')exec(boundClockMigrationBody(native.root,name));
  }
  for(const name of ['202610040128_merchant_attendance_sources.sql','202610040133_merchant_attendance_shift_rule_bindings.sql',
    '202610040134_merchant_attendance_bound_clocks.sql','202610040135_merchant_attendance_shift_rule_binding_reader.sql'])exec(boundClockMigrationBody(native.root,name));
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const fingerprint=()=>exec(`select ${sourcesNativePlan(owned,tables).fingerprint};`);
  const definitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const require=createRequire(import.meta.url),{executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const {parseSourcesResult}=require('../../src/lib/merchantAttendanceSources.ts');
  const calls=[],service={rpc:async(name,args)=>{assert(['faolla_attendance_self_v1','faolla_attendance_self_bound_v1'].includes(name));calls.push(name);
    return {data:JSON.parse(exec(`set local role service_role;select ${boundClockRpcExpression(name,args)};`)),error:null};}};
  const clock=(action,expectedSequence)=>executeAttendanceSelf({siteId:site,authUserId:auth,operationId:null,
    command:{expectedWorkerId:worker,operationId:randomUUID(),locationId:plainLocation,action,expectedSequence}},service);
  const flags=['FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED','FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS'],previous=new Map(flags.map(key=>[key,process.env[key]]));
  let legacy,verified,unverified;
  try{
    process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS=site;delete process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;
    legacy=await clock('clock_in',0);await clock('clock_out',1);process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='1';
    verified=await clock('clock_in',2);await clock('clock_out',3);
    data.foundation.call(groupsQueryInput({groupId:data.group}),groupsNativeSave(7801,{groupId:data.group,expectedRevision:1,active:false,name:'Current group <img src=x onerror=alert(1)>'}),true);
    unverified=await clock('clock_in',4);assert.equal(unverified.state.status,'working');await clock('clock_out',5);
  }finally{for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  const counts=()=>JSON.parse(exec("select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings),'sources',(select count(*) from public.merchant_attendance_shift_rule_sources));"));
  assert.deepEqual(counts(),{events:6,bindings:2,sources:1});assert.equal(calls.length,6);assert.equal(calls[0],'faolla_attendance_self_v1');assert.equal(calls[2],'faolla_attendance_self_bound_v1');
  const eventDates=JSON.parse(exec(`select jsonb_build_object('fromDate',min(occurred_at at time zone 'UTC')::date,'throughDate',max(occurred_at at time zone 'UTC')::date) from public.merchant_attendance_events;`));
  const query={siteId:site,workerId:worker,...eventDates};let sourceReads=0;
  const readRaw=(q=query,actor=owner)=>{
    const before=fingerprint(),defs=definitions();try{sourceReads++;return JSON.parse(exec(`set local role service_role;select public.faolla_attendance_sources_v1(${json(q)},${quote(actor)});`));}
    finally{assert.equal(fingerprint(),before,'view_source_read_changed_facts');assert.equal(definitions(),defs);}
  };
  const source={...parseSourcesResult(readRaw(),query,owner),moduleEnabled:true};
  assert.equal(source.attendance.base.rows.length,3);assert.equal(source.attendance.missing.length,0);
  const anchors={missing:legacy.receipt.id,verified:verified.receipt.id,unverified:unverified.receipt.id};
  assert.deepEqual(new Set(source.attendance.base.rows.map(row=>row.startEventId)),new Set(Object.values(anchors)));
  const emptyQuery={...query,workerId:data.geoWorker},emptySource={...parseSourcesResult(readRaw(emptyQuery),emptyQuery,owner),moduleEnabled:true};
  assert.equal(emptySource.attendance.base.rows.length,0);
  return {...data,source,emptySource,query,anchors,counts,fingerprint,definitions,readRaw,sourceReads:()=>sourceReads,
    syntheticOnly:true,actual128:true,actualSelfClockCalls:calls.length,sql:scope.sql};
}
