import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { withAttendanceConcurrencySandbox } from './merchant-attendance-concurrency-sandbox.mjs';
const require = createRequire(import.meta.url);
const { parseMissingResult } = require('../src/lib/merchantAttendanceMissing.ts');
export const missingId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
export async function checkAttendanceMissing(native, browserCheck = null, { revisions = false } = {}) {
  const { root, query, pass, connect } = native, id = missingId, site = '99990001', owner = id(99), employee = id(1), worker = id(201), location = id(301);
  await withAttendanceConcurrencySandbox(native, async ({ sql }) => {
    const exec = source => query(sql(source));
    const folder = path.join(root, 'scripts/supabase-migrations');
    const extras = readdirSync(folder).filter(name => /^2026\d{8}_/.test(name) && Number(name.slice(0, 12)) >= 202609300087 && Number(name.slice(0, 12)) <= 202610010100).sort();
    assert.equal(extras.length, 14);
    for (const file of extras) exec(readFileSync(path.join(folder, file), 'utf8'));
    if (revisions) for (const file of ['202610010101_merchant_attendance_unified_report.sql', '202610010102_merchant_attendance_unified_export.sql', '202610010103_merchant_attendance_missing_revisions.sql']) exec(readFileSync(path.join(folder, file), 'utf8'));
    const today = exec("select (clock_timestamp() at time zone 'UTC')::date;");
    const day = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    exec(`begin;insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990002','${id(98)}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Synthetic',array['enterprise.view','attendance.self.view','attendance.self.request']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(101)}','${site}','${employee}','missing-a@example.invalid','漏卡员工甲','${id(30)}','active'),('${id(102)}','${site}','${id(2)}','missing-b@example.invalid','漏卡员工乙','${id(30)}','active');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','测试门店','UTC',true);
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ('${worker}','${site}','${id(101)}','A01','漏卡员工甲',true,'${location}'),('${id(202)}','${site}','${id(102)}','B01','漏卡员工乙',true,'${location}');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01'),('${site}','${id(202)}','2000-01-01');commit;`);
    const policy = { action: 'set_policy', operationId: id(390), expectedRevision: 0, expectedSettingsVersion: 1, reason: '合成期限规则', submissionWindowDays: 30 };
    exec(`set role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(policy)},null,null,true);`);
    const q = { siteId: site, access: 'self', fromDate: day(-30), throughDate: today, requestId: null, operationId: null, beforeAt: null, beforeId: null };
    const own = { ...q, access: 'owner' };
    const proposal = n => ({ startAt: `${day(n)}T09:00:00.000000Z`, endAt: `${day(n)}T17:00:00.000000Z`, breaks: [{ startAt: `${day(n)}T12:00:00.000000Z`, endAt: `${day(n)}T13:00:00.000000Z`, paid: false }] });
    const cmd = { operationId: id(401), reason: '整段忘记打卡', action: 'submit', expectedWorkerId: worker, expectedSettingsVersion: 1, expectedPolicyRevision: 1, locationId: location, timeZone: 'UTC', proposal: proposal(-1) };
    const call = (qArg = q, c = null, who = employee, allow = true) => `public.faolla_attendance_missing_v1(${json(qArg)},'${who}',${c ? json(c) : 'null'},${allow})`;
    const run = (qArg = q, c = null, who = employee, allow = true) => parseMissingResult({ ...JSON.parse(exec(`begin;set local role service_role;select ${call(qArg,c,who,allow)};commit;`)), moduleEnabled: allow }, { ...qArg, operationId: c?.operationId ?? qArg.operationId });
    const reject = (qArg, c, code, who = employee, allow = true, preparation = '') => exec(`begin;${preparation}set local role service_role;do $check$ begin begin perform ${call(qArg,c,who,allow)};raise exception 'unexpected acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;end $check$;rollback;`);
    assert.equal(run().items.length, 0); assert.equal(run().canRequest, true); assert.equal(run(own,null,owner).canRequest, false);
    reject(own,null,'attendance_access_denied'); reject({ ...q, siteId: '99990002' },null,'attendance_settings_required');
    reject(q,cmd,'attendance_platform_paused',employee,false);
    pass('missing request context is read-only, owner/self isolated and writes platform gated');
    const first = run(q,cmd); assert.equal(first.detail.status,'submitted'); assert.equal(first.detail.proposal.breaks.length,1); assert.equal(first.includedInTimesheet,false);
    assert.equal(run(q,cmd,employee,false).receipt.operationId,cmd.operationId);
    assert.equal(run({ ...q, operationId: cmd.operationId }).detail.requestId,cmd.operationId);
    reject(q,{...cmd,reason:'different'},'attendance_operation_conflict'); reject(q,{...cmd,operationId:id(402)},'attendance_missing_conflict');
    reject({ ...q, requestId: cmd.operationId },null,'attendance_access_denied',id(2)); assert.equal(run(q,null,id(2)).items.length,0);
    pass('whole-missing declaration does not require a punch; replay/receipt and overlapping pending protection');
    reject(q,{...cmd,operationId:id(403),proposal:proposal(-31)},'attendance_correction_window_expired');
    reject(q,{...cmd,operationId:id(403),proposal:proposal(1)},'attendance_invalid_request');
    reject(q,{...cmd,operationId:id(403),expectedPolicyRevision:2},'attendance_correction_policy_changed');
    reject(q,{...cmd,operationId:id(403),expectedWorkerId:id(202)},'attendance_worker_changed');
    reject(q,{...cmd,operationId:id(403),proposal:proposal(-2)},'attendance_missing_conflict',employee,true,
      `update public.merchant_attendance_employment_periods set starts_on='${day(-1)}' where worker_id='${worker}';`);
    pass('deadline, future time, stale policy/binding and employment coverage are rechecked inside SQL');
    const detailQ = { ...own, requestId:cmd.operationId }, review = run(detailQ,null,owner).detail;
    const approve = { operationId:id(410),reason:'核实工作时段',action:'approve',requestId:cmd.operationId,expectedRevision:1,evidenceToken:review.evidenceToken };
    reject(detailQ,{...approve,evidenceToken:'0'.repeat(32)},'attendance_missing_basis_changed',owner);
    reject(detailQ,approve,'attendance_missing_basis_changed',owner,true,`update public.merchant_attendance_settings set version=version+1 where merchant_id='${site}';`);
    const lock = n => `select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'lock_period',operationId:id(7900),expectedRevision:1,expectedSettingsVersion:1,reason:'合成周期锁定',fromDate:day(n),throughDate:day(n)})},null,null,true);`;
    reject(detailQ,approve,'attendance_missing_basis_changed',owner,true,lock(-1));
    reject(q,{...cmd,operationId:id(403),proposal:proposal(-2)},'attendance_missing_conflict',employee,true,lock(-2));
    const selfReview=JSON.parse(exec(`begin;update public.merchants set user_id='${employee}' where id='${site}';select ${call(detailQ,null,employee)};rollback;`));
    assert(selfReview.detail.issues.includes('self_review'));assert.equal(selfReview.detail.canApprove,false);assert.equal(selfReview.detail.canReject,false);
    reject({...q,requestId:cmd.operationId},null,'attendance_access_denied',employee,true,`update public.merchant_enterprise_employees set auth_user_id='${id(3)}' where id='${id(101)}';`);
    const rebound=JSON.parse(exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(3)}' where id='${id(101)}';update public.merchant_enterprise_employees set auth_user_id='${employee}' where id='${id(102)}';select ${call()};rollback;`));
    assert.equal(rebound.items.length,0);assert.equal(rebound.employeeId,id(102));
    pass('period locks and changed settings invalidate stale review; own review and employee rebinding cannot expose or approve prior requests');
    const raw=(n,closed=false)=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ('${id(8001)}','${site}','${worker}','${location}','${id(8001)}',1,'clock_in','web','${day(n)}T00:00:00Z','UTC','${id(101)}')
      ${closed?`,('${id(8002)}','${site}','${worker}','${location}','${id(8002)}',2,'clock_out','web','${day(n)}T01:00:00Z','UTC','${id(101)}')`:''};`;
    reject(q,{...cmd,operationId:id(403),proposal:proposal(-2)},'attendance_missing_conflict',employee,true,raw(-2));
    const correction={action:'submit',operationId:id(8003),expectedRevision:0,expectedPolicyRevision:1,reason:'合成核定时段',startEventId:id(8001),expectedLastEventId:id(8002),proposal:proposal(-9)};
    const corrected=raw(-9,true)+`select public.faolla_attendance_correction_self_v3('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,requestId:id(8003),operationId:null})},${json(correction)},true);
      do $effect$ declare evidence jsonb;begin evidence:=public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(8003)}',null,null,true);
      if evidence->'canApprove'<>'true'::jsonb then raise exception 'fixture_approval_denied';end if;
      perform public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(8003)}',${json({action:'approve',operationId:id(8004),requestId:id(8003),expectedRevision:1,reason:'合成核定批准'})}||jsonb_build_object('expectedEvidence',evidence->'evidenceToken'),null,true);end $effect$;`;
    reject(q,{...cmd,operationId:id(403),proposal:proposal(-9)},'attendance_missing_conflict',employee,true,corrected);
    pass('open raw shift and separately approved effective shift both block overlapping missing declaration; synthetic correction approval uses real existing RPC');
    const approved = run(detailQ,approve,owner); assert.equal(approved.detail.status,'approved'); assert.equal(approved.includedInTimesheet,false);
    assert.equal(run(detailQ,approve,owner,false).receipt.operationId,approve.operationId);
    reject({ ...q,requestId:cmd.operationId },{operationId:id(411),reason:'迟到撤回',action:'withdraw',requestId:cmd.operationId,expectedRevision:1},'attendance_missing_closed');
    pass('owner approval requires current evidence and is immutable; approved declarations remain outside existing totals');
    const second = run(q,{...cmd,operationId:id(420),proposal:proposal(-2)}).detail;
    const withdraw = { operationId:id(421),reason:'员工重新核对',action:'withdraw',requestId:second.requestId,expectedRevision:1 };
    assert.equal(run({ ...q,requestId:second.requestId },withdraw,employee,false).detail.status,'withdrawn');
    const third = run(q,{...cmd,operationId:id(422),proposal:proposal(-2)}).detail;
    const thirdQ = {...own,requestId:third.requestId}, rejection = run(thirdQ,null,owner).detail;
    run(thirdQ,{operationId:id(423),reason:'请补充依据后重新申请',action:'reject',requestId:third.requestId,expectedRevision:1,evidenceToken:rejection.evidenceToken},owner);
    assert.equal(run({...q,requestId:third.requestId}).detail.status,'rejected');
    pass('self withdraw works while platform paused; rejected/withdrawn declarations may be freshly resubmitted');
    // Approval versus withdrawal must have only one winner across actual connections.
    const race = run(q,{...cmd,operationId:id(430),proposal:proposal(-3)}).detail, raceQ={...own,requestId:race.requestId};
    const raceReview=run(raceQ,null,owner).detail, a=connect(), b=connect();
    try {
      await a.step(sql(`begin;set local role service_role;select ${call(raceQ,{...approve,operationId:id(431),requestId:race.requestId,evidenceToken:raceReview.evidenceToken},owner)};`));
      const waiting=b.step(sql(`begin;set local role service_role;do $check$ begin begin perform ${call({...q,requestId:race.requestId},{...withdraw,operationId:id(432),requestId:race.requestId})};raise exception 'unexpected acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'attendance_missing_closed' then raise;end if;end;end $check$;commit;`));
      await a.step('commit;');await waiting;
    } finally {await a.close();await b.close();}
    assert.equal(run({...q,requestId:race.requestId}).detail.status,'approved');pass('concurrent approval and withdrawal serialize to one terminal decision');
    if(browserCheck)await browserCheck({...native,exec,sql,run,q,own,owner,employee,worker,location,today,day,id,proposal,cmd});
    for(let n=0;n<26;n++){
      const start=new Date(Date.parse(day(-8)+'T02:00:00Z')+n*5*60000),end=new Date(start.valueOf()+60000);
      run(q,{...cmd,operationId:id(9000+n),proposal:{startAt:start.toISOString().replace('.000Z','.000000Z'),endAt:end.toISOString().replace('.000Z','.000000Z'),breaks:[]}});
    }
    const page1=run(),page2=run({...q,beforeAt:page1.nextCursor.at,beforeId:page1.nextCursor.id});
    assert.equal(page1.items.length,25);assert(page2.items.length>0);assert(!page1.items.some(a=>page2.items.some(b=>b.requestId===a.requestId)));
    const pageIds=[...page1.items,...page2.items].map(x=>x.requestId);for(let n=0;n<26;n++)assert(pageIds.includes(id(9000+n)));
    pass('bounded keyset pagination returns 26+ declarations without duplicate or missing rows');
    assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
    assert.equal(exec('select count(*) from public.merchant_attendance_effect_versions;'),'0');
    assert.equal(exec('select count(*) from public.merchant_attendance_correction_effects;'),'0');
    for(const table of ['requests','entries']){
      assert.equal(exec(`select has_table_privilege('service_role','public.merchant_attendance_missing_${table}','INSERT');`),'f');
      exec(`do $guard$ begin begin execute 'truncate public.merchant_attendance_missing_${table} cascade';raise exception 'unexpected rewrite';exception when sqlstate '42501' then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end $guard$;`);
    }
    pass('new journal is append-only; no raw punches or existing effective time rows created');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceMissing).catch(error=>{console.error(error);process.exitCode=1;});
