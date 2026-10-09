// Verify the approved original-employee read boundary through actual enterprise
// pages. Rebinding is an isolated fixture input, not a supported owner UI action.
// Never rewrite original events or synthetic expected facts to hide a failure.
import assert from 'node:assert/strict';

export async function checkAttendanceSelfHistoryPagingShell({newPage,click,count,requests,data,pass,origin}){
  const own=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  const history=page=>page.getByRole('region',{name:'本人历史打卡',exact:true});
  const session=page=>page.getByRole('region',{name:'本人班次核对',exact:true});
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const topRows=page=>history(page).locator('article');
  const rowFor=(page,id)=>topRows(page).filter({hasText:id});
  const home=async page=>click(page,'history',history(page).getByRole('button',{name:'重新查询首页',exact:true}));
  const next=async(page,status=200)=>click(page,'history',history(page).getByRole('button',{name:'下一页',exact:true}),status);
  const duration=n=>{
    const seconds=Math.floor(n/1000000),fraction=String(n%1000000).padStart(6,'0').replace(/0+$/,'');
    return `${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds/60)%60} 分 ${seconds%60}${fraction?'.'+fraction:''} 秒`;
  };
  const login=async page=>{
    await page.goto(origin+'/enterprise');await page.getByLabel('员工邮箱',{exact:true}).fill(data.actors.find(a=>a.id===data.employeeAuth).email);
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await page.getByRole('button',{name:'登录并选择企业',exact:true}).click();
    await page.locator('article').filter({hasText:'企业编号 '+data.site}).getByRole('button',{name:'进入工作台',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/enterprise/'+data.site);
    await page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();
    await own(page).getByRole('button',{name:'查看本人历史打卡',exact:true}).click();await history(page).waitFor();
    await history(page).getByLabel('开始日期',{exact:true}).fill(data.date);await history(page).getByLabel('结束日期（含当天）',{exact:true}).fill(data.date);
  };
  const verifyHistory=async(page,r,ids,worker)=>{
    assert.equal(r.siteId,data.site);assert.equal(r.employeeId,data.employeeId);assert.equal(r.workerId,worker);assert.equal(r.moduleEnabled,false);
    assert.deepEqual(r.items.map(item=>item.id),ids);assert(r.items.every(item=>item.workerId===worker));
    await page.waitForFunction(expected=>{
      const panel=document.querySelector('section[aria-label="本人历史打卡"]');if(!panel)return false;
      const rows=[...panel.querySelectorAll('article')];return rows.length===expected.length&&rows.every((row,index)=>row.textContent.includes(expected[index]));
    },ids,{timeout:5000});
    const text=await history(page).textContent(),visibleIds=new Set(ids);
    for(const id of [...data.oldIds,...data.otherIds,...data.forbiddenIds])if(!visibleIds.has(id))assert(!text.includes(id));
    assert.equal(await session(page).count(),0);data.assertFactsUnchanged();
  };
  const verifySession=async(page,result,expected,worker)=>{
    assert.equal(result.workerId,worker);assert.equal(result.employeeId,data.employeeId);assert.equal(result.moduleEnabled,false);
    assert.deepEqual(result.events,expected.events);assert.deepEqual(result.events.map(event=>event.id),expected.eventIds);
    await session(page).getByRole('status').filter({hasText:'已按该班次完整原始记录核对'}).waitFor();
    for(const [label,key] of [['上下班间隔','elapsedUs'],['工作段合计（扣除所有已记休息）','workedUs'],['全部已记休息','breakUs'],['其中有带薪标记的休息','paidBreakUs']]){
      const box=session(page).getByText(label,{exact:true}).locator('..');
      await box.getByText(duration(expected.totals[key]),{exact:true}).waitFor();
    }
    await session(page).getByText('原始时间与核对边界',{exact:true}).click();
    const boundary=await session(page).innerText();assert(boundary.includes(expected.startAt));assert(boundary.includes(expected.endAt));assert(boundary.includes('读取 4 条原始记录'));
    await session(page).getByText('休息明细（已结束 1 次）',{exact:true}).click();
    await session(page).getByText(expected.paid?/^1\. .* · 带薪标记$/:/^1\. .* · 非带薪标记$/).waitFor();data.assertFactsUnchanged();
  };
  const openSession=async(page,expected,worker)=>{
    const result=await click(page,'session',rowFor(page,expected.startEventId).getByRole('button',{name:'核对本班次工作／休息',exact:true}));
    await verifySession(page,result,expected,worker);return result;
  };
  let swapped=false;
  try {
    const desktop=await newPage(false),beforeHistory=count('history'),beforeSession=count('session');await login(desktop);
    assert.equal(count('history'),beforeHistory);assert.equal(count('session'),beforeSession);assert.equal(await topRows(desktop).count(),0);
    assert(await history(desktop).getByRole('button',{name:'下一页',exact:true}).isDisabled());
    assert.equal(await desktop.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'考勤明细',exact:true}).count(),0);
    pass('actual view-only employee SDK enterprise entry opens own history while paused; no manager menu, automatic history/session query or punch POST (self status GET is separate)');

    const first=await click(desktop,'history',history(desktop).getByRole('button',{name:'查询本人记录',exact:true}));
    await verifyHistory(desktop,first,data.oldIds.slice(0,50),data.worker);
    const second=await next(desktop);await verifyHistory(desktop,second,data.oldIds.slice(50,100),data.worker);
    const third=await next(desktop);await verifyHistory(desktop,third,data.oldIds.slice(100),data.worker);
    assert.equal(third.nextCursor,null);assert(await history(desktop).getByRole('button',{name:'下一页',exact:true}).isDisabled());
    const pages=[first,second,third];assert.equal(new Set(pages.flatMap(page=>page.items.map(item=>item.id))).size,104);
    const historyReads=requests.filter(r=>r.path===endpoint('history'));
    for(let n=1;n<3;n++){
      assert.equal(pages[n].asOf,first.asOf);assert.equal(historyReads[n].query.expectedWorkerId,data.worker);
      assert.equal(historyReads[n].query.cursorAt,pages[n-1].nextCursor.occurredAt);assert.equal(historyReads[n].query.cursorId,pages[n-1].nextCursor.id);
    }
    assert.equal(second.items.at(-1).occurredAt,third.items[0].occurredAt);assert(second.items.at(-1).id>third.items[0].id);
    pass('actual own history pages50/50/4 all104 fixture facts, pins worker/asOf and six-digit time plus UUID cursor; same-time boundary has no duplicates or omissions, foreign/unbound facts remain absent');

    await verifyHistory(desktop,await home(desktop),data.oldIds.slice(0,50),data.worker);
    await verifyHistory(desktop,await next(desktop),data.oldIds.slice(50,100),data.worker);
    const crossing=data.sessions[13];assert(second.items.some(row=>row.id===crossing.startEventId));assert(crossing.eventIds.some(id=>!second.items.some(row=>row.id===id)));
    await openSession(desktop,crossing,data.worker);
    const alternate=data.sessions[12];assert.notEqual(crossing.paid,alternate.paid);await openSession(desktop,alternate,data.worker);
    assert.equal(await session(desktop).count(),1);assert.equal(await rowFor(desktop,crossing.startEventId).getByRole('button',{name:'核对本班次工作／休息',exact:true}).getAttribute('aria-expanded'),'false');
    pass('second-page clock-in opens its complete four-action session beyond the50-row boundary; actual UI independently matches elapsed/work/unpaid-or-paid break totals and raw microseconds, switching sessions removes prior detail');

    await verifyHistory(desktop,await home(desktop),data.oldIds.slice(0,50),data.worker);assert.equal(await session(desktop).count(),0);
    await verifyHistory(desktop,await next(desktop),data.oldIds.slice(50,100),data.worker);await openSession(desktop,crossing,data.worker);
    const phone=await newPage(true),phoneReads=count('history');await login(phone);assert.equal(count('history'),phoneReads);
    await verifyHistory(phone,await click(phone,'history',history(phone).getByRole('button',{name:'查询本人记录',exact:true})),data.oldIds.slice(0,50),data.worker);
    await openSession(phone,data.sessions[25],data.worker);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('explicit homepage refresh unmounts nested session and resets cursor; independent390px enterprise login reads same current-worker facts and complete session without horizontal overflow or automatic writes');

    data.swapBindings();swapped=true;
    const historyBeforeDenial=count('history');
    const refused=await click(desktop,'session',session(desktop).getByRole('button',{name:'重新核对',exact:true}),404);
    assert.equal(refused.error,'attendance_session_not_found');
    await desktop.waitForFunction(()=>{
      const panel=document.querySelector('section[aria-label="本人历史打卡"]');
      return panel&&!panel.querySelector('article')&&!panel.querySelector('section[aria-label="本人班次核对"]');
    },undefined,{timeout:5000});
    assert.equal(count('history'),historyBeforeDenial,'session denial must not silently reload a new worker');
    for(const id of [...data.oldIds,...data.otherIds])assert(!(await history(desktop).textContent()).includes(id));
    const changed=await next(phone,409);assert.equal(changed.error,'attendance_worker_changed');
    await history(phone).getByRole('status').filter({hasText:'账号绑定的考勤档案已变化'}).waitFor();
    for(const page of [desktop,phone]){
      assert.equal(await topRows(page).count(),0);assert.equal(await session(page).count(),0);
      assert(await history(page).getByRole('button',{name:'下一页',exact:true}).isDisabled());
      assert(await history(page).getByRole('button',{name:'重新查询首页',exact:true}).isEnabled());
    }
    data.assertFactsUnchanged();
    pass('synthetic rebind makes old session GET404 immediately clear desktop parent and child; old mobile history cursor GET409 also clears both, without automatic homepage reads or silently switching workers');

    const originalOther=data.rawBaseline.filter(event=>event.worker_id===data.otherWorker);
    assert.equal(originalOther.length,4);assert(originalOther.every(event=>event.actor_employee_id===data.otherEmployeeId));
    for(const page of [desktop,phone]){
      const fresh=await home(page);await verifyHistory(page,fresh,[],data.otherWorker);assert.equal(fresh.nextCursor,null);
      const last=requests.filter(r=>r.path===endpoint('history')).at(-1).query;
      for(const field of ['expectedWorkerId','asOf','cursorAt','cursorId'])assert.equal(Object.hasOwn(last,field),false);
      assert.equal(await history(page).getByRole('button',{name:'核对本班次工作／休息',exact:true}).count(),0);
      for(const id of [...data.oldIds,...data.otherIds])assert(!(await history(page).textContent()).includes(id));
    }
    pass('explicit fresh history may select the new current worker but returns no OTHER-actor facts, cursor or session links on either device; original four facts remain unchanged in the fixture');

    data.restoreBindings();swapped=false;
    for(const page of [desktop,phone]){
      await verifyHistory(page,await home(page),data.oldIds.slice(0,50),data.worker);
      const persisted=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));
      for(const id of [...data.oldIds,...data.otherIds,...data.forbiddenIds])assert(!persisted.includes(id));
    }
    data.assertFactsUnchanged();assert.equal(requests.filter(r=>r.method==='POST'&&r.path.startsWith('/api/merchant-enterprise/attendance/')).length,0);
    assert(requests.filter(r=>r.method==='POST').every(r=>r.path==='/api/merchant-enterprise/employees/accept'));
    assert(requests.every(r=>r.status===200||r.path===endpoint('session')&&r.status===404||r.path===endpoint('history')&&r.status===409||r.path===endpoint('self')&&r.status===403));
    pass('exact original synthetic bindings restored, fresh explicit reads return original profile; all116 immutable fixtures/configuration remain unchanged and no event IDs persist in browser storage');
    console.log(JSON.stringify({actualSelfHistoryPagingEnterpriseShell:true,historyPages:[50,50,4],fixtureCompletedSessions:26,productionAccess:false,realAuthService:false,realNextRuntime:false,syntheticPreseededFacts:true,browserBusinessWrites:0,bindingsRestored:true,originalActorIsolation:true,sessionDenialClearsParent:true}));
  } finally {if(swapped)data.restoreBindings();}
}
