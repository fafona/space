// Extend the same owned enterprise-shell lineage, never inject missing business
// outcomes. Original punches/approvals stay unchanged; downloads are ephemeral.
import assert from 'node:assert/strict';
import {deleteAttendanceDownloadOnce,runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

export async function checkAttendanceMissingFlowShell({owner,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdCorrectionResponse,downloads,csvRows}) {
  assert.equal(site,'99990001');
  const rows=(table,order)=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const unchanged=()=>Object.fromEntries([
    ['merchant_attendance_events','sequence'],['merchant_attendance_workers','id'],['merchant_attendance_settings','merchant_id'],
    ['merchant_attendance_config_operations','operation_id'],['merchant_attendance_scope_operations','revision'],
    ['merchant_attendance_scope_grants','id'],['merchant_attendance_correction_entries','revision'],
    ['merchant_attendance_correction_decisions','operation_id'],['merchant_attendance_correction_effects','request_id'],
    ['merchant_attendance_revision_requests','revision'],['merchant_attendance_revision_decisions','operation_id'],
    ['merchant_attendance_effect_versions','revision'],['merchant_attendance_report_exports','operation_id'],
    ...['merchant_attendance_locations','merchant_attendance_employment_periods','merchant_attendance_scopes',
      'merchant_attendance_scope_workers','merchant_attendance_scope_locations','merchant_attendance_correction_controls',
      'merchant_attendance_correction_periods','merchant_attendance_correction_rule_bindings'].map(table=>[table,'to_jsonb(t)::text']),
  ].map(([table,order])=>[table,rows(table,order)]));
  const baseline=unchanged(),raw=baseline.merchant_attendance_events,worker=baseline.merchant_attendance_workers[0];
  assert.equal(raw.length,4);assert.equal(baseline.merchant_attendance_workers.length,1);
  const current=baseline.merchant_attendance_effect_versions.at(-1);assert.equal(current.revision,3);
  const sourceRequests=()=>rows('merchant_attendance_missing_requests','submitted_at,request_id');
  const entries=()=>rows('merchant_attendance_missing_entries','recorded_at,operation_id');
  const receipts=()=>rows('merchant_attendance_unified_exports','recorded_at,operation_id');
  assert.equal(sourceRequests().length,0);assert.equal(entries().length,0);assert.equal(receipts().length,0);
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const posts=name=>requests.filter(r=>r.path===endpoint(name)&&r.method==='POST');
  const read=(page,name,method='GET',status=200)=>{
    const waiting=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint(name)&&r.request().method()===method)
      .then(response=>{assert.equal(response.status(),status,`unexpected_${name}_${method}_status`);return response;});
    // Observe a timeout even if a preceding UI action fails. The original
    // promise is still awaited and fails the check; outer cleanup can now run.
    void waiting.catch(()=>{});return waiting;
  };
  const result=async promise=>{const value=await (await promise).json();assert.equal(value.ok,true);return value;};
  const click=async(page,name,button,method='GET')=>{const ready=read(page,name,method);await button.click();return result(ready);};
  const missing=(page,access)=>page.getByRole('region',{name:access==='owner'?'整段漏卡审核工作区':'整段漏卡申请工作区',exact:true});
  const unified=page=>page.getByRole('region',{name:'含整段漏卡工时工作区',exact:true});
  const exporting=page=>unified(page).getByRole('region',{name:'含整段申报的受控导出',exact:true});
  const own=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  const pending=(page,access,actor)=>page.evaluate(key=>sessionStorage.getItem(key),`faolla:attendance:missing:v1:${site}:${access}:${actor}`);
  const role=rows('merchant_enterprise_roles','id').find(r=>r.id===id(31));assert(role);
  const wasEnabled=transport.state.moduleEnabled,downloadStart=downloads.length;
  const dates=JSON.parse(exec("select jsonb_build_object('fromDate',((clock_timestamp() at time zone 'Europe/Madrid')::date-1)::text,'throughDate',(clock_timestamp() at time zone 'Europe/Madrid')::date::text);"));
  assert.equal(raw[0].time_zone,'Europe/Madrid');
  const elapsed=(Date.parse(raw[3].occurred_at)-Date.parse(raw[0].occurred_at))*1000;
  const rest=(Date.parse(raw[2].occurred_at)-Date.parse(raw[1].occurred_at))*1000;
  const original={elapsedUs:elapsed,breakUs:rest,paidBreakUs:0,workedUs:elapsed-rest};
  const recorded={elapsedUs:elapsed+2000,breakUs:0,paidBreakUs:0,workedUs:elapsed+2000};
  assert.equal(current.worked_us,recorded.workedUs);
  const amounts=hours=>({elapsedUs:hours?(hours+1)*3600000000:0,breakUs:hours?3600000000:0,paidBreakUs:0,workedUs:hours*3600000000});
  const totals=hours=>{const m=amounts(hours),selected=Object.fromEntries(Object.keys(recorded).map(k=>[k,recorded[k]+m[k]]));
    return {original,recordedSelected:recorded,missingSelected:m,selected,difference:Object.fromEntries(Object.keys(selected).map(k=>[k,selected[k]-original[k]]))};};
  const duration=n=>{const seconds=Math.floor(n/1000000),fraction=String(n%1000000).padStart(6,'0').replace(/0+$/,'');return `${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds/60)%60} 分 ${seconds%60}${fraction?'.'+fraction:''} 秒`;};
  const verifyReport=(r,hours,requestId,operationId,access)=>{
    assert.equal(r.version,'attendance-unified-v1');assert.equal(r.access,access);assert.equal(r.payrollReady,false);assert.equal(r.complete,true);
    assert.equal(r.moduleEnabled,false);assert.equal(r.base.workerId,worker.id);assert.equal(r.base.fromDate,dates.fromDate);assert.equal(r.base.throughDate,dates.throughDate);
    assert.equal(r.base.rows.length,1);assert.deepEqual(r.base.rows[0].eventIds,raw.map(e=>e.id));
    assert.equal(r.base.rows[0].correction.revision,3);assert.equal(r.base.rows[0].correction.operationId,current.operation_id);
    assert.deepEqual(r.totals,totals(hours));assert.equal(r.missing.length,hours?1:0);
    if(hours){const m=r.missing[0];assert.equal(m.source,'missing-approved');assert.equal(m.requestId,requestId);assert.equal(m.operationId,operationId);
      assert.equal(m.workerId,worker.id);assert.equal(m.employeeId,access==='self'?worker.employee_id:null);assert.deepEqual(m.inPeriod,amounts(hours));}
    assert.deepEqual(unchanged(),baseline);
  };
  const queryUnified=async(page,hours,requestId,operationId,access)=>{
    const r=await click(page,'unified-timesheet',unified(page).getByRole('button',{name:'查询含整段漏卡工时',exact:true}));
    verifyReport(r,hours,requestId,operationId,access);
    const cells=unified(page).getByRole('region',{name:'含整段申报工时合计',exact:true}).getByRole('row',{name:/^工作段/}).getByRole('cell');
    const expected=totals(hours);for(const [index,basis] of ['original','recordedSelected','missingSelected','selected'].entries())assert.equal(await cells.nth(index).innerText(),duration(expected[basis].workedUs));
    return r;
  };
  const openReport=async(page,access)=>{
    let panel;
    if(access==='owner'){
      await openOwner(page);await admin(page).getByRole('button',{name:'周期工时核对（只读）',exact:true}).click();
      panel=page.getByRole('region',{name:'周期工时核对',exact:true});await panel.getByRole('button',{name:new RegExp(worker.worker_no)}).click();
    }else{
      await page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'工作台',exact:true}).click();
      await page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();
      await click(page,'scoped-timesheet-context',own(page).getByRole('button',{name:'我的周期工时核对',exact:true}));
      panel=page.getByRole('region',{name:'受限周期工时核对',exact:true});
    }
    await panel.getByLabel('开始日期',{exact:true}).fill(dates.fromDate);await panel.getByLabel('结束日期（含）',{exact:true}).fill(dates.throughDate);
    const base=await click(page,access==='owner'?'timesheet':'scoped-timesheet',panel.getByRole('button',{name:access==='owner'?'查询工时':'查询可见工时',exact:true}));
    assert.deepEqual(base.totals.selected,recorded);assert.equal(base.rows.length,1);
    const before=requests.filter(r=>r.path===endpoint('unified-timesheet')).length;
    await panel.getByRole('button',{name:'含整段漏卡的工时核对',exact:true}).click();await unified(page).waitFor();
    assert.equal(requests.filter(r=>r.path===endpoint('unified-timesheet')).length,before,'unified_report_must_require_explicit_query');
  };
  const verifyCsv=(text,hours,requestId,operationId,access)=>{
    const parsed=csvRows(text),head=parsed[0];assert.equal(head.length,16);assert(parsed.every(r=>r.length===16));
    const clean=value=>value.startsWith("'")?value.slice(1):value;
    for(const [basis,values] of Object.entries(totals(hours))){const list=parsed.filter(r=>r[0]==='汇总'&&r[1]===basis);assert.equal(list.length,1);
      for(const [label,key] of [['起止微秒','elapsedUs'],['休息微秒','breakUs'],['带薪休息微秒','paidBreakUs'],['工作微秒','workedUs']])assert.equal(clean(list[0][head.indexOf(label)]),String(values[key]));}
    const meta=Object.fromEntries(parsed.filter(r=>r[0]==='元数据').map(r=>[r[5],r[6]]));assert.equal(meta.访问范围,access);assert.equal(meta.人员编号,worker.id);
    assert.equal(meta.来源版本,'attendance-unified-v1');assert.equal(meta.可用于工资结算,'false');assert.equal(meta.整段申报来源数,'1');assert.equal(meta.来源合计数,'2');
    const whole=parsed.filter(r=>r[0]==='整段申报完整');assert.equal(whole.length,1);assert.equal(whole[0][4],requestId);assert.equal(whole[0][3],'missing-approved');
    const sources=Object.fromEntries(parsed.filter(r=>r[0]==='批准来源'&&r[1]==='missingSelected').map(r=>[r[5],r[6]]));
    assert.equal(sources.requestId,requestId);assert.equal(sources.operationId,operationId);assert.equal(sources.原始打卡,'无，不伪造事件');
    assert.deepEqual(parsed.filter(r=>r[0]==='原始动作').map(r=>r[6]),raw.map(e=>e.id));
  };
  const download=async(page,hours,requestId,operationId,access)=>{
    const before=receipts(),section=exporting(page),waiting=Promise.all([read(page,'unified-export','POST'),page.waitForEvent('download')]);
    void waiting.catch(()=>{}); // Keep both failures observed even if the click fails.
    assert(await section.getByRole('button').isDisabled());await section.getByRole('checkbox').check();await section.getByRole('button').click();
    const [response,file]=await waiting,r=await response.json(),record=downloads.find(v=>v.download===file);assert.equal(r.ok,true);assert(record);
    try{const stream=await file.createReadStream();assert(stream);const chunks=[];let size=0;
      for await(const part of stream){size+=part.length;assert(size<=4*1024*1024);chunks.push(part);}
      const text=Buffer.concat(chunks).toString('utf8');assert.equal(text,r.csv);assert.equal(file.suggestedFilename(),r.filename);verifyCsv(text,hours,requestId,operationId,access);
      assert.equal(r.receipt.reportVersion,'attendance-unified-v1');assert.equal(r.receipt.status,'source_read');assert.equal(r.receipt.downloadConfirmed,false);
      assert.equal(r.receipt.missingCount,1);assert.equal(r.receipt.sourceCount,2);assert.equal(r.replayed,false);assert.equal(r.moduleEnabled,false);
      const after=receipts();assert.equal(after.length,before.length+1);assert.deepEqual(after.slice(0,-1),before);assert.deepEqual(unchanged(),baseline);
    }finally{await runAttendanceCleanupSteps([{name:'unified-download',timeoutMs:5000,run:()=>deleteAttendanceDownloadOnce(record)}]);}
    // A download event precedes the component's final acknowledgement reset.
    // Observe that reset rather than racing the next check() against it.
    await section.locator('input[type="checkbox"]:enabled:not(:checked)').waitFor({timeout:5000});
    await section.locator('button:disabled').waitFor({timeout:5000});
  };
  const openOwnerMissing=async()=>{await openOwner(owner);return click(owner,'missing',admin(owner).getByRole('button',{name:'整段漏卡审核',exact:true}));};
  const selectOwnerMissing=async requestId=>{await openOwnerMissing();return click(owner,'missing',missing(owner,'owner').getByRole('button',{name:'查看申请 '+requestId.slice(-4),exact:true}));};
  const lostSubmit=async(page,access,button)=>{
    const panel=missing(page,access),actor=access==='owner'?actors[0].id:worker.employee_id;
    const before=posts('missing').length;control.lose=endpoint('missing');await button.click();
    await panel.getByRole('button',{name:'用原编号明确重试',exact:true}).and(page.locator('button:not(:disabled)')).waitFor();assert.equal(control.lose,null);
    const saved=await pending(page,access,actor);assert(saved);const intent=JSON.parse(saved);
    transport.state.moduleEnabled=false;
    const r=await click(page,'missing',panel.getByRole('button',{name:'重新读取／查原收据',exact:true}));
    assert.equal(r.receipt.operationId,intent.command.operationId);assert.equal(r.moduleEnabled,false);
    await panel.getByRole('status').filter({hasText:'原操作已确认'}).waitFor();assert.equal(await pending(page,access,actor),null);
    assert.equal(posts('missing').length,before+1);assert.equal(posts('missing').at(-1).fault,'after-sql');return r;
  };
  let employee;
  try{
    exec(`update public.merchant_enterprise_roles set permissions=array_append(array_append(permissions,'attendance.self.request'),'attendance.self.export'),version=version+1 where merchant_id='${site}' and id='${role.id}';`);
    transport.state.moduleEnabled=true;
    employee=await newPage({employee:true,mobile:true});assert.equal(employee.viewportSize().width,390);
    await employee.goto(origin+'/enterprise');await employee.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);
    await employee.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await employee.getByRole('button',{name:'登录并选择企业',exact:true}).click();
    await employee.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();
    await employee.waitForURL(url=>url.pathname==='/enterprise/'+site);
    await employee.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();
    const initial=await click(employee,'missing',own(employee).getByRole('button',{name:'整段漏卡申请',exact:true}));
    assert.equal(initial.canRequest,true);assert.equal(initial.items.length,0);assert.equal(initial.workerId,worker.id);assert.equal(posts('missing').length,0);
    const self=missing(employee,'self');assert.equal(await self.getByLabel('申报开始时间',{exact:true}).inputValue(),'');
    await self.getByLabel('申报开始时间',{exact:true}).fill(dates.fromDate+'T09:00');await self.getByLabel('申报结束时间',{exact:true}).fill(dates.fromDate+'T17:00');
    await self.getByRole('button',{name:'增加休息时段',exact:true}).click();await self.getByLabel('休息 1 开始',{exact:true}).fill(dates.fromDate+'T12:00');await self.getByLabel('休息 1 结束',{exact:true}).fill(dates.fromDate+'T13:00');
    await self.getByLabel('漏卡原因',{exact:true}).fill('企业入口合成验收：昨日整段漏卡含一小时休息');
    await self.getByLabel('确认整段无打卡，起止、休息及理由真实，提交负责人审核',{exact:true}).check();
    const first=await lostSubmit(employee,'self',self.getByRole('button',{name:'提交整段申请',exact:true})),firstId=first.detail.requestId;
    assert.equal(first.detail.status,'submitted');assert.equal(sourceRequests().length,1);assert.equal(entries().length,1);assert.deepEqual(unchanged(),baseline);
    pass('actual390px enterprise employee submits yesterday whole-missing shift with unpaid break; SQL-committed lost reply recovers same receipt by GET while paused, without fake punches or duplicate submission');

    await openReport(owner,'owner');await queryUnified(owner,0,null,null,'owner');assert.equal(receipts().length,0);
    pass('real owner old report remains latest recorded revision3; separately opened unified query excludes pending missing declaration and does not auto-query or export');

    transport.state.moduleEnabled=true;const firstReview=await selectOwnerMissing(firstId);assert.equal(firstReview.detail.canApprove,true);
    await missing(owner,'owner').getByLabel('审核意见',{exact:true}).fill('合成负责人核对后批准首次整段申报');
    await missing(owner,'owner').getByLabel('已核对完整申报及当前冲突提示，明确作出审核决定',{exact:true}).check();
    const approved=await lostSubmit(owner,'owner',missing(owner,'owner').getByRole('button',{name:'批准整段申请',exact:true})),firstApproval=approved.receipt.operationId;
    assert.equal(approved.detail.status,'approved');assert.equal(entries().length,2);assert.deepEqual(unchanged(),baseline);
    const historicRequest=structuredClone(sourceRequests()[0]),historicEntries=structuredClone(entries());
    pass('actual owner approves whole-missing request; committed lost reply recovers by original-ID GET during pause, preserving the declaration, original four events and all prior revision facts');

    await openReport(owner,'owner');await queryUnified(owner,7,firstId,firstApproval,'owner');await download(owner,7,firstId,firstApproval,'owner');
    pass('owner actual unified report and downloaded16-column CSV equal recorded revision3 plus7h only, keep separate missing-approved provenance, emit no synthetic event IDs and remove the temporary file');

    transport.state.moduleEnabled=true;
    await click(employee,'missing',self.getByRole('button',{name:'重新读取／查原收据',exact:true}));
    // Receipt recovery can leave the list selected; select this immutable request explicitly.
    await click(employee,'missing',self.getByRole('button',{name:'查看申请 '+firstId.slice(-4),exact:true}));
    await self.getByRole('button',{name:'申请修订整段申报',exact:true}).click();
    assert.equal(await self.getByLabel('申报结束时间',{exact:true}).inputValue(),dates.fromDate+'T17:00');
    await self.getByLabel('申报结束时间',{exact:true}).fill(dates.fromDate+'T18:00');await self.getByLabel('修订原因',{exact:true}).fill('合成核实后将昨日结束时间延后一小时');
    await self.getByLabel('确认整段无打卡，起止、休息及理由真实，提交负责人审核',{exact:true}).check();
    const revised=await click(employee,'missing',self.getByRole('button',{name:'提交整段修订',exact:true}),'POST'),secondId=revised.detail.requestId;
    assert.notEqual(secondId,firstId);assert.equal(revised.detail.status,'submitted');assert.equal(sourceRequests().length,2);assert.equal(entries().length,3);
    transport.state.moduleEnabled=false;await queryUnified(owner,7,firstId,firstApproval,'owner');
    assert.deepEqual(sourceRequests().find(r=>r.request_id===firstId),historicRequest);for(const entry of historicEntries)assert.deepEqual(entries().find(r=>r.operation_id===entry.operation_id),entry);
    pass('employee actual missing-revision form starts from approved declaration; one-hour change creates separate pending request and unified totals remain7h until explicit approval, never counting pending or both versions');

    transport.state.moduleEnabled=true;const secondReview=await selectOwnerMissing(secondId);assert.equal(secondReview.detail.canApprove,true);
    await missing(owner,'owner').getByLabel('审核意见',{exact:true}).fill('核对原批准与延长声明后批准新版本');
    await missing(owner,'owner').getByLabel('已核对完整申报及当前冲突提示，明确作出审核决定',{exact:true}).check();
    const second=await click(owner,'missing',missing(owner,'owner').getByRole('button',{name:'批准整段申请',exact:true}),'POST'),secondApproval=second.receipt.operationId;
    assert.equal(second.detail.status,'approved');assert.equal(entries().length,4);
    transport.state.moduleEnabled=false;
    await openReport(owner,'owner');await queryUnified(owner,8,secondId,secondApproval,'owner');await download(owner,8,secondId,secondApproval,'owner');
    await openReport(employee,'self');await queryUnified(employee,8,secondId,secondApproval,'self');await download(employee,8,secondId,secondApproval,'self');
    assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(sourceRequests().find(r=>r.request_id===firstId),historicRequest);for(const entry of historicEntries)assert.deepEqual(entries().find(r=>r.operation_id===entry.operation_id),entry);
    pass('explicit second approval replaces7h with8h, not15h; owner and390px employee actual queries/downloads agree with latest missing source plus unchanged recorded revision3, historical request/approval remain intact');

    exec(`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.export'),version=version+1 where merchant_id='${site}' and id='${role.id}';`);
    // Permission/version changes legitimately remount the workspace on its
    // capabilities refresh. Start a current authorized read instead of racing
    // that refresh with a stale locator; SQL must still reject the export.
    await employee.reload();await openReport(employee,'self');await queryUnified(employee,8,secondId,secondApproval,'self');
    const fileCount=downloads.length,receiptCount=receipts().length,denied=read(employee,'unified-export','POST',403);
    await exporting(employee).getByRole('checkbox').check();await exporting(employee).getByRole('button').click();
    assert.equal((await (await denied).json()).error,'attendance_export_denied');
    await unified(employee).waitFor({state:'detached'});await employee.getByRole('article',{name:'可见工时查询结果',exact:true}).waitFor({state:'detached'});
    assert.equal(downloads.length,fileCount);assert.equal(receipts().length,receiptCount);assert.deepEqual(unchanged(),baseline);
    pass('after employee export permission revocation and real workspace reload, viewing remains allowed but actual SQL403 clears combined and parent private results on export, without a source receipt or download');

    const held=holdCorrectionResponse(owner,endpoint('unified-export')),beforeHeld=downloads.length;
    await exporting(owner).getByRole('checkbox').check();await exporting(owner).getByRole('button').click();const committed=await held.ready();
    assert.equal(committed.receipt.missingCount,1);assert.equal(committed.receipt.downloadConfirmed,false);assert.equal(receipts().length,4);
    await unified(owner).getByLabel('合并核对开始日期',{exact:true}).fill('2000-01-01');await unified(owner).getByRole('article',{name:'含整段漏卡工时结果',exact:true}).waitFor({state:'detached'});
    await held.release();await owner.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(downloads.length,beforeHeld);assert.equal(downloads.length-downloadStart,3);assert(downloads.every(r=>r.deleted));
    assert.equal(posts('missing').length,4);assert.equal(posts('unified-export').filter(r=>r.status===200).length,4);assert.equal(posts('unified-export').filter(r=>r.status===403).length,1);
    assert.deepEqual(unchanged(),baseline);
    pass('unified export response held after actual source-read SQL is discarded after date change;4 read receipts but3 actual downloads, all deleted, and no rewritten original/correction/revision/scope/config facts');
    const proof={requests:sourceRequests().length,entries:entries().length,downloads:downloads.length-downloadStart,sourceReads:receipts().length,originalFactsUnchanged:true};
    console.log(JSON.stringify({actualMissingFlowShell:true,...proof,latestRecordedRevision:3,latestMissingWorkedHours:8,syntheticAuthOnly:true,productionAccess:false}));return proof;
  }finally{
    transport.state.moduleEnabled=wasEnabled;control.lose=null;
    await runAttendanceCleanupSteps([
      {name:'missing-role',run:()=>exec(`update public.merchant_enterprise_roles set permissions=array[${role.permissions.map(p=>`'${p.replaceAll("'","''")}'`).join(',')}],version=version+1 where merchant_id='${site}' and id='${role.id}';`)},
      ...(employee?[{name:'missing-employee-context',run:()=>employee.context().close()}]:[]),
    ]);
  }
}
