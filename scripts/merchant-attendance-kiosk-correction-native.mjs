// Local synthetic compatibility only: no PIN clock writer, production or new cluster.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
const require=createRequire(import.meta.url);
const {parseCorrectionResult}=require('../src/lib/merchantAttendanceCorrection.ts');
const {parseCurrentCorrectionDecision}=require('../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
const {parseRevisionCycleResult}=require('../src/lib/merchantAttendanceRevisionCycle.ts');
const {parseRevisionApprovalResult}=require('../src/lib/merchantAttendanceRevisionApproval.ts');
const {parseUnifiedSource}=require('../src/lib/merchantAttendanceUnifiedTimesheet.ts');
const {parseUnifiedExportSource,buildUnifiedExportCsv}=require('../src/lib/merchantAttendanceUnifiedExport.ts');
const {summarizeAttendanceSessionRecords}=require('../src/lib/merchantAttendanceSession.ts');
export const kioskJson=v=>v===null?'null':"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
export async function checkKioskCorrection(native,browserCheck=null){
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const {query,root,pass}=native,exec=s=>query(sql(s)),json=kioskJson;
    const folder=path.join(root,'scripts/supabase-migrations');
    const migrations=readdirSync(folder).filter(n=>/^\d{12}_/.test(n)&&((Number(n.slice(0,12))>=202609300087&&Number(n.slice(0,12))<=202610010104)||/^2026093000(68|79)_/.test(n))).sort();
    assert.equal(migrations.length,20);
    for(const name of migrations)exec(readFileSync(path.join(folder,name),'utf8'));
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='99990001',owner=id(99),auth=id(1),employee=id(101),worker=id(201),location=id(301),role=id(30);
    const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10),at=(n,h)=>day(n)+'T'+String(h).padStart(2,'0')+':00:00.000000Z';
    exec(`insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990002','${id(98)}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${location}','${site}','合成门店','UTC');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Self',array['enterprise.view','attendance.self.view','attendance.self.request']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
        ('${employee}','${site}','${auth}','kiosk@example.test','合成测试员工','${role}','active'),
        ('${id(102)}','${site}','${id(2)}','other@example.test','其他员工','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name) values('${worker}','${site}','${employee}','SYN-01','合成测试员工');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');`);
    const patterns=[['web','web'],['kiosk','kiosk'],['kiosk','web'],['web','kiosk'],['kiosk','web']];
    for(let n=0;n<patterns.length;n++)for(let j=0;j<2;j++)exec(`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
      values('${id(1000+n*2+j)}','${site}','${worker}','${location}','${id(2000+n*2+j)}',${1+n*2+j},'${j?'clock_out':'clock_in'}','${patterns[n][j]}','${at(n-5,j?16:8)}','UTC','${employee}');`);
    const raw=()=>exec('select md5(jsonb_agg(to_jsonb(e) order by sequence)::text) from public.merchant_attendance_events e;'),rawBefore=raw();
    const prepare=start=>({siteId:site,expectedWorkerId:worker,mode:'prepare',startEventId:start});
    const call=(q,c=null,who=auth,allow=true)=>{const {siteId,...rest}=q;return `public.faolla_attendance_correction_self_v3('${siteId}','${who}',${json(rest)},${json(c)},${allow})`;};
    const self=(q,c=null,who=auth,allow=true)=>parseCorrectionResult(JSON.parse(exec(`set role service_role;select ${call(q,c,who,allow)};`)),c?{...q,operationId:c.operationId}:q,true,true);
    assert.equal(self(prepare(id(1000))).basis.events[0].source,'web');
    assert.throws(()=>self(prepare(id(1002))),/attendance_correction_unsupported_basis/);
    const migration=readFileSync(path.join(folder,'202610010105_merchant_attendance_kiosk_correction_basis.sql'),'utf8');
    exec(migration);exec(migration);assert.equal(raw(),rawBefore);
    for(const name of ['anon','authenticated','service_role']){
      assert.throws(()=>exec(`set role ${name};select public.faolla_attendance_correction_basis_v1('${site}','${auth}','${id(1002)}','${worker}','${employee}');`),/permission denied/);
      assert.throws(()=>exec(`set role ${name};select public.faolla_attendance_correction_owner_basis_v1('${site}','${worker}','${employee}','${id(1002)}',clock_timestamp());`),/permission denied/);
    }
    pass('actual old migration rejects kiosk; additive 105 enables same-member sources, is repeatable, preserves raw rows and private helper ACL');
    const controls={action:'set_policy',operationId:id(400),expectedRevision:0,expectedSettingsVersion:1,submissionWindowDays:30,reason:'Synthetic policy'};
    exec(`set role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(controls)},null,null,true);`);
    const detail=rid=>({siteId:site,expectedWorkerId:worker,mode:'detail',requestId:rid,operationId:null});
    const decision=(rid,c=null)=>parseCurrentCorrectionDecision(JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v2('${site}','${owner}','${rid}',${json(c)},null,true);`)),{siteId:site,requestId:rid,operationId:c?.operationId??null});
    const approve=(rid,operationId=id(5000+Number(rid.slice(-4))))=>{const r=decision(rid);assert.equal(r.canApprove,true);return decision(rid,{action:'approve',operationId,requestId:rid,expectedRevision:1,expectedEvidence:r.evidenceToken,reason:'Synthetic approval'});};
    const currentIds=[];
    for(let n=0;n<4;n++){
      const start=id(1000+n*2),rid=id(3000+n),q=prepare(start),p=self(q);
      assert.deepEqual(p.basis.events.map(e=>e.source),patterns[n]);
      const c={action:'submit',operationId:rid,expectedRevision:p.revision,expectedPolicyRevision:1,startEventId:start,expectedLastEventId:id(1001+n*2),reason:'Synthetic correction',proposal:{startAt:at(n-5,8),endAt:at(n-5,17),breaks:[]}};
      assert.equal(self(detail(rid),c).item.status,'submitted');
      const approved=approve(rid);assert.equal(approved.current.workedUs,9*3600000000);
      assert.deepEqual(approved.review.application.basis.events.map(e=>e.source),patterns[n]);
      const rq={siteId:site,mode:'prepare',expectedWorkerId:worker,baseRequestId:rid,requestId:null,operationId:null};
      const cycle=(query=rq,command=null)=>{const {siteId,...r}=query;return parseRevisionCycleResult(JSON.parse(exec(`set role service_role;select public.faolla_attendance_revision_self_v2('${siteId}','${auth}',${json(r)},${json(command)},true);`)),{...query,operationId:command?.operationId??query.operationId});};
      let current=cycle();
      for(let step=0;step<2;step++){
        const revisionId=id(4000+n*10+step),rc={action:'submit',operationId:revisionId,expectedRevision:current.revision,expectedBaseOperationId:approved.current.operationId,expectedEffectiveOperationId:current.current.operationId,expectedPolicyRevision:1,reason:'Synthetic next revision',proposal:{...c.proposal,endAt:at(n-5,18+step)}};
        const dq={...rq,mode:'detail',requestId:revisionId};assert.equal(cycle(dq,rc).item.status,'submitted');
        const review=(command=null)=>parseRevisionApprovalResult(JSON.parse(exec(`set role service_role;select public.faolla_attendance_revision_decide_v2('${site}','${owner}','${revisionId}',${json(command)},null,true);`)),{siteId:site,requestId:revisionId,operationId:command?.operationId??null});
        const inspected=review();assert.equal(inspected.canApprove,true);
        const dc={action:'approve',operationId:id(6000+n*10+step),requestId:revisionId,expectedRevision:inspected.review.submittedRevision,expectedEvidence:inspected.evidenceToken,expectedBaseOperationId:inspected.current.operationId,reason:'Synthetic revised approval'};
        assert.equal(review(dc).current.revision,step+2);current=cycle();
      }
      currentIds.push(current.current.operationId);assert.equal(current.current.workedUs,11*3600000000);
      assert.equal(decision(rid).current.operationId,current.current.operationId);
      assert.deepEqual(self(detail(rid)).basis.events.map(e=>e.source),patterns[n]);
    }
    pass('web, kiosk and both mixed orders complete self prepare/submit, first approval, two successive revisions and historical/current reads without relabeling');
    const reportQ={siteId:site,access:'owner',workerId:worker,fromDate:day(-6),throughDate:day(0)};
    const wire={access:'owner',workerId:worker,fromDate:reportQ.fromDate,throughDate:reportQ.throughDate};
    const report=parseUnifiedSource(JSON.parse(exec(`set role service_role;select public.faolla_attendance_unified_report_v1('${site}','${owner}',${json(wire)});`)),reportQ);
    assert.equal(report.totals.original.workedUs,40*3600000000);assert.equal(report.totals.selected.workedUs,52*3600000000);
    const exportQ={siteId:site,operationId:id(9000),query:{...wire,locationId:null,expectedWorkerId:null,expectedTimeZone:'UTC',expectedScopeRevision:null}};
    const exported=parseUnifiedExportSource(JSON.parse(exec(`set role service_role;select public.faolla_attendance_unified_export_v1('${site}','${owner}','${exportQ.operationId}',${json(exportQ.query)});`)),exportQ);
    assert.equal(exported.report.totals.selected.workedUs,report.totals.selected.workedUs);
    const csv=buildUnifiedExportCsv(exported.report,exported.receipt);for(const operation of currentIds)assert(csv.includes(operation));
    assert.equal(raw(),rawBefore);pass('latest unified report/CSV count approved hours once; every original event and source remains byte-identical');
    const deny=(expression,code,prep='')=>exec(`begin;${prep}do $deny$ begin begin perform ${expression};raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;end $deny$;rollback;`);
    const basis=`public.faolla_attendance_correction_basis_v1('${site}','${auth}','${id(1010)}','${worker}','${employee}')`;
    const ownerBasis=member=>`public.faolla_attendance_correction_owner_basis_v1('${site}','${worker}',${member},'${id(1010)}',clock_timestamp())`;
    for(const actor of ['null',`'${id(102)}'`]){
      const prep=`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
        values('${id(1010)}','${site}','${worker}','${location}','${id(2010)}',11,'clock_in','kiosk','${at(-1,20)}','UTC',${actor});`;
      deny(basis,'attendance_correction_unsupported_basis',prep);deny(ownerBasis(`'${employee}'`),'attendance_correction_unsupported_basis',prep);
      deny(ownerBasis('null'),'attendance_correction_unsupported_basis',prep);
    }
    const breakFixture=(middleActor=`'${employee}'`)=>['clock_in','break_start','break_end','clock_out'].map((action,n)=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id,break_paid)
      values('${id(1010+n)}','${site}','${worker}','${location}','${id(2010+n)}',${11+n},'${action}','${n%2?'web':'kiosk'}','${at(-1,20+n)}','UTC',${n===2?middleActor:`'${employee}'`},${n===1?'false':'null'});`).join('\n');
    const mixedBreak=JSON.parse(exec(`begin;${breakFixture()}select jsonb_build_object('self',${basis},'owner',${ownerBasis(`'${employee}'`)});rollback;`));
    assert.deepEqual(mixedBreak.self.events.map(e=>e.source),['kiosk','web','kiosk','web']);
    assert.deepEqual(mixedBreak.owner.currentBasis.events,mixedBreak.self.events);
    assert.equal(summarizeAttendanceSessionRecords(mixedBreak.self).totals.workedUs,2*3600000000);
    for(const actor of ['null',`'${id(102)}'`]){
      deny(basis,'attendance_correction_unsupported_basis',breakFixture(actor));
      deny(ownerBasis(`'${employee}'`),'attendance_correction_unsupported_basis',breakFixture(actor));
    }
    pass('mixed web/kiosk break transitions preserve two hours worked; identity checked on every action, including middle-of-session records');
    deny(call(prepare(id(1002)),null,id(2)),'attendance_access_denied');
    deny(call(prepare(id(1002))), 'attendance_access_denied',`update public.merchant_enterprise_employees set status='disabled' where id='${employee}';`);
    deny(call(prepare(id(1002))), 'attendance_access_denied',`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';`);
    pass('null actor, other member, different login, disabled membership and removed view permission remain rejected by actual SQL');
    const fresh={action:'submit',operationId:id(9100),expectedRevision:0,expectedPolicyRevision:1,startEventId:id(1008),expectedLastEventId:id(1009),reason:'Synthetic pending',proposal:{startAt:at(-1,8),endAt:at(-1,17),breaks:[]}};
    deny(call(detail(fresh.operationId),fresh,auth,false),'attendance_platform_paused');
    deny(call(detail(fresh.operationId),fresh),'attendance_access_denied',`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';`);
    pass('module pause and request permission still block new kiosk correction submissions');
    if(browserCheck)await browserCheck({...native,exec,id,site,owner,auth,employee,worker,location,day,at,patterns,prepare,detail,self,approve,raw,rawBefore});
    assert.equal(raw(),rawBefore);
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAttendanceLabelsReuse(process.argv.slice(2),checkKioskCorrection);
