// Actual service/KDF -> service_role SQL in a caller-owned disposable namespace.
// No HTTP/browser/Auth-service claim. Only historical seed facts bypass writers.
import assert from 'node:assert/strict';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {executePinAdmin}=require('../src/lib/merchantAttendancePin.server.ts');
const {executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
const {executeTerminalAdmin,executeTerminalDevice}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal=value=>value===null?'null':typeof value==='boolean'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const valueSql=value=>value!==null&&typeof value==='object'?literal(JSON.stringify(value))+'::jsonb':literal(value);

export async function checkAttendancePinIdentityServiceNative({exec,pass,mode='legacy'}){
  assert(['legacy','guarded'].includes(mode),'pin_identity_service_invalid_mode');
  assert(typeof exec==='function'&&typeof pass==='function','pin_identity_service_caller_required');
  const isolation=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,'tableOid',c.oid::bigint,
    'owner',n.nspowner::regrole::text,'marker',obj_description(n.oid,'pg_namespace')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`));
  assert(isolation&&/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)&&isolation.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[0-9a-f-]{36}$/.test(isolation.marker)&&Number.isSafeInteger(isolation.oid)&&isolation.oid>0
    &&Number.isSafeInteger(isolation.tableOid)&&isolation.tableOid>0,'pin_identity_service_owned_schema_required');
  const site='99990005',owner=id(985099),role=id(985030),location=id(985301),terminal=id(985070),former=id(985104);
  assert.equal(exec(`reset role;select count(*) from public.merchants where id='${site}';`),'0','pin_identity_service_tenant_exists');
  const people=[0,1,2].map(n=>({worker:id(985201+n),employee:id(985101+n),auth:id(985001+n),no:`PIN-ID-${n+1}`,pin:String(randomInt(10000000,100000000))}));
  exec(`reset role;begin;set local lock_timeout='3s';set local statement_timeout='10s';
    do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${isolation.tableOid} and n.oid=${isolation.oid}
        and n.nspname=${literal(isolation.schema)} and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${literal(isolation.marker)})
      then raise exception 'pin_identity_service_schema_identity_changed';end if;end; $owned$;
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',true,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','Synthetic PIN identity location','UTC',true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic PIN identity role',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ${[...people,{employee:former,auth:id(985004),no:'former'}].map(p=>`('${p.employee}','${site}','${p.auth}','${p.no.toLowerCase()}@example.test','Synthetic ${p.no}','${role}','active')`).join(',')};
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values
      ${people.map(p=>`('${p.worker}','${site}','${p.employee}','${p.no}','Synthetic ${p.no}','${location}',true)`).join(',')};
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values ${people.map(p=>`('${site}','${p.worker}','2000-01-01')`).join(',')};
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at,actor_employee_id) values
      ${people.slice(0,2).map((p,n)=>`('${id(986001+n)}','${site}','${p.worker}','${location}','${id(987001+n)}',1,'clock_in','web','UTC',date_trunc('milliseconds',clock_timestamp())-interval '1 hour',clock_timestamp(),${literal(n===0?former:null)})`).join(',')};commit;`);
  const inspect=source=>JSON.parse(exec('reset role;'+source));
  const oldFacts=()=>inspect(`select jsonb_agg(to_jsonb(e) order by id) from public.merchant_attendance_events e where merchant_id='${site}' and id in ('${id(986001)}','${id(986002)}');`);
  const original=oldFacts(),pairSecret=randomBytes(32).toString('base64url'),deviceSecret=randomBytes(32).toString('base64url');
  const signatures={
    faolla_attendance_terminal_admin_v1:['p_site','p_auth','p_query','p_command','p_allow_create'],
    faolla_attendance_terminal_device_v1:['p_site','p_id','p_secret_hash','p_device_hash','p_allow_pair'],
    faolla_attendance_pin_admin_v1:['p_site','p_auth','p_no','p_operation','p_command','p_allow_set'],
    faolla_attendance_pin_begin_v1:['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_allow'],
    faolla_attendance_pin_clock_v1:['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new'],
  };
  let lastClock=null,rpcCalls=0;
  const service={rpc:async(name,args)=>{
    assert(Object.hasOwn(signatures,name),'pin_identity_service_rpc_not_allowed');
    const keys=signatures[name];assert(Object.keys(args).sort().join()===keys.slice().sort().join(),'pin_identity_service_rpc_fields');
    assert(args.p_site===site&&(!Object.hasOwn(args,'p_auth')||args.p_auth===owner),'pin_identity_service_rpc_scope');
    assert(!Object.hasOwn(args,'p_no')||people.some(p=>p.no===args.p_no),'pin_identity_service_rpc_worker');
    assert(!Object.hasOwn(args,'p_terminal')||args.p_terminal===terminal,'pin_identity_service_rpc_terminal');
    assert(!Object.hasOwn(args,'p_id')||args.p_id===terminal,'pin_identity_service_rpc_device');
    if(name==='faolla_attendance_pin_clock_v1')lastClock=structuredClone(args);
    rpcCalls++;
    try{
      const reply=JSON.parse(exec(`set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${keys.map(key=>valueSql(args[key])).join(',')}));`));
      assert(reply.role==='service_role','pin_identity_service_role_required');return {data:reply.data,error:null};
    }catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];
      if(!code)throw Error('pin_identity_service_rpc_failed');return {data:null,error:{message:code}};}
  }};
  const denied=async(action,code)=>{let actual='';try{await action();}catch(error){actual=error?.message??'';}assert(actual===code,'pin_identity_service_expected_'+code);};
  const clock=(p,command=null,operationId=null,pin=p.pin)=>executePinClock({siteId:site,terminalId:terminal,secret:deviceSecret,workerNo:p.no,pin,allowNew:true,command,operationId},service);
  const command=(p,action,sequence)=>({expectedWorkerId:p.worker,expectedEmployeeId:p.employee,operationId:randomUUID(),locationId:location,action,expectedSequence:sequence});
  const counts=()=>inspect(`select jsonb_build_object('workers',(select jsonb_agg(c.attempts order by w.worker_no) from public.merchant_attendance_pin_credentials c join public.merchant_attendance_workers w on w.merchant_id=c.merchant_id and w.id=c.worker_id where c.merchant_id='${site}'),
    'device',(select attempts from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${terminal}'),
    'leaseConsumed',(select lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${terminal}'));`);
  const checks=[],record=label=>{checks.push(label);pass(label);},priorPepper=process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;
  process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=randomBytes(32).toString('base64url');
  try{
    const created=await executeTerminalAdmin({siteId:site,authUserId:owner,cursor:null,terminalId:null,allowCreate:true,
      command:{action:'create',terminalId:terminal,locationId:location,label:'Synthetic PIN identity terminal',pairSecret}},service);
    assert(created.items.length===1&&created.items[0].state==='pending','pin_identity_service_terminal_created');
    const paired=await executeTerminalDevice({siteId:site,terminalId:terminal,secret:pairSecret,deviceSecret,allowPair:true},service);
    assert(paired.terminal.state==='active','pin_identity_service_terminal_paired');
    for(const p of people){const result=await executePinAdmin({siteId:site,authUserId:owner,workerNo:p.no,operationId:null,allowSet:true,
      command:{action:'set',operationId:randomUUID(),expectedRevision:0,workerId:p.worker,employeeId:p.employee,pin:p.pin,salt:randomBytes(16).toString('hex')}},service);
      assert(result.ready&&result.bindingCurrent&&result.enabled&&result.revision===1,'pin_identity_service_real_pin_set');}
    record('PIN service control: actual terminal create/pair and owner PIN setup use service_role RPCs and the real scrypt service; ordinary web channel remains disabled');
    for(const [n,p] of people.slice(0,2).entries()){
      const label=n===0?'OTHER':'null';
      if(mode==='guarded')await denied(()=>clock(p),'attendance_access_denied');
      else{const r=await clock(p);assert(r.state.status==='working'&&r.state.sequence===1&&r.state.lastEvent.id===id(986001+n),'pin_identity_service_legacy_last_exposed');}
      assert(lastClock?.p_verified===true,'pin_identity_service_real_kdf_verified');
      const beforeReuse=counts(),used=structuredClone(lastClock);
      assert(beforeReuse.leaseConsumed,'pin_identity_service_lease_not_consumed');
      const reused=await service.rpc('faolla_attendance_pin_clock_v1',used);
      assert(!reused.error&&reused.data?.error==='attendance_pin_denied','pin_identity_service_used_lease_rejected');
      assert.deepEqual(counts(),beforeReuse,'pin_identity_service_reused_lease_changed_attempts');
      const close=command(p,'clock_out',1);
      if(mode==='guarded')await denied(()=>clock(p,close),'attendance_access_denied');
      else{const r=await clock(p,close);assert(!r.replayed&&r.receipt?.action==='clock_out'&&r.receipt.sequence===2,'pin_identity_service_legacy_append');}
      const wrongPin=String((Number(p.pin)+1)%100000000).padStart(8,'0');
      await denied(()=>clock(p,null,null,wrongPin),'attendance_pin_denied');
      const c=counts();assert(c.workers[n]===3&&c.leaseConsumed,'pin_identity_service_denials_preserve_attempts_and_consume_lease');
      record(`${mode==='legacy'?'CONCERN':'GUARDED'}: real correct PIN ${mode==='legacy'?'reads and explicitly closes':'cannot read or close'} ${label} latest identity; wrong PIN and consumed-lease reuse are denied without resetting attempts`);
    }
    const p=people[2],empty=await clock(p);assert(empty.state.sequence===0&&empty.state.lastEvent===null,'pin_identity_service_empty_state');
    const start=command(p,'clock_in',0),saved=await clock(p,start);
    assert(saved.receipt?.sequence===1&&!saved.replayed,'pin_identity_service_own_append');
    const recovered=await clock(p,null,start.operationId),replayed=await clock(p,start);
    assert(recovered.receipt?.id===saved.receipt.id&&replayed.receipt?.id===saved.receipt.id&&replayed.replayed,'pin_identity_service_own_recovery');
    const c=counts();assert.deepEqual(c.workers,[3,3,4]);assert.equal(c.device,10);assert(c.leaseConsumed);
    const facts=inspect(`select jsonb_agg(to_jsonb(e) order by worker_id,sequence) from public.merchant_attendance_events e where merchant_id='${site}';`);
    assert.equal(facts.length,mode==='legacy'?5:3);assert.deepEqual(oldFacts(),original,'pin_identity_service_original_facts_changed');
    const fresh=facts.filter(e=>![id(986001),id(986002)].includes(e.id));
    assert(fresh.every(e=>e.source==='kiosk'&&people.some(p=>p.worker===e.worker_id&&p.employee===e.actor_employee_id)),'pin_identity_service_new_event_attribution');
    const receipts=inspect(`select jsonb_agg(to_jsonb(r) order by event_id) from public.merchant_attendance_pin_clock_receipts r where merchant_id='${site}';`);
    assert(receipts.length===fresh.length&&receipts.every(r=>fresh.some(e=>e.id===r.event_id&&e.worker_id===r.worker_id&&e.actor_employee_id===r.employee_id&&e.operation_id===r.operation_id)),'pin_identity_service_receipt_binding');
    record('PIN service control: empty current employee creates exactly one kiosk fact; original-operation read/replay never duplicates, all historical seed facts remain immutable, and real verification counters total ten');
    return {mode,syntheticOnly:true,realServiceKdf:true,rpcCalls,verificationAttempts:10,events:facts.length,newEvents:fresh.length,receipts:receipts.length,checks};
  }finally{lastClock=null;for(const p of people)p.pin='';if(priorPepper===undefined)delete process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;else process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=priorPepper;}
}
