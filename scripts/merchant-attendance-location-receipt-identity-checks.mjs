// Legacy/guarded comparison, not proof of attendance. History below is explicit
// synthetic SQL input; only read/preflight RPCs run through the actual service.
// The actual client uses an in-memory transport, not HTTP, GPS or a browser.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal=value=>value===null?'null':typeof value==='boolean'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const siteId='99990008',owner=id(1000099),role=id(1000030),locationId=id(1000301),former=id(1000098);
const cases=[['older_other','hidden','other'],['older_null','hidden','null'],['latest_other','denied','other'],
  ['latest_null','denied','null'],['own_older_receipt','owned',null],['missing_operation','missing',null]].map(([name,kind,actor],index)=>{
  const base=1001000+index*100;
  return {name,kind,actor,employeeId:id(base+1),authUserId:id(base+2),workerId:id(base+3),
    events:[id(base+11),id(base+12),id(base+13)],operations:[id(base+21),id(base+22),id(base+23)],missingOperation:id(base+29)};
});
const rpcName='faolla_attendance_location_clock_v2';
const rpcKeys=['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock'];
const operation=item=>item.kind==='missing'?item.missingOperation:item.operations[1];
const sqlIntent=(item,op=operation(item))=>({operationId:op,locationId,action:'clock_out',expectedSequence:1,
  settingsVersion:1,workerVersion:1,locationVersion:1,noticeRevision:null,safeFinish:true});

// Exported for pure boundary tests. Produces SQL only; it cannot start a service
// or execute against an uninspected database. The caller below owns execution.
export function locationReceiptIdentityReadSql(name,args){
  assert.equal(name,rpcName,'location_receipt_rpc_not_allowed');
  assert(args&&typeof args==='object'&&!Array.isArray(args),'location_receipt_rpc_fields');
  assert.deepEqual(Object.keys(args).sort(),rpcKeys.slice().sort(),'location_receipt_rpc_fields');
  assert.equal(args.p_site_id,siteId,'location_receipt_rpc_site');
  const item=cases.find(row=>row.authUserId===args.p_auth_user_id&&row.workerId===args.p_expected_worker_id);
  assert(item,'location_receipt_rpc_identity');
  assert.equal(args.p_command,null,'location_receipt_no_sql_write');
  assert.equal(args.p_assertion,null,'location_receipt_no_position_assertion');
  assert.equal(args.p_allow_new_sessions,false,'location_receipt_paused_only');
  assert.equal(typeof args.p_require_clock,'boolean','location_receipt_clock_flag');
  assert.equal(args.p_operation_id,operation(item),'location_receipt_original_operation_only');
  return `set role service_role;select jsonb_build_object('role',current_user,'data',public.${rpcName}(${rpcKeys.map(key=>literal(args[key])).join(',')}));`;
}

export async function checkAttendanceLocationReceiptIdentity({exec,pass,mode='legacy'}){
  assert(['legacy','guarded'].includes(mode),'location_receipt_invalid_mode');
  assert(typeof exec==='function'&&typeof pass==='function','location_receipt_caller_required');
  const isolation=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,'tableOid',c.oid::bigint,
    'owner',n.nspowner::regrole::text,'marker',obj_description(n.oid,'pg_namespace')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`));
  assert(isolation&&/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)&&isolation.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[0-9a-f-]{36}$/.test(isolation.marker)&&Number.isSafeInteger(isolation.oid)&&isolation.oid>0
    &&Number.isSafeInteger(isolation.tableOid)&&isolation.tableOid>0,'location_receipt_owned_schema_required');
  assert.equal(exec(`reset role;select count(*) from public.merchants where id='${siteId}';`),'0','location_receipt_tenant_exists');
  exec(`reset role;begin;set local lock_timeout='3s';set local statement_timeout='10s';
    do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${isolation.tableOid} and n.oid=${isolation.oid}
        and n.nspname=${literal(isolation.schema)} and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${literal(isolation.marker)})
      then raise exception 'location_receipt_schema_identity_changed';end if;end; $owned$;
    insert into public.merchants(id,user_id) values('${siteId}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled,location_clock_enabled)
      values('${siteId}','UTC',false,false,false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${role}','${siteId}','Synthetic receipt identity',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
      values('${locationId}','${siteId}','Synthetic receipt location','UTC',true);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ${[...cases,{employeeId:former,authUserId:id(1000097),name:'former'}].map(item=>`('${item.employeeId}','${siteId}','${item.authUserId}','location-receipt-${item.name}@example.test','Synthetic receipt member','${role}','active')`).join(',')};
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ${cases.map((item,n)=>`('${item.workerId}','${siteId}','${item.employeeId}','LOCATION-RECEIPT-${n+1}','Synthetic bound receipt worker',true,'${locationId}')`).join(',')};
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values
      ${cases.map(item=>`('${siteId}','${item.workerId}','2000-01-01')`).join(',')};
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at,actor_employee_id) values
      ${cases.flatMap(item=>item.events.map((event,n)=>{
        const unknown=(item.kind==='hidden'&&n===1)||(item.kind==='denied'&&n===2);
        return `('${event}','${siteId}','${item.workerId}','${locationId}','${item.operations[n]}',${n+1},'${n===1?'clock_out':'clock_in'}','web','UTC',date_trunc('milliseconds',clock_timestamp())-interval '1 hour'+${n}*interval '1 second',clock_timestamp(),${literal(unknown?(item.actor==='other'?former:null):item.employeeId)})`;
      })).join(',')};
    insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,algorithm_version,reason,needs_review) values
      ${cases.map(item=>`('${item.events[1]}',1,1,1,1,'not_provided',true)`).join(',')};
    insert into public.merchant_attendance_location_clock_notices(event_id,merchant_id,location_id,employee_id,worker_id,notice_revision,safe_finish,command) values
      ${cases.filter(item=>item.kind!=='hidden').map(item=>`('${item.events[1]}','${siteId}','${locationId}','${item.employeeId}','${item.workerId}',null,true,${json(sqlIntent(item,item.operations[1]))})`).join(',')};commit;`);
  const tables=['merchants','merchant_attendance_settings','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_workers',
    'merchant_attendance_locations','merchant_attendance_employment_periods','merchant_attendance_events','merchant_attendance_location_results',
    'merchant_attendance_location_clock_notices','merchant_attendance_location_notices','merchant_attendance_location_notice_acknowledgements',
    'merchant_attendance_location_policy_drafts'];
  const factsSql=`reset role;select jsonb_build_object(${tables.map(table=>`${literal(table)},(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]')) from public.${table} r)`).join(',')});`;
  const baseline=exec(factsSql);
  const {executeAttendanceLocationClock}=require('../src/lib/merchantAttendanceLocationClock.server.ts');
  const {AttendanceLocationClockClient,attendanceLocationClockPendingKey}=require('../src/lib/merchantAttendanceLocationClockClient.ts');
  const calls=[],observations=[],checks=[];
  const service={rpc:async(name,args)=>{
    const statement=locationReceiptIdentityReadSql(name,args);calls.push(structuredClone(args));
    try{
      const response=JSON.parse(exec(statement));assert.equal(response.role,'service_role','location_receipt_service_role_required');
      return {data:response.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];
      if(!['attendance_access_denied','attendance_operation_conflict'].includes(code))throw Error('location_receipt_rpc_failed');
      return {data:null,error:{message:code}};
    }
  }};
  try{
    for(const item of cases){
      const denied=item.kind==='denied'||mode==='guarded'&&item.kind==='hidden';
      const input={siteId,authUserId:item.authUserId,expectedWorkerId:item.workerId,operationId:operation(item),command:null,moduleEnabled:false};
      let result=null,error=null;
      try{result=await executeAttendanceLocationClock(input,service);}catch(caught){error=caught.message;}
      if(denied){
        assert.equal(error,'attendance_access_denied','unknown requested identity is a hard denial');
        assert.equal(result,null,'identity denial exposes no result');
      }
      else{
        assert.equal(error,null);assert.equal(result.state.sequence,3);assert.equal(result.state.lastEvent.id,item.events[2]);
        assert.equal(result.channelEnabled,false);assert.equal(result.employeeId,item.employeeId);
        if(item.kind==='owned'){
          assert.equal(result.receipt.id,item.events[1]);assert.equal(result.locationResult.eventId,item.events[1]);
          assert.deepEqual(result.receiptGate,{noticeRevision:null,safeFinish:true,command:sqlIntent(item)});
        }else{
          assert.equal(result.receipt,null);assert.equal(result.locationResult,null);assert.equal(result.receiptGate,null);
        }
      }
      let preflightError=null;
      if(item.kind==='hidden'){
        const intent={expectedWorkerId:item.workerId,...sqlIntent(item),position:null,positionFailure:'not_provided'};
        await assert.rejects(executeAttendanceLocationClock({...input,operationId:null,command:intent},service),caught=>{
          preflightError=caught.message;return preflightError===(mode==='guarded'?'attendance_access_denied':'attendance_operation_conflict');
        });
      }
      const key=attendanceLocationClockPendingKey(siteId,item.employeeId),pending={version:1,siteId,employeeId:item.employeeId,
        intent:{expectedWorkerId:item.workerId,...sqlIntent(item)}};
      const initial=JSON.stringify(pending),memory=new Map([[key,initial]]),clientRequests=[];
      let gpsCalls=0,transientRead=false;
      const client=new AttendanceLocationClockClient({siteId,employeeId:item.employeeId,workerId:item.workerId,canClock:true,
        storage:()=>({getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}),
        environment:{isSecureContext:()=>true,isVisible:()=>true,geolocation:()=>{gpsCalls++;throw Error('location_receipt_no_gps');}},
        apiFetch:async(url,init)=>{
          const parsed=new URL(url,'https://synthetic.invalid'),method=init?.method??'GET';
          clientRequests.push({method,operationId:parsed.searchParams.get('operationId'),syntheticUnavailable:transientRead});
          assert.equal(method,'GET','location_receipt_client_read_only');assert.equal(init?.body,undefined);
          assert.equal(parsed.pathname,'/api/merchant-enterprise/attendance/location-clock');
          assert.deepEqual([...parsed.searchParams.keys()].sort(),['expectedWorkerId','operationId','siteId']);
          assert.equal(parsed.searchParams.get('siteId'),siteId);assert.equal(parsed.searchParams.get('expectedWorkerId'),item.workerId);
          assert.equal(parsed.searchParams.get('operationId'),operation(item));
          // Explicit transport failure only, never a fabricated business result.
          if(transientRead)return Response.json({ok:false,error:'attendance_unavailable'},{status:503});
          try{return Response.json({ok:true,moduleEnabled:false,...await executeAttendanceLocationClock(input,service)});}
          catch(caught){assert.equal(caught.message,'attendance_access_denied');return Response.json({ok:false,error:caught.message},{status:403});}
        }});
      let clientState,transientRecovery=null;
      try{
        await client.initialize();clientState=structuredClone(client.getSnapshot());assert.equal(gpsCalls,0);assert.equal(clientRequests.length,1);
        if(denied){
          assert.equal(memory.get(key),initial);assert.deepEqual(clientState.pending,pending);assert.equal(clientState.result,null);
          assert.equal(clientState.confirmed,null);assert.equal(clientState.phase,'blocked');
          assert.match(clientState.message,/联系负责人.*核验/);
        }else{
          assert.equal(memory.size,0);assert.equal(clientState.pending,null);assert.equal(clientState.phase,'ready');
          if(item.kind==='owned')assert.equal(clientState.confirmed.receipt.id,item.events[1]);
          else{assert.equal(clientState.confirmed,null);assert.match(clientState.message,/未找到此操作的收据/);}
        }
        if(item.name==='latest_other'){
          const beforeCalls=calls.length;
          transientRead=true;await client.refresh();transientRead=false;
          const failed=structuredClone(client.getSnapshot());
          assert.equal(failed.phase,'unconfirmed');assert.equal(failed.result,null);assert.equal(failed.confirmed,null);
          assert.deepEqual(failed.pending,pending);assert.equal(memory.get(key),initial);
          assert.equal(calls.length,beforeCalls,'synthetic unavailable response invokes no SQL');
          await client.retry('not_provided');
          clientState=structuredClone(client.getSnapshot());
          assert.equal(clientState.phase,'blocked');assert.equal(clientState.result,null);assert.equal(clientState.confirmed,null);
          assert.deepEqual(clientState.pending,pending);assert.equal(memory.get(key),initial);
          assert.equal(calls.length,beforeCalls+1,'retry performs exactly one authoritative read');
          assert.equal(clientRequests.length,3);assert.equal(gpsCalls,0);
          assert(clientRequests.every(request=>request.method==='GET'&&request.operationId===operation(item)),'retry never changes operation or sends POST');
          transientRecovery={unavailableStatus:503,phaseAfterUnavailable:failed.phase,phaseAfterRetry:clientState.phase,
            pendingPreserved:true,authoritativeRetryReads:1,postRequests:0,gpsRequests:gpsCalls};
        }
      }finally{client.pause();}
      assert.equal(exec(factsSql),baseline,'location_receipt_original_facts_changed');
      const concern=item.kind==='hidden'&&mode==='legacy';
      const label=concern?`CONCERN: ${item.name} is hidden as null despite existing location evidence; read-only client recovery drops the original pending after sequence advances, while write preparation conflicts`
        :item.kind==='hidden'?`GUARDED: ${item.name} denies both recovery and write preparation; client hides results and retains the original pending; no application writes or GPS`
        :`BASELINE: ${item.name} ${item.kind==='denied'?'rejects the unknown latest identity and retains pending':item.kind==='owned'?'recovers the attributable receipt and confirms the exact pending':'returns genuine absence and clears the impossible old intent'}; no application writes or GPS`;
      observations.push({case:item.name,concern,input,result,error,preflightError,clientState,clientRequests,transientRecovery});checks.push(label);pass(label);
    }
    const clientRequests=observations.flatMap(item=>item.clientRequests);
    assert.equal(calls.length,15);assert.equal(calls.filter(call=>call.p_require_clock).length,2);
    assert.equal(clientRequests.length,8);assert(clientRequests.every(request=>request.method==='GET'));
    return {mode,siteId,syntheticOnly:true,syntheticEvents:18,locationResults:6,noticeLinks:4,newAttendanceEvents:0,
      rpcCalls:calls.length,writePreflights:2,clientGetRequests:clientRequests.length,clientPostRequests:0,gpsRequests:0,observations,checks};
  }finally{assert.equal(exec(factsSql),baseline,'location_receipt_original_facts_changed');}
}
