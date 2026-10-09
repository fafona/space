// Actual same-page employee SDK logout/login, default handlers and isolated SQL.
// Auth/entitlement remain synthetic. No credentials or pending intent are injected.
import assert from 'node:assert/strict';

const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const keys=value=>Object.keys(value).sort();
const pendingKey=(c,member)=>'faolla:attendance:self:v1:'+c.site+':'+c.employees[member];
const micros=value=>{
  const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  assert(match,'account_switch_invalid_fact_timestamp');
  const seconds=Date.parse(match[1]+match[3]);assert(Number.isFinite(seconds),'account_switch_invalid_fact_timestamp');
  return BigInt(seconds)*1000n+BigInt((match[2]??'').padEnd(6,'0'));
};

export function assertAccountSwitchPending(raw,{consts:c,member,action,sequence}){
  assert(typeof raw==='string'&&raw.length<=2048,'account_switch_pending_required');
  const value=JSON.parse(raw);
  assert.deepEqual(keys(value),['command','employeeId','siteId','version','workerId']);
  assert.equal(value.version,1);assert.equal(value.siteId,c.site);assert.equal(value.employeeId,c.employees[member]);assert.equal(value.workerId,c.workers[member]);
  assert.deepEqual(keys(value.command),['action','expectedSequence','expectedWorkerId','locationId','operationId']);
  const command=value.command;
  assert.equal(command.expectedWorkerId,c.workers[member]);assert.equal(command.locationId,c.place);
  assert.equal(command.action,action);assert.equal(command.expectedSequence,sequence);assert.match(command.operationId,uuid);
  return command;
}

export function assertAccountSwitchFacts(previous,current,{consts:c,accepted}){
  assert.equal(current.length,accepted.length,'account_switch_fact_count');
  assert.equal(new Set(current.map(row=>row.id)).size,current.length);
  assert.equal(new Set(current.map(row=>row.operation_id)).size,current.length);
  for(const row of previous)assert.deepEqual(current.find(next=>next.id===row.id),row,'account_switch_original_fact_changed');
  for(const {member,browserActor,command,result} of accepted){
    const receipt=result.receipt;assert(receipt,'account_switch_receipt_required');
    const row=current.find(item=>item.id===receipt.id);assert(row,'account_switch_receipt_without_sql_fact');
    assert.equal(result.ok,true);assert.equal(result.replayed,false);assert.equal(result.workerId,c.workers[member]);assert.equal(result.locationId,c.place);
    assert.equal(result.state.sequence,receipt.sequence);assert.equal(result.state.lastEvent.id,receipt.id);
    assert.equal(row.merchant_id,c.site);assert.equal(row.worker_id,c.workers[member]);assert.equal(row.location_id,c.place);assert.equal(row.source,'web');
    assert.equal(row.actor_employee_id,c.employees[member]);assert.equal(browserActor,c.authUsers[member],'account_switch_browser_auth_principal');
    assert.equal(command.expectedWorkerId,c.workers[member]);assert.equal(command.locationId,c.place);
    assert.equal(row.operation_id,command.operationId);assert.equal(receipt.operationId,command.operationId);
    assert.equal(row.sequence,command.expectedSequence+1);assert.equal(receipt.sequence,row.sequence);
    assert.equal(row.action,command.action);assert.equal(receipt.action,row.action);
    assert.equal(receipt.workerId,row.worker_id);assert.equal(receipt.locationId,row.location_id);assert.equal(receipt.siteId,c.site);
    assert.equal(micros(receipt.occurredAt),micros(row.occurred_at));assert.equal(receipt.timeZone,row.time_zone);assert.equal(receipt.breakPaid,row.break_paid);
  }
}

export function assertAccountSwitchHistory(result,{consts:c,member,facts}){
  assert.equal(result.ok,true);assert.equal(result.siteId,c.site);assert.equal(result.employeeId,c.employees[member]);assert.equal(result.workerId,c.workers[member]);
  assert.equal(typeof result.moduleEnabled,'boolean');assert.equal(result.nextCursor,null);
  const expected=facts.filter(row=>row.worker_id===c.workers[member]).sort((a,b)=>{
    const delta=micros(b.occurred_at)-micros(a.occurred_at);return delta<0n?-1:delta>0n?1:b.id.localeCompare(a.id);
  });
  assert.deepEqual(result.items.map(row=>row.id),expected.map(row=>row.id));
  for(const [index,item] of result.items.entries()){
    const row=expected[index];assert.equal(item.workerId,c.workers[member]);assert.equal(item.locationId,c.place);
    assert.equal(item.sequence,row.sequence);assert.equal(item.action,row.action);assert.equal(item.source,row.source);
    assert.equal(micros(item.occurredAt),micros(row.occurred_at));
    assert.equal(item.workerName,c.labels[member]);assert.equal(item.workerNo,member==='a'?c.labels.workerA:c.labels.workerB);
  }
  return expected.map(row=>row.id);
}

export function assertAccountSwitchCrossProbe(kind,status,payload,{consts:c,bReceipt}){
  if(kind==='otherReceipt'){
    assert.equal(status,200);assert.equal(payload.ok,true);assert.equal(payload.workerId,c.workers.b);assert.equal(payload.locationId,c.place);
    assert.equal(payload.receipt,null);assert.equal(payload.replayed,false);assert.equal(payload.state.status,'working');assert.equal(payload.state.sequence,1);
    assert.deepEqual(payload.state.lastEvent,bReceipt);return;
  }
  const expected={otherCommand:[409,'attendance_worker_changed'],otherSession:[404,'attendance_session_not_found'],
    otherHistory:[409,'attendance_worker_changed'],oldToken:[401,'unauthorized']}[kind];
  assert(expected,'account_switch_unknown_probe');assert.equal(status,expected[0]);assert.deepEqual(payload,{ok:false,error:expected[1]});
}

export async function checkAttendanceAccountSwitchShell({phone,response,requests,exec,events,audits,prepared,origin,actors,pass,holdResponse,loseNextSelfResponse,accountRequest}){
  const c=prepared.consts;assert.equal(c.site,'99990001');
  for(const group of [c.employees,c.workers,c.authUsers]){assert.match(group.a,uuid);assert.match(group.b,uuid);assert.notEqual(group.a,group.b);}
  assert.match(c.place,uuid);
  const actor=member=>{const found=actors.find(item=>item.id===c.authUsers[member]);assert(found);return found;};
  assert.equal(new URL(phone.url()).origin,origin);assert.equal(new URL(phone.url()).pathname,'/enterprise/'+c.site);
  const documentTimeOrigin=await phone.evaluate(()=>performance.timeOrigin);
  assert.deepEqual(events(),[]);assert.deepEqual(audits(),[]);
  const protectedFacts=()=>exec("select md5(jsonb_build_object("+
    "'employees',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_employees t),"+
    "'roles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t),"+
    "'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),"+
    "'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),"+
    "'locations',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t),"+
    "'periods',(select jsonb_agg(to_jsonb(t) order by worker_id,starts_on) from public.merchant_attendance_employment_periods t),"+
    "'scopes',(select jsonb_agg(to_jsonb(t) order by employee_id) from public.merchant_attendance_scopes t),"+
    "'grants',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_scope_grants t),"+
    "'boards',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_boards t),"+
    "'columns',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_columns t),"+
    "'roleBoards',(select jsonb_agg(to_jsonb(t) order by role_id,board_id) from public.merchant_enterprise_role_boards t),"+
    "'tasks',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_tasks t),"+
    "'assignments',(select jsonb_agg(to_jsonb(t) order by task_id,employee_id) from public.merchant_task_assignees t))::text);");
  const original=protectedFacts(),accepted=[],gates=new Set();let previous=[],unconfirmedFacts=null;
  const safe=()=>{
    assert.equal(protectedFacts(),original,'account_switch_configuration_changed');assert.deepEqual(audits(),[]);
    const current=events();
    if(unconfirmedFacts)assert.deepEqual(current,unconfirmedFacts,'account_switch_unconfirmed_facts_changed');
    else assertAccountSwitchFacts(previous,current,{consts:c,accepted});
    previous=current;return current;
  };
  const self=()=>phone.getByRole('region',{name:'我的考勤',exact:true}),history=()=>phone.getByRole('region',{name:'本人历史打卡',exact:true});
  const nav=()=>phone.getByRole('navigation',{name:'企业管理功能',exact:true});
  const pending=member=>phone.evaluate(key=>sessionStorage.getItem(key),pendingKey(c,member));
  const posts=()=>requests.filter(row=>row.path===endpoint('self')&&row.method==='POST');
  const waitRead=(path,operationId)=>{
    const waiting=phone.waitForResponse(reply=>{
      const url=new URL(reply.url());return url.origin===origin&&url.pathname===path&&reply.request().method()==='GET'
        &&(operationId===undefined||url.searchParams.get('operationId')===operationId);
    },{timeout:12000}).then(async reply=>{assert.equal(reply.status(),200,'account_switch_read_status');return reply.json();});
    void waiting.catch(()=>{});return waiting;
  };
  const showNavigation=async target=>{
    if(!await target.isVisible())await phone.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();
    await target.waitFor({state:'visible'});
  };
  const enter=async(member,operationId=null)=>{
    const waiting=waitRead(endpoint('self'),operationId);
    if(await self().count())await self().getByRole('button',{name:/^(刷新状态|核对打卡结果)$/}).click();
    else{const button=nav().getByRole('button',{name:'我的考勤',exact:true});await showNavigation(button);await button.click();}
    const result=await waiting;assert.equal(result.ok,true);assert.equal(result.workerId,c.workers[member]);
    await self().getByText(c.labels[member]+' · 仅记录本人打卡',{exact:true}).waitFor();
    await self().getByRole('button',{name:/^(刷新状态|核对打卡结果)$/}).waitFor();
    return result;
  };
  const logout=async()=>{
    const button=phone.getByRole('button',{name:'退出员工登录',exact:true});await showNavigation(button);
    const waiting=phone.waitForResponse(reply=>new URL(reply.url()).pathname==='/auth/v1/logout'&&reply.request().method()==='POST',{timeout:12000});
    void waiting.catch(()=>{});await button.click();
    await phone.getByLabel('员工邮箱',{exact:true}).waitFor();
    assert.equal(await self().count(),0);assert.equal(await history().count(),0);
    assert.equal((await waiting).status(),204);await phone.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();
    assert.equal(new URL(phone.url()).pathname,'/enterprise/'+c.site);
    assert.equal(await phone.evaluate(()=>performance.timeOrigin),documentTimeOrigin,'account_switch_logout_reloaded_document');
  };
  const login=async member=>{
    await phone.getByLabel('员工邮箱',{exact:true}).fill(actor(member).email);
    await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
    await phone.getByRole('button',{name:'登录企业工作台',exact:true}).click();await nav().waitFor({state:'attached'});
    assert.equal(new URL(phone.url()).pathname,'/enterprise/'+c.site);
    assert.equal(await phone.evaluate(()=>performance.timeOrigin),documentTimeOrigin,'account_switch_login_reloaded_document');
  };
  const readHistory=async member=>{
    if(!await history().count())await self().getByRole('button',{name:'查看本人历史打卡',exact:true}).click();
    await history().waitFor();
    const dates=events().map(row=>new Date(Number(micros(row.occurred_at)/1000n)).toISOString().slice(0,10)).sort();assert(dates.length);
    await history().getByLabel('开始日期',{exact:true}).fill(dates[0]);
    await history().getByLabel('结束日期（含当天）',{exact:true}).fill(dates.at(-1));
    const waiting=waitRead(endpoint('history'));await history().getByRole('button',{name:'查询本人记录',exact:true}).click();
    const result=await waiting;await verifyHistoryDom(result,member);return result;
  };
  const verifyHistoryDom=async(result,member)=>{
    const ids=assertAccountSwitchHistory(result,{consts:c,member,facts:events()});
    await phone.waitForFunction(expected=>{
      const panel=document.querySelector('section[aria-label="本人历史打卡"]');
      const rows=panel?[...panel.querySelectorAll('article')]:[];
      return !!panel&&rows.length===expected.length&&rows.every((row,index)=>row.textContent.includes(expected[index]));
    },ids,{timeout:5000});
    const text=await history().textContent();
    for(const row of events())if(!ids.includes(row.id))assert(!text.includes(row.id),'account_switch_other_history_visible');
    assert(!text.includes(c.labels[member==='a'?'workerB':'workerA']));safe();
  };
  const confirmed=async receipt=>self().getByText('收据编号：'+receipt.id,{exact:true}).waitFor();
  const settle=()=>phone.evaluate(()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('account_switch_render_timeout')),5000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
  }));
  const release=async gate=>{await gate.release();gates.delete(gate);await settle();};
  const commandFromPost=()=>{const body=posts().at(-1).body;assert.equal(body.siteId,c.site);const {siteId,...command}=body;assert.equal(siteId,c.site);return command;};
  try{
    assert.equal(posts().length,0);assert.equal(await pending('a'),null);assert.equal(await pending('b'),null);
    const initial=await enter('a');assert.equal(initial.state.sequence,0);assert.equal(initial.receipt,null);
    const firstReply=response(phone,endpoint('self'),'POST');void firstReply.catch(()=>{});
    await self().getByRole('button',{name:'上班打卡',exact:true}).click();const first=await(await firstReply).json();
    await confirmed(first.receipt);accepted.push({member:'a',browserActor:posts().at(-1).actorId,command:commandFromPost(),result:first});safe();
    assert.equal(await pending('a'),null);await readHistory('a');assert.equal(posts().length,1);
    pass('actual A SDK shell creates one SQL clock-in and reads exactly its own event; browser Auth principal, SQL employee/worker, receipt, timestamp and unchanged configuration independently match');

    const late=holdResponse({actorId:c.authUsers.a,path:endpoint('self'),method:'POST'});gates.add(late);
    await self().getByRole('button',{name:'下班打卡',exact:true}).click();const second=await late.ready();
    const rawA=await pending('a'),aCommand=assertAccountSwitchPending(rawA,{consts:c,member:'a',action:'clock_out',sequence:1});
    assert.deepEqual(commandFromPost(),aCommand);
    accepted.push({member:'a',browserActor:posts().at(-1).actorId,command:aCommand,result:second});safe();assert.equal(posts().length,2);
    await logout();assert.equal(await pending('a'),rawA);
    const bBegin=requests.length;await login('b');const bInitial=await enter('b');assert.equal(bInitial.state.sequence,0);assert.equal(bInitial.receipt,null);
    assert.equal(await pending('b'),null);await release(late);
    assert.equal(await pending('a'),rawA);assert.equal(await pending('b'),null);
    const bText=await self().textContent();assert(!bText.includes(c.labels.a));assert(!bText.includes(second.receipt.id));assert(!bText.includes(aCommand.operationId));
    assert.equal(await history().count(),0);assert(!requests.slice(bBegin).some(row=>row.path===endpoint('self')&&row.query.operationId===aCommand.operationId));
    assert.equal(posts().length,2);safe();
    pass('A clock-out commits before its response is held; same-page logout/login B and released late response cannot restore A DOM or erase A pending, and B never queries A operation');

    loseNextSelfResponse({actorId:c.authUsers.b});await self().getByRole('button',{name:'上班打卡',exact:true}).click();
    await self().getByText('打卡结果待确认',{exact:true}).waitFor();
    const rawB=await pending('b'),bCommand=assertAccountSwitchPending(rawB,{consts:c,member:'b',action:'clock_in',sequence:0});
    assert.deepEqual(commandFromPost(),bCommand);
    const bBrowserActor=posts().at(-1).actorId;assert.equal(bBrowserActor,c.authUsers.b);
    assert.notEqual(aCommand.operationId,bCommand.operationId);assert.equal(await pending('a'),rawA);
    const bRow=events().find(row=>row.operation_id===bCommand.operationId);assert(bRow);assert.equal(events().length,3);
    // This fact has no delivered POST response. Its default-service GET below
    // supplies the independent receipt proof; until then compare the saved rows.
    for(const row of previous)assert.deepEqual(events().find(next=>next.id===row.id),row);
    assert.equal(bRow.worker_id,c.workers.b);assert.equal(bRow.actor_employee_id,c.employees.b);
    unconfirmedFacts=events();safe();assert.equal(posts().length,3);
    pass('B clock-in response is lost after SQL, leaving two exact membership-scoped pending commands with different workers and operation IDs; no duplicate fact is produced');

    await logout();await login('a');const recoveredA=await enter('a',aCommand.operationId);
    assert.deepEqual(recoveredA.receipt,second.receipt);assert.equal(recoveredA.replayed,false);await confirmed(second.receipt);
    assert.equal(await pending('a'),null);assert.equal(await pending('b'),rawB);assert.equal(posts().length,3);
    // B is deliberately still unresolved in the UI; verify only A's existing
    // facts here and retain the entire database snapshot for later immutability.
    const beforeBRecovery=events();
    const aHistory=await readHistory('a');
    assert.deepEqual(new Set(aHistory.items.map(row=>row.id)),new Set([second.receipt.id,first.receipt.id]));
    pass('returning A recovers its original committed receipt by GET only, clears only A pending and reads exactly A two facts while preserving B pending byte-for-byte');

    const oldHistory=holdResponse({actorId:c.authUsers.a,path:endpoint('history'),method:'GET'});gates.add(oldHistory);
    await history().getByRole('button',{name:'重新查询首页',exact:true}).click();const heldHistory=await oldHistory.ready();
    assertAccountSwitchHistory(heldHistory,{consts:c,member:'a',facts:events()});
    await logout();await login('b');const recoveredB=await enter('b',bCommand.operationId);
    assert.equal(recoveredB.replayed,false);await confirmed(recoveredB.receipt);
    accepted.push({member:'b',browserActor:bBrowserActor,command:bCommand,result:recoveredB});unconfirmedFacts=null;safe();
    assert.deepEqual(events(),beforeBRecovery);assert.equal(await pending('a'),null);assert.equal(await pending('b'),null);
    const bHistory=await readHistory('b');assert.deepEqual(bHistory.items.map(row=>row.id),[recoveredB.receipt.id]);
    await release(oldHistory);await verifyHistoryDom(bHistory,'b');assert.equal(await pending('a'),null);assert.equal(await pending('b'),null);
    assert.equal(posts().length,3);assert(!((await self().textContent()).includes(c.labels.a)));safe();
    pass('B returns through its original GET receipt without another POST; released A history cannot replace B single-row history or revive A data, and both owned pending slots are now clear');

    const cross=[
      ['otherReceipt',{actorId:c.authUsers.b,path:endpoint('self')+'?'+new URLSearchParams({siteId:c.site,operationId:aCommand.operationId}),method:'GET'}],
      ['otherCommand',{actorId:c.authUsers.b,path:endpoint('self'),method:'POST',body:{siteId:c.site,...aCommand}}],
      ['otherSession',{actorId:c.authUsers.b,path:endpoint('session')+'?'+new URLSearchParams({siteId:c.site,startEventId:first.receipt.id}),method:'GET'}],
      ['otherHistory',{actorId:c.authUsers.b,path:endpoint('history')+'?'+new URLSearchParams({siteId:c.site,fromAt:bHistory.items[0].occurredAt.slice(0,10)+'T00:00:00.000000Z',toAt:new Date(Date.parse(bHistory.items[0].occurredAt.slice(0,10)+'T00:00:00Z')+86400000).toISOString(),expectedWorkerId:c.workers.a}),method:'GET'}],
      ['oldToken',{actorId:c.authUsers.a,tokenEpoch:0,path:endpoint('self')+'?'+new URLSearchParams({siteId:c.site}),method:'GET'}],
    ];
    const crossBaseline=events();
    for(const [kind,input] of cross){
      const result=await accountRequest(input);assertAccountSwitchCrossProbe(kind,result.status,await result.json(),{consts:c,bReceipt:recoveredB.receipt});
      assert.deepEqual(events(),crossBaseline);safe();
    }
    assert.equal(posts().length,3);assert.equal(await pending('a'),null);assert.equal(await pending('b'),null);
    assert.equal(await phone.evaluate(()=>performance.timeOrigin),documentTimeOrigin,'account_switch_final_document_changed');
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('captured real SDK B token gets own state with null A receipt, A worker POST409, A session404 and pinned history409; old A token gets401 only in the local Auth fixture, with zero added facts or audits');
    return {actualAccountSwitchShell:true,accountSwitches:3,browserPunchPosts:3,crossWorkerRejectedPosts:1,directProbes:5,
      attendanceEvents:3,managementAudits:0,receiptGetRecoveries:2,lateResponses:2,sameDocument:true,pendingSlotsCleared:true,protectedFactsUnchanged:true,
      syntheticAuthAndEntitlement:true,realAuthService:false,realNextServer:false,productionAccess:false};
  }finally{
    // The runner also owns these bounded gates; always unblock it on assertion
    // failure, even if the original document already aborted delivery.
    await Promise.allSettled([...gates].map(gate=>gate.release()));
  }

}
