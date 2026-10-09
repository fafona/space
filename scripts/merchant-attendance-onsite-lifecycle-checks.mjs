// Local SQL lifecycle evidence only. Claims below are synthetic SQL inputs, not
// signed tokens or evidence of password authentication, HTTP, UI or phone use.
// The caller owns and removes the entire identity-checked disposable namespace.
import assert from 'node:assert/strict';
import {
  lifecycleId as id, lifecycleJson as json, assertLifecycleSandbox, lifecycleRace,
} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990005',owner=id(1022099),location=id(1022301),terminal=id(1022070);
const permissions=['enterprise.view','attendance.self.view','attendance.self.clock'];
const pairHash='2'.repeat(64),deviceHash='3'.repeat(64);

// Exposed for pure construction tests; this does not execute or simulate SQL.
export function onsiteLifecyclePlan(){
  const subjects=[1,2,3].map(n=>({auth:id(1022000+n),employee:id(1022100+n),worker:id(1022200+n),role:id(1022030+n),
    command:{operationId:id(1022500+n),locationId:location,action:'clock_in',expectedSequence:0,
      expectedWorkerId:id(1022200+n),expectedEmployeeId:id(1022100+n)}}));
  const seed=`insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',true,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','Synthetic lifecycle QR','UTC',true);
    ${subjects.map((p,n)=>`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${p.role}','${site}','Synthetic onsite lifecycle ${n+1}',array['enterprise.view','attendance.self.view','attendance.self.clock']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at)
        values('${p.employee}','${site}','${p.auth}','onsite-lifecycle-${n+1}@example.test','Synthetic employee ${n+1}','${p.role}','active',clock_timestamp());
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
        values('${p.worker}','${site}','${p.employee}','QR-LIFECYCLE-${n+1}','Synthetic worker ${n+1}','${location}',true);
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${p.worker}','2000-01-01');`).join('\n')}`;
  return {site,owner,location,terminal,subjects,seed};
}

const clockSql=(p,claims=null,command=null,operationId=null)=>`set local role service_role;
  select public.faolla_attendance_onsite_clock_v1('${site}','${p.auth}',${json(claims)},${json(command)},${operationId===null?'null':`'${operationId}'`},true);`;
const employeeSql=(p,status)=>`update public.merchant_enterprise_employees set status='${status}',version=version+1,updated_at=clock_timestamp()
  where merchant_id='${site}' and id='${p.employee}' and auth_user_id='${p.auth}';`;
const roleSql=(p,enabled)=>`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'${enabled?",'attendance.self.clock'":''}],version=version+1,updated_at=clock_timestamp()
  where merchant_id='${site}' and id='${p.role}';`;
const factsSql=`reset role;select jsonb_build_object(
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by worker_id,sequence) from public.merchant_attendance_events e where merchant_id='${site}'),'[]'::jsonb),
  'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by worker_id,operation_id) from public.merchant_attendance_onsite_receipts r where merchant_id='${site}'),'[]'::jsonb));`;
const stableSql=`reset role;select jsonb_build_object(
  'merchant',(select to_jsonb(m) from public.merchants m where id='${site}'),
  'settings',(select to_jsonb(s) from public.merchant_attendance_settings s where merchant_id='${site}'),
  'locations',(select jsonb_agg(to_jsonb(l) order by id) from public.merchant_attendance_locations l where merchant_id='${site}'),
  'workers',(select jsonb_agg(to_jsonb(w) order by id) from public.merchant_attendance_workers w where merchant_id='${site}'),
  'periods',(select jsonb_agg(to_jsonb(p) order by id) from public.merchant_attendance_employment_periods p where merchant_id='${site}'),
  'terminals',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_terminals t where merchant_id='${site}'),
  'terminalAudit',(select jsonb_agg(to_jsonb(a) order by terminal_id,action) from public.merchant_attendance_terminal_audit a where merchant_id='${site}'),
  'employeeIdentity',(select jsonb_agg(to_jsonb(e)-'status'-'version'-'updated_at' order by id) from public.merchant_enterprise_employees e where merchant_id='${site}'),
  'roleIdentity',(select jsonb_agg(to_jsonb(r)-'permissions'-'version'-'updated_at' order by id) from public.merchant_enterprise_roles r where merchant_id='${site}'));
`;

function assertReceipt(result,p,replayed){
  assert.equal(result.workerId,p.worker);assert.equal(result.employeeId,p.employee);assert.equal(result.locationId,location);
  assert.equal(result.replayed,replayed);assert.equal(result.state.sequence,1);assert.equal(result.state.status,'working');
  assert.deepEqual(result.state.lastEvent,result.receipt);
  assert.equal(result.receipt.siteId,site);assert.equal(result.receipt.workerId,p.worker);assert.equal(result.receipt.locationId,location);
  assert.equal(result.receipt.operationId,p.command.operationId);assert.equal(result.receipt.action,'clock_in');assert.equal(result.receipt.sequence,1);
  assert.match(result.receipt.id,/^[a-f0-9-]{36}$/);
}

export async function checkAttendanceOnsiteLifecycle(native,{sql}){
  assert.equal(typeof native.query,'function');assert.equal(typeof native.connect,'function');assert.equal(typeof native.pass,'function');
  assert.equal(typeof sql,'function');
  const exec=statement=>native.query(sql(statement)),owned=assertLifecycleSandbox(exec),plan=onsiteLifecyclePlan();
  assert.equal(exec(`reset role;select count(*) from public.merchants where id='${site}';`),'0','onsite_lifecycle_tenant_exists');
  // Check the exact namespace and table OIDs again in the same transaction as
  // seeding. Lifecycle writes are synthetic direct updates, not owner-UI proof.
  exec(`begin;reset role;do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname='${owned.schema}' and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')='${owned.marker}') then raise exception 'onsite_lifecycle_owned_schema_required'; end if;
    if exists(select 1 from public.merchants where id='${site}') then raise exception 'onsite_lifecycle_tenant_exists'; end if;
  end; $owned$;${plan.seed}commit;`);
  const run=statement=>exec(`begin;${statement}commit;`);
  run(`set local role service_role;select public.faolla_attendance_terminal_admin_v1('${site}','${owner}',${json({terminalId:null,cursor:null})},
    ${json({action:'create',terminalId:terminal,locationId:location,label:'Synthetic lifecycle terminal',pairHash})},true);`);
  run(`set local role service_role;select public.faolla_attendance_terminal_device_v1('${site}','${terminal}','${pairHash}','${deviceHash}',true);`);
  const stable=exec(stableSql),facts=()=>JSON.parse(exec(factsSql));
  assert.deepEqual(facts(),{events:[],receipts:[]});
  let nonceIndex=0;
  const issue=()=>{
    const issued=JSON.parse(run(`set local role service_role;select public.faolla_attendance_onsite_issue_v1('${site}','${terminal}','${deviceHash}');`));
    assert.equal(issued.siteId,site);assert.equal(issued.terminalId,terminal);assert.equal(issued.locationId,location);
    assert.equal(issued.expiresAtMs-issued.issuedAtMs,45000);assert(issued.pairedAtMs<=issued.issuedAtMs);
    return {v:1,purpose:'faolla.attendance.onsite',...issued,nonce:id(1022700+(++nonceIndex))};
  };
  const fresh=claims=>assert(Number(exec('reset role;select floor(extract(epoch from clock_timestamp())*1000)::bigint;'))<claims.expiresAtMs,
    'onsite_lifecycle_claims_expired_during_test');
  const clock=(p,claims=null,command=null,operationId=null)=>JSON.parse(run(clockSql(p,claims,command,operationId)));
  const read=p=>clock(p,null,null,p.command.operationId);
  const unchanged=before=>assert.deepEqual(facts(),before,'onsite_lifecycle_denial_or_replay_changed_facts');
  const deny=statement=>{
    const before=facts();assert.throws(()=>run(statement),/\battendance_access_denied\b/);unchanged(before);
  };
  const grow=(before,p,claims,result)=>{
    const after=facts();assert.equal(after.events.length,before.events.length+1);assert.equal(after.receipts.length,before.receipts.length+1);
    for(const old of before.events)assert.deepEqual(after.events.find(row=>row.id===old.id),old,'old raw event changed');
    for(const old of before.receipts)assert.deepEqual(after.receipts.find(row=>row.event_id===old.event_id),old,'old raw receipt changed');
    const event=after.events.find(row=>row.id===result.receipt.id),receipt=after.receipts.find(row=>row.event_id===result.receipt.id);
    assert(event&&receipt);assert.equal(event.merchant_id,site);assert.equal(event.worker_id,p.worker);assert.equal(event.actor_employee_id,p.employee);
    assert.equal(event.operation_id,p.command.operationId);assert.equal(event.sequence,1);assert.equal(event.action,'clock_in');assert.equal(event.source,'web');
    assert.equal(event.location_id,location);assert.equal(receipt.merchant_id,site);assert.equal(receipt.worker_id,p.worker);
    assert.equal(receipt.employee_id,p.employee);assert.equal(receipt.terminal_id,terminal);assert.equal(receipt.operation_id,p.command.operationId);
    assert.equal(receipt.nonce,claims.nonce);assert.deepEqual(receipt.command,p.command);assert.deepEqual(receipt.claims,claims);
    return after;
  };
  const recover=(p,claims,original)=>{
    const before=facts(),recovered=read(p);assertReceipt(recovered,p,false);assert.deepEqual(recovered.receipt,original.receipt);
    const replay=clock(p,claims,p.command);assertReceipt(replay,p,true);assert.deepEqual(replay.receipt,original.receipt);unchanged(before);
  };
  const checks=[],pass=message=>{checks.push(message);native.pass(message);},raceContext={connect:native.connect,query:native.query,sql};
  const [member,role,punch]=plan.subjects;

  const memberClaims=issue(),empty=facts();
  const memberRace=await lifecycleRace(raceContext,employeeSql(member,'disabled'),clockSql(member,memberClaims,member.command));
  assert.equal(memberRace.witnessed,true);assert.equal(memberRace.right.output,null);assert.match(String(memberRace.right.error),/\battendance_access_denied\b/);
  fresh(memberClaims);unchanged(empty);
  pass('onsite SQL: employee-disable holder blocks the exact punch waiter; committed disable denies the valid original request with zero event/receipt growth');

  run(employeeSql(member,'active'));
  const memberRetryClaims=issue(),memberResult=clock(member,memberRetryClaims,member.command);assertReceipt(memberResult,member,false);
  grow(empty,member,memberRetryClaims,memberResult);recover(member,memberRetryClaims,memberResult);
  pass('onsite SQL: restoring the same employee permits explicit original-UUID retry with fresh claims exactly once; read-only recovery and exact replay add nothing');

  const roleClaims=issue(),beforeRole=facts();
  const roleRace=await lifecycleRace(raceContext,roleSql(role,false),clockSql(role,roleClaims,role.command));
  assert.equal(roleRace.witnessed,true);assert.equal(roleRace.right.output,null);assert.match(String(roleRace.right.error),/\battendance_access_denied\b/);
  fresh(roleClaims);unchanged(beforeRole);
  const view=read(role);assert.equal(view.workerId,role.worker);assert.equal(view.employeeId,role.employee);
  assert.deepEqual(view.state,{sequence:0,status:'off',lastEvent:null});assert.equal(view.receipt,null);assert.equal(view.replayed,false);unchanged(beforeRole);
  run(roleSql(role,true));
  const roleRetryClaims=issue(),roleResult=clock(role,roleRetryClaims,role.command);assertReceipt(roleResult,role,false);
  grow(beforeRole,role,roleRetryClaims,roleResult);recover(role,roleRetryClaims,roleResult);
  pass('onsite SQL: removing self.clock while holding the role row denies the waiting write but preserves self.view; restoring it admits the same operation once');

  const punchClaims=issue(),beforePunch=facts();
  const punchRace=await lifecycleRace(raceContext,clockSql(punch,punchClaims,punch.command),employeeSql(punch,'disabled'));
  assert.equal(punchRace.witnessed,true);assert.equal(punchRace.right.error,null);
  const punchResult=JSON.parse(punchRace.left);assertReceipt(punchResult,punch,false);grow(beforePunch,punch,punchClaims,punchResult);
  assert.equal(exec(`reset role;select status from public.merchant_enterprise_employees where merchant_id='${site}' and id='${punch.employee}';`),'disabled');
  deny(clockSql(punch,null,null,punch.command.operationId));deny(clockSql(punch,punchClaims,punch.command));
  const finish={...punch.command,operationId:id(1022603),action:'clock_out',expectedSequence:1};
  deny(clockSql(punch,issue(),finish));
  pass('onsite SQL: punch-first member lock serializes subsequent disable; the one committed fact remains immutable, while disabled read/replay/new finish all deny');

  run(employeeSql(punch,'active'));recover(punch,issue(),punchResult);
  assert.equal(exec(stableSql),stable,'onsite_lifecycle_unrelated_fixture_changed');
  const lifecycle=JSON.parse(exec(`reset role;select jsonb_build_object(
    'employees',(select jsonb_agg(jsonb_build_object('id',id,'status',status,'version',version) order by id) from public.merchant_enterprise_employees where merchant_id='${site}'),
    'roles',(select jsonb_agg(jsonb_build_object('id',id,'permissions',permissions,'version',version) order by id) from public.merchant_enterprise_roles where merchant_id='${site}'));`));
  assert.deepEqual(lifecycle.employees,plan.subjects.map((p,n)=>({id:p.employee,status:'active',version:n===1?1:3})));
  assert.deepEqual(lifecycle.roles,plan.subjects.map((p,n)=>({id:p.role,permissions,version:n===1?3:1})));
  const finalFacts=facts();assert.equal(finalFacts.events.length,3);assert.equal(finalFacts.receipts.length,3);
  pass('onsite SQL: same-identity restoration recovers the punch-first receipt with no second write; all three exact operations remain and unrelated synthetic facts are unchanged');
  return {siteId:site,syntheticOnly:true,signedTokenVerified:false,httpVerified:false,checks,
    witnessedRaces:3,eventCount:finalFacts.events.length,receiptCount:finalFacts.receipts.length,
    operationIds:plan.subjects.map(p=>p.command.operationId)};
}
