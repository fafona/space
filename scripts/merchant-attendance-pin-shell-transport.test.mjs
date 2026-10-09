// Pure boundary tests. Fake exec returns an opaque marker or an explicit denial;
// protocol fixtures below only drive the real KDF, never model a successful punch.
// No database, browser, network, production credentials or generated artifacts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const names={admin:'faolla_attendance_pin_admin_v1',begin:'faolla_attendance_pin_begin_v1',finish:'faolla_attendance_pin_finish_v1',clock:'faolla_attendance_pin_clock_v1'};
const site='99990001',owner=actors[0].id,employee=actors[2].id,worker=id(201),employeeId=id(102),location=id(401),terminal=id(9101),operation=id(9102),lease=id(9103);
const workerNo="合成工号 ' quote \\ slash",salt='a'.repeat(32),verifier='b'.repeat(64),commandHash='c'.repeat(64),secretHash='d'.repeat(64);
const set={action:'set',operationId:operation,expectedRevision:0,workerId:worker,employeeId,salt,verifier,commandHash};
const revoke={...set,action:'revoke',expectedRevision:1,salt:null,verifier:null};
const command={expectedWorkerId:worker,expectedEmployeeId:employeeId,operationId:operation,locationId:location,action:'clock_in',expectedSequence:0};
const request={command:null,operationId:null};
const common={p_site:site,p_terminal:terminal,p_secret_hash:secretHash,p_no:workerNo,p_lease:lease};
const adminArgs=(c=null,op=null,allow=false,actor=owner)=>({p_site:site,p_auth:actor,p_no:workerNo,p_operation:op,p_command:c,p_allow_set:allow});
const beginArgs=(allow=false)=>({...common,p_allow:allow});
const finishArgs=(verified=false,allow=false)=>({...common,p_allow:allow,p_verified:verified});
const clockArgs=(r=request,verified=false,allow=false)=>({...common,p_verified:verified,p_request:r,p_allow_new:allow});
const marker={opaqueSqlMarker:'not-a-business-result'};
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const statement=(name,args)=>`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${args}));`;
const commonSql=`'${site}','${terminal}','${secretHash}',${literal(workerNo)},'${lease}'`;
function fixture(reply=()=>JSON.stringify({role:'service_role',data:marker})) {
  const statements=[],transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return reply(sql);});
  return {transport,statements};
}
async function rejected(name,inputs,pattern) {
  const f=fixture();
  for(const [index,input] of inputs.entries())await assert.rejects(f.transport.rpc(name,input),pattern,`invalid input ${index}`);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);assert.deepEqual(f.transport.errors,[]);
}
function noSecrets(value,extra=[]) {
  const text=JSON.stringify(value);
  for(const secret of [salt,verifier,commandHash,secretHash,lease,...extra])assert.equal(text.includes(secret),false,'sensitive value must not enter logs');
  for(const key of ['salt','verifier','commandHash','p_secret_hash','p_lease','p_verified','pin','proof'])
    assert.equal(text.includes('"'+key+'"'),false,'sensitive field must not enter logs');
}

test('PIN admin exact reads and receipt queries preserve actor/worker/operation without a synthetic authority shortcut',async()=>{
  const f=fixture();
  for(const op of [null,operation])for(const actor of [owner,employee]){
    assert.deepEqual(await f.transport.rpc(names.admin,adminArgs(null,op,false,actor)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.admin,`'${site}','${actor}',${literal(workerNo)},${op===null?'null':literal(op)},null,false`));
    assert.deepEqual(f.transport.calls.at(-1),{name:names.admin,actor,siteId:site,employeeId:null,operationId:op,command:null,
      query:{workerNo,operationId:op},allowSet:false});
  }
});

test('PIN set and revoke forward exact hashed SQL commands and log only detached nonsensitive intent',async()=>{
  const f=fixture();
  for(const c of [set,revoke,{...revoke,employeeId:null}]){
    const original=structuredClone(c),input=adminArgs(original);
    assert.deepEqual(await f.transport.rpc(names.admin,input),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.admin,`'${site}','${owner}',${literal(workerNo)},null,${json(c)},false`));
    const publicCommand={action:c.action,operationId:operation,expectedRevision:c.expectedRevision,workerId:worker,employeeId:c.employeeId};
    assert.deepEqual(f.transport.calls.at(-1).command,publicCommand);assert.equal(f.transport.calls.at(-1).operationId,operation);
    original.workerId=id(999);assert.deepEqual(f.transport.calls.at(-1).command,publicCommand);
  }
  noSecrets(f.transport.calls);
});

test('PIN admin rejects raw PIN, missing exact command fields, invalid salt/verifier/hash and mixed receipt writes',async()=>{
  const {commandHash:omitted,...missingHash}=set;assert.equal(omitted,commandHash);
  const bad=[undefined,{},[],missingHash,{...set,pin:'12345678'},{...set,proof:true},{...set,action:'verify'},
    {...set,operationId:'bad'},{...set,workerId:null},{...set,employeeId:null},
    ...[-1,1.5,'0',NaN,Infinity,999999999].map(value=>({...set,expectedRevision:value})),
    ...[null,'','A'.repeat(32),'a'.repeat(31)].map(value=>({...set,salt:value})),
    ...[null,'','B'.repeat(64),'b'.repeat(63)].map(value=>({...set,verifier:value})),
    ...[null,'','C'.repeat(64),'c'.repeat(63)].map(value=>({...set,commandHash:value})),
    {...revoke,salt},{...revoke,verifier},{...revoke,employeeId:'bad'}];
  await rejected(names.admin,bad.map(c=>({...adminArgs(),p_command:c})),/invalid_command/);
  await rejected(names.admin,[adminArgs(set,operation),adminArgs(null,'bad'),
    ...[undefined,null,0,1,'false'].map(value=>({...adminArgs(),p_allow_set:value})),
  ],/mixed_write_read|invalid_operation|invalid_set_gate/);
  const f=fixture();await f.transport.rpc(names.admin,adminArgs({...set,expectedRevision:999999998}));assert.equal(f.statements.length,1);
});

test('PIN begin and finish preserve the real SQL parameter order and false verification/admission',async()=>{
  const f=fixture();
  for(const allow of [false,true]){
    assert.deepEqual(await f.transport.rpc(names.begin,beginArgs(allow)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.begin,commonSql+','+allow));
    for(const verified of [false,true]){
      assert.deepEqual(await f.transport.rpc(names.finish,finishArgs(verified,allow)),{data:marker,error:null});
      // SQL places verified BEFORE allow despite executor object's insertion order.
      assert.equal(f.statements.at(-1),statement(names.finish,commonSql+','+verified+','+allow));
      assert.deepEqual(f.transport.calls.at(-1),{name:names.finish,actor:null,siteId:site,employeeId:null,operationId:null,command:null,
        query:{workerNo},terminalId:terminal,allowVerify:allow});
    }
  }
  noSecrets(f.transport.calls);
});

test('all PIN RPC worker numbers remain exact bounded text and credential RPCs require terminal/hash/lease',async()=>{
  for(const [name,args] of [[names.admin,adminArgs()],[names.begin,beginArgs()],[names.finish,finishArgs()],[names.clock,clockArgs()]]){
    await rejected(name,[null,undefined,123,'',' padded','padded ','x'.repeat(41),'bad\u0085worker'].map(value=>({...args,p_no:value})),/invalid_worker_number/);
    const f=fixture();await f.transport.rpc(name,{...args,p_no:'😀'.repeat(40)});assert.equal(f.statements.length,1);
  }
  for(const [name,args] of [[names.begin,beginArgs()],[names.finish,finishArgs()],[names.clock,clockArgs()]]){
    await rejected(name,[{...args,p_terminal:null},{...args,p_terminal:'bad'},
      ...[null,undefined,'D'.repeat(64),'d'.repeat(63),'A'.repeat(43)].map(value=>({...args,p_secret_hash:value})),
      ...[null,undefined,123,'bad'].map(value=>({...args,p_lease:value})),
    ],/invalid_terminal|invalid_secret_hash|invalid_lease/);
  }
});

test('PIN credential gates and proof are strict booleans without accepting browser-supplied fields',async()=>{
  for(const [name,args,fields] of [[names.begin,beginArgs(),['p_allow']],[names.finish,finishArgs(),['p_allow','p_verified']],[names.clock,clockArgs(),['p_allow_new','p_verified']]]){
    const inputs=fields.flatMap(field=>[null,undefined,0,1,'true',{}].map(value=>({...args,[field]:value})));
    await rejected(name,inputs,/invalid_verify_gate|invalid_proof|invalid_clock_gate/);
    await rejected(name,[{...args,pin:'12345678'},{...args,proof:'browser-proof'},{...args,p_auth:owner},{...args,p_auth_user_id:employee},
      {...args,p_verified:args.p_verified??false,extra:true}],/invalid_rpc_arguments/);
  }
});

test('PIN clock separates authenticated status/receipt reads and six-field original command intent',async()=>{
  const f=fixture();
  for(const r of [request,{command:null,operationId:operation},...['clock_in','break_start','break_end','clock_out'].map(action=>({command:{...command,action},operationId:null}))]){
    for(const verified of [false,true]){
      assert.deepEqual(await f.transport.rpc(names.clock,clockArgs(r,verified,false)),{data:marker,error:null});
      assert.equal(f.statements.at(-1),statement(names.clock,commonSql+','+verified+','+json(r)+',false'));
      assert.deepEqual(f.transport.calls.at(-1),{name:names.clock,actor:null,siteId:site,employeeId:null,
        operationId:r.command?.operationId??r.operationId,command:r.command,query:{workerNo,operationId:r.operationId},terminalId:terminal,allowNew:false});
    }
  }
  noSecrets(f.transport.calls);
});

test('PIN clock request parser rejects mixed recovery, extra fields, bad identities and sequence coercion',async()=>{
  const badRequests=[undefined,null,{},[],{command:null},{...request,token:'extra'},{...request,operationId:'bad'},
    {command,operationId:operation},{command:{...command,pin:'12345678'},operationId:null},
    {command:{...command,source:'kiosk'},operationId:null},
    ...['expectedWorkerId','expectedEmployeeId','operationId','locationId'].map(field=>({command:{...command,[field]:null},operationId:null})),
    {command:{...command,action:'verify'},operationId:null},
    ...[-1,1.5,'0',NaN,Infinity,Number.MAX_SAFE_INTEGER].map(value=>({command:{...command,expectedSequence:value},operationId:null}))];
  await rejected(names.clock,badRequests.map(value=>({...clockArgs(),p_request:value})),/invalid_request/);
});

test('new PIN signatures do not weaken tenant, owner principal, own-property or RPC identifier allowlists',async()=>{
  const f=fixture();
  for(const name of ['constructor','toString','faolla_attendance_pin_verify_v1','faolla_attendance_pin_member_v1',names.clock+';select 1'])
    await assert.rejects(f.transport.rpc(name,{}),/unexpected_rpc/);
  for(const [name,args] of [[names.admin,adminArgs()],[names.begin,beginArgs()],[names.finish,finishArgs()],[names.clock,clockArgs()]]){
    const {p_site:removed,...rest}=args;assert.equal(removed,site);
    await rejected(name,[rest,Object.assign(Object.create({p_site:site}),rest),{...args,p_site_id:site},{...args,p_site:'99990002'},
      {...args,p_site:99990001},{...args,extra:null}],/invalid_rpc_arguments|invalid_site/);
  }
  const {p_auth:removed,...noActor}=adminArgs();assert.equal(removed,owner);
  await rejected(names.admin,[noActor,Object.assign(Object.create({p_auth:owner}),noActor),{...adminArgs(),p_auth:id(999)},
    {...adminArgs(),p_auth:null},{...adminArgs(),p_auth_user_id:owner}],/invalid_rpc_arguments|invalid_actor/);
  await rejected('faolla_attendance_self_context_v1',[{p_site_id:site,p_auth_user_id:null},
    {p_site:site,p_terminal:terminal,p_secret_hash:secretHash}],/invalid_actor|invalid_rpc_arguments/);
  assert.deepEqual(f.statements,[]);
});

test('PIN typed SQL denials survive but wrong roles and driver-echoed credentials fail closed with no secret diagnostics',async()=>{
  for(const [name,args] of [[names.admin,adminArgs(set)],[names.begin,beginArgs()],[names.finish,finishArgs()],[names.clock,clockArgs({command,operationId:null})]]){
    for(const code of ['attendance_access_denied','attendance_pin_denied','attendance_pin_changed','attendance_pin_busy','attendance_platform_paused']){
      const f=fixture(()=>{throw Error('ERROR: '+code);});assert.deepEqual(await f.transport.rpc(name,args),{data:null,error:{message:code}});assert.deepEqual(f.transport.errors,[]);
    }
    const failed=fixture(sql=>{throw Error('driver error echoes '+sql);});
    await assert.rejects(failed.transport.rpc(name,args),error=>error.message==='attendance_pin_shell_sql_failure');
    assert.deepEqual(failed.transport.errors,['attendance_pin_shell_sql_failure']);noSecrets(failed.transport.calls);noSecrets(failed.transport.errors);
    const wrong=fixture(()=>JSON.stringify({role:'postgres',data:marker}));
    await assert.rejects(wrong.transport.rpc(name,args),/wrong_database_role/);noSecrets(wrong.transport.errors);
  }
  const tampered=Object.defineProperty({...set},'toJSON',{enumerable:false,value:()=>({...set,verifier:'e'.repeat(64)})});
  const f=fixture();await assert.rejects(f.transport.rpc(names.admin,adminArgs(tampered)),error=>error.message==='attendance_pin_shell_non_json_arguments');
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
});

test('real admin executor preflights before KDF and sends only a bound verifier plus command hash to denied SQL',async()=>{
  const {executePinAdmin}=require('../src/lib/merchantAttendancePin.server.ts');
  const key='FAOLLA_ATTENDANCE_PIN_PEPPER',previous=process.env[key],pin='12345678';process.env[key]='A'.repeat(43);
  const status={siteId:site,workerId:worker,employeeId,workerNo,workerName:'合成员工',ready:true,revision:0,enabled:false,bindingCurrent:false,changedAt:null,receipt:null};
  let sent;
  const f=fixture(sql=>{
    if(sql.endsWith(',null,true));'))return JSON.stringify({role:'service_role',data:status});
    const encoded=sql.match(/,'((?:[^']|'')*)'::jsonb,true\)\);$/);assert(encoded,'hashed admin payload must be JSON');sent=JSON.parse(encoded[1].replaceAll("''","'"));
    throw Error('ERROR: attendance_pin_changed');
  });
  try {
    await assert.rejects(executePinAdmin({siteId:site,workerNo,operationId:null,authUserId:owner,allowSet:true,
      command:{action:'set',operationId:operation,expectedRevision:0,workerId:worker,employeeId,pin,salt}},f.transport),error=>error.code==='attendance_pin_changed');
    assert.equal(f.statements.length,2);assert.deepEqual(f.transport.calls.map(call=>call.name),[names.admin,names.admin]);
    assert.equal(f.transport.calls[0].operationId,operation);assert.equal(f.transport.calls[0].command,null);
    assert.match(sent.verifier,/^[0-9a-f]{64}$/);assert.equal(sent.salt,salt);assert.equal(Object.hasOwn(sent,'pin'),false);
    const {commandHash:digest,...payload}=sent;assert.equal(digest,createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    noSecrets(f.transport.calls,[pin,sent.verifier,digest]);assert.deepEqual(f.transport.errors,[]);
    const denied=fixture(()=>{throw Error('ERROR: attendance_access_denied');});
    await assert.rejects(executePinAdmin({siteId:site,workerNo,operationId:null,authUserId:owner,allowSet:true,
      command:{action:'set',operationId:operation,expectedRevision:0,workerId:worker,employeeId,pin,salt}},denied.transport),error=>error.code==='attendance_access_denied');
    assert.equal(denied.statements.length,1);assert.equal(denied.transport.calls[0].command,null);
  } finally {if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

test('real verification and clock executors produce KDF proof and fresh lease before denied finish/clock SQL',async()=>{
  const {deriveAttendancePin,executePinVerification}=require('../src/lib/merchantAttendancePin.server.ts');
  const {executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
  const {terminalHash}=require('../src/lib/merchantAttendanceTerminal.server.ts');
  const key='FAOLLA_ATTENDANCE_PIN_PEPPER',previous=process.env[key],pin='24681357',secret='B'.repeat(42)+'A';process.env[key]='A'.repeat(43);
  try {
    const derived=await deriveAttendancePin(pin,salt,{siteId:site,workerId:worker,employeeId});
    const credentials={workerId:worker,employeeId,revision:1,salt,verifier:derived};
    const f=fixture(sql=>{if(sql.includes('public.'+names.begin+'('))return JSON.stringify({role:'service_role',data:credentials});throw Error('ERROR: attendance_pin_denied');});
    const input={siteId:site,terminalId:terminal,secret,workerNo,pin};
    await assert.rejects(executePinVerification({...input,allowVerify:true},f.transport),error=>error.code==='attendance_pin_denied');
    await assert.rejects(executePinClock({...input,command,operationId:null,allowNew:false},f.transport),error=>error.code==='attendance_pin_denied');
    await assert.rejects(executePinClock({...input,pin:'11111111',command:null,operationId:operation,allowNew:false},f.transport),error=>error.code==='attendance_pin_denied');
    assert.deepEqual(f.transport.calls.map(call=>call.name),[names.begin,names.finish,names.begin,names.clock,names.begin,names.clock]);
    const leases=[];
    for(let n=0;n<f.statements.length;n+=2){
      const matched=f.statements[n].match(/,'([0-9a-f-]{36})',true\)\);$/);assert(matched);leases.push(matched[1]);
      assert(f.statements[n+1].includes("'"+matched[1]+"'"));assert(f.statements[n].includes(terminalHash(secret)));
    }
    assert.equal(new Set(leases).size,3);assert(f.statements[1].endsWith(',true,true));'));
    assert(f.statements[3].includes(',true,'+json({command,operationId:null})+',false));'));
    assert(f.statements[5].includes(',false,'+json({command:null,operationId:operation})+',false));'));
    assert.equal(f.transport.calls[3].operationId,operation);assert.equal(f.transport.calls[5].operationId,operation);
    noSecrets(f.transport.calls,[pin,'11111111',secret,derived,terminalHash(secret),...leases]);assert.deepEqual(f.transport.errors,[]);
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
  return JSON.parse(JSON.stringify(runInNewContext(`${prefix}\n({withPinShell,withTerminalShell,entry,defines:(${defines})});`,
    {process:{argv:['node','synthetic-harness',...flags]}},{timeout:1000})));
}

test('pin-shell requires the merchant shell and rejects every other mode before imports/build/listen',()=>{
  for(const flags of [['--pin-shell'],['--pin-shell','--check-only']])
    assert.throws(()=>harnessConfiguration(flags),/attendance_pin_shell_requires_merchant_shell/);
  for(const conflict of ['--terminal-shell','--controls','--correction-flow','--missing-flow','--location-settings','--employee-location','--location-exceptions',
    '--portal','--portal-features','--owner-entry','--database-entry','--terminals','--terminal-recovery','--onsite-qr','--event-channels',
    '--event-channels-shell','--missing','--unified','--unified-export','--schedule','--pin','--pin-clock','--pin-workflow','--unknown'])
    assert.throws(()=>harnessConfiguration(['--merchant-shell','--pin-shell',conflict]),/attendance_pin_shell_conflicting_entry_flags/);
  assert.equal(harnessConfiguration(['--merchant-shell','--pin-shell','--check-only']).withPinShell,true);
});

test('pin-shell retains the merchant entry and enables exactly TERMINALS/PIN/PIN_CLOCK relative to default',()=>{
  const base=harnessConfiguration(['--merchant-shell']),enabled=harnessConfiguration(['--merchant-shell','--pin-shell']);
  assert.equal(base.withPinShell,false);assert.equal(enabled.withPinShell,true);assert.equal(enabled.withTerminalShell,false);
  assert.equal(enabled.entry,base.entry);assert.equal(enabled.entry,'scripts/fixtures/attendance-merchant-shell-browser.tsx');
  const key=name=>'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+name+'_ENABLED';
  const changed=[...new Set([...Object.keys(base.defines),...Object.keys(enabled.defines)])].filter(name=>base.defines[name]!==enabled.defines[name]).sort();
  assert.deepEqual(changed,['TERMINALS','PIN','PIN_CLOCK'].map(key).sort());
  for(const name of changed){assert.equal(base.defines[name],'"0"');assert.equal(enabled.defines[name],'"1"');}
  for(const name of ['MISSING','UNIFIED_REPORT','UNIFIED_EXPORT','SCHEDULE','EVENT_CHANNELS','CORRECTIONS','REVISION_CYCLES','TIMESHEET',
    'SCOPED_TIMESHEET','TIMESHEET_EXPORT','LOCATION_WORKSPACE','EMPLOYEE_LOCATION_WORKSPACE','EXCEPTION_WORKSPACE'])assert.equal(enabled.defines[key(name)],'"0"');
});

test('pin-shell adds only the device and clock HTML routes and never exposes verify-only/onsite or API surfaces',()=>{
  const {prefix,server}=harnessParts(),ts=require('typescript'),paths=new Set();
  const ast=ts.createSourceFile('route-fragment.mjs',server,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const visit=node=>{if(ts.isStringLiteral(node)&&node.text.startsWith('/'))paths.add(node.text);ts.forEachChild(node,visit);};visit(ast);
  const route=flags=>{
    let handler;
    runInNewContext(prefix+'\n'+server,{process:{argv:['node','synthetic-harness',...flags]},URL,
      bundle:{outputFiles:[{contents:'synthetic-js'}]},css:'synthetic-css',createServer:callback=>{handler=callback;return {};},
    },{timeout:1000});assert.equal(typeof handler,'function');
    return (url,method='GET',host='127.0.0.1:3131')=>{
      let status;const response={setHeader(){},writeHead(value){status=value;return this;},end(){return this;}};
      handler({url,method,headers:{host}},response);return status;
    };
  };
  const disabled=route(['--merchant-shell']),enabled=route(['--merchant-shell','--pin-shell']);
  const expected=['/enterprise/attendance-terminal','/enterprise/attendance-terminal/clock'];
  assert.deepEqual([...paths].filter(path=>enabled(path)===200&&disabled(path)!==200).sort(),expected.toSorted());
  for(const path of expected){
    assert.equal(enabled(path),200);assert.equal(disabled(path),403);
    for(const value of [path+'/',path+'/extra',path+'-suffix',path.toUpperCase()])assert.equal(enabled(value),403);
    for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal(enabled(path,method),403);
    for(const host of ['localhost:3131','127.0.0.1:3132','www.faolla.com'])assert.equal(enabled(path,'GET',host),403);
  }
  for(const path of ['/enterprise/attendance-terminal/pin','/enterprise/attendance-terminal/onsite','/enterprise/attendance-scan','/enterprise/99990002',
    '/api/merchant-enterprise/attendance/terminal-clock','/api/merchant-enterprise/attendance/terminal-pin'])assert.equal(enabled(path),403);
});

function runnerSource() {
  const text=readFileSync(new URL('./merchant-attendance-audit-shell-browser-check.mjs',import.meta.url),'utf8'),ts=require('typescript');
  const ast=ts.createSourceFile('runner.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const initializer=name=>{
    const matches=[];const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)matches.push(node.initializer);ts.forEachChild(node,visit);};visit(ast);
    assert.equal(matches.length,1,name);return matches[0].getText(ast);
  };return {text,ts,ast,initializer};
}

test('PIN runner opts into exactly four HTTP handlers and 104/106/107 migrations without verify-only/onsite',()=>{
  const {ts,ast,initializer}=runnerSource(),loaded=[];
  const read=enabled=>runInNewContext('('+initializer('pinHandlers')+')',{pinShellMode:enabled,
    require:name=>{loaded.push(name);return {handleTerminalAdmin:'admin',handleTerminalDevice:'device',handlePinAdmin:'credentials',handlePinClock:'clock'};},
  },{timeout:1000});
  assert.deepEqual(Object.keys(read(false)),[]);assert.deepEqual(loaded,[]);
  const expected=['pin-credentials','terminal-clock','terminal-device','terminals'];
  assert.deepEqual(Object.keys(read(true)).sort(),expected);assert.deepEqual(loaded.map(name=>name.split('/').at(-2)).sort(),expected);
  const matches=[];const visit=node=>{
    if(ts.isIfStatement(node)&&node.expression.getText(ast)==='pinShellMode'&&ts.isForOfStatement(node.thenStatement)
      &&ts.isArrayLiteralExpression(node.thenStatement.expression)&&node.thenStatement.expression.elements.every(value=>ts.isStringLiteral(value)&&value.text.endsWith('.sql')))matches.push(node);
    ts.forEachChild(node,visit);
  };visit(ast);assert.equal(matches.length,1);
  const files=[],context={pinShellMode:true,root:'/synthetic-root',path:{join:(...parts)=>parts.join('/')},readFileSync:name=>name,exec:name=>files.push(name)};
  runInNewContext(matches[0].getText(ast),context,{timeout:1000});
  assert.deepEqual(files.map(name=>name.split('/').at(-1)),['202610010104_merchant_attendance_terminals.sql','202610010106_merchant_attendance_pin_credentials.sql','202610010107_merchant_attendance_pin_clock.sql']);
  files.length=0;runInNewContext(matches[0].getText(ast),{...context,pinShellMode:false},{timeout:1000});assert.deepEqual(files,[]);
  assert.deepEqual(Array.from(runInNewContext('('+initializer('pinDeviceApis')+')',{}, {timeout:1000})),[
    '/api/merchant-enterprise/attendance/terminal-device','/api/merchant-enterprise/attendance/terminal-clock']);
});

test('actual PIN runner request projection and error redaction exclude PIN/salt and retain original operation intent',()=>{
  const {initializer}=runnerSource(),pin='12345678';
  const safe=(path,body)=>JSON.parse(JSON.stringify(runInNewContext('('+initializer('safeBody')+')',{
    terminalShellMode:false,pinShellMode:true,url:new URL('https://local.invalid'+path),parsedBody:body,
  },{timeout:1000})));
  const c={action:'set',operationId:operation,expectedRevision:0,workerId:worker,employeeId,pin,salt};
  assert.deepEqual(safe('/api/merchant-enterprise/attendance/pin-credentials',{siteId:site,workerNo,command:c}),{
    siteId:site,workerNo,command:{action:'set',operationId:operation,expectedRevision:0,workerId:worker,employeeId}});
  for(const r of [request,{command,operationId:null},{command:null,operationId:operation}]){
    const projected=safe('/api/merchant-enterprise/attendance/terminal-clock',{workerNo,pin,...r});
    assert.deepEqual(projected,{workerNo,...r});noSecrets(projected,[pin]);
  }
  assert.deepEqual(safe('/api/merchant-enterprise/attendance/terminal-device',{action:'pair',token:'synthetic-secret'}),{action:'pair'});
  const redact=runInNewContext('('+initializer('redactDiagnostics')+')',{}, {timeout:1000});
  for(const secret of ['12345678','123456789012',salt,verifier,commandHash,secretHash,'-'+'A'.repeat(42)])
    assert.equal(redact('Error: "'+secret+'"').includes(secret),false);
});
