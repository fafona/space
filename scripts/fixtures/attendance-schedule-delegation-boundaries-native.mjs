//198 inert, caller-owned synthetic boundary probes. Does not start PostgreSQL.
//Three real-RPC setup sites remain for the caller's owned-schema cleanup. All
//role/Auth projections and positive write probes below roll back explicitly.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {scheduleDelegationExpression as expression} from './attendance-schedule-delegation-native.mjs';

function factHashSql(names){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(sd_boundary_row) order by to_jsonb(sd_boundary_row)::text),'[]') from public."+name+' sd_boundary_row) rows';
  }).join(' union all ')+') sd_boundary_tables)';
}

export async function verifyScheduleDelegationBoundaries(p){
  const {d,h,native,scope,seed,grant,sq,q,publish,cancel,read,write,call,oldRead,oq,settings,next,all,views,core}=p;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d.guard,'string');
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  assert.equal(scope.schema,d.owned.schema);
  for(const port of [seed,grant,sq,q,publish,cancel,read,write,call,oldRead,oq,settings,next,all,views])assert.equal(typeof port,'function');

  //These are actual grant/publication operations, not copied success ledgers.
  const roles=seed(6);await grant(roles);
  const rolesPublication=publish(roles);await write(roles,sq(roles),rolesPublication);
  const roleSlot=read(roles,sq(roles)).schedule.entries[0];assert(roleSlot?.canCancel);
  const rolePublish=publish(roles,{slots:roles.slots.map(pair=>pair.map(stamp=>new Date(Date.parse(stamp)+7200000).toISOString()))});
  const roleCancel=cancel(roles,roleSlot.slotId);
  const identities=seed(7);await grant(identities);
  const identityPublication=publish(identities),saved=await write(identities,sq(identities),identityPublication);
  const identitySlot=read(identities,sq(identities)).schedule.entries[0];assert(identitySlot?.canCancel);
  const identityPublish=publish(identities,{slots:identities.slots.map(pair=>pair.map(stamp=>new Date(Date.parse(stamp)+7200000).toISOString()))});
  const identityCancel=cancel(identities,identitySlot.slotId);
  const identityRecover=q(identities,'delegate','recover',{operationId:identityPublication.decision.operationId});

  //Calling099 directly is intentional: the original supported owner path
  //creates no136 publication evidence. Never fabricate or delete that evidence.
  const legacy=seed(8),legacyBefore=oldRead(legacy);
  const legacyPublish={action:'publish',operationId:next(),expectedRevision:legacyBefore.revision,expectedSettingsVersion:settings(legacy).version,
    reason:'Synthetic198 original099 evidence-absent publication',locationId:legacy.location,timeZone:'UTC',slots:legacy.slots};
  const legacyPublished=call(`public.faolla_attendance_schedule_v1(${json(oq(legacy))},${quote(legacy.owner)},${json(legacyPublish)},true)`);
  assert.deepEqual(legacyPublished.receipt.command,legacyPublish);assert.equal(legacyPublished.entries.length,1);
  const legacySlot=legacyPublished.entries[0].id;
  assert.equal(d.exec(`select count(*) from public.merchant_attendance_schedule_publication_evidence where merchant_id=${quote(legacy.site)};`),'0');
  await grant(legacy,{includeExistingFuture:true});
  assert.equal(read(legacy,sq(legacy)).schedule.entries.length,0);
  const legacyCancel=cancel(legacy,legacySlot),old=oldRead(legacy);
  const ownerCancel={action:'cancel',operationId:next(),expectedRevision:old.revision,expectedSettingsVersion:settings(legacy).version,
    reason:'Synthetic198 original owner cancellation remains usable',slotId:legacySlot};
  const histories=new Map([roles,identities,legacy].map(subject=>[subject.site,views(subject)]));
  assert.equal(histories.get(legacy.site).rows[0].self.slot.hasPublicationEvidence,false);

  const names=d.inventory(),hash=factHashSql(names),baseline=all(),definitions=d.definitions(),catalog=d.tableCatalog();
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  //all() intentionally retains the caller's default session serialization for
  //the final external rollback comparison. Cross-connection transaction checks
  //must instead use the same UTC/DateStyle as every querySteps stage below.
  const normalizedBaseline=d.exec(prefix+'select '+hash+';');
  const newDelegateAuth=next(),newTargetAuth=next();
  assert.equal(d.exec(`select count(*) from public.merchant_enterprise_employees where auth_user_id in(${quote(newDelegateAuth)},${quote(newTargetAuth)});`),'0');
  let denialChecks=0,readChecks=0,positiveRollbackChecks=0;
  const denied=(exp,error,label)=>{
    denialChecks++;
    return `do $sd_boundary_denial$ declare before_hash text;begin before_hash:=${hash};
      begin set local role service_role;perform ${exp};reset role;raise exception '198_boundary_expected_denial_missing';
      exception when raise_exception then reset role;if sqlerrm<>${quote(error)} then raise;end if;end;
      assert ${hash}=before_hash,${quote('198_denial_zero_writes_'+label)};
    end;$sd_boundary_denial$;`;
  };
  const readCheck=(exp,predicate,label)=>{
    readChecks++;
    return `do $sd_boundary_read$ declare before_hash text;reply jsonb;begin before_hash:=${hash};
      set local role service_role;reply:=${exp};reset role;
      assert ${predicate},${quote('198_read_'+label)};assert ${hash}=before_hash,${quote('198_read_zero_writes_'+label)};
    end;$sd_boundary_read$;`;
  };
  const history=subject=>{
    readChecks++;
    const overview={siteId:subject.site,workerIds:[subject.worker],fromDate:subject.fromDate,throughDate:subject.throughDate,revision:null,cursorDate:null,cursorStart:null,cursorId:null};
    const expected=histories.get(subject.site);
    return `do $sd_boundary_history$ declare before_hash text;historical_rows jsonb;historical_overview jsonb;begin before_hash:=${hash};
      select coalesce(jsonb_agg(jsonb_build_object('self',public.faolla_attendance_self_schedule_slot_v1(sd_slot),'source',public.faolla_attendance_sources_schedule_v1(sd_slot)) order by sd_slot.id),'[]')
        into historical_rows from public.merchant_attendance_schedule_slots sd_slot where merchant_id=${quote(subject.site)};
      set local role service_role;historical_overview:=public.faolla_attendance_schedule_overview_v1(${json(overview)},${quote(subject.owner)});reset role;
      assert historical_rows=${json(expected.rows)} and historical_overview=${json(expected.overview)},'198_saved137_128_120_history_unchanged';
      assert ${hash}=before_hash,'198_saved_history_read_zero_writes';
    end;$sd_boundary_history$;`;
  };
  const positive=async(subject,command)=>{
    positiveRollbackChecks++;
    const expectedHash=await core.scheduleDelegationFingerprint(sq(subject),command),decision=command.decision;
    return `do $sd_boundary_positive$ declare before_hash text;reply jsonb;begin before_hash:=${hash};
      begin set local role service_role;reply:=${expression(sq(subject),subject.delegateAuth,command)};reset role;
        assert reply->'receipt'->>'operationId'=${quote(decision.operationId)} and reply->'receipt'->>'actorId'=${quote(subject.delegateAuth)}
          and reply->'receipt'->>'action'=${quote(decision.action)} and reply->'receipt'->>'commandFingerprint'=${quote(expectedHash)},'198_independent_hash_actual_receipt';
        assert exists(select 1 from public.merchant_attendance_schedule_commands where merchant_id=${quote(subject.site)}
          and operation_id=${quote(decision.operationId)} and actor_auth_user_id=${quote(subject.delegateAuth)} and command=${json(decision)}),'198_actual_original_command';
        assert exists(select 1 from public.merchant_attendance_schedule_delegation_operations where merchant_id=${quote(subject.site)}
          and operation_id=${quote(decision.operationId)} and command=${json(command)}),'198_actual_mandatory_authority';
        ${decision.action==='publish'?`assert exists(select 1 from public.merchant_attendance_schedule_publication_evidence where merchant_id=${quote(subject.site)} and operation_id=${quote(decision.operationId)}),'198_actual_publication_evidence';`:''}
        set constraints all immediate;raise exception using errcode='P1983',message='198_positive_probe_rollback';
      exception when sqlstate 'P1983' then reset role;end;
      assert ${hash}=before_hash,'198_positive_probe_all_facts_restored';
    end;$sd_boundary_positive$;`;
  };
  const roleProjection=action=>`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view',${quote('attendance.schedule.'+action)}]
    where merchant_id=${quote(roles.site)} and id=${quote(roles.delegateRole)};`;
  const actionRead=action=>readCheck(expression(sq(roles),roles.delegateAuth),
    `reply->'schedule'->'grant'->'usableActions'=${json([action])} and jsonb_array_length(reply->'schedule'->'entries')=1
      and reply->'schedule'->'entries'->0->'canCancel'='${action==='cancel'}'::jsonb`,'independent_'+action);
  const recover=()=>readCheck(expression(identityRecover,identities.delegateAuth,null,false),
    `reply->'receipt'=${json(saved.receipt)} and reply->'schedule'='null'::jsonb and reply->'detail'='null'::jsonb
      and reply->'grants'='[]'::jsonb and reply->'catalogItems'='[]'::jsonb`,'target_rebind_original_minimal_receipt');
  const closedStage=(label,sql)=>prefix+`savepoint sd_boundary_probe;${sql}
    rollback to sd_boundary_probe;release sd_boundary_probe;
    do $sd_boundary_stage_restored$ begin assert ${hash}=${quote(normalizedBaseline)},${quote('198_stage_all_facts_restored_'+label)};end;$sd_boundary_stage_restored$;`;

  const stages=[
    'begin;'+prefix+`do $sd_boundary_owned$ begin
      assert current_user='postgres','198_owned_postgres_required';
      assert not exists(select 1 from pg_trigger where tgrelid in(select oid from pg_class where relnamespace=${d.owned.oid}) and tgenabled<>'O'),'198_all_existing_triggers_enabled';
      assert ${hash}=${quote(normalizedBaseline)},'198_initial_all_facts_baseline';
    end;$sd_boundary_owned$;`,
    closedStage('publish_only',roleProjection('publish')+actionRead('publish')
      +denied(expression(sq(roles),roles.delegateAuth,roleCancel),'attendance_access_denied','publish_only_cannot_cancel')
      +await positive(roles,rolePublish)+history(roles)),
    closedStage('cancel_only',roleProjection('cancel')+actionRead('cancel')
      +denied(expression(sq(roles),roles.delegateAuth,rolePublish),'attendance_access_denied','cancel_only_cannot_publish')
      +await positive(roles,roleCancel)+history(roles)),
    closedStage('delegate_auth',`update public.merchant_enterprise_employees set auth_user_id=${quote(newDelegateAuth)} where merchant_id=${quote(identities.site)} and id=${quote(identities.delegateEmployee)};`
      +denied(expression(sq(identities),identities.delegateAuth,identityPublish),'attendance_access_denied','old_delegate_publish')
      +denied(expression(sq(identities),newDelegateAuth,identityCancel),'attendance_access_denied','new_delegate_cancel')
      +denied(expression(identityRecover,identities.delegateAuth,null,false),'attendance_access_denied','old_delegate_recovery')
      +denied(expression(identityRecover,newDelegateAuth,null,false),'attendance_access_denied','replacement_delegate_recovery')+history(identities)),
    closedStage('target_auth',`update public.merchant_enterprise_employees set auth_user_id=${quote(newTargetAuth)} where merchant_id=${quote(identities.site)} and id=${quote(identities.employee)};`
      +denied(expression(sq(identities),identities.delegateAuth,identityPublish),'attendance_access_denied','target_rebound_publish')
      +denied(expression(sq(identities),identities.delegateAuth,identityCancel),'attendance_access_denied','target_rebound_cancel')+recover()+history(identities)),
    closedStage('legacy099',denied(expression(sq(legacy),legacy.delegateAuth,legacyCancel),'attendance_access_denied','no136_evidence_delegate_cancel')
      +`do $sd_boundary_owner_cancel$ declare before_hash text;reply jsonb;begin before_hash:=${hash};
        begin set local role service_role;reply:=public.faolla_attendance_schedule_evidenced_v1(${json(oq(legacy))},${quote(legacy.owner)},${json(ownerCancel)},true);reset role;
          assert reply->'receipt'->'command'=${json(ownerCancel)} and reply->'receipt'->>'operationId'=${quote(ownerCancel.operationId)},'198_original_owner_actual_cancel_receipt';
          assert exists(select 1 from public.merchant_attendance_schedule_cancellations where merchant_id=${quote(legacy.site)} and slot_id=${quote(legacySlot)}),'198_original_owner_actual_cancel_row';
          assert not exists(select 1 from public.merchant_attendance_schedule_publication_evidence where merchant_id=${quote(legacy.site)}),'198_no136_evidence_backfill';
          assert not exists(select 1 from public.merchant_attendance_schedule_delegation_operations where merchant_id=${quote(legacy.site)}),'198_owner_not_disguised_delegate';
          set constraints all immediate;raise exception using errcode='P1983',message='198_owner_positive_probe_rollback';
        exception when sqlstate 'P1983' then reset role;end;
        assert ${hash}=before_hash,'198_owner_cancel_probe_all_facts_restored';
      end;$sd_boundary_owner_cancel$;`+history(legacy)),
    prefix+'set constraints all immediate;rollback;',
  ];
  assert.equal(stages.length,7);assert.equal(denialChecks,9);
  try{await native.querySteps(stages.map((sql,index)=>scope.sql(`--schedule_boundary_stage_${index+1}\n`+sql)));}
  catch(error){throw Error('schedule_delegation_boundaries_failed: '+String(error),{cause:error});}
  finally{
    assert.equal(all(),baseline,'198_boundary_all_facts_restored');
    assert.equal(d.definitions(),definitions,'198_boundary_definitions_unchanged');
    assert.equal(d.tableCatalog(),catalog,'198_boundary_catalog_unchanged');
  }
  for(const subject of [roles,identities,legacy])assert.deepEqual(views(subject),histories.get(subject.site));
  native.pass('198 independent publish/cancel role withdrawal, both Auth rebinding, immutable historical readers, and original099 no-evidence owner-only cancellation');
  return {syntheticSites:[6,7,8],rollbackGroups:1,stages:stages.length,denialChecks,readChecks,positiveRollbackChecks:positiveRollbackChecks+1,
    realSetupGrants:3,realSetupDelegatePublications:2,realSetupOriginal099Publications:1,
    actionsIndependent:true,bothAuthBindingsChecked:true,historical137_128_120Unchanged:true,legacyNoEvidenceOwnerCancel:true,
    allFactsDefinitionsCatalogRestoredToPostSetupBaseline:true,production:false,
    fixture:'Three synthetic sites with actual RPC grants/publications remain until caller owned-schema cleanup. All role/Auth projection changes and positive publish/cancel probes roll back in one outer transaction; no historical row was edited and no trigger was disabled.'};
}
