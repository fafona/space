import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import revision from '../src/lib/merchantAttendanceRevision.ts';
import reports from '../src/lib/merchantAttendanceTimesheet.ts';
import scoped from '../src/lib/merchantAttendanceScopedTimesheet.ts';
import exports from '../src/lib/merchantAttendanceTimesheetExport.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
async function check(context){
  const {query,connect,root,pass}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql','202610010090_merchant_attendance_period_export.sql','202610010091_merchant_attendance_revision_requests.sql','202610010092_merchant_attendance_revision_review.sql','202610010093_merchant_attendance_versioned_reports.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    const site='99990009',owner=id(1),auth=id(2),employee=id(3),role=id(4),worker=id(5),loc=id(6),oldRequest=id(7),oldOperation=id(8),other=id(9),otherAuth=id(10);
    const day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10),at=(n,h)=>day(n)+'T'+h+':00.000000Z';
    const approved={startAt:at(4,'08:00'),endAt:at(4,'17:00'),breaks:[]},proposed={startAt:at(2,'08:00'),endAt:at(2,'15:00'),breaks:[]};
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${owner}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${loc}','${site}','Synthetic location','Europe/Madrid');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Self',array['enterprise.view','attendance.self.view','attendance.self.request']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${employee}','${site}','${auth}','revision@example.test','Synthetic self','${role}','active'),('${other}','${site}','${otherAuth}','revision-other@example.test','Other self','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name) values('${worker}','${site}','${employee}','REVISION','Synthetic worker');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
        ('${id(101)}','${site}','${worker}','${loc}','${id(201)}',1,'clock_in','web','${at(3,'08:00')}','Europe/Madrid','${employee}'),
        ('${id(102)}','${site}','${worker}','${loc}','${id(202)}',2,'clock_out','web','${at(3,'16:00')}','Europe/Madrid','${employee}');commit;`);
    const controls=(command)=>JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(command)},null,null,true);`));
    let controlsRevision=0,policyRevision=1,nonce=300;
    const control=(action,fields)=>{const op=id(nonce++);controls({action,operationId:op,expectedRevision:controlsRevision,expectedSettingsVersion:1,reason:'Synthetic revision rules',...fields});controlsRevision++;return op;};
    control('set_policy',{submissionWindowDays:365});
    exec(`set role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:oldRequest,operationId:null})},${json({action:'submit',operationId:oldRequest,expectedRevision:0,expectedPolicyRevision:1,reason:'Initial synthetic declaration',startEventId:id(101),expectedLastEventId:id(102),proposal:approved})},true);`);
    const oldEvidence=JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${oldRequest}',null,null,true);`));assert.equal(oldEvidence.canApprove,true);
    exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${oldRequest}',${json({action:'approve',operationId:oldOperation,requestId:oldRequest,expectedRevision:1,expectedEvidence:oldEvidence.evidenceToken,reason:'Initial synthetic approval'})},null,true);`);
    const prepare={siteId:site,mode:'prepare',expectedWorkerId:worker,baseRequestId:oldRequest,requestId:null,operationId:null};
    const detail=(requestId,operationId=null)=>({...prepare,mode:'detail',requestId,operationId});
    const submit=(expectedRevision)=>({action:'submit',operationId:id(nonce++),expectedRevision,expectedBaseOperationId:oldOperation,expectedPolicyRevision:policyRevision,reason:'Request another review',proposal:proposed});
    const call=(q=prepare,c=null,who=auth,enabled=true)=>`public.faolla_attendance_revision_self_v1('${q.siteId}','${who}',${json({mode:q.mode,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,requestId:q.requestId,operationId:q.operationId})},${c?json(c):'null'},${enabled})`;
    const read=(q=prepare,c=null,who=auth,enabled=true)=>revision.parseAttendanceRevisionResult(JSON.parse(exec(`set role service_role;select ${call(q,c,who,enabled)};`)),{...q,operationId:c?.operationId??q.operationId});
    const send=(c,enabled=true)=>read(detail(c.action==='submit'?c.operationId:c.requestId),c,auth,enabled);
    const fingerprint=()=>exec(`select jsonb_build_object(${['events','correction_entries','correction_decisions','correction_effects','correction_rule_bindings'].map(t=>`'${t}',(select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) from public.merchant_attendance_${t} t)`).join(',')});`);
    const requested=submit(0);send(requested);
    const sourceBefore=fingerprint(),revisionBefore=exec('select md5(jsonb_agg(to_jsonb(t) order by revision)::text) from public.merchant_attendance_revision_requests t;');
    const manager=id(21),managerAuth=id(22),managerRole=id(23),grant=id(24),versionOperation=id(25);
    exec(`begin;
      update public.merchant_enterprise_roles set permissions=permissions||array['attendance.self.export'] where id='${role}';
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${managerRole}','${site}','Manager',array['enterprise.view','attendance.records.view','attendance.reports.export']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
        values('${manager}','${site}','${managerAuth}','versions-manager@example.test','Synthetic manager','${managerRole}','active');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${manager}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager}','${grant}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${grant}','${worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${grant}','${loc}');commit;`);
    const ownerQuery=(n=2)=>({siteId:site,workerId:worker,fromDate:day(n),throughDate:day(n)});
    const reportSql=(q=ownerQuery(),version=2,who=owner)=>`public.faolla_attendance_period_report_v${version}('${q.siteId}','${who}',${json({workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate})})`;
    const report=(q=ownerQuery(),version=2,who=owner)=>reports.parseAttendanceTimesheetResult(JSON.parse(exec(`set role service_role;select ${reportSql(q,version,who)};`)),q,`raw-and-approved-v${version}`);
    const initial=report(ownerQuery(4));assert.equal(initial.rows[0].correction.revision,1);assert.equal(initial.totals.selected.workedUs,9*3600000000);
    assert.deepEqual(initial.totals,report(ownerQuery(4),1).totals);assert.equal(initial.rows[0].correction.lineage.previousOperationId,null);
    pass('v2 initial-only source matches existing v1 hours with explicit immutable root lineage');
    // Synthetic storage fixture, NOT an application approval. 093 grants no
    // approval writer; the sandbox schema owner alone seeds this candidate node.
    const insert=(patch={})=>{
      const n={revision:2,root:oldRequest,worker,start:id(101),request:requested.operationId,operation:versionOperation,previous:oldOperation,requestRevision:1,policyRevision:1,...patch};
      return `insert into public.merchant_attendance_effect_versions(merchant_id,root_request_id,worker_id,start_event_id,revision,request_id,operation_id,previous_operation_id,actor_auth_user_id,request_revision,evidence_token,reason,recorded_at,policy_revision)
        values('${site}','${n.root}','${n.worker}','${n.start}',${n.revision},'${n.request}','${n.operation}','${n.previous}','${owner}',${n.requestRevision},repeat('a',32),'Synthetic storage node only',clock_timestamp(),${n.policyRevision});`;
    };
    const count=()=>exec('select count(*) from public.merchant_attendance_effect_versions;');
    for(const patch of [{revision:3},{previous:id(99)},{root:id(99)},{worker:id(99)},{start:id(102)},{request:id(99)},{requestRevision:2},{policyRevision:2},{operation:oldOperation},{operation:requested.operationId}])
      assert.throws(()=>exec(insert(patch)),/attendance_effect_version_|attendance_operation_conflict/);
    assert.equal(count(),'0');assert.equal(fingerprint(),sourceBefore);
    pass('storage guard rejects revision gaps, wrong predecessor/root/worker/event/request/policy and operation collision');
    const withdrawal={action:'withdraw',operationId:id(nonce++),requestId:requested.operationId,expectedRevision:1,reason:'Synthetic pending race'};
    assert.throws(()=>exec(`begin;set local role service_role;select ${call(detail(requested.operationId),withdrawal)};reset role;${insert()}rollback;`),/attendance_effect_version_invalid/);
    assert.equal(fingerprint(),sourceBefore);assert.equal(count(),'0');
    pass('withdrawn request cannot seed a version; failed synthetic transaction rolls back');
    for(const name of ['anon','authenticated','service_role']){
      assert.throws(()=>exec(`set role ${name};${insert()}`),/permission denied/);
      for(const table of ['merchant_attendance_effect_versions','merchant_attendance_effect_current_v2'])assert.throws(()=>exec(`set role ${name};select * from public.${table};`),/permission denied/);
      assert.throws(()=>exec(`set role ${name};select public.faolla_attendance_effect_evidence_v2(null,clock_timestamp());`),/permission denied/);
    }
    for(const name of ['anon','authenticated'])assert.throws(()=>exec(`set role ${name};select ${reportSql()};`),/permission denied/);
    pass('all application roles denied journal writes/direct source access; internal evidence helper stays private');
    await race('begin;'+insert(),`set role service_role;select ${reportSql()};`,o=>{
      assert(!o.error,String(o.error));const r=reports.parseAttendanceTimesheetResult(JSON.parse(o.output),ownerQuery(),'raw-and-approved-v2');
      assert.equal(r.rows.length,1);assert.equal(r.totals.selected.workedUs,7*3600000000);
    });
    assert.equal(count(),'1');pass('v2 reader waits for exact synthetic version transaction PID and sees committed latest hours');
    const current=report();assert.equal(current.rows.length,1);assert.equal(current.totals.original.workedUs,0);assert.equal(current.totals.selected.workedUs,7*3600000000);
    assert.equal(current.rows[0].correction.operationId,versionOperation);assert.equal(current.rows[0].correction.lineage.rootOperationId,oldOperation);
    assert.equal(current.rows[0].correction.lineage.previousOperationId,oldOperation);assert.equal(current.rows[0].correction.revision,2);
    assert.equal(report(ownerQuery(4)).rows.length,0);const rawPeriod=report(ownerQuery(3));assert.equal(rawPeriod.totals.original.workedUs,8*3600000000);assert.equal(rawPeriod.totals.selected.workedUs,0);
    const fullQuery={...ownerQuery(),fromDate:day(5),throughDate:day(1)},full=report(fullQuery);
    assert.equal(full.rows.length,1);assert.equal(full.totals.original.workedUs,8*3600000000);assert.equal(full.totals.selected.workedUs,7*3600000000);
    pass('latest moved-in date counted once, superseded date omitted, raw date independently retained; no double count');
    assert.throws(()=>report(fullQuery,1),/attendance_report_version_required/);assert.throws(()=>read(),/attendance_report_version_required/);
    assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_revision_owner_review_v1('${site}','${owner}','${requested.operationId}');`),/attendance_report_version_required/);
    assert.throws(()=>report(fullQuery,2,auth),/attendance_access_denied/);assert.throws(()=>report({...fullQuery,siteId:'99990008'}),/attendance_settings_required/);
    pass('legacy report/revision paths fail closed; current owner and cross-tenant boundaries unchanged');
    const scopedQuery=access=>({siteId:site,access,fromDate:fullQuery.fromDate,throughDate:fullQuery.throughDate,...(access==='self'?{expectedWorkerId:worker}:{workerId:worker,locationId:loc})});
    const scopedSql=(access,version=2)=>{const q=scopedQuery(access),{siteId,...rest}=q;return `public.faolla_attendance_scoped_period_report_v${version}('${siteId}','${access==='self'?auth:managerAuth}',${json({workerId:null,locationId:null,expectedWorkerId:null,...rest})})`;};
    for(const access of ['self','manager']){
      const r=scoped.parseAttendanceScopedTimesheetResult(JSON.parse(exec(`set role service_role;select ${scopedSql(access)};`)),scopedQuery(access),'raw-and-approved-v2');
      assert.deepEqual(r.totals,full.totals);assert.equal(r.rows[0].correction.revision,2);assert.equal('employeeId' in r,false);
      assert.throws(()=>exec(`set role service_role;select ${scopedSql(access,1)};`),/attendance_report_version_required/);
    }
    pass('owner/self/manager agree on current hours; scoped privacy and legacy denial retained');
    // Rebinding cannot reveal an old employee's version, even via a legacy error.
    exec(`update public.merchant_attendance_workers set employee_id='${other}' where id='${worker}';`);
    for(const version of [1,2]){
      const raw=JSON.parse(exec(`set role service_role;select ${scopedSql('self',version).replace(auth,otherAuth)};`));assert.equal(raw.items.length,0);
    }
    assert.throws(()=>read(prepare,null,otherAuth),/attendance_revision_base_not_found/);
    exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);
    const hiddenLoc=id(26),hiddenGrant=id(27);
    exec(`begin;insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${hiddenLoc}','${site}','Other location','Europe/Madrid');
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager}','${hiddenGrant}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${hiddenGrant}','${worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${hiddenGrant}','${hiddenLoc}');commit;`);
    for(const version of [1,2])assert.equal(JSON.parse(exec(`set role service_role;select ${scopedSql('manager',version).replace(loc,hiddenLoc)};`)).items.length,0);
    pass('rebound self and separately authorized foreign location see no revision data or legacy-version existence hint');
    const exportCommand=access=>({siteId:site,operationId:id(nonce++),query:{access,workerId:access==='self'?null:worker,locationId:access==='manager'?loc:null,expectedWorkerId:access==='self'?worker:null,
      fromDate:fullQuery.fromDate,throughDate:fullQuery.throughDate,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:access==='manager'?1:null}});
    const exportSql=(c,version=2)=>`public.faolla_attendance_period_export_v${version}('${site}','${c.query.access==='owner'?owner:c.query.access==='self'?auth:managerAuth}','${c.operationId}',${json(c.query)})`;
    const commands=['owner','self','manager'].map(exportCommand);
    for(const c of commands){
      const raw=JSON.parse(exec(`set role service_role;select ${exportSql(c)};`)),r=exports.parseTimesheetExportSource(raw,c,'raw-and-approved-v2');
      assert.equal(r.report.totals.selected.workedUs,7*3600000000);assert.equal(r.receipt.downloadConfirmed,false);
      const csv=exports.buildTimesheetExportCsv(r.report,r.receipt);assert(csv.includes('lineage.rootOperationId'));assert(csv.includes(versionOperation));assert(csv.includes(oldOperation));assert(!csv.includes('[object Object]'));
      const replay=exports.parseTimesheetExportSource(JSON.parse(exec(`set role service_role;select ${exportSql(c)};`)),c,'raw-and-approved-v2');
      assert.equal(replay.report,null);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,r.receipt);
      assert.throws(()=>exec(`set role service_role;select ${exportSql(c,1)};`),/attendance_report_version_required/);
      assert.throws(()=>exec(`set role service_role;select ${exportSql({...c,operationId:id(nonce++)},1)};`),/attendance_report_version_required/);
    }
    assert.equal(exec('select count(*) from public.merchant_attendance_report_exports;'),'3');
    pass('three v2 exports generate CSV in memory with source lineage; v2 receipt-only replay; legacy exports cannot return old hours');
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.records.view'] where id='${managerRole}';`);
    assert.throws(()=>exec(`set role service_role;select ${exportSql(commands[2])};`),/attendance_export_denied/);
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.reports.export'] where id='${managerRole}';`);
    await race(`begin;update public.merchant_attendance_scopes set revision=2 where merchant_id='${site}' and employee_id='${manager}';delete from public.merchant_attendance_scope_grants where merchant_id='${site}' and id='${grant}';`,`set role service_role;select ${scopedSql('manager')};`,o=>assert.match(String(o.error),/attendance_access_denied/));
    pass('export replay rechecks independent permission; concurrent scope revoke hides current-version report');
    for(const statement of ["update public.merchant_attendance_effect_versions set reason='rewrite'",'delete from public.merchant_attendance_effect_versions','truncate public.merchant_attendance_effect_versions'])
      assert.throws(()=>exec(statement),/append.only|immutable/i);
    assert.throws(()=>exec(insert()),/attendance_effect_version_conflict/);assert.equal(count(),'1');assert.equal(fingerprint(),sourceBefore);
    assert.equal(exec('select md5(jsonb_agg(to_jsonb(t) order by revision)::text) from public.merchant_attendance_revision_requests t;'),revisionBefore);
    pass('no journal rewrite/fork; original clock/approval/request ledgers byte-for-byte unchanged');
    const oldWriter=connect();
    try{
      await oldWriter.step(sql(`begin;insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
        ('${id(103)}','${site}','${worker}','${loc}','${id(203)}',3,'clock_in','web','${at(1,'08:00')}','Europe/Madrid','${employee}'),
        ('${id(104)}','${site}','${worker}','${loc}','${id(204)}',4,'clock_out','web','${at(1,'16:00')}','Europe/Madrid','${employee}');`));
      const another=id(nonce++),proposal={startAt:at(1,'08:00'),endAt:at(1,'15:00'),breaks:[]};
      await oldWriter.step(sql(`set local role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:another,operationId:null})},${json({action:'submit',operationId:another,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic legacy request',startEventId:id(103),expectedLastEventId:id(104),proposal})},true);`));
      const preflight=JSON.parse(await oldWriter.step(sql(`select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${another}',null,null,true);`)));
      await assert.rejects(oldWriter.step(sql(`select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${another}',${json({action:'approve',operationId:id(nonce++),requestId:another,expectedRevision:1,expectedEvidence:preflight.evidenceToken,reason:'Synthetic old writer'})},null,true);`)),/attendance_report_version_required/);
    }finally{await oldWriter.close();}
    assert.equal(fingerprint(),sourceBefore);
    pass('legacy first-approval writer cannot ignore another shift revised version; synthetic probe rolled back');
    async function race(hold,waiting,check){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));await holder.step(sql(hold));
        pending=reader.step(sql(waiting)).then(output=>({output}),error=>({error}));let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert(blocked);await holder.step('commit;');await check(await pending);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
  });
  pass('owned synthetic namespace removed and existing baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
