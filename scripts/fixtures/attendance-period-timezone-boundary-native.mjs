//184 diagnostic only. The caller owns the existing synthetic PostgreSQL scope.
//No settings UPDATE bypass: empty-site timezone changes use actual064. Existing
//history remains protected; all new-site rows and149 operations roll back.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const fid=n=>id(184000000+n);
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const emptySite='98400184';
const ownTables=new Set(['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings',
  'merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_config_operations',
  'merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries']);
function hashSql(names,originalOnly=false){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const where=originalOnly&&ownTables.has(name)?` where ${name==='merchants'?'id':'merchant_id'}<>${quote(emptySite)}`:'';
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r${where}) rows`;
  }).join(' union all ')+') timezone_rows)';
}

export async function verifyPeriodTimezoneBoundaryNative({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof native?.connect,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  assert.notEqual(d.site,emptySite);
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const {parsePeriodClosureResult}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
  const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),allHash=hashSql(names),oldHash=hashSql(names,true);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const restore=label=>{assert.equal(d.fingerprint(),baseline,label+':facts');assert.equal(d.definitions(),definitions,label+':definitions');assert.equal(d.tableCatalog(),catalog,label+':catalog');};
  const marker=(kind,hash=allHash)=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${hash});`;
  const initial=`do $timezone_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050154),'timezone_requires154';
    assert not exists(select 1 from public.merchants where id=${quote(emptySite)}),'timezone_unique_synthetic_site';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'timezone_live_guards';
  end;$timezone_initial$;`;
  let readChecks=0,failedChecks=0,actualAdminWrites=0,actualPeriodWrites=0;
  const rejectedSql=(label,expression,code)=>marker('before_failure')+`set local role service_role;do $timezone_reject$ begin
    begin perform ${expression};raise exception 'timezone_expected_failure_missing';exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
    end;$timezone_reject$;${prefix}select jsonb_build_object('kind','rejection','label',${quote(label)},'error',${quote(code)});`+marker('after_failure');
  const checkFailure=rows=>{assert.equal(rows.length,3);assert.equal(rows[0].kind,'before_failure');assert.equal(rows[1].kind,'rejection');assert.equal(rows[2].kind,'after_failure');assert.equal(rows[0].hash,rows[2].hash,'timezone_failed_rpc_wrote');failedChecks++;return rows[1];};
  const admin=(site,owner,zone,operationId,expectedVersion,values)=>`public.faolla_attendance_admin_v1(${quote(site)},${quote(owner)},${json({view:'settings',cursor:null,search:''})},${json({kind:'settings',operationId,expectedVersion,values:{...values,timeZone:zone}})},null)`;
  // Metadata preparation is privileged fixture setup, never a private SELECT
  // nested in a service_role RPC argument. No original row is changed.
  const settings=JSON.parse(d.exec(`select jsonb_build_object('version',version,'timeZone',time_zone,'enabled',enabled,'webClockEnabled',web_clock_enabled,'webBreakPaid',web_break_paid)
    from public.merchant_attendance_settings where merchant_id=${quote(d.site)};`));
  assert(Number.isSafeInteger(settings.version)&&settings.version>=1);assert.equal(settings.timeZone,'UTC');
  const {version:settingsVersion,...values}=settings;
  const historySteps=['begin;'+prefix+initial+marker('protected_before'),
    prefix+`do $timezone_history$ begin assert exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)}),'timezone_real_history_required';
      assert (select version from public.merchant_attendance_settings where merchant_id=${quote(d.site)})=${settingsVersion},'timezone_settings_version_stable';end;$timezone_history$;`,
    ...['Etc/UTC','Europe/Madrid'].map((zone,i)=>rejectedSql(zone,admin(d.site,d.owner,zone,fid(10+i),settingsVersion,values),'attendance_history_protected')),
    marker('protected_after')+'set constraints all immediate;rollback;'];
  let history;
  try{history=lines(await native.querySteps(historySteps.map(sql=>scope.sql(sql))));}
  catch(error){throw new Error('period_timezone_history_guard:'+String(error?.message??error),{cause:error});}
  finally{restore('history_guard');}
  assert.equal(history[0].hash,history.at(-1).hash,'timezone_history_unchanged');
  for(let i=1;i<history.length-1;i+=3)checkFailure(history.slice(i,i+3));

  const site=quote(emptySite),owner=fid(1),role=fid(2),employee=fid(3),auth=fid(4),location=fid(5),worker=fid(6),employment=fid(7);
  const base={siteId:emptySite,workerId:worker,fromDate:h.slot.workDate,throughDate:h.slot.workDate};
  const query=(access='owner',mode='detail',periodId=fid(100),version=null,operationId=null)=>({...base,access,mode,periodId,operationId,version});
  const newSite=`insert into public.merchants(id,user_id) values(${site},${quote(owner)});
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${site},'Synthetic timezone review',array['enterprise.view','attendance.self.view','attendance.self.request','attendance.self.export']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values(${quote(employee)},${site},${quote(auth)},'period-timezone@example.test','Synthetic empty period employee',${quote(role)},'active');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values(${site},'UTC',true,true);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values(${quote(location)},${site},'Synthetic UTC location','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
      values(${quote(worker)},${site},${quote(employee)},'TZ-EMPTY','Synthetic empty period worker',true,${quote(location)});
    insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on) values(${quote(employment)},${site},${quote(worker)},'2020-01-01');`;
  const call=(q,c=null,artifact=null,allow=false)=>`public.faolla_attendance_period_closure_v1(${json(q)},${quote(q.access==='owner'?owner:auth)},${json(c)},${json(artifact)},${allow})`;
  const command=(action,n,revision,version,fingerprint,periodId=fid(100))=>({action,operationId:fid(n),periodId,expectedRevision:revision,expectedVersion:version,expectedFingerprint:fingerprint,reason:action==='confirm'?'':'Synthetic184 timezone diagnostic'});
  function project(raw,q,cmd=null){
    const r={...raw};
    if(r.kind==='preview'){
      const projected=projectPeriodClosureSource(r.source,q),period=r.period;delete r.source;delete r.period;
      return parsePeriodClosureResult({...r,preview:{...projected,period}},q,{authUserId:q.access==='owner'?owner:auth},cmd);
    }
    assert.equal(sha(r.artifactText),r.artifactSha256);assert.equal(Buffer.byteLength(r.artifactText,'utf8'),r.artifactBytes);assert(r.artifactBytes<=2097152);
    assert.deepEqual(JSON.parse(r.artifactText),r.artifact);delete r.artifactText;delete r.artifactSha256;delete r.artifactBytes;
    return parsePeriodClosureResult(r,q,{authUserId:q.access==='owner'?owner:auth},cmd);
  }
  const results=[];
  for(const zone of ['Etc/UTC','Europe/Madrid']){
    const label=zone==='Etc/UTC'?'equivalent_alias':'changed_offset',sealed=zone==='Europe/Madrid',connection=native.connect();
    let steps=0,originalBefore;
    const step=async sql=>{assert(++steps<=30,'timezone_bounded_steps');return connection.step(scope.sql(prefix+sql));};
    const invoke=async(q,c=null,artifact=null,allow=false,readonly=c===null)=>{
      const sql=`set local role service_role;select jsonb_build_object('kind','reply','raw',${call(q,c,artifact,allow)});`;
      const rows=lines(await step(readonly?marker('before_read')+sql+marker('after_read'):sql));
      const reply=rows[readonly?1:0];assert.equal(reply.kind,'reply');
      if(readonly){assert.equal(rows.length,3);assert.equal(rows[0].kind,'before_read');assert.equal(rows[2].kind,'after_read');assert.equal(rows[0].hash,rows[2].hash,'timezone_read_or_replay_wrote');readChecks++;}
      else {assert.equal(rows.length,1);actualPeriodWrites++;}
      return {raw:reply.raw,parsed:project(reply.raw,q,c)};
    };
    const fail=async(label,q,c,a,code)=>checkFailure(lines(await step(rejectedSql(label,call(q,c,a,true),code))));
    const recover=async c=>{
      const result=await invoke(query(c.action==='confirm'?'self':'owner','recover',c.periodId,null,c.operationId));
      assert.equal(result.parsed.replayed,true);assert.deepEqual(result.parsed.operation.command,c);assert.equal(result.parsed.sourceChanged,null);return result;
    };
    try{
      const opened=lines(await step('begin;'+initial+marker('original_before',oldHash)+newSite));assert.equal(opened.length,1);originalBefore=opened[0].hash;
      const before=await invoke(query('owner','preview',null));assert.equal(before.parsed.preview.period,null);assert.deepEqual(before.parsed.preview.blockers,[]);
      const artifact=before.parsed.preview.artifact,fp=artifact.sourceFingerprint;assert.equal(artifact.period.timeZone,'UTC');
      assert.deepEqual(artifact.report.base.rows,[]);assert.deepEqual(artifact.report.missing,[]);
      const send=command('send',101,0,0,fp),confirm=command('confirm',102,1,1,fp),seal=command('seal',103,2,1,fp);
      const sent=await invoke(query(),send,artifact,true);assert.equal(sent.parsed.period.state,'review');assert.equal(sent.parsed.period.revision,1);
      const confirmed=await invoke(query('self'),confirm,null,true);assert.equal(confirmed.parsed.period.state,'confirmed');assert.equal(confirmed.parsed.period.confirmedVersion,1);
      if(sealed){const result=await invoke(query(),seal,null,true);assert.equal(result.parsed.period.sealed,true);assert.equal(result.parsed.period.revision,3);}
      const beforeOwner=await invoke(query('owner','export',fid(100),1));await invoke(query('self','export',fid(100),1));
      const config=JSON.parse(await step('set local role service_role;select '+admin(emptySite,owner,zone,fid(110),1,{enabled:true,webClockEnabled:true,webBreakPaid:false})+';'));
      actualAdminWrites++;assert.equal(config.version,2);assert.equal(config.settings.timeZone,zone);assert.equal(config.receipt.operationId,fid(110));
      const current=await invoke(query('owner','preview'));assert.equal(current.parsed.preview.period.timeZone,'UTC');
      const currentArtifact=current.parsed.preview.artifact,currentFp=currentArtifact.sourceFingerprint;
      assert.equal(currentArtifact.period.timeZone,zone);assert.notEqual(currentFp,fp);assert.deepEqual(current.parsed.preview.blockers,[]);
      if(sealed){assert(Date.parse(currentArtifact.period.startAt)<Date.parse(artifact.period.startAt));assert(Date.parse(currentArtifact.period.endAt)<Date.parse(artifact.period.endAt));}
      else {assert.equal(currentArtifact.period.startAt,artifact.period.startAt);assert.equal(currentArtifact.period.endAt,artifact.period.endAt);}
      for(const access of ['owner','self']){const detail=await invoke(query(access));assert.equal(detail.parsed.sourceChanged,true);assert.equal(detail.parsed.period.timeZone,'UTC');}
      await recover(send);await recover(confirm);
      const retry=sealed?seal:confirm;
      if(sealed)await recover(seal);
      const replay=await invoke(query(retry.action==='confirm'?'self':'owner'),retry,null,false,true);
      assert.equal(replay.parsed.replayed,true);assert.deepEqual(replay.parsed.operation.command,retry);
      let revision=sealed?3:2;
      if(sealed){
        const reopen=command('reopen',104,3,1,null),reopened=await invoke(query(),reopen,null,false);
        assert.equal(reopened.parsed.period.state,'open');assert.equal(reopened.parsed.period.sealed,false);assert.equal(reopened.parsed.period.confirmedVersion,null);assert.equal(reopened.parsed.sourceChanged,null);revision=4;
        await recover(reopen);const again=await invoke(query(),reopen,null,false,true);assert.equal(again.parsed.replayed,true);
      }else{
        await fail('fresh_confirm',query('self'),command('confirm',120,revision,1,fp),null,'attendance_period_source_changed');
        await fail('fresh_seal',query(),command('seal',121,revision,1,fp),null,'attendance_period_source_changed');
      }
      await fail('send_existing_with_fresh_artifact',query(),command('send',122,revision,1,currentFp),currentArtifact,'attendance_period_source_changed');
      await fail('send_new_overlapping_period',query('owner','detail',fid(200)),command('send',123,0,0,currentFp,fid(200)),currentArtifact,'attendance_period_overlap');
      for(const access of ['owner','self']){
        const saved=await invoke(query(access,'export',fid(100),1));assert.equal(saved.parsed.sourceChanged,null);assert.equal(saved.parsed.period.revision,revision);
        assert.equal(saved.raw.artifactText,beforeOwner.raw.artifactText);assert.equal(saved.raw.artifactSha256,beforeOwner.raw.artifactSha256);assert.equal(saved.raw.artifactBytes,beforeOwner.raw.artifactBytes);
        assert.deepEqual(saved.parsed.artifact,artifact);assert.equal(saved.parsed.period.timeZone,'UTC');assert.equal(saved.parsed.period.startAt,artifact.period.startAt);assert.equal(saved.parsed.period.endAt,artifact.period.endAt);
      }
      const last=lines(await step(`do $timezone_empty$ begin
        assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${site}),'timezone_no_event_bypass';
        assert (select time_zone from public.merchant_attendance_settings where merchant_id=${site})=${quote(zone)},'timezone_settings_changed_by064';
        assert (select time_zone from public.merchant_attendance_locations where merchant_id=${site} and id=${quote(location)})='UTC','timezone_location_not_settings';
        assert (select count(*) from public.merchant_attendance_period_closures where merchant_id=${site})=1,'timezone_no_overlapping_head_written';
        assert (select current_version from public.merchant_attendance_period_closures where merchant_id=${site})=1,'timezone_no_failed_new_version';
      end;$timezone_empty$;`+marker('original_after',oldHash)+'set constraints all immediate;rollback;'));
      assert.equal(last.length,1);assert.equal(last[0].hash,originalBefore,'timezone_changed_original_site_rows');
      results.push({zone,settingsVersion:2,locationTimeZone:'UTC',sameUtcBounds:!sealed,sourceChanged:true,
        fixedArtifactSha256:beforeOwner.raw.artifactSha256,fixedArtifactBytes:beforeOwner.raw.artifactBytes,originalOperationRecovery:true,
        sealedBeforeChange:sealed,reopenWithAllowWriteFalse:sealed,headStillOriginalUtc:true,newSendError:'attendance_period_source_changed',newPeriodError:'attendance_period_overlap',steps});
    }catch(error){throw new Error('period_timezone_diagnostic:'+label+':'+String(error?.message??error),{cause:error});}
    finally{await connection.close();restore(label);}
  }
  assert.equal(readChecks,25);assert.equal(failedChecks,8);assert.equal(actualAdminWrites,2);assert.equal(actualPeriodWrites,6);
  return {diagnosticOnly:true,readerVersion:'154',groups:3,historyProtectedErrors:2,scenarios:results,readChecks,failedChecks,actualAdminWrites,actualPeriodWrites,
    outerRollbackTransactions:3,allReadsAndFailuresZeroWrites:true,allOriginalRowsUnchanged:true,allFactsDefinitionsCatalogRestored:true,
    real064TimezoneChanges:true,syntheticEmptyMerchant:true,settingsUpdateBypass:false,locationTimezoneChanged:false,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Existing event-bearing merchant uses actual064 rejected changes. Two independent rollback-only empty-merchant fixtures use actual149 preview, genuine Node projection, send/confirm/seal/reopen and actual064 timezone changes. No original merchant setting change, deleted events, migration, guard bypass, tzdata-upgrade simulation, real account or deployment.'};
}
