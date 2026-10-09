//185 inert regression. Only root supplies the existing owned PG lifecycle.
//Actual064/149 and new155 are exercised;184 diagnostic remains unchanged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url),fid=n=>id(185000000+n),emptySite='98400185';
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const rows=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const day=(value,n)=>new Date(Date.parse(value+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
const writable=new Set(['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_locations',
  'merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_config_operations','merchant_attendance_period_closures',
  'merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries',
  'merchant_attendance_correction_controls','merchant_attendance_missing_requests','merchant_attendance_missing_entries']);
function hashSql(names,original=false){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const where=original&&writable.has(name)?` where ${name==='merchants'?'id':'merchant_id'}<>${quote(emptySite)}`:'';
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r${where}) rows`;
  }).join(' union all ')+') resume_rows)';
}

export async function verifyPeriodTimezoneResumeNative({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof native?.connect,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);assert.notEqual(emptySite,d.site);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const {parsePeriodClosureResult}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
  const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),allHash=hashSql(names),oldHash=hashSql(names,true);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const restore=label=>{assert.equal(d.fingerprint(),baseline,label+':facts');assert.equal(d.definitions(),definitions,label+':definitions');assert.equal(d.tableCatalog(),catalog,label+':catalog');};
  const mark=(kind,hash=allHash)=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${hash});`;
  const initial=`do $resume_initial$ declare fn text;begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050155 and name='merchant_attendance_period_fixed_boundaries'),'resume_requires155';
    assert not exists(select 1 from public.merchants where id=${quote(emptySite)}),'resume_unique_synthetic_site';
    assert has_function_privilege('service_role','public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','EXECUTE')
      and not has_function_privilege('anon','public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','EXECUTE')
      and not has_function_privilege('authenticated','public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','EXECUTE'),'resume_service_only_source';
    foreach fn in array array['public.faolla_attendance_period_closure_report_v1(text,uuid,jsonb,jsonb)',
      'public.faolla_attendance_period_closure_scoped_report_v1(text,uuid,jsonb,jsonb)',
      'public.faolla_attendance_period_closure_unified_report_v1(text,uuid,jsonb,jsonb)'] loop
      assert not has_function_privilege('service_role',fn,'EXECUTE') and not has_function_privilege('anon',fn,'EXECUTE') and not has_function_privilege('authenticated',fn,'EXECUTE'),'resume_private_fixed_report';
    end loop;
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'resume_guards_enabled';
  end;$resume_initial$;`;
  let readChecks=0,failedChecks=0,sourceReads=0,periodWrites=0,adminWrites=0,policyWrites=0,missingWrites=0;
  const rejection=(label,expr,code)=>mark('before_failure')+`set local role service_role;do $resume_reject$ begin
    begin perform ${expr};raise exception 'resume_expected_rejection_missing';exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
    end;$resume_reject$;${prefix}select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`+mark('after_failure');
  const checkedFailure=list=>{assert.equal(list.length,3);assert.equal(list[0].kind,'before_failure');assert.equal(list[1].kind,'rejection');assert.equal(list[2].kind,'after_failure');assert.equal(list[0].hash,list[2].hash,'resume_failed_read_wrote');failedChecks++;};
  const admin=(site,actor,zone,op,version,values)=>`public.faolla_attendance_admin_v1(${quote(site)},${quote(actor)},${json({view:'settings',cursor:null,search:''})},${json({kind:'settings',operationId:op,expectedVersion:version,values:{...values,timeZone:zone}})},null)`;
  const settings=JSON.parse(d.exec(`select jsonb_build_object('version',version,'timeZone',time_zone,'enabled',enabled,'webClockEnabled',web_clock_enabled,'webBreakPaid',web_break_paid) from public.merchant_attendance_settings where merchant_id=${quote(d.site)};`));
  assert(Number.isSafeInteger(settings.version)&&settings.version>=1);assert.equal(settings.timeZone,'UTC');const {version,...values}=settings;
  let protectedRows;
  try{protectedRows=rows(await native.querySteps([
    'begin;'+prefix+initial+mark('before')+`do $resume_history$ begin assert exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)}),'resume_original_history_required';end;$resume_history$;`,
    ...['Etc/UTC','Europe/Madrid'].map((zone,i)=>rejection(zone,admin(d.site,d.owner,zone,fid(10+i),version,values),'attendance_history_protected')),
    mark('after')+'set constraints all immediate;rollback;'
  ].map(sql=>scope.sql(sql))));}
  finally{restore('existing_event_history');}
  assert.equal(protectedRows[0].hash,protectedRows.at(-1).hash);checkedFailure(protectedRows.slice(1,4));checkedFailure(protectedRows.slice(4,7));

  const site=quote(emptySite),owner=fid(1),role=fid(2),employee=fid(3),auth=fid(4),location=fid(5),worker=fid(6),otherEmployee=fid(8),otherAuth=fid(9),otherWorker=fid(12);
  const oldRange={fromDate:day(h.slot.workDate,-1),throughDate:h.slot.workDate},newRange={fromDate:day(h.slot.workDate,-4),throughDate:day(h.slot.workDate,-4)};
  const q=(access='owner',mode='detail',pid=fid(100),version=null,operationId=null,range=oldRange)=>({siteId:emptySite,access,workerId:worker,...range,mode,periodId:pid,operationId,version});
  const sq=(pid=fid(100),access='owner',range=oldRange,target=worker)=>({siteId:emptySite,access,workerId:target,...range,periodId:pid});
  const source=(query,actor=query.access==='owner'?owner:auth)=>`public.faolla_attendance_period_closure_source_v1(${json(query)},${quote(actor)})`;
  const setup=`insert into public.merchants(id,user_id) values(${site},${quote(owner)});
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${site},'Synthetic fixed period',array['enterprise.view','attendance.self.view','attendance.self.request','attendance.self.export']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      (${quote(employee)},${site},${quote(auth)},'period-fixed@example.test','Synthetic fixed period employee',${quote(role)},'active'),
      (${quote(otherEmployee)},${site},${quote(otherAuth)},'period-fixed-other@example.test','Synthetic other employee',${quote(role)},'active');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values(${site},'UTC',true,true);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values(${quote(location)},${site},'Synthetic UTC location','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      (${quote(worker)},${site},${quote(employee)},'FIXED-1','Synthetic fixed worker',true,${quote(location)}),
      (${quote(otherWorker)},${site},${quote(otherEmployee)},'FIXED-2','Synthetic other worker',true,${quote(location)});
    insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on) values
      (${quote(fid(7))},${site},${quote(worker)},'2020-01-01'),(${quote(fid(13))},${site},${quote(otherWorker)},'2020-01-01');`;
  const command=(action,n,revision,version,fingerprint,pid=fid(100))=>({action,operationId:fid(n),periodId:pid,expectedRevision:revision,expectedVersion:version,expectedFingerprint:fingerprint,reason:action==='confirm'?'':'Synthetic185 fixed boundary resume'});
  const call=(query,c=null,a=null,allow=false)=>`public.faolla_attendance_period_closure_v1(${json(query)},${quote(query.access==='owner'?owner:auth)},${json(c)},${json(a)},${allow})`;
  function project(raw,query,c){
    const r={...raw};if(r.kind==='preview'){const value=projectPeriodClosureSource(r.source,query),period=r.period;delete r.source;delete r.period;return parsePeriodClosureResult({...r,preview:{...value,period}},query,{authUserId:query.access==='owner'?owner:auth},c);}
    assert.equal(sha(r.artifactText),r.artifactSha256);assert.equal(Buffer.byteLength(r.artifactText,'utf8'),r.artifactBytes);assert(r.artifactBytes<=2097152);assert.deepEqual(JSON.parse(r.artifactText),r.artifact);
    delete r.artifactText;delete r.artifactSha256;delete r.artifactBytes;return parsePeriodClosureResult(r,query,{authUserId:query.access==='owner'?owner:auth},c);
  }
  const summaries=[];
  for(const scenario of [{zone:'Etc/UTC',reopened:false,withMissing:false},{zone:'Europe/Madrid',reopened:true,withMissing:false},{zone:'Europe/Madrid',reopened:false,withMissing:true}]){
    const {zone,reopened,withMissing}=scenario,connection=native.connect();let steps=0;
    const step=async sql=>{assert(++steps<=40,'resume_bounded_steps');return connection.step(scope.sql(prefix+sql));};
    const read=async(expr,kind='reply')=>{
      const list=rows(await step(mark('before_read')+`set local role service_role;select jsonb_build_object('kind',${quote(kind)},'raw',${expr});`+mark('after_read')));
      assert.equal(list.length,3);assert.equal(list[0].kind,'before_read');assert.equal(list[1].kind,kind);assert.equal(list[2].kind,'after_read');assert.equal(list[0].hash,list[2].hash,'resume_read_or_recovery_wrote');readChecks++;return list[1].raw;
    };
    const invoke=async(query,c=null,a=null,allow=false,readonly=c===null)=>{
      let raw;if(readonly)raw=await read(call(query,c,a,allow));else{raw=JSON.parse(await step('set local role service_role;select '+call(query,c,a,allow)+';'));periodWrites++;}
      return {raw,parsed:project(raw,query,c)};
    };
    const collect=async query=>{sourceReads++;const raw=await read(source(query),'source');const result=projectPeriodClosureSource(raw,{...query,mode:'preview',operationId:null,version:null});return {raw,...result};};
    const fail=async(label,expr,code)=>checkedFailure(rows(await step(rejection(label,expr,code))));
    try{
      const first=rows(await step('begin;'+initial+mark('original_before',oldHash)+setup));assert.equal(first.length,1);const originalBefore=first[0].hash;
      const preview=await invoke(q('owner','preview',null)),artifact=preview.parsed.preview.artifact,fp=artifact.sourceFingerprint;
      assert.deepEqual(preview.parsed.preview.blockers,[]);assert.equal(artifact.period.timeZone,'UTC');assert.equal(artifact.dayBoundaries.length,2);assert.deepEqual(artifact.report.base.rows,[]);
      const send=command('send',101,0,0,fp),confirm=command('confirm',102,1,1,fp),seal=command('seal',103,2,1,fp);
      const sent=await invoke(q(),send,artifact,true),confirmed=await invoke(q('self'),confirm,null,true);assert.equal(confirmed.parsed.period.confirmedVersion,1);
      if(reopened){const result=await invoke(q(),seal,null,true);assert.equal(result.parsed.period.sealed,true);}
      const saved=await invoke(q('owner','export',fid(100),1));
      const config=JSON.parse(await step('set local role service_role;select '+admin(emptySite,owner,zone,fid(110),1,{enabled:true,webClockEnabled:true,webBreakPaid:false})+';'));
      adminWrites++;assert.equal(config.settings.timeZone,zone);assert.equal(config.version,2);
      const missingProposal={startAt:oldRange.throughDate+'T23:30:00.000000Z',endAt:oldRange.throughDate+'T23:45:00.000000Z',breaks:[]};
      if(withMissing){
        const mq=access=>({siteId:emptySite,access,fromDate:oldRange.fromDate,throughDate:oldRange.throughDate,requestId:access==='owner'?fid(300):null,operationId:null,beforeAt:null,beforeId:null});
        const declaration={action:'submit',operationId:fid(300),reason:'Synthetic185 fixed-boundary missing declaration',expectedWorkerId:worker,expectedSettingsVersion:2,expectedPolicyRevision:1,locationId:location,timeZone:'UTC',proposal:missingProposal};
        await step(`set local role service_role;do $resume_actual_missing$ declare review jsonb;decision jsonb;begin
          perform public.faolla_attendance_correction_controls_v2(${site},${quote(owner)},${json({action:'set_policy',operationId:fid(299),expectedRevision:0,expectedSettingsVersion:2,submissionWindowDays:365,reason:'Synthetic185 missing policy'})},null,null,true);
          perform public.faolla_attendance_missing_v1(${json(mq('self'))},${quote(auth)},${json(declaration)},true);
          review:=public.faolla_attendance_missing_v1(${json(mq('owner'))},${quote(owner)},null,true);
          assert review->'detail'->>'canApprove'='true','resume_actual_missing_eligible';
          decision:=jsonb_build_object('action','approve','operationId',${quote(fid(301))},'requestId',${quote(fid(300))},'expectedRevision',1,'evidenceToken',review->'detail'->>'evidenceToken','reason','Synthetic185 actual approval');
          perform public.faolla_attendance_missing_v1(${json(mq('owner'))},${quote(owner)},decision,true);
        end;$resume_actual_missing$;`);policyWrites++;missingWrites+=2;
      }
      const fixed=await invoke(q('owner','preview'));assert.deepEqual(fixed.parsed.preview.artifact.period,artifact.period);assert.deepEqual(fixed.parsed.preview.artifact.dayBoundaries,artifact.dayBoundaries);
      const resumeFp=fixed.parsed.preview.artifact.sourceFingerprint;
      if(withMissing){assert.notEqual(resumeFp,fp);assert.deepEqual(fixed.parsed.preview.artifact.report.missing.map(x=>x.requestId),[fid(300)]);assert.equal(fixed.parsed.preview.artifact.report.totals.missingSelected.workedUs,900000000);}
      else assert.equal(resumeFp,fp);
      assert.deepEqual(fixed.parsed.preview.blockers,[]);assert.deepEqual(fixed.parsed.preview.artifact.report.base.rows,[]);
      for(const access of ['owner','self']){const detail=await invoke(q(access));assert.equal(detail.parsed.sourceChanged,withMissing);}
      const fixedSelf=await collect(sq(fid(100),'self'));assert.deepEqual(fixedSelf.artifact.dayBoundaries,artifact.dayBoundaries);assert.equal(fixedSelf.artifact.sourceFingerprint,resumeFp);
      const unknown=await collect(sq(fid(900)));assert.equal(unknown.artifact.period.timeZone,zone);assert.notEqual(unknown.artifact.sourceFingerprint,fp);
      const nullId=await collect(sq(null));assert.deepEqual(nullId.raw.sourceCanonical,unknown.raw.sourceCanonical);
      if(zone==='Europe/Madrid')assert.notEqual(unknown.artifact.period.startAt,artifact.period.startAt);else assert.equal(unknown.artifact.period.startAt,artifact.period.startAt);
      if(withMissing){assert.deepEqual(unknown.artifact.report.missing,[]);assert(Date.parse(missingProposal.startAt)>=Date.parse(unknown.artifact.period.endAt));assert(Date.parse(missingProposal.endAt)<=Date.parse(artifact.period.endAt));}
      await fail('wrong_worker',source(sq(fid(100),'owner',oldRange,otherWorker)),'attendance_access_denied');
      await fail('wrong_date',source(sq(fid(100),'owner',{fromDate:day(oldRange.fromDate,-1),throughDate:oldRange.throughDate})),'attendance_access_denied');
      await fail('untrusted_frame',source({...sq(),frame:{timeZone:zone}}),'attendance_invalid_request');
      // Isolated adversarial current identity only on this NEW synthetic member;
      // no real membership write or disabled constraint is claimed.
      await step(`savepoint rebound;update public.merchant_enterprise_employees set auth_user_id=${quote(fid(901))} where merchant_id=${site} and id=${quote(employee)};`);
      await fail('rebound_owner',source(sq()),'attendance_period_identity_changed');
      await fail('rebound_self',source(sq(fid(100),'self'),fid(901)),'attendance_period_identity_changed');
      await step('rollback to savepoint rebound;release savepoint rebound;');
      let revision=reopened?3:2,logicalVersion=1;
      if(reopened){const c=command('reopen',104,revision,1,null),r=await invoke(q(),c,null,false);assert.equal(r.parsed.period.state,'open');assert.equal(r.parsed.period.confirmedVersion,null);revision++;}
      const resumed=command('send',120,revision,1,resumeFp),newSent=await invoke(q(),resumed,fixed.parsed.preview.artifact,true);revision++;
      logicalVersion=reopened||withMissing?2:1;assert.equal(newSent.parsed.period.currentVersion,logicalVersion);assert.equal(newSent.parsed.period.revision,revision);
      if(withMissing){assert.notEqual(newSent.raw.artifactText,saved.raw.artifactText);assert.deepEqual(newSent.parsed.artifact.report.missing.map(x=>x.requestId),[fid(300)]);}
      else assert.equal(newSent.raw.artifactText,saved.raw.artifactText,'resume_reuses_original_immutable_body');
      const reconfirm=command('confirm',121,revision,logicalVersion,resumeFp),c=await invoke(q('self'),reconfirm,null,true);revision++;assert.equal(c.parsed.period.confirmedVersion,logicalVersion);
      const reseal=command('seal',122,revision,logicalVersion,resumeFp),s=await invoke(q(),reseal,null,true);revision++;assert.equal(s.parsed.period.sealed,true);assert.equal(s.parsed.period.revision,revision);
      for(const [action,access,receipt] of [[send,'owner',sent.parsed.operation],[confirm,'self',confirmed.parsed.operation]]){
        const recovered=await invoke(q(access,'recover',fid(100),null,action.operationId));assert.equal(recovered.parsed.replayed,true);assert.deepEqual(recovered.parsed.operation,receipt);assert.equal(recovered.parsed.artifactVersion,1);assert.equal(recovered.raw.artifactText,saved.raw.artifactText);
      }
      const replay=await invoke(q(),send,null,false,true);assert.equal(replay.parsed.replayed,true);assert.deepEqual(replay.parsed.operation,sent.parsed.operation);
      for(const access of ['owner','self']){const exported=await invoke(q(access,'export',fid(100),1));assert.equal(exported.parsed.sourceChanged,null);assert.equal(exported.raw.artifactText,saved.raw.artifactText);assert.equal(exported.raw.artifactSha256,saved.raw.artifactSha256);assert.deepEqual(exported.parsed.artifact,artifact);}
      const nextPreview=await invoke(q('owner','preview',null,null,null,newRange)),next=nextPreview.parsed.preview.artifact;
      assert.equal(next.period.timeZone,zone);assert.equal(next.dayBoundaries.length,1);assert(Date.parse(next.period.endAt)<Date.parse(artifact.period.startAt));
      const nextSend=command('send',201,0,0,next.sourceFingerprint,fid(200)),nextResult=await invoke(q('owner','detail',fid(200),null,null,newRange),nextSend,next,true);
      assert.equal(nextResult.parsed.period.timeZone,zone);assert.deepEqual(nextResult.parsed.artifact.dayBoundaries,next.dayBoundaries);
      const final=rows(await step(`do $resume_final$ begin
        assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${site}),'resume_no_event_bypass';
        assert (select time_zone from public.merchant_attendance_locations where merchant_id=${site} and id=${quote(location)})='UTC','resume_location_unchanged';
        assert (select count(*) from public.merchant_attendance_period_closures where merchant_id=${site})=2,'resume_exact_old_new_periods';
        assert (select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(fid(100))})=${withMissing?2:1},'resume_exact_immutable_body_count';
      end;$resume_final$;`+mark('original_after',oldHash)+'set constraints all immediate;rollback;'));
      assert.equal(final.length,1);assert.equal(final[0].hash,originalBefore,'resume_original_rows_changed');
      summaries.push({zone,oldTimeZone:'UTC',oldFixedDays:2,newTimeZone:zone,newDays:1,currentLogicalVersion:logicalVersion,reopened,withMissing,
        sourceUnchangedForOldPeriod:!withMissing,oldArchiveSha256:saved.raw.artifactSha256,oldArchiveBytes:saved.raw.artifactBytes,sourceFingerprint:fp,
        sameBodyReused:!withMissing,oldSealed:true,newPeriodUsesCurrentSettings:true,unknownPeriodUsesCurrentSettings:true,steps});
    }catch(error){throw new Error('period_timezone_resume:'+zone+':'+String(error?.message??error),{cause:error});}
    finally{await connection.close();restore(zone);}
  }
  assert.equal(readChecks,42);assert.equal(failedChecks,17);assert.equal(sourceReads,9);assert.equal(periodWrites,20);assert.equal(adminWrites,3);assert.equal(policyWrites,1);assert.equal(missingWrites,2);
  return {readerVersion:'155',groups:4,scenarios:summaries,readChecks,failedChecks,sourceReads,periodWrites,adminWrites,policyWrites,missingWrites,actualMissingReviewReads:1,
    serviceOnlySource:true,privateReportsNotExecutable:true,allReadsFailuresAndRecoveriesZeroWrites:true,allOriginalRowsUnchanged:true,
    allFactsDefinitionsCatalogRestored:true,outerRollbackTransactions:4,actual064HistoryStillProtected:true,actual103BoundaryDeclaration:true,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Actual064 changes only on independent empty synthetic merchant; actual149/155 old/new period workflow and genuine Node projection. Identity-rebind negative is a savepoint-only constrained new synthetic member change. No original settings/membership write, deleted event, changed deadline, production or deployment.'};
}
