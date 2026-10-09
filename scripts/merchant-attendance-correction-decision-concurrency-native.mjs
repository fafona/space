import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import decision from "../src/lib/merchantAttendanceCorrectionDecision.ts";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
import {withAttendanceConcurrencySandbox} from "./merchant-attendance-concurrency-sandbox.mjs";

export async function checkAttendanceDecisionConcurrency(context) {
  const {query,connect,pass} = context;
  await withAttendanceConcurrencySandbox(context, async ({sql}) => {
    const json = value => value === null ? "null" : `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
    const epoch = Date.now(), day = n => new Date(epoch - n*86400000).toISOString().slice(0,10);
    const stamp = (n,h) => `${day(n)}T${h}:00.000000Z`;
    const exec = source => query(sql(source));
    const value = text => JSON.parse(text.split(/\r?\n/).find(line => line.startsWith("{")) ?? "null");
    let number = 0, witnessed = 0;
    function fixture() {
      const base = 700000 + (++number)*100, site = String(99991000 + number);
      const owner=id(base),auth=id(base+1),emp=id(base+2),role=id(base+3),worker=id(base+4),loc=id(base+5),other=id(base+6);
      const request=id(base+30), request2=id(base+31), operation=id(base+40);
      const self = command => `public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:request,operationId:null})},${json(command)},true)`;
      const call = (command=null,req=request,op=null,who=owner) => `public.faolla_attendance_correction_decide_v1('${site}','${who}','${req}',${json(command)},${op?`'${op}'`:"null"},true)`;
      const controls = command => `public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(command)},null,null,true)`;
      const proposal = {startAt:stamp(4,"08:00"),endAt:stamp(4,"17:00"),breaks:[]};
      const proposal2 = {startAt:stamp(4,"16:30"),endAt:stamp(3,"16:00"),breaks:[]};
      const submit = (req,start,end,p) => ({action:'submit',operationId:req,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic concurrent request',startEventId:start,expectedLastEventId:end,proposal:p});
      exec(`begin;
        insert into public.merchants(id,user_id) values('${site}','${owner}');
        insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
        insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${loc}','${site}','Synthetic concurrency','Europe/Madrid');
        insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic concurrency',array['enterprise.view','attendance.self.view','attendance.self.request']);
        insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
          values('${emp}','${site}','${auth}','concurrency@example.test','Synthetic concurrency','${role}','active');
        insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id)
          values('${worker}','${site}','${emp}','CONCURRENT','Synthetic concurrency','${loc}');
        insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
        ${[[1,'clock_in',stamp(4,'08:00')],[2,'clock_out',stamp(4,'16:00')],[3,'clock_in',stamp(3,'08:00')],[4,'clock_out',stamp(3,'16:00')]].map(([n,action,t])=>`
          insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
          values('${id(base+10+n)}','${site}','${worker}','${loc}','${id(base+20+n)}',${n},'${action}','web','${t}','Europe/Madrid','${emp}');`).join('\n')}
        set local role service_role;
        select ${controls({action:'set_policy',operationId:id(base+50),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic policy',submissionWindowDays:30})};
        select ${self(submit(request,id(base+11),id(base+12),proposal))};
        select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:request2,operationId:null})},${json(submit(request2,id(base+13),id(base+14),proposal2))},true);
        commit;`);
      const read = (req=request,op=null,who=owner) => {
        const result = value(exec(`set role service_role;select ${call(null,req,op,who)};`));
        decision.parseCorrectionDecisionResult(result,{siteId:site,requestId:req,operationId:op}); return result;
      };
      const command = (req=request,op=operation,action='approve') => {
        const result=read(req); assert.equal(result.canApprove,true); assert.equal(result.canReject,true);
        return {action,operationId:op,requestId:req,expectedRevision:1,expectedEvidence:result.evidenceToken,reason:'Synthetic concurrent decision'};
      };
      const counts = () => JSON.parse(exec(`select jsonb_build_object('decisions',(select count(*) from public.merchant_attendance_correction_decisions where merchant_id='${site}'),
        'effects',(select count(*) from public.merchant_attendance_correction_effects where merchant_id='${site}'),
        'withdrawals',(select count(*) from public.merchant_attendance_correction_entries where merchant_id='${site}' and action='withdraw'));`));
      const raw = () => exec(`select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e where merchant_id='${site}';`);
      return {base,site,owner,auth,emp,worker,other,request,request2,operation,call,self,controls,read,command,counts,raw};
    }
    // No assumed sleep ordering: witness the exact waiter blocked by this holder PID.
    async function race(first,second,{rollback=false}={}) {
      const holder=connect(),waiter=connect(); let waiting;
      try {
        const pid=Number(await holder.step('select pg_backend_pid();')); assert.ok(Number.isInteger(pid)&&pid>0);
        const left=await holder.step(sql(`begin;${first}`));
        waiting=waiter.step(sql(second)).then(output=>({output,error:null}),error=>({output:null,error}));
        const until=Date.now()+2000; let locked=false;
        while(Date.now()<until) {
          locked=query(`select count(*) from pg_stat_activity where application_name='${waiter.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';
          if(locked) break;
          await new Promise(resolve=>setTimeout(resolve,15));
        }
        assert.ok(locked,'attendance_concurrency_exact_blocker_not_witnessed'); witnessed++;
        await holder.step(rollback?'rollback;':'commit;');
        const right=await waiting; return {left:value(left),right:right.error?right:value(right.output)};
      } finally { await Promise.all([holder.close(),waiter.close()]); if(waiting) await waiting; }
    }
    const service = expression => `set local role service_role;select ${expression};`;
    const incoming = expression => `begin;${service(expression)}commit;`;
    const fails = (result,code) => { assert.ok(result?.error,`expected failure ${code}`); assert.match(result.error.message,new RegExp(code)); };
    const invariant = (f,before,expected) => { assert.deepEqual(f.counts(),expected);assert.equal(f.raw(),before,'original punch facts changed'); };

    for(const mode of ['identical','same_operation_changed','approve_then_reject','reject_then_approve','rollback']) {
      const f=fixture(),before=f.raw(),first=f.command(f.request,f.operation,mode==='reject_then_approve'?'reject':'approve');
      const next= mode==='same_operation_changed'?{...first,reason:'Changed concurrent intent'}:
        ['approve_then_reject','reject_then_approve'].includes(mode)?{...first,operationId:id(f.base+41),action:first.action==='approve'?'reject':'approve'}:first;
      const result=await race(service(f.call(first)),incoming(f.call(next)),{rollback:mode==='rollback'});
      if(mode==='same_operation_changed') fails(result.right,'attendance_operation_conflict');
      else if(['approve_then_reject','reject_then_approve'].includes(mode)) fails(result.right,'attendance_correction_decided');
      else {assert.equal(result.right.receipt.operationId,f.operation);if(mode==='identical')assert.deepEqual(result.left.receipt,result.right.receipt);}
      invariant(f,before,{decisions:1,effects:mode==='reject_then_approve'?0:1,withdrawals:0});
      assert.equal(f.read(f.request,f.operation).receipt.operationId,f.operation);
      pass(`real two-session ${mode}: witnessed lock, one decision, immutable raw facts`);
    }
    for(const order of ['withdraw_first','approve_first']) {
      const f=fixture(),before=f.raw(),command=f.command();
      const withdraw=f.self({action:'withdraw',operationId:id(f.base+60),requestId:f.request,expectedRevision:1,reason:'Synthetic concurrent withdrawal'});
      const result=await race(service(order==='withdraw_first'?withdraw:f.call(command)),incoming(order==='withdraw_first'?f.call(command):withdraw));
      fails(result.right,order==='withdraw_first'?'attendance_version_conflict':'attendance_correction_decided');
      invariant(f,before,order==='withdraw_first'?{decisions:0,effects:0,withdrawals:1}:{decisions:1,effects:1,withdrawals:0});
      pass(`real two-session ${order}: mutually exclusive terminal result`);
    }
    for(const mode of ['lock_first','policy_first','approve_before_lock','rule_rollback']) {
      const f=fixture(),before=f.raw(),command=f.command();
      const rule=f.controls({action:mode==='policy_first'?'set_policy':'lock_period',operationId:id(f.base+61),expectedRevision:1,expectedSettingsVersion:1,reason:'Synthetic concurrent rule',
        ...(mode==='policy_first'?{submissionWindowDays:7}:{fromDate:day(4),throughDate:day(4)})});
      const result=await race(service(mode==='approve_before_lock'?f.call(command):rule),incoming(mode==='approve_before_lock'?rule:f.call(command)),{rollback:mode==='rule_rollback'});
      if(['lock_first','policy_first'].includes(mode)) {
        fails(result.right,'attendance_correction_evidence_changed');
        invariant(f,before,{decisions:0,effects:0,withdrawals:0});
        const current=f.read();
        if(mode==='lock_first') {assert.equal(current.canApprove,false);assert.ok(current.blockers.includes('rule_period_locked'));}
        else {assert.equal(current.canApprove,true);assert.notEqual(current.evidenceToken,command.expectedEvidence);}
      } else {
        assert.ok(!result.right?.error); invariant(f,before,{decisions:1,effects:1,withdrawals:0});
        assert.equal(f.read().decision.action,'approve');
      }
      pass(`real two-session ${mode}: rule version and commit order rechecked`);
    }
    for(const reverse of [false,true]) {
      const f=fixture(),before=f.raw(),first=f.command(),second=f.command(f.request2,id(f.base+41));
      const result=await race(service(reverse?f.call(second,f.request2):f.call(first)),incoming(reverse?f.call(first):f.call(second,f.request2)));
      fails(result.right,'attendance_correction_evidence_changed');
      const after=f.read(reverse?f.request:f.request2); assert.equal(after.canApprove,false);assert.ok(after.blockers.includes('effective_overlap'));
      invariant(f,before,{decisions:1,effects:1,withdrawals:0});
      pass('real overlapping applications cannot both become effective, even for distinct raw shifts');
    }
    for(const mode of ['binding_first','approval_before_binding','owner_first','approval_before_transfer']) {
      const f=fixture(),before=f.raw(),command=f.command(),transfer=mode.includes('owner')||mode.includes('transfer');
      const mutation=transfer?`update public.merchants set user_id='${f.other}' where id='${f.site}';`:
        `update public.merchant_enterprise_employees set auth_user_id='${f.other}' where id='${f.emp}';`;
      const first=mode.startsWith('approval_');
      const result=await race(first?service(f.call(command)):mutation,first?`begin;${mutation}commit;`:incoming(f.call(command)));
      if(first) {assert.ok(!result.right?.error);invariant(f,before,{decisions:1,effects:1,withdrawals:0});}
      else {fails(result.right,transfer?'attendance_access_denied':'attendance_correction_evidence_changed');invariant(f,before,{decisions:0,effects:0,withdrawals:0});}
      if(!transfer) {const current=f.read();assert.equal(current.canApprove,false);assert.ok(current.blockers.includes('binding_changed'));}
      else {const current=f.read(f.request,f.operation,f.other);assert.equal(current.receipt,null);}
      pass(`real two-session ${mode}: identity checked at serialization boundary, old receipt not inherited`);
    }
    for(const readFirst of [false,true]) {
      const f=fixture(),before=f.raw(),command=f.command();
      const result=await race(service(readFirst?f.call():f.call(command)),incoming(readFirst?f.call(command):f.call()));
      if(readFirst) {assert.equal(result.left.decision,null);assert.equal(result.right.decision.action,'approve');}
      else {assert.equal(result.right.decision.action,'approve');assert.equal(result.right.effective.operationId,f.operation);}
      invariant(f,before,{decisions:1,effects:1,withdrawals:0});
      pass(`real read/${readFirst?'write':'committed decision'} serialization: no partial decision/effect projection`);
    }
    assert.equal(witnessed,19);
    pass('all 19 races witnessed exact PostgreSQL blocking PIDs; all owned sessions closed');
    {
      const a=fixture(),b=fixture(),beforeA=a.raw(),beforeB=b.raw(),ca=a.command(),cb=b.command(b.request,a.operation);
      const holder=connect(),independent=connect();
      try {
        await holder.step(sql(`begin;${service(a.call(ca))}`));
        // Must finish while A's transaction is STILL open: tenant B must not
        // wait for tenant A, even when the clients reuse the same operation UUID.
        const response=value(await independent.step(sql(incoming(b.call(cb)))));
        assert.equal(response.siteId,b.site);assert.equal(response.receipt.operationId,a.operation);
        await holder.step('commit;');
      } finally {await Promise.all([holder.close(),independent.close()]);}
      invariant(a,beforeA,{decisions:1,effects:1,withdrawals:0});invariant(b,beforeB,{decisions:1,effects:1,withdrawals:0});
      assert.equal(a.read(a.request,a.operation).receipt.requestId,a.request);
      assert.equal(b.read(b.request,a.operation).receipt.requestId,b.request);
      pass('different merchants progress independently under held locks; same operation UUID stays tenant-scoped');
    }
  });
  pass('run-owned synthetic schema removed; no new cluster, no public migration/fixture commit');
}
if(process.argv[1] && path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) {
  await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceDecisionConcurrency).catch(error=>{console.error(error);process.exitCode=1;});
}
