// Continue the actual missing-flow lineage. Only synthetic role permission is
// adjusted directly; grants, reports and exports all use real UI/handler/SQL.
import assert from 'node:assert/strict';
import {deleteAttendanceDownloadOnce,runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

export async function checkAttendanceMissingManagerShell({owner,newPage,openOwner,exec,transport,requests,pass,origin,site,actors,id,holdCorrectionResponse,downloads,csvRows}) {
  assert.equal(site,'99990001');
  const rows=table=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t;`));
  const protectedFacts=()=>Object.fromEntries([
    'merchant_attendance_events','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods',
    'merchant_attendance_settings','merchant_attendance_config_operations','merchant_enterprise_employees',
    'merchant_attendance_correction_controls','merchant_attendance_correction_periods','merchant_attendance_correction_rule_bindings',
    'merchant_attendance_correction_entries','merchant_attendance_correction_decisions','merchant_attendance_correction_effects',
    'merchant_attendance_revision_requests','merchant_attendance_revision_decisions','merchant_attendance_effect_versions',
    'merchant_attendance_missing_requests','merchant_attendance_missing_entries','merchant_attendance_report_exports',
  ].map(table=>[table,rows(table)]));
  const baseline=protectedFacts(),raw=baseline.merchant_attendance_events.toSorted((a,b)=>a.sequence-b.sequence);
  const [worker]=baseline.merchant_attendance_workers,[location]=baseline.merchant_attendance_locations;
  assert.equal(raw.length,4);assert.equal(baseline.merchant_attendance_workers.length,1);assert.equal(baseline.merchant_attendance_locations.length,1);
  const current=baseline.merchant_attendance_effect_versions.find(v=>v.revision===3);assert(current);
  const missing=baseline.merchant_attendance_missing_requests.find(r=>r.supersedes_request_id);assert(missing);
  assert.equal(baseline.merchant_attendance_missing_requests.length,2);assert.equal(baseline.merchant_attendance_missing_entries.length,4);
  const approval=baseline.merchant_attendance_missing_entries.find(e=>e.request_id===missing.request_id&&e.action==='approve');assert(approval);
  const managerMember=baseline.merchant_enterprise_employees.find(e=>e.auth_user_id===actors[1].id);assert(managerMember);
  const role=rows('merchant_enterprise_roles').find(r=>r.id===id(30));assert(role);assert.equal(managerMember.role_id,role.id);
  assert(!role.permissions.includes('attendance.reports.export'));
  const scopeBefore=rows('merchant_attendance_scope_operations'),receipts=()=>rows('merchant_attendance_unified_exports'),beforeReceipts=receipts();
  assert.equal(scopeBefore.length,4);assert.equal(rows('merchant_attendance_scope_grants').length,0);assert.equal(beforeReceipts.length,4);
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const posts=name=>requests.filter(r=>r.path===endpoint(name)&&r.method==='POST');
  const scopePosts=posts('scopes').length,missingPosts=posts('missing').length,exportPosts=posts('unified-export').length,downloadStart=downloads.length;
  const read=(page,name,method='GET',status=200)=>{
    const waiting=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint(name)&&r.request().method()===method)
      .then(response=>{assert.equal(response.status(),status,`unexpected_${name}_${method}_status`);return response;});
    void waiting.catch(()=>{});return waiting; // Preserve rejection while allowing outer finally to clean up.
  };
  const click=async(page,name,button,method='GET',status=200)=>{const done=read(page,name,method,status);await button.click();const body=await (await done).json();assert.equal(body.ok,status===200);return body;};
  const scope=()=>owner.getByRole('region',{name:'主管考勤范围',exact:true});
  const scoped=page=>page.getByRole('region',{name:'受限周期工时核对',exact:true});
  const unified=page=>page.getByRole('region',{name:'含整段漏卡工时工作区',exact:true});
  const exporting=page=>unified(page).getByRole('region',{name:'含整段申报的受控导出',exact:true});
  const dates=JSON.parse(exec("select jsonb_build_object('fromDate',((clock_timestamp() at time zone 'Europe/Madrid')::date-1)::text,'throughDate',(clock_timestamp() at time zone 'Europe/Madrid')::date::text);"));
  const elapsed=(Date.parse(raw[3].occurred_at)-Date.parse(raw[0].occurred_at))*1000,rest=(Date.parse(raw[2].occurred_at)-Date.parse(raw[1].occurred_at))*1000;
  const original={elapsedUs:elapsed,breakUs:rest,paidBreakUs:0,workedUs:elapsed-rest};
  const recordedSelected={elapsedUs:elapsed+2000,breakUs:0,paidBreakUs:0,workedUs:elapsed+2000};
  const missingSelected={elapsedUs:9*3600000000,breakUs:3600000000,paidBreakUs:0,workedUs:8*3600000000};
  const selected=Object.fromEntries(Object.keys(original).map(k=>[k,recordedSelected[k]+missingSelected[k]]));
  const totals={original,recordedSelected,missingSelected,selected,difference:Object.fromEntries(Object.keys(original).map(k=>[k,selected[k]-original[k]]))};
  assert.equal(current.worked_us,recordedSelected.workedUs);assert.equal(missing.worker_id,worker.id);assert.equal(missing.location_id,location.id);
  const duration=n=>{const s=Math.floor(n/1000000),fraction=String(n%1000000).padStart(6,'0').replace(/0+$/,'');return `${Math.floor(s/3600)} 小时 ${Math.floor(s/60)%60} 分 ${s%60}${fraction?'.'+fraction:''} 秒`;};
  let manager,phone,scopeRevision;const wasEnabled=transport.state.moduleEnabled;
  const intact=()=>{
    assert.deepEqual(protectedFacts(),baseline);
    for(const old of beforeReceipts)assert.deepEqual(receipts().find(r=>r.operation_id===old.operation_id),old);
    for(const old of scopeBefore)assert.deepEqual(rows('merchant_attendance_scope_operations').find(r=>r.operation_id===old.operation_id),old);
  };
  const openManagerReport=async page=>{
    await page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'考勤明细',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'整段漏卡审核',exact:true}).count(),0);
    return click(page,'scoped-timesheet-context',page.getByRole('button',{name:'授权范围工时核对',exact:true}));
  };
  const login=async page=>{
    await page.goto(origin+'/enterprise');await page.getByLabel('员工邮箱',{exact:true}).fill(actors[1].email);
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await page.getByRole('button',{name:'登录并选择企业',exact:true}).click();
    await page.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/enterprise/'+site);
    return openManagerReport(page);
  };
  const selectPair=async(page,context)=>{
    assert.equal(context.access,'manager');assert.equal(context.items.length,1);assert.equal(context.items[0].workerId,worker.id);assert.equal(context.items[0].locationId,location.id);
    assert.equal(context.scopeRevision,scopeRevision);assert(await scoped(page).getByRole('button',{name:'查询可见工时',exact:true}).isDisabled());
    await scoped(page).getByRole('button',{name:new RegExp(worker.worker_no)}).click();
  };
  const query=async page=>{
    const r=await click(page,'unified-timesheet',unified(page).getByRole('button',{name:'查询含整段漏卡工时',exact:true}));
    assert.equal(r.access,'manager');assert.equal(r.version,'attendance-unified-v1');assert.equal(r.complete,true);assert.equal(r.payrollReady,false);assert.equal(r.moduleEnabled,false);
    assert.equal(r.base.viewerEmployeeId,managerMember.id);assert.equal(r.base.workerId,worker.id);assert.equal(r.base.locationId,location.id);assert.equal(r.base.scopeRevision,scopeRevision);
    assert.equal(r.base.fromDate,dates.fromDate);assert.equal(r.base.throughDate,dates.throughDate);assert.equal(r.base.timeZone,'Europe/Madrid');
    assert.equal(r.base.rows.length,1);assert.deepEqual(r.base.rows[0].eventIds,raw.map(e=>e.id));assert.equal(r.base.rows[0].correction.revision,3);
    assert.equal(r.base.rows[0].correction.operationId,current.operation_id);assert.equal(r.missing.length,1);
    assert.equal(r.missing[0].requestId,missing.request_id);assert.equal(r.missing[0].operationId,approval.operation_id);assert.equal(r.missing[0].employeeId,null);
    assert.equal(r.missing[0].locationId,location.id);assert.equal(r.missing[0].workerId,worker.id);assert.deepEqual(r.missing[0].inPeriod,missingSelected);assert.deepEqual(r.totals,totals);
    const cells=unified(page).getByRole('region',{name:'含整段申报工时合计',exact:true}).getByRole('row',{name:/^工作段/}).getByRole('cell');
    for(const [n,basis] of ['original','recordedSelected','missingSelected','selected'].entries())assert.equal(await cells.nth(n).innerText(),duration(totals[basis].workedUs));
    await unified(page).getByText(/只核对所选人员与地点的授权组合/).waitFor();intact();return r;
  };
  const openCombined=async page=>{
    await scoped(page).getByLabel('开始日期',{exact:true}).fill(dates.fromDate);await scoped(page).getByLabel('结束日期（含）',{exact:true}).fill(dates.throughDate);
    const base=await click(page,'scoped-timesheet',scoped(page).getByRole('button',{name:'查询可见工时',exact:true}));
    assert.equal(base.access,'manager');assert.equal(base.locationId,location.id);assert.deepEqual(base.totals.selected,recordedSelected);
    const count=requests.filter(r=>r.path===endpoint('unified-timesheet')).length;
    await scoped(page).getByRole('button',{name:'含整段漏卡的工时核对',exact:true}).click();await unified(page).waitFor();
    assert.equal(requests.filter(r=>r.path===endpoint('unified-timesheet')).length,count);await query(page);
  };
  const cleared=async page=>{
    await unified(page).waitFor({state:'detached'});await scoped(page).getByRole('article',{name:'可见工时查询结果',exact:true}).waitFor({state:'detached'});
  };
  try {
    transport.state.moduleEnabled=false;manager=await newPage({employee:true});
    const reportReads=()=>requests.filter(r=>[endpoint('scoped-timesheet'),endpoint('unified-timesheet')].includes(r.path)).length;
    const beforeLoginReads=reportReads(),empty=await login(manager);assert.equal(reportReads(),beforeLoginReads);
    assert.deepEqual(empty.items,[]);assert(await scoped(manager).getByRole('button',{name:'查询可见工时',exact:true}).isDisabled());
    assert.equal(await scoped(manager).getByRole('button',{name:'含整段漏卡的工时核对',exact:true}).count(),0);intact();
    pass('manager actual SDK enterprise login starts with zero authorized pairs, no automatic report and no owner missing-approval entry; existing punches, declarations and approvals unchanged');

    transport.state.moduleEnabled=true;await openOwner(owner);await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();
    await scope().getByRole('button',{name:/合成主管甲/}).click();await scope().getByRole('button',{name:'新增授权',exact:true}).click();
    await scope().getByRole('button',{name:new RegExp(worker.worker_no)}).click();await scope().getByRole('button',{name:'地点 0 / 50',exact:true}).click();
    await scope().getByRole('button',{name:new RegExp(location.name)}).click();await click(owner,'scopes',scope().getByRole('button',{name:'保存此条授权',exact:true}),'POST');
    transport.state.moduleEnabled=false;
    const allowed=await click(manager,'scoped-timesheet-context',scoped(manager).getByRole('button',{name:'重新读取当前权限与范围',exact:true}));scopeRevision=allowed.scopeRevision;
    assert.equal(scopeRevision,scopeBefore.length+1);
    await selectPair(manager,allowed);await openCombined(manager);
    pass('owner actual grant selects one worker and location; paused manager explicitly selects that pair and opens combined read without auto-query: latest8h missing approval plus recorded revision3, no7h predecessor duplication and missing-source employee binding omitted');

    const denied=read(manager,'unified-export','POST',403);await exporting(manager).getByRole('checkbox').check();await exporting(manager).getByRole('button').click();
    assert.equal((await (await denied).json()).error,'attendance_export_denied');await cleared(manager);
    assert.equal(receipts().length,beforeReceipts.length);assert.equal(downloads.length,downloadStart);intact();
    pass('manager can read but lacks independent reports-export permission: actual SQL403 clears combined and parent private reports, without a source-read receipt or download');

    exec(`update public.merchant_enterprise_roles set permissions=array_append(permissions,'attendance.reports.export'),version=version+1 where merchant_id='${site}' and id='${role.id}';`);
    // Load the actual updated capabilities before opening a new report. Do not
    // race the workspace's legitimate authorization-epoch remount.
    await manager.reload();await selectPair(manager,await openManagerReport(manager));await openCombined(manager);
    const waiting=Promise.all([read(manager,'unified-export','POST'),manager.waitForEvent('download')]);
    void waiting.catch(()=>{}); // Observe even if clicking fails; awaited below, never turn failure into success.
    assert(await exporting(manager).getByRole('button').isDisabled());await exporting(manager).getByRole('checkbox').check();await exporting(manager).getByRole('button').click();
    const [downloadReply,file]=await waiting,payload=await downloadReply.json(),record=downloads.find(r=>r.download===file);assert(record);
    try {
      const stream=await file.createReadStream();assert(stream);const chunks=[];let size=0;
      for await(const chunk of stream){size+=chunk.length;assert(size<=4*1024*1024);chunks.push(chunk);}
      const text=Buffer.concat(chunks).toString('utf8');assert.equal(text,payload.csv);assert.equal(file.suggestedFilename(),payload.filename);
      const parsed=csvRows(text),header=parsed[0];assert.equal(header.length,16);assert(parsed.every(row=>row.length===16));
      const meta=Object.fromEntries(parsed.filter(r=>r[0]==='元数据').map(r=>[r[5],r[6]]));
      assert.equal(meta.访问范围,'manager');assert.equal(meta.地点编号,location.id);assert.equal(meta.人员编号,worker.id);assert.equal(meta.范围版本,String(scopeRevision));assert.equal(meta.可用于工资结算,'false');
      for(const [basis,amount] of Object.entries(totals))for(const [title,key] of [['起止微秒','elapsedUs'],['休息微秒','breakUs'],['带薪休息微秒','paidBreakUs'],['工作微秒','workedUs']]){
        const matches=parsed.filter(r=>r[0]==='汇总'&&r[1]===basis);assert.equal(matches.length,1);assert.equal(matches[0][header.indexOf(title)].replace(/^'/,''),String(amount[key]));
      }
      assert.deepEqual(parsed.filter(r=>r[0]==='整段申报完整').map(r=>r[4]),[missing.request_id]);
      const source=Object.fromEntries(parsed.filter(r=>r[0]==='批准来源'&&r[1]==='missingSelected').map(r=>[r[5],r[6]]));
      assert.equal(source.requestId,missing.request_id);assert.equal(source.operationId,approval.operation_id);assert.equal(source.原始打卡,'无，不伪造事件');
      const recorded=Object.fromEntries(parsed.filter(r=>r[0]==='批准来源'&&r[1]==='recordedSelected').map(r=>[r[5],r[6]]));
      assert.equal(recorded.operationId,current.operation_id);assert.equal(recorded.requestId,current.request_id);assert.equal(recorded.revision,'3');
      assert.deepEqual(parsed.filter(r=>r[0]==='原始动作').map(r=>r[6]),raw.map(r=>r.id));
      assert.equal(payload.receipt.downloadConfirmed,false);assert.equal(payload.receipt.status,'source_read');assert.equal(payload.receipt.scopeRevision,scopeRevision);assert.equal(payload.receipt.missingCount,1);assert.equal(payload.receipt.sourceCount,2);
      const receipt=receipts().find(r=>r.operation_id===payload.receipt.operationId);assert(receipt);assert.equal(receipt.actor_auth_user_id,actors[1].id);assert.equal(receipt.actor_employee_id,managerMember.id);assert.equal(receipt.access,'manager');
      assert.equal(receipt.location_id,location.id);assert.equal(receipt.worker_id,worker.id);assert.equal(receipts().length,beforeReceipts.length+1);intact();
    } finally {await runAttendanceCleanupSteps([{name:'manager-unified-download',timeoutMs:5000,run:()=>deleteAttendanceDownloadOnce(record)}]);}
    await exporting(manager).locator('input[type="checkbox"]:enabled:not(:checked)').waitFor({timeout:5000});
    await exporting(manager).locator('button:disabled').waitFor({timeout:5000});
    pass('fresh manager context plus separate export permission yields one actual16-column CSV matching latest8h and revision3, exact scope/actor provenance, no payroll claim and immediate temporary-file deletion');

    const held=holdCorrectionResponse(manager,endpoint('unified-export'));await exporting(manager).getByRole('checkbox').check();await exporting(manager).getByRole('button').click();
    const committed=await held.ready();assert.equal(committed.receipt.scopeRevision,scopeRevision);assert.equal(committed.receipt.downloadConfirmed,false);assert.equal(receipts().length,beforeReceipts.length+2);
    await unified(manager).getByLabel('合并核对开始日期',{exact:true}).fill('2000-01-01');await unified(manager).getByRole('article',{name:'含整段漏卡工时结果',exact:true}).waitFor({state:'detached'});
    await held.release();await manager.evaluate(()=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('missing_manager_render_settlement_timeout')),5000);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
    }));assert.equal(downloads.length,downloadStart+1);
    await unified(manager).getByLabel('合并核对开始日期',{exact:true}).fill(dates.fromDate);await query(manager);intact();
    pass('manager export held after SQL source read cannot trigger a late download after date change; two new immutable source receipts but only one actual file, without rewriting any attendance facts');

    phone=await newPage({employee:true,mobile:true});assert.equal(phone.viewportSize().width,390);await selectPair(phone,await login(phone));await openCombined(phone);
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await scope().getByRole('button',{name:'撤销此条',exact:true}).click();await click(owner,'scopes',scope().getByRole('button',{name:'确认撤销',exact:true}),'POST');
    const refused=await click(manager,'unified-timesheet',unified(manager).getByRole('button',{name:'查询含整段漏卡工时',exact:true}),'GET',403);
    assert.equal(refused.error,'attendance_access_denied');await cleared(manager);
    const staleExport=read(phone,'unified-export','POST',403);await exporting(phone).getByRole('checkbox').check();await exporting(phone).getByRole('button').click();
    assert.equal((await (await staleExport).json()).error,'attendance_access_denied');await cleared(phone);
    for(const page of [manager,phone]){
      const context=await click(page,'scoped-timesheet-context',scoped(page).getByRole('button',{name:'重新读取当前权限与范围',exact:true}));assert.deepEqual(context.items,[]);
      assert(await scoped(page).getByRole('button',{name:'查询可见工时',exact:true}).isDisabled());
    }
    assert.equal(rows('merchant_attendance_scope_grants').length,0);assert.equal(rows('merchant_attendance_scope_workers').length,0);assert.equal(rows('merchant_attendance_scope_locations').length,0);
    assert.equal(rows('merchant_attendance_scope_operations').length,scopeBefore.length+2);assert.equal(posts('scopes').length-scopePosts,2);assert.equal(posts('missing').length,missingPosts);
    assert.equal(posts('unified-export').length-exportPosts,4);assert.equal(downloads.length-downloadStart,1);assert.equal(receipts().length-beforeReceipts.length,2);assert(downloads.every(r=>r.deleted));intact();
    pass('paused owner revokes grant via actual controls: next desktop combined GET and390px old-page export POST both return SQL403 and clear parent/child results; refreshed pairs empty, zero active grants and no extra file/receipt');
    const proof={scopeCountBefore:scopeBefore.length,scopeCountAfter:rows('merchant_attendance_scope_operations').length,scopeWrites:2,sourceReadsAdded:2,downloadsAdded:1,businessFactsUnchanged:true};
    console.log(JSON.stringify({actualMissingManagerShell:true,...proof,latestMissingWorkedHours:8,realAuthService:false,productionAccess:false}));return proof;
  } finally {
    transport.state.moduleEnabled=wasEnabled;
    await runAttendanceCleanupSteps([
      {name:'missing-manager-role',run:()=>exec(`update public.merchant_enterprise_roles set permissions=array[${role.permissions.map(p=>`'${p.replaceAll("'","''")}'`).join(',')}],version=version+1 where merchant_id='${site}' and id='${role.id}';`)},
      ...(phone?[{name:'missing-manager-phone',run:()=>phone.context().close()}]:[]),
      ...(manager?[{name:'missing-manager-desktop',run:()=>manager.context().close()}]:[]),
    ]);
  }
}
