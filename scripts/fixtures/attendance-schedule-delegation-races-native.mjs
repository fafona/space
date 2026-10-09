//198 inert, owned-sandbox acceptance callback. Root alone owns connections,
//timeouts and environment lifecycle. Only the reserved synthetic seeds18/19
//are created; no original function, trigger or constraint is disabled.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const rpc='faolla_attendance_schedule_delegation_v1';
const expression=(query,actor,command=null,allow=true)=>`public.${rpc}(${json(query)},${quote(actor)},${json(command)},${allow})`;
const scheduleTables=['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations',
  'merchant_attendance_schedule_publication_evidence','merchant_attendance_schedule_delegation_operations'];

function protectedSql(names,sites){
  assert(names.length>0&&new Set(names).size===names.length);
  return `select md5(jsonb_object_agg(name,rows order by name)::text) from (${names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const key=name==='merchants'?'id':'merchant_id';
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(body order by body::text),'[]') from
      (select to_jsonb(r) body from public.${name} r where (to_jsonb(r)->>${quote(key)}) is null
        or (to_jsonb(r)->>${quote(key)}) not in(${sites.map(quote).join(',')})) t) rows`;
  }).join(' union all ')}) protected_rows;`;
}

export async function verifyScheduleDelegationAdditionalRaces(p){
  const {d,native,scope,seed,grant,read,write,q,sq,publish,cancel,revoke,employee,settings,next,all,oldRead}=p;
  assert.equal(d?.syntheticOnly,true);
  for(const value of [native?.query,native?.connect,d?.exec,d?.inventory,d?.definitions,d?.tableCatalog,
    seed,grant,read,write,q,sq,publish,cancel,revoke,employee,settings,next,all,oldRead])assert.equal(typeof value,'function');
  assert.equal(typeof d.guard,'string');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  const sites=['99990218','99990219'],protection=protectedSql(d.inventory(),sites),beforeProtected=d.exec(protection),defs=d.definitions(),catalog=d.tableCatalog();
  const db={connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql};
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
  const scheduleFacts=site=>d.exec(`select md5(jsonb_object_agg(name,rows order by name)::text) from (${scheduleTables.map(name=>
    `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.${name} x where x.merchant_id=${quote(site)}) rows`).join(' union all ')}) schedule_facts;`);
  const noOperation=(subject,operation)=>{
    const before=all();assert.equal(read(subject,q(subject,'delegate','recover',{operationId:operation}),false).receipt,null);assert.equal(all(),before);
    assert.equal(d.exec(`select (select count(*) from public.merchant_attendance_schedule_commands where merchant_id=${quote(subject.site)} and operation_id=${quote(operation)})+
      (select count(*) from public.merchant_attendance_schedule_delegation_operations where merchant_id=${quote(subject.site)} and operation_id=${quote(operation)})+
      (select count(*) from public.merchant_attendance_schedule_publication_evidence where merchant_id=${quote(subject.site)} and operation_id=${quote(operation)});`),'0');
  };
  const expectWaiter=(race,code)=>{assert.equal(race.witnessed,true,'additional_exact_holder_pid_required');assert(race.right.error,'additional_waiter_must_reject');
    assert.match(String(race.right.error),new RegExp('ERROR:\\s+'+code+'(?:\\s|$)'));};
  let phase='disable-versus-publish';
  try{
    const stopped=seed(18);assert.equal(stopped.site,sites[0]);await grant(stopped);
    const prepared=publish(stopped),priorSchedule=scheduleFacts(stopped.site),member=employee(stopped,stopped.delegateEmployee);
    assert.equal(member.status,'active');assert.equal(member.auth_user_id,stopped.delegateAuth);
    assert.equal(d.exec(`select count(*) from public.merchant_attendance_workers where merchant_id=${quote(stopped.site)} and employee_id=${quote(stopped.delegateEmployee)};`),'0');
    const disable={merchant_id:stopped.site,employee_id:stopped.delegateEmployee,expected_version:member.version,actor_type:'owner',actor_id:stopped.owner,status:'disabled',
      offboarding_mode:'unassign',attendance_operation_id:next(),attendance_suspension_enabled:false};
    const stopRace=await lifecycleRace(db,prefix+`select public.faolla_update_merchant_enterprise_employee_v1(${json(disable)});`,
      prefix+'select '+expression(sq(stopped),stopped.delegateAuth,prepared)+';');
    expectWaiter(stopRace,'attendance_access_denied');assert(JSON.parse(stopRace.left));
    assert.equal(employee(stopped,stopped.delegateEmployee).status,'disabled');
    const epoch=JSON.parse(d.exec(`select jsonb_build_object('generation',generation,'paused',paused) from public.merchant_attendance_account_epochs
      where merchant_id=${quote(stopped.site)} and employee_id=${quote(stopped.delegateEmployee)};`));
    assert.deepEqual(epoch,{generation:1,paused:true});assert.equal(scheduleFacts(stopped.site),priorSchedule);
    noOperation(stopped,prepared.decision.operationId);
    native.pass('198 exact PID: real employee disable with capture flag OFF invalidates no-worker supervisor before prepared delegated publication; no schedule receipt/rows');

    phase='revoke-versus-cancel';const subject=seed(19);assert.equal(subject.site,sites[1]);await grant(subject);
    const publishedCommand=publish(subject),published=await write(subject,sq(subject),publishedCommand),originalGrant=subject.grantId;
    const firstSlot=read(subject,sq(subject)).schedule.entries[0];assert(firstSlot&&!firstSlot.cancelled&&firstSlot.canCancel);
    const pendingCancel=cancel(subject,firstSlot.slotId),revocation=revoke(subject),beforeCancel=scheduleFacts(subject.site);
    const revokeRace=await lifecycleRace(db,prefix+'select '+expression(q(subject,'owner','detail',{grantId:subject.grantId}),subject.owner,revocation,false)+';',
      prefix+'select '+expression(sq(subject),subject.delegateAuth,pendingCancel)+';');
    expectWaiter(revokeRace,'attendance_access_denied');assert.equal(JSON.parse(revokeRace.left).receipt.operationId,revocation.operationId);
    assert.equal(scheduleFacts(subject.site),beforeCancel);noOperation(subject,pendingCancel.decision.operationId);
    assert.equal(read(subject,q(subject,'owner','detail',{grantId:originalGrant}),false).detail.status,'revoked');
    assert.deepEqual(read(subject,q(subject,'delegate','recover',{operationId:publishedCommand.decision.operationId}),false).receipt,published.receipt);
    assert.equal(oldRead(subject).entries.find(e=>e.id===firstSlot.slotId)?.cancelled,false);
    native.pass('198 exact PID: grant revoke wins over a prepared delegated cancellation; original publication and old owner reader remain intact');

    phase='owner-versus-delegate';await grant(subject);assert.notEqual(subject.grantId,originalGrant);
    const shift=(minutes)=>subject.slots.map(([a,b])=>[new Date(Date.parse(a)+minutes*60000).toISOString(),new Date(Date.parse(b)+minutes*60000).toISOString()]);
    const overlapSlots=shift(120),competing=publish(subject,{slots:overlapSlots}),ownerBefore=oldRead(subject);
    const ownerQuery={siteId:subject.site,access:'owner',workerId:subject.worker,fromDate:subject.fromDate,throughDate:subject.throughDate,operationId:null};
    const ownerCommand={action:'publish',operationId:next(),expectedRevision:ownerBefore.revision,expectedSettingsVersion:settings(subject).version,
      reason:'Synthetic198 original owner concurrent publication',locationId:subject.location,timeZone:'UTC',slots:overlapSlots};
    assert.equal(competing.decision.expectedRevision,ownerCommand.expectedRevision);
    const ownerRace=await lifecycleRace(db,prefix+`select public.faolla_attendance_schedule_evidenced_v1(${json(ownerQuery)},${quote(subject.owner)},${json(ownerCommand)},true);`,
      prefix+'select '+expression(sq(subject),subject.delegateAuth,competing)+';');
    expectWaiter(ownerRace,'attendance_version_conflict');
    const ownerAfter=oldRead(subject);assert.equal(ownerAfter.revision,ownerBefore.revision+1);assert.equal(ownerAfter.entries.length,ownerBefore.entries.length+1);
    noOperation(subject,competing.decision.operationId);
    const refreshed=publish(subject,{slots:overlapSlots}),beforeOverlap=all();
    assert.equal(refreshed.decision.expectedRevision,ownerAfter.revision);
    assert.throws(()=>d.exec(prefix+'select '+expression(sq(subject),subject.delegateAuth,refreshed)+';'),/ERROR:\s+attendance_schedule_overlap(?:\s|$)/);
    assert.equal(all(),beforeOverlap);noOperation(subject,refreshed.decision.operationId);
    native.pass('198 exact PID: actual original owner publication wins same-worker overlap CAS; refreshed delegated command rejects actual overlap without rows');

    phase='mandatory-publication-evidence-fault';const fault=publish(subject,{slots:shift(240)}),faultOperation=fault.decision.operationId;
    const constraint='attendance_schedule_evidence_fault_198',faultTable='merchant_attendance_schedule_publication_evidence',beforeFault=all();
    assert.equal(d.exec(`select count(*) from pg_constraint where conrelid='public.${faultTable}'::regclass and conname=${quote(constraint)};`),'0');
    let added=false;const errors=[];
    try{
      d.exec(`alter table public.${faultTable} add constraint ${constraint} check(operation_id<>${quote(faultOperation)}::uuid) not valid;`);added=true;
      // NOT VALID skips historical scanning, not enforcement of NEW writes.
      // The actual167 RPC reaches its mandatory136 evidence INSERT after old
      // command/slots/authority; this exact23514 rolls back that entire call.
      d.exec(prefix+`do $sd_evidence_fault$ declare fault_constraint text;fault_state text;begin
        begin perform ${expression(sq(subject),subject.delegateAuth,fault)};raise exception 'sd_expected_evidence_failure_missing';
        exception when check_violation then get stacked diagnostics fault_constraint=CONSTRAINT_NAME,fault_state=RETURNED_SQLSTATE;
          assert fault_state='23514' and fault_constraint=${quote(constraint)},'sd_exact_evidence_failure_required';end;end;$sd_evidence_fault$;`);
      assert.equal(all(),beforeFault,'evidence_failure_must_rollback_old_command_slot_and_authority');noOperation(subject,faultOperation);
    }catch(error){errors.push(error);}
    finally{
      if(added)try{d.exec(`alter table public.${faultTable} drop constraint ${constraint};set constraints all immediate;`);}catch(error){errors.push(error);}
      try{assert.equal(d.tableCatalog(),catalog);assert.equal(d.definitions(),defs);assert.equal(all(),beforeFault);}catch(error){errors.push(error);}
    }
    if(errors.length)throw new AggregateError(errors,'schedule_evidence_fault_or_cleanup_failed');
    assert.equal(d.exec(protection),beforeProtected,'additional_races_changed_unreserved_facts');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
    native.pass('198 actual mandatory136 evidence CHECK23514 rolls back old command, slot and authority together; temporary constraint and full fact baseline restored');
    return {syntheticOnly:true,reservedSeeds:[18,19],exactPidRaces:3,disableWinsPublish:true,revokeWinsCancel:true,ownerWinsOverlappingPublish:true,
      refreshedOverlapRejected:true,mandatoryEvidenceExact23514:true,failedOperationsHaveNoReceipts:true,unreservedFactsPreserved:true,definitionsPreserved:true,
      tableCatalogRestored:true,realAuthentication:false,production:false,deployed:false};
  }catch(error){throw Error('schedule_delegation_additional_phase='+phase+': '+String(error),{cause:error});}
}
