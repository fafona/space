// Pure SQL transport contracts, never a terminal/clock business model.
// No browser, database, network, persisted credentials or generated artifacts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const names={admin:'faolla_attendance_terminal_admin_v1',device:'faolla_attendance_terminal_device_v1',issue:'faolla_attendance_onsite_issue_v1',clock:'faolla_attendance_onsite_clock_v1'};
const site='99990001',owner=actors[0].id,employee=actors[2].id,terminal=id(8801),location=id(401),worker=id(201),employeeId=id(102),operation=id(8802),nonce=id(8803);
const hash='a'.repeat(64),deviceHash='b'.repeat(64),query={cursor:null,terminalId:null};
const create={action:'create',terminalId:terminal,locationId:location,label:"合成终端 ' quote \\ slash",pairHash:hash};
const command={expectedWorkerId:worker,operationId:operation,locationId:location,action:'clock_in',expectedSequence:0,expectedEmployeeId:employeeId};
const claims={v:1,purpose:'faolla.attendance.onsite',siteId:site,terminalId:terminal,locationId:location,
  pairedAtMs:1000,issuedAtMs:2000,expiresAtMs:47000,nonce};
const adminArgs=(q=query,c=null,allow=false,actor=owner)=>({p_site:site,p_auth:actor,p_query:q,p_command:c,p_allow_create:allow});
const deviceArgs=(device=deviceHash,allow=true)=>({p_site:site,p_id:terminal,p_secret_hash:hash,p_device_hash:device,p_allow_pair:allow});
const issueArgs=()=>({p_site:site,p_terminal:terminal,p_secret_hash:deviceHash});
const clockArgs=(c=null,qr=null,op=null,allow=false,actor=employee)=>({p_site:site,p_auth:actor,p_claims:qr,p_command:c,p_operation:op,p_allow_new:allow});
const marker={opaqueSqlMarker:'not-a-business-result'};
const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const statement=(name,args)=>`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${args}));`;
function fixture(reply=()=>JSON.stringify({role:'service_role',data:marker})) {
  const statements=[],transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return reply(sql);});
  return {transport,statements};
}
async function rejected(name,inputs,pattern) {
  const f=fixture();
  for(const [index,input] of inputs.entries())await assert.rejects(f.transport.rpc(name,input),pattern,`invalid input ${index}`);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);assert.deepEqual(f.transport.errors,[]);
}

test('terminal admin exact reads/create/revoke preserve SQL argument order and redact credential hashes from logs',async()=>{
  const f=fixture();
  for(const q of [query,{cursor:terminal,terminalId:null},{cursor:null,terminalId:terminal}]){
    assert.deepEqual(await f.transport.rpc(names.admin,adminArgs(q)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.admin,`'${site}','${owner}',${json(q)},null,false`));
    assert.deepEqual(f.transport.calls.at(-1).query,q);assert.equal(f.transport.calls.at(-1).terminalId,q.terminalId);
  }
  for(const c of [create,{action:'revoke',terminalId:terminal}])for(const actor of [owner,employee]){
    // Paused creates and a non-owner actor still reach current SQL authorization.
    await f.transport.rpc(names.admin,adminArgs(query,c,false,actor));
    assert.equal(f.statements.at(-1),statement(names.admin,`'${site}','${actor}',${json(query)},${json(c)},false`));
    const call=f.transport.calls.at(-1);assert.equal(call.actor,actor);assert.equal(call.allowCreate,false);assert.equal(call.terminalId,terminal);
    assert.deepEqual(call.command,c.action==='create'?{action:'create',terminalId:terminal,locationId:location,label:create.label}:c);
    assert.equal(call.operationId,null);
  }
  assert.equal(JSON.stringify(f.transport.calls).includes(hash),false);
});

test('terminal admin rejects malformed selectors, mixed reads/writes, labels, raw secrets and command extras',async()=>{
  await rejected(names.admin,[
    ...[null,{},[],{cursor:null},{...query,extra:null},{cursor:terminal,terminalId:terminal},{...query,cursor:'bad'},
      {...query,terminalId:42}].map(q=>adminArgs(q)),
  ],/invalid_query/);
  await rejected(names.admin,[
    ...[undefined,{},[],{...create,action:'pair'},{...create,pairSecret:'A'.repeat(43)},
      {...create,terminalId:'bad'},{...create,locationId:null},{...create,pairHash:'A'.repeat(64)},
      {...create,pairHash:hash.slice(1)},{...create,label:''},{...create,label:' padded '},
      {...create,label:'x'.repeat(81)},{...create,label:'bad\u0085label'},
      {action:'revoke',terminalId:terminal,pairHash:hash}].map(c=>({...adminArgs(),p_command:c})),
    adminArgs({cursor:terminal,terminalId:null},create),adminArgs({cursor:null,terminalId:terminal},{action:'revoke',terminalId:terminal}),
    ...[null,undefined,0,1,'false'].map(allow=>({...adminArgs(),p_allow_create:allow})),
  ],/invalid_command|mixed_write_read|invalid_create_gate/);
  const f=fixture();await f.transport.rpc(names.admin,adminArgs(query,{...create,label:'😀'.repeat(80)},true));assert.equal(f.statements.length,1);
});

test('device pairing/status and onsite issue alone allow credential authentication without an actor',async()=>{
  const f=fixture();
  for(const [value,allow] of [[deviceHash,true],[deviceHash,false],[null,true],[null,false],[hash,true]]){
    const args=deviceArgs(value,allow);
    assert.deepEqual(await f.transport.rpc(names.device,args),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.device,`'${site}','${terminal}','${hash}',${value===null?'null':"'"+value+"'"},${allow}`));
    assert.deepEqual(f.transport.calls.at(-1),{name:names.device,actor:null,siteId:site,employeeId:null,operationId:null,command:null,query:null,terminalId:terminal,allowPair:allow});
  }
  assert.deepEqual(await f.transport.rpc(names.issue,issueArgs()),{data:marker,error:null});
  assert.equal(f.statements.at(-1),statement(names.issue,`'${site}','${terminal}','${deviceHash}'`));
  assert.deepEqual(f.transport.calls.at(-1),{name:names.issue,actor:null,siteId:site,employeeId:null,operationId:null,command:null,query:null,terminalId:terminal});
  for(const value of [hash,deviceHash])assert.equal(JSON.stringify(f.transport.calls).includes(value),false);
});

test('device RPCs strictly reject invalid hashes, UUIDs, coercible gates, auth injection and unknown credentials',async()=>{
  for(const [name,args,idKey] of [[names.device,deviceArgs(),'p_id'],[names.issue,issueArgs(),'p_terminal']]){
    await rejected(name,[...['',null,undefined,123,'A'.repeat(64),'c'.repeat(63),'c'.repeat(65),'A'.repeat(43)].map(value=>({...args,p_secret_hash:value})),
      {...args,[idKey]:null},{...args,[idKey]:'not-a-uuid'},
      {...args,p_auth:owner},{...args,p_auth_user_id:owner},{...args,secret:'A'.repeat(43)},{...args,p_claims:claims},
    ],/invalid_secret_hash|invalid_terminal|invalid_rpc_arguments/);
  }
  await rejected(names.device,[
    ...[undefined,0,'','B'.repeat(64),'b'.repeat(63)].map(value=>({...deviceArgs(),p_device_hash:value})),
    ...[undefined,null,0,1,'true'].map(value=>({...deviceArgs(),p_allow_pair:value})),
  ],/invalid_device_hash|invalid_pair_gate/);
});

test('onsite status and exact original operation GET retain principal guards without claims or token',async()=>{
  const f=fixture();
  for(const op of [null,operation])for(const allow of [false,true]){
    assert.deepEqual(await f.transport.rpc(names.clock,clockArgs(null,null,op,allow)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.clock,`'${site}','${employee}',null,null,${op===null?'null':"'"+op+"'"},${allow}`));
    assert.deepEqual(f.transport.calls.at(-1),{name:names.clock,actor:employee,siteId:site,employeeId:null,operationId:op,command:null,query:null,allowNew:allow});
  }
  await rejected(names.clock,[clockArgs(null,claims),clockArgs(null,{},operation),clockArgs(null,null,'bad'),
    {...clockArgs(),token:'aq1.synthetic.token'},...['false',0,null,undefined].map(value=>({...clockArgs(),p_allow_new:value}))],
  /read_claims|invalid_operation|invalid_rpc_arguments|invalid_clock_gate/);
});

test('onsite commands forward exact six-field intent and signed-claim DTO without fixture freshness or authorization guesses',async()=>{
  const f=fixture();
  for(const action of ['clock_in','break_start','break_end','clock_out']){
    const c={...command,action};
    // Deliberately old claims: real SQL decides expiry or an exact replay.
    assert.deepEqual(await f.transport.rpc(names.clock,clockArgs(c,claims,null,false,owner)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.clock,`'${site}','${owner}',${json(claims)},${json(c)},null,false`));
    const call=f.transport.calls.at(-1);assert.equal(call.actor,owner);assert.deepEqual(call.command,c);assert.equal(call.operationId,operation);
    assert.equal(call.terminalId,terminal);assert.equal(call.locationId,location);assert.equal(call.expectedWorkerId,worker);assert.equal(call.allowNew,false);
    assert.equal(Object.hasOwn(call,'claims'),false);
  }
  assert.equal(JSON.stringify(f.transport.calls).includes(nonce),false);
});

test('onsite command shape cannot add source/coordinates, change bindings, omit expected identity or mix operation reads',async()=>{
  const invalid=[undefined,{},[],{...command,source:'web'},{...command,latitude:1},{...command,expectedEmployeeId:null},
    {...command,expectedWorkerId:'bad'},{...command,locationId:null},{...command,operationId:'bad'},{...command,action:'pair'},
    ...[-1,1.5,'0',null,NaN,Infinity,Number.MAX_SAFE_INTEGER].map(value=>({...command,expectedSequence:value}))];
  await rejected(names.clock,invalid.map(c=>({...clockArgs(),p_command:c,p_claims:claims})),/invalid_clock_command/);
  await rejected(names.clock,[clockArgs(command,claims,operation),clockArgs({...command,locationId:id(402)},claims)],/mixed_write_read|invalid_claims/);
});

test('onsite claims enforce the exact domain, site, nine keys, UUIDs and structural 45-second clock bounds',async()=>{
  const invalid=[null,{},[],{...claims,token:'secret'},{...claims,v:2},{...claims,purpose:'faolla.other'},
    {...claims,siteId:'99990002'},{...claims,siteId:99990001},{...claims,terminalId:'bad'},
    {...claims,nonce:null},{...claims,locationId:id(402)},{...claims,pairedAtMs:3000},
    {...claims,expiresAtMs:47001},{...claims,issuedAtMs:'2000'},
    ...[-1,-0,1.1,NaN,Infinity,8640000000000001].map(value=>({...claims,pairedAtMs:value}))];
  await rejected(names.clock,invalid.map(qr=>clockArgs(command,qr)),/invalid_claims/);
  const f=fixture();await f.transport.rpc(names.clock,clockArgs(command,{...claims,pairedAtMs:0,issuedAtMs:0,expiresAtMs:45000}));
  assert.equal(f.statements.length,1);
});

test('short SQL parameter names do not widen prior RPC identity, tenant or own-key allowlists',async()=>{
  const f=fixture();
  for(const name of ['constructor','toString','faolla_attendance_terminal_admin_v2','faolla_attendance_onsite_clock_v2',names.device+';select 1'])
    await assert.rejects(f.transport.rpc(name,{}),/unexpected_rpc/);
  for(const [name,args] of [[names.admin,adminArgs()],[names.device,deviceArgs()],[names.issue,issueArgs()],[names.clock,clockArgs()]]){
    const {p_site:removed,...rest}=args;assert.equal(removed,site);
    await rejected(name,[rest,Object.assign(Object.create({p_site:site}),rest),{...args,p_site:'99990002'},
      {...args,p_site:99990001},{...args,p_site_id:site},{...args,extra:null}],/invalid_rpc_arguments|invalid_site/);
  }
  for(const [name,args] of [[names.admin,adminArgs()],[names.clock,clockArgs()]]){
    const {p_auth:removed,...rest}=args;assert(removed);
    await rejected(name,[rest,Object.assign(Object.create({p_auth:owner}),rest),{...args,p_auth:null},{...args,p_auth:id(999)},
      {...args,p_auth_user_id:owner}],/invalid_actor|invalid_rpc_arguments/);
  }
  await rejected('faolla_attendance_self_context_v1',[
    {p_site:site,p_auth:employee},{p_site_id:site},{p_site_id:site,p_auth_user_id:null},
    {p_site_id:site,p_auth_user_id:employee,p_secret_hash:hash},
  ],/invalid_rpc_arguments|invalid_actor/);
  assert.deepEqual(f.statements,[]);
});

test('credential SQL failures stay typed or sanitized and never log driver-echoed hashes or QR claims',async()=>{
  for(const [name,args] of [[names.admin,adminArgs(query,create)],[names.device,deviceArgs()],[names.issue,issueArgs()],[names.clock,clockArgs(command,claims)]]){
    const denied=fixture(()=>{throw Error('ERROR: attendance_terminal_denied');});
    assert.deepEqual(await denied.transport.rpc(name,args),{data:null,error:{message:'attendance_terminal_denied'}});
    assert.equal(denied.statements.length,1);assert.deepEqual(denied.transport.errors,[]);
    const failed=fixture(sql=>{throw Error('driver transport failure '+sql);});
    await assert.rejects(failed.transport.rpc(name,args),error=>error.message==='attendance_terminal_shell_sql_failure');
    assert.deepEqual(failed.transport.errors,['attendance_terminal_shell_sql_failure']);
    for(const value of [hash,deviceHash,nonce])assert.equal(JSON.stringify({calls:failed.transport.calls,errors:failed.transport.errors}).includes(value),false);
    const wrongRole=fixture(()=>JSON.stringify({role:'postgres',data:marker}));
    await assert.rejects(wrongRole.transport.rpc(name,args),/wrong_database_role/);
  }
});

test('terminal and onsite logs are detached and lossy serialization cannot alter credentials or intent after validation',async()=>{
  const f=fixture(),admin=adminArgs(structuredClone(query),structuredClone(create)),clock=clockArgs(structuredClone(command),structuredClone(claims));
  await f.transport.rpc(names.admin,admin);await f.transport.rpc(names.clock,clock);
  admin.p_command.label='changed';clock.p_command.action='clock_out';clock.p_claims.terminalId=id(999);
  assert.equal(f.transport.calls[0].command.label,create.label);assert.equal(f.transport.calls[1].command.action,'clock_in');assert.equal(f.transport.calls[1].terminalId,terminal);
  const lossy=Object.defineProperty({...create},'toJSON',{enumerable:false,value:()=>({...create,pairHash:deviceHash})});
  await rejected(names.admin,[adminArgs(query,lossy)],/non_json_arguments/);
});

test('actual server executors hash terminal secrets and verify onsite signatures before reaching the strict SQL transport',async()=>{
  const {executeTerminalAdmin,executeTerminalDevice,terminalHash}=require('../src/lib/merchantAttendanceTerminal.server.ts');
  const {executeOnsiteIssue,executeOnsiteClock,signOnsiteToken}=require('../src/lib/merchantAttendanceOnsiteQr.server.ts');
  const f=fixture(()=>{throw Error('ERROR: attendance_terminal_denied');}),secret='A'.repeat(43),deviceSecret='B'.repeat(42)+'A';
  const key='FAOLLA_ATTENDANCE_ONSITE_QR_SECRET',previous=process.env[key];process.env[key]='d'.repeat(64);
  try {
    const token=signOnsiteToken(claims);
    const invoke=[
      ()=>executeTerminalAdmin({siteId:site,cursor:null,terminalId:null,authUserId:owner,command:{action:'create',terminalId:terminal,locationId:location,label:create.label,pairSecret:secret},allowCreate:true},f.transport),
      ()=>executeTerminalDevice({siteId:site,terminalId:terminal,secret,deviceSecret,allowPair:true},f.transport),
      ()=>executeOnsiteIssue({siteId:site,terminalId:terminal,secret:deviceSecret},f.transport),
      ()=>executeOnsiteClock({siteId:site,authUserId:employee,token,command,operationId:null,allowNew:true},f.transport),
      ()=>executeOnsiteClock({siteId:site,authUserId:employee,token:null,command:null,operationId:operation,allowNew:false},f.transport),
    ];
    for(const action of invoke)await assert.rejects(action,error=>error.code==='attendance_terminal_denied');
    assert.deepEqual(f.transport.calls.map(call=>call.name),[names.admin,names.device,names.issue,names.clock,names.clock]);
    assert(f.statements[0].includes(terminalHash(secret)));assert(f.statements[1].includes(terminalHash(deviceSecret)));
    assert(f.statements[2].includes(terminalHash(deviceSecret)));assert(f.statements[3].includes(json(claims)));
    const count=f.statements.length;
    await assert.rejects(executeOnsiteClock({siteId:site,authUserId:employee,token:token.slice(0,-1)+(token.endsWith('A')?'B':'A'),command,operationId:null,allowNew:true},f.transport),error=>error.code==='attendance_qr_invalid');
    assert.equal(f.statements.length,count);
    for(const value of [secret,deviceSecret,token,terminalHash(secret),terminalHash(deviceSecret),nonce])assert.equal(JSON.stringify(f.transport.calls).includes(value),false);
  } finally {if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

function harnessParts() {
  const source=readFileSync(new URL('./attendance-self-browser-harness.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const demo ='),build=source.indexOf('const bundle = await build(');
  const defineStart=source.indexOf('define: {',build),defineEnd=source.indexOf(', logLevel:',defineStart);
  const serverStart=source.indexOf('const server = createServer('),listen=source.indexOf('server.listen(',serverStart);
  assert(start>=0&&build>start&&defineStart>build&&defineEnd>defineStart&&serverStart>defineEnd&&listen>serverStart);
  return {prefix:source.slice(start,build),defines:source.slice(defineStart+'define: '.length,defineEnd),server:source.slice(serverStart,listen)};
}
function harnessConfiguration(flags) {
  const {prefix,defines}=harnessParts();
  // Evaluate the actual argument/define code only; never import esbuild, build
  // assets, compile CSS or reach listen(). No process API beyond argv exists.
  return JSON.parse(JSON.stringify(runInNewContext(`${prefix}\n({withTerminalShell,entry,defines:(${defines})});`,
    {process:{argv:['node','synthetic-harness',...flags]}},{timeout:1000})));
}

test('terminal-shell requires merchant-shell and rejects every other leaf or full-shell mode before construction',()=>{
  assert.throws(()=>harnessConfiguration(['--terminal-shell']),/attendance_terminal_shell_requires_merchant_shell/);
  assert.throws(()=>harnessConfiguration(['--terminal-shell','--check-only']),/attendance_terminal_shell_requires_merchant_shell/);
  for(const conflict of ['--controls','--correction-flow','--missing-flow','--location-settings','--employee-location','--location-exceptions',
    '--portal','--portal-features','--owner-entry','--database-entry','--terminals','--terminal-recovery','--onsite-qr','--event-channels',
    '--event-channels-shell','--missing','--unified','--unified-export','--schedule','--pin','--pin-clock','--pin-workflow','--unknown'])
    assert.throws(()=>harnessConfiguration(['--merchant-shell','--terminal-shell',conflict]),/attendance_terminal_shell_conflicting_entry_flags/);
  assert.equal(harnessConfiguration(['--merchant-shell','--terminal-shell','--check-only']).withTerminalShell,true);
});

test('terminal-shell keeps the actual merchant entry and changes only the TERMINALS frontend define',()=>{
  const base=harnessConfiguration(['--merchant-shell']),enabled=harnessConfiguration(['--merchant-shell','--terminal-shell']);
  assert.equal(base.withTerminalShell,false);assert.equal(enabled.withTerminalShell,true);
  assert.equal(enabled.entry,base.entry);assert.equal(enabled.entry,'scripts/fixtures/attendance-merchant-shell-browser.tsx');
  const changed=[...new Set([...Object.keys(base.defines),...Object.keys(enabled.defines)])]
    .filter(key=>base.defines[key]!==enabled.defines[key]).sort();
  const key='process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TERMINALS_ENABLED';
  assert.deepEqual(changed,[key]);assert.equal(base.defines[key],'"0"');assert.equal(enabled.defines[key],'"1"');
  for(const feature of ['SCHEDULE','MISSING','UNIFIED_REPORT','UNIFIED_EXPORT','PIN','PIN_CLOCK','EVENT_CHANNELS','CORRECTIONS',
    'REVISION_HISTORY','REVISION_DECISIONS','REVISION_CYCLES','TIMESHEET','SCOPED_TIMESHEET','TIMESHEET_EXPORT',
    'LOCATION_WORKSPACE','EMPLOYEE_LOCATION_WORKSPACE','EXCEPTION_WORKSPACE'])
    assert.equal(enabled.defines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+feature+'_ENABLED'],'"0"');
});

test('terminal-shell adds exactly three fixed HTML routes while retaining host, GET and default-off boundaries',()=>{
  const {prefix,server}=harnessParts(),ts=require('typescript');
  const source=ts.createSourceFile('harness-route-fragment.mjs',server,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const candidates=new Set();
  const visit=node=>{if(ts.isStringLiteral(node)&&node.text.startsWith('/'))candidates.add(node.text);ts.forEachChild(node,visit);};visit(source);
  const expected=['/enterprise/attendance-terminal','/enterprise/attendance-terminal/onsite','/enterprise/attendance-scan'];
  const route=flags=>{
    let handler;
    runInNewContext(prefix+'\n'+server,{process:{argv:['node','synthetic-harness',...flags]},URL,
      bundle:{outputFiles:[{contents:'synthetic-js'}]},css:'synthetic-css',
      createServer:callback=>{handler=callback;return {};},
    },{timeout:1000});
    assert.equal(typeof handler,'function');
    return (pathname,method='GET',host='127.0.0.1:3131')=>{
      const result={status:null,headers:{},body:null};
      const response={setHeader(name,value){result.headers[name]=value;},writeHead(status,headers={}){result.status=status;Object.assign(result.headers,headers);return this;},end(body){result.body=body??null;return this;}};
      handler({url:pathname,method,headers:{host}},response);return result;
    };
  };
  const disabled=route(['--merchant-shell']),enabled=route(['--merchant-shell','--terminal-shell']);
  const added=[...candidates].filter(path=>enabled(path).status===200&&disabled(path).status!==200).sort();
  assert.deepEqual(added,expected.toSorted());
  for(const path of expected){
    assert.equal(disabled(path).status,403);assert.equal(enabled(path).status,200);
    assert.equal(enabled(path).headers['Content-Type'],'text/html; charset=utf-8');
    for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal(enabled(path,method).status,403);
    for(const host of ['localhost:3131','127.0.0.1:3132','www.faolla.com'])assert.equal(enabled(path,'GET',host).status,403);
    for(const invalid of [path+'/',path+'/unexpected',path+'-suffix',path.toUpperCase(),path.replace('/enterprise/','/enterprise//')])
      assert.equal(enabled(invalid).status,403);
  }
  for(const path of ['/','/99990001','/login','/harness.js','/harness.css'])assert.equal(enabled(path).status,disabled(path).status);
  for(const path of ['/enterprise','/enterprise/99990001','/enterprise/99990002','/api/merchant-enterprise/attendance/onsite-code'])
    assert.equal(enabled(path).status,403);
});

function runnerSource() {
  const text=readFileSync(new URL('./merchant-attendance-audit-shell-browser-check.mjs',import.meta.url),'utf8'),ts=require('typescript');
  const ast=ts.createSourceFile('audit-shell-runner.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const initializer=name=>{
    const matches=[];const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)matches.push(node.initializer);ts.forEachChild(node,visit);};visit(ast);
    assert.equal(matches.length,1,name);return matches[0].getText(ast);
  };
  return {text,ts,ast,initializer};
}

test('terminal runner opts into exactly four handlers and only terminal/onsite migrations in its isolated branch',()=>{
  const {ts,ast,initializer}=runnerSource(),required=[];
  const load=enabled=>runInNewContext('('+initializer('terminalHandlers')+')',{terminalShellMode:enabled,
    require:name=>{required.push(name);return {handleTerminalAdmin:'admin',handleTerminalDevice:'device',handleOnsiteCode:'issue',handleOnsiteClock:'clock'};},
  },{timeout:1000});
  assert.deepEqual(Object.keys(load(false)),[]);assert.deepEqual(required,[]);
  assert.deepEqual(Object.keys(load(true)).sort(),['onsite-clock','onsite-code','terminal-device','terminals']);
  assert.deepEqual(required.map(name=>name.split('/').at(-2)).sort(),['onsite-clock','onsite-code','terminal-device','terminals']);
  const matches=[];const visit=node=>{
    if(ts.isIfStatement(node)&&node.expression.getText(ast)==='terminalShellMode'&&ts.isForOfStatement(node.thenStatement)
      &&ts.isArrayLiteralExpression(node.thenStatement.expression)&&node.thenStatement.expression.elements.every(value=>ts.isStringLiteral(value)&&value.text.endsWith('.sql')))
      matches.push(node);
    ts.forEachChild(node,visit);
  };visit(ast);assert.equal(matches.length,1);
  const files=[];
  const context={terminalShellMode:true,root:'/synthetic-root',path:{join:(...parts)=>parts.join('/')},readFileSync:name=>name,exec:name=>files.push(name)};
  runInNewContext(matches[0].getText(ast),context,{timeout:1000});
  assert.deepEqual(files.map(name=>name.split('/').at(-1)),['202610010104_merchant_attendance_terminals.sql','202610010108_merchant_attendance_onsite_qr.sql']);
  files.length=0;runInNewContext(matches[0].getText(ast),{...context,terminalShellMode:false},{timeout:1000});assert.deepEqual(files,[]);
});

async function isolatedRunnerPage(options) {
  const {initializer}=runnerSource(),localOrigin='https://127.0.0.1:3131',cookieName='__Host-faolla-attendance-terminal';
  const observed={contexts:[],cookies:[],init:[],login:[],handlers:[],requests:[],errors:[],external:[],diagnostics:[]},control={unsent:null,lose:null,acceptDialogs:true};
  let routeHandler;const events=new Map(),page={setDefaultTimeout(){},on:(name,callback)=>events.set(name,callback),isClosed:()=>false};
  const context={addInitScript:async fn=>observed.init.push(fn),addCookies:async value=>observed.cookies.push(value),
    route:async(pattern,handler)=>{assert.equal(pattern,'**/*');routeHandler=handler;},newPage:async()=>page};
  const handlers=Object.fromEntries(['terminals','terminal-device','onsite-code','onsite-clock'].map(name=>[name,async request=>{
    observed.handlers.push({name,url:request.url,method:request.method});
    return new Response(JSON.stringify({ok:true}),{headers:{'cache-control':'private, no-store'}});
  }]));
  const scope={assert,URL,Headers,Request,Response,actors,origin:localOrigin,canonical:'https://www.faolla.com',staticOrigin:'http://127.0.0.1:3131',
    terminalShellMode:true,pinShellMode:false,employeeShellMode:true,terminalPages:['/enterprise/attendance-terminal','/enterprise/attendance-terminal/onsite'],
    terminalDeviceApis:['/api/merchant-enterprise/attendance/terminal-device','/api/merchant-enterprise/attendance/onsite-code'],
    MERCHANT_AUTH_COOKIE:'synthetic-owner-cookie',TERMINAL_COOKIE:cookieName,
    browser:{newContext:async opts=>{observed.contexts.push(opts);return context;}},auth:{login:async actor=>{observed.login.push(actor);return 'synthetic-session';}},
    transportClosing:false,control,handlers,entitlement:()=>{},exportLimiter:()=>true,gate:null,heldGates:new Set(),pendingRoutes:new Set(),exports:[],downloads:[],
    faultEndpoints:new Set(['/api/merchant-enterprise/attendance/onsite-clock']),requests:observed.requests,errors:observed.errors,external:observed.external,browserDiagnostics:observed.diagnostics,
    fetch:()=>{throw Error('pure_test_network_forbidden');},localFetch:()=>{throw Error('pure_test_static_fetch_forbidden');},
  };
  scope.redactDiagnostics=runInNewContext('('+initializer('redactDiagnostics')+')',{}, {timeout:1000});
  const createPage=runInNewContext('('+initializer('newPage')+')',scope,{timeout:1000});await createPage(options);
  const dispatch=async(path,{method='GET',headers={},body=null}={})=>{
    const outcome={fulfilled:false,aborted:false};
    const request={url:()=>localOrigin+path,method:()=>method,allHeaders:async()=>headers,postData:()=>body===null?null:JSON.stringify(body),failure:()=>null,frame:()=>({page:()=>page})};
    await routeHandler({request:()=>request,fulfill:async()=>{outcome.fulfilled=true;},abort:async()=>{outcome.aborted=true;}});
    return outcome;
  };
  return {observed,control,dispatch,events,cookieName};
}

test('actual runner device-page constructor injects no account identity and rejects account APIs or credentials before handlers',async()=>{
  const f=await isolatedRunnerPage({device:true});
  assert.deepEqual(f.observed.login,[]);assert.deepEqual(f.observed.cookies,[]);assert.deepEqual(f.observed.init,[]);
  assert.equal(f.observed.contexts[0].serviceWorkers,'block');
  const path='/api/merchant-enterprise/attendance/terminal-device';
  assert.equal((await f.dispatch(path)).fulfilled,true);
  assert.equal((await f.dispatch('/api/merchant-enterprise/attendance/onsite-code',{method:'POST',headers:{cookie:f.cookieName+'=synthetic-device'}})).fulfilled,true);
  const allowed=f.observed.handlers.length;
  for(const forbidden of ['/api/merchant-enterprise/attendance/terminals','/api/merchant-enterprise/attendance/onsite-clock',
    '/api/merchant-enterprise/attendance/admin','/auth/v1/token','/enterprise/attendance-scan','/enterprise/99990001'])
    assert.equal((await f.dispatch(forbidden)).aborted,true);
  for(const headers of [{'x-merchant-access-token':'synthetic-employee'},{authorization:'Bearer synthetic-employee'},
    {cookie:'synthetic-owner-cookie=owner'},{cookie:f.cookieName+'=device; synthetic-owner-cookie=owner'}])
    assert.equal((await f.dispatch(path,{headers})).aborted,true);
  assert.equal(f.observed.handlers.length,allowed);assert.deepEqual(f.observed.external,[]);
});

test('runner before-handler and after-SQL fault probes keep raw QR capability out of request records',async()=>{
  const f=await isolatedRunnerPage({employee:true,mobile:true}),path='/api/merchant-enterprise/attendance/onsite-clock';
  assert.deepEqual(f.observed.login,[]);assert.deepEqual(f.observed.cookies,[]);
  const token='aq1.'+'A'.repeat(100)+'.'+'B'.repeat(43),body={siteId:site,token,command},headers={'x-merchant-access-token':'synthetic-employee'};
  f.control.unsent=path;assert.equal((await f.dispatch(path,{method:'POST',headers,body})).aborted,true);
  assert.equal(f.observed.handlers.length,0);assert.equal(f.observed.requests[0].fault,'before-handler');assert.equal(f.control.unsent,null);
  f.control.lose=path;assert.equal((await f.dispatch(path,{method:'POST',headers,body})).aborted,true);
  assert.equal(f.observed.handlers.length,1);assert.equal(f.observed.requests[1].fault,'after-sql');assert.equal(f.control.lose,null);
  for(const record of f.observed.requests)assert.deepEqual(JSON.parse(JSON.stringify(record.body)),{siteId:site,command});
  assert.equal(JSON.stringify(f.observed.requests).includes(token),false);assert.deepEqual(f.observed.errors,[]);
});

test('actual runner diagnostics redact base64url leading-hyphen secrets, QR tokens and final exception stacks',async()=>{
  const {ts,ast,initializer}=runnerSource(),redact=runInNewContext('('+initializer('redactDiagnostics')+')',{}, {timeout:1000});
  const secret='-'+'A'.repeat(42),qr='aq1.'+'B'.repeat(100)+'.'+'C'.repeat(43),jwt='eyJ'+'D'.repeat(40)+'.'+'E'.repeat(50)+'.'+'F'.repeat(43);
  const raw=`Error: synthetic terminal ${secret} QR ${qr} bearer ${jwt} pair ${hash}`;
  for(const value of [secret,qr,jwt,hash])assert.equal(redact(raw).includes(value),false);
  const f=await isolatedRunnerPage({device:true});
  f.events.get('console')({type:()=> 'error',text:()=>raw,args:()=>[{evaluate:async()=>raw}]});
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.observed.diagnostics.length,2);
  for(const value of [secret,qr,jwt,hash])assert.equal(JSON.stringify(f.observed.diagnostics).includes(value),false);
  const last=ast.statements.at(-1);assert(ts.isExpressionStatement(last)&&ts.isAwaitExpression(last.expression));
  const caught=last.expression.expression;assert(ts.isCallExpression(caught)&&ts.isPropertyAccessExpression(caught.expression)&&caught.expression.name.text==='catch');
  const output=[],processState={exitCode:0};
  const callback=runInNewContext('('+caught.arguments[0].getText(ast)+')',{redactDiagnostics:redact,console:{error:value=>output.push(value)},process:processState},{timeout:1000});
  callback({stack:raw});assert.equal(processState.exitCode,1);assert.equal(output.length,1);
  for(const value of [secret,qr,jwt,hash])assert.equal(output[0].includes(value),false);
});
