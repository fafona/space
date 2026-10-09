// Pure construction/boundary probes; opaque SQL markers or explicit failures
// are not successful credential, pairing or attendance business evidence.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createAttendancePinManagementTransport,pinManagementFixturePlan,prepareAttendancePinManagement,sanitizePinManagementBody,redactPinManagementDiagnostics} from './merchant-attendance-pin-management-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {executePinAdmin,deriveAttendancePin}=require('../src/lib/merchantAttendancePin.server.ts');
const {executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
const {executeTerminalAdmin,executeTerminalDevice,terminalHash}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const bound={site:'99990001',ownerId:id(99),employeeAuthId:id(1),workerId:id(201),placeId:id(301)};
const workerNo='SYNTHETIC-103',employeeId=id(101),terminal=id(8601),operation=id(8602),lease=id(8603);
const options={...bound,employeeId,workerNo},scope={schema:owned.schema,sql:source=>qualifyAttendanceSandbox(source,owned.schema)};
const names={terminal:'faolla_attendance_terminal_admin_v1',device:'faolla_attendance_terminal_device_v1',admin:'faolla_attendance_pin_admin_v1',
  begin:'faolla_attendance_pin_begin_v1',finish:'faolla_attendance_pin_finish_v1',clock:'faolla_attendance_pin_clock_v1'};
const secretHash='d'.repeat(64),salt='a'.repeat(32),verifier='b'.repeat(64),commandHash='c'.repeat(64);
const command={expectedWorkerId:bound.workerId,expectedEmployeeId:employeeId,operationId:operation,locationId:bound.placeId,action:'clock_in',expectedSequence:0};
const credential={action:'set',operationId:operation,expectedRevision:0,workerId:bound.workerId,employeeId,salt,verifier,commandHash};
const common={p_site:bound.site,p_terminal:terminal,p_secret_hash:secretHash,p_no:workerNo,p_lease:lease};
const argumentsByName={
  [names.terminal]:{p_site:bound.site,p_auth:bound.ownerId,p_query:{terminalId:null,cursor:null},p_command:null,p_allow_create:true},
  [names.device]:{p_site:bound.site,p_id:terminal,p_secret_hash:secretHash,p_device_hash:null,p_allow_pair:true},
  [names.admin]:{p_site:bound.site,p_auth:bound.ownerId,p_no:workerNo,p_operation:null,p_command:null,p_allow_set:true},
  [names.begin]:{...common,p_allow:true},
  [names.finish]:{...common,p_verified:false,p_allow:false},
  [names.clock]:{...common,p_verified:false,p_request:{command:null,operationId:null},p_allow_new:false},
};
const marker={opaqueDatabaseMarker:'not-a-business-result'};
function fixture(respond=()=>JSON.stringify({role:'service_role',data:marker})){
  const statements=[];
  const transport=createAttendancePinManagementTransport(statement=>{
    if(statement.includes('obj_description'))return JSON.stringify(owned);
    statements.push(statement);return respond(statement);
  },options);
  return {...transport,statements};
}
function noSecrets(value,extra=[]){
  const logged=JSON.stringify(value);
  for(const secret of [secretHash,salt,verifier,commandHash,lease,...extra])assert(!logged.includes(secret),'sensitive value escaped');
  for(const key of ['pin','token','pairSecret','pairHash','salt','verifier','commandHash','p_secret_hash','p_device_hash','p_lease','p_verified','proof'])
    assert(!logged.includes('"'+key+'"'),'sensitive field escaped');
}

test('four original migrations remain byte-for-byte intact with current 112 identity guard and original lease consumption',()=>{
  const plan=pinManagementFixturePlan(root);assert.deepEqual(plan.map(item=>item.name.split('_')[0].slice(-3)),['104','106','107','112']);
  for(const item of plan)assert.equal(item.source,readFileSync(path.join(root,'scripts/supabase-migrations',item.name),'utf8'));
  assert.match(plan.at(-1).source,/last_row\.id is not null and last_row\.actor_employee_id is distinct from w\.employee_id/);
  assert.match(plan.at(-1).source,/sqlerrm in \('attendance_access_denied'/);
  assert.match(plan.at(-1).source,/faolla_attendance_pin_finish_v1/);
});

test('preparation constructs ownership-rechecked scoped originals and no synthetic business writes',async()=>{
  let submitted;const stop=Error('pure construction: SQL not executed');
  const native={root,query:statement=>statement.includes('obj_description')?JSON.stringify(owned):'pure fingerprint',
    querySteps:async steps=>{submitted=steps;throw stop;}};
  await assert.rejects(prepareAttendancePinManagement(native,scope,bound),error=>error===stop);
  const plan=pinManagementFixturePlan(root);assert.equal(submitted.length,9);
  assert.match(submitted[0],/pin_management_fixture_already_present/);
  for(let n=0;n<plan.length;n++){
    assert(submitted[1+n*2].includes('c.oid=456 and n.oid=123'));assert(submitted[1+n*2].includes(owned.marker));
    assert.match(submitted[1+n*2],/pin_management_seed_binding_required/);
    assert.equal(submitted[2+n*2],scope.sql(plan[n].source));assert.doesNotMatch(submitted[2+n*2],/\bpublic\./);
  }
  for(const change of [{schema:'public'},{owner:'service_role'},{tableOid:0},{marker:'foreign'}]){
    let called=false;
    await assert.rejects(prepareAttendancePinManagement({...native,query:()=>JSON.stringify({...owned,...change}),querySteps:async()=>{called=true;}},scope,bound),/lifecycle_owned_schema_required/);
    assert.equal(called,false);
  }
  await assert.rejects(prepareAttendancePinManagement(native,{...scope,sql:source=>source},bound),/pin_management_qualifier_required/);
  await assert.rejects(prepareAttendancePinManagement(native,{...scope,schema:'attendance_race_'+'b'.repeat(32)},bound),/pin_management_scope_mismatch/);
  const source=readFileSync(new URL('./merchant-attendance-pin-management-fixture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/insert into|update public\.|delete from|set_config|disable trigger|spawn\(|DATABASE_URL|create schema|drop schema/i);
  assert.match(source,/preparation_changed_protected_facts/);assert.match(source,/rows:0/);assert.match(source,/seededBusinessRows:0/);
});

test('only six exact PIN/terminal RPCs reach service-role SQL, preserving false proof/admission and opaque database replies',async()=>{
  const f=fixture();
  assert.deepEqual(f.rpcNames,Object.values(names));assert(Object.isFrozen(f.rpcNames));
  assert(!f.rpcNames.includes('faolla_attendance_admin_v1'),'ordinary owner admin stays on the original transport');
  assert(!f.rpcNames.includes('faolla_update_merchant_enterprise_employee_v1'),'employee-management RPC stays on its existing strict adapter');
  for(const [name,args] of Object.entries(argumentsByName))assert.deepEqual(await f.rpc(name,args),{data:marker,error:null});
  assert.equal(f.statements.length,6);assert.equal(f.calls.length,6);
  for(const statement of f.statements)assert.match(statement,/set role service_role;select jsonb_build_object\('role',current_user,'data'/);
  assert(f.statements[4].includes("'"+lease+"',false,false"));assert(f.statements[5].endsWith(',false));'));
  for(const name of ['faolla_attendance_self_v1','faolla_attendance_onsite_clock_v1','faolla_attendance_pin_member_v1','constructor'])
    await assert.rejects(f.rpc(name,argumentsByName[names.begin]),/^Error: pin_management_invalid_rpc_arguments$/);
  assert.equal(f.statements.length,6);noSecrets({calls:f.calls,errors:f.errors});
});

test('fixed synthetic binding and reused exact validators reject malformed scope, credentials, request fields and booleans before SQL',async()=>{
  const f=fixture();
  for(const [name,args] of Object.entries(argumentsByName)){
    const invalid=[{...args,p_site:'99990002'},{...args,pin:'12345678'},Object.assign(Object.create({hidden:true}),args)];
    const gate=Object.keys(args).find(key=>key.startsWith('p_allow'));
    for(const value of [null,0,1,'true'])invalid.push({...args,[gate]:value});
    if(Object.hasOwn(args,'p_auth'))invalid.push({...args,p_auth:id(2)});
    else invalid.push({...args,p_auth:bound.ownerId});
    if(Object.hasOwn(args,'p_no'))invalid.push({...args,p_no:'ANOTHER-WORKER'});
    if(Object.hasOwn(args,'p_secret_hash'))invalid.push({...args,p_secret_hash:'raw device secret'}, {...args,p_secret_hash:'A'.repeat(64)});
    for(const value of invalid)await assert.rejects(f.rpc(name,value),/^Error: pin_management_invalid_rpc_arguments$/);
  }
  for(const c of [{...credential,workerId:id(202)},{...credential,employeeId:id(102)},{...credential,salt:'raw PIN'},
    {...credential,verifier:null},{...credential,expectedRevision:'0'},{...credential,pin:'12345678'}])
    await assert.rejects(f.rpc(names.admin,{...argumentsByName[names.admin],p_command:c}),/^Error: pin_management_invalid_rpc_arguments$/);
  for(const c of [{...command,expectedWorkerId:id(202)},{...command,expectedEmployeeId:id(102)},{...command,locationId:id(302)},
    {...command,pin:'12345678'},{...command,expectedSequence:Number.MAX_SAFE_INTEGER}])
    await assert.rejects(f.rpc(names.clock,{...argumentsByName[names.clock],p_request:{command:c,operationId:null}}),/^Error: pin_management_invalid_rpc_arguments$/);
  await assert.rejects(f.rpc(names.clock,{...argumentsByName[names.clock],p_verified:'true'}),/^Error: pin_management_invalid_rpc_arguments$/);
  assert.equal(f.statements.length,0);assert.equal(f.calls.length,0);assert.deepEqual(f.errors,[]);
  for(const change of [{site:'12345678'},{employeeAuthId:id(2)},{workerId:id(202)},{placeId:id(302)}])
    assert.throws(()=>createAttendancePinManagementTransport(()=>JSON.stringify(owned),{...options,...change}),/synthetic_binding_required/);
});

test('credential commands and terminal hashes reach SQL while recorded calls retain only detached non-secret intent',async()=>{
  const f=fixture();
  const set=structuredClone(credential);
  await f.rpc(names.admin,{...argumentsByName[names.admin],p_command:set});
  await f.rpc(names.clock,{...argumentsByName[names.clock],p_request:{command,operationId:null},p_verified:true});
  await f.rpc(names.terminal,{...argumentsByName[names.terminal],p_command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic PIN device',pairHash:secretHash}});
  assert(f.statements[0].includes(verifier));assert(f.statements[0].includes(salt));assert(f.statements[0].includes(commandHash));
  assert.deepEqual(f.calls[0].command,{action:'set',operationId:operation,expectedRevision:0,workerId:bound.workerId,employeeId});
  assert.deepEqual(f.calls[1].command,command);set.workerId=id(999);assert.equal(f.calls[0].command.workerId,bound.workerId);
  noSecrets({calls:f.calls,errors:f.errors});
});

test('business denials remain actual SQL replies, including known employee admin denial; unknown diagnostics are fixed and secret-free',async()=>{
  const denied=fixture(()=>{throw Error('ERROR: attendance_access_denied\nCONTEXT: protected statement');});
  assert.deepEqual(await denied.rpc(names.admin,{...argumentsByName[names.admin],p_auth:bound.employeeAuthId}),{data:null,error:{message:'attendance_access_denied'}});
  assert.equal(denied.statements.length,1,'known employee is sent to actual SQL authorization');
  for(const code of ['attendance_pin_denied','attendance_pin_changed','attendance_worker_changed','attendance_operation_conflict']){
    const f=fixture(()=>{throw Error('ERROR: '+code+'\nCONTEXT: '+secretHash);});
    assert.deepEqual(await f.rpc(names.clock,argumentsByName[names.clock]),{data:null,error:{message:code}});assert.deepEqual(f.errors,[]);
  }
  for(const respond of [()=>{throw Error('ERROR: attendance_unknown_sensitive\n'+verifier);},()=>{throw Error('database failure '+salt+' '+lease);},
    ()=>JSON.stringify({role:'postgres',data:{pin:'12345678'}})]){
    const f=fixture(respond);assert.deepEqual(await f.rpc(names.clock,argumentsByName[names.clock]),{data:null,error:{message:'attendance_unavailable'}});
    assert.deepEqual(f.errors,['pin_management_sql_failure']);noSecrets({calls:f.calls,errors:f.errors});
  }
});

test('four HTTP body projections remove PIN/pairing secrets and unknown nested fields without mutating original requests',()=>{
  const prefix='/api/merchant-enterprise/attendance/',pin='12345678',pairSecret='synthetic-pair-secret',token='synthetic-pair-token';
  const requests=[
    ['terminal-device',{action:'pair',token,extra:pin},{action:'pair'}],
    ['terminals',{siteId:bound.site,command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic device',pairSecret,proof:verifier}},
      {siteId:bound.site,command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic device'}}],
    ['pin-credentials',{siteId:bound.site,workerNo,command:{...credential,pin,extra:{salt}}},
      {siteId:bound.site,workerNo,command:{action:'set',operationId:operation,expectedRevision:0,workerId:bound.workerId,employeeId}}],
    ['terminal-clock',{workerNo,pin,command:{...command,proof:verifier},operationId:null,token},
      {workerNo,operationId:null,command}],
    ['terminal-clock',{workerNo,pin,command:null,operationId:operation},{workerNo,operationId:operation,command:null}],
  ];
  for(const [endpoint,body,expected] of requests){const original=structuredClone(body),safe=sanitizePinManagementBody(prefix+endpoint,body);
    assert.deepEqual(safe,expected);assert.deepEqual(body,original);noSecrets(safe,[pin,pairSecret,token]);}
  assert.equal(sanitizePinManagementBody('/unknown',{pin}),null);
  assert.equal(sanitizePinManagementBody(prefix+'terminal-clock',null),null);
  assert.equal(sanitizePinManagementBody(prefix+'terminal-device',[token]),null);
});

test('diagnostic redaction covers Playwright fill PINs, complete pairing tokens, JWTs, hashes and long opaque secrets',()=>{
  const pins=['12345678','123456789','1234567890','12345678901','123456789012'];
  const pair='99990001.'+terminal+'.'+'Q'.repeat(43);
  const jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.'+'S'.repeat(43);
  const hashes=['A'.repeat(64),'abcdef0123456789'.repeat(4),'e'.repeat(32)];
  const opaque=['xY9_'.repeat(20),'aB+/'.repeat(20)+'=='];
  const error=new Error('locator.fill: Timeout 15000ms exceeded');
  error.stack+='\nCall log:\n'+pins.map(pin=>'  - fill("'+pin+'")').join('\n')
    +'\nCookie '+pair+'\nAuthorization Bearer '+jwt+'\nSQL '+hashes.join(' ')+'\nOpaque '+opaque.join(' ');
  const safe=redactPinManagementDiagnostics(error);
  for(const secret of [...pins,pair,jwt,...hashes,...opaque])assert(!safe.includes(secret),'diagnostic secret escaped');
  assert(safe.includes('locator.fill: Timeout 15000ms exceeded'));assert(safe.includes('Call log:'));
  assert(safe.includes('[pair-token-redacted]'));assert(safe.includes('[jwt-redacted]'));
  assert(safe.includes('[hash-redacted]'));assert(safe.includes('[opaque-secret-redacted]'));
  assert.equal(redactPinManagementDiagnostics(safe),safe,'redaction is idempotent for stored diagnostics');
});

test('actual terminal executors hash credentials before the strict adapter and preserve business errors',async()=>{
  const secret=randomBytes(32).toString('base64url'),deviceSecret=randomBytes(32).toString('base64url');
  const f=fixture(()=>{throw Error('ERROR: attendance_terminal_denied');});
  await assert.rejects(executeTerminalAdmin({siteId:bound.site,authUserId:bound.ownerId,terminalId:null,cursor:null,allowCreate:true,
    command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic device',pairSecret:secret}},{rpc:f.rpc}),error=>error.code==='attendance_terminal_denied');
  await assert.rejects(executeTerminalDevice({siteId:bound.site,terminalId:terminal,secret,deviceSecret,allowPair:true},{rpc:f.rpc}),error=>error.code==='attendance_terminal_denied');
  assert(f.statements[0].includes(terminalHash(secret)));assert(f.statements[1].includes(terminalHash(deviceSecret)));
  assert(!f.statements.some(statement=>statement.includes(secret)||statement.includes(deviceSecret)));
  noSecrets({calls:f.calls,errors:f.errors},[secret,deviceSecret,terminalHash(secret),terminalHash(deviceSecret)]);
});

test('actual PIN KDF/default clock executor supplies begin then final proof without faking a successful lease or punch result',async()=>{
  const key='FAOLLA_ATTENDANCE_PIN_PEPPER',previous=process.env[key],pin='57391642',secret=randomBytes(32).toString('base64url');
  process.env[key]=randomBytes(32).toString('base64url');
  try{
    const derived=await deriveAttendancePin(pin,salt,{siteId:bound.site,workerId:bound.workerId,employeeId});
    // A protocol-shaped fake begin response only lets us observe the real KDF;
    // final SQL response is a denial, never a made-up successful attendance fact.
    const f=fixture(statement=>{
      if(statement.includes(names.begin+'('))return JSON.stringify({role:'service_role',data:{workerId:bound.workerId,employeeId,revision:1,salt,verifier:derived}});
      return JSON.stringify({role:'service_role',data:{error:'attendance_access_denied'}});
    });
    await assert.rejects(executePinClock({siteId:bound.site,terminalId:terminal,secret,workerNo,pin,command:null,operationId:operation,allowNew:false},{rpc:f.rpc}),
      error=>error.code==='attendance_access_denied');
    assert.deepEqual(f.calls.map(call=>call.name),[names.begin,names.clock]);
    assert(f.statements[1].includes(",true,'{\"command\":null,\"operationId\":\""+operation+'\"}'));
    assert(!f.statements.some(statement=>statement.includes(pin)||statement.includes(secret)));
    noSecrets({calls:f.calls,errors:f.errors},[pin,secret,derived]);
  }finally{if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

test('actual PIN admin preflight and KDF use bound identity, then forward only hashes to SQL and sanitized intent to logs',async()=>{
  const key='FAOLLA_ATTENDANCE_PIN_PEPPER',previous=process.env[key],pin='93617542';process.env[key]=randomBytes(32).toString('base64url');
  try{
    const f=fixture(statement=>{
      if(statement.includes(',null,true))'))return JSON.stringify({role:'service_role',data:{siteId:bound.site,workerId:bound.workerId,employeeId,workerNo,
        workerName:'Synthetic worker',ready:true,revision:0,enabled:false,bindingCurrent:false,changedAt:null,receipt:null}});
      throw Error('ERROR: attendance_access_denied');
    });
    await assert.rejects(executePinAdmin({siteId:bound.site,authUserId:bound.ownerId,workerNo,operationId:null,allowSet:true,
      command:{action:'set',operationId:operation,expectedRevision:0,workerId:bound.workerId,employeeId,pin,salt}},{rpc:f.rpc}),error=>error.code==='attendance_access_denied');
    assert.equal(f.calls.length,2);assert.equal(f.calls[0].command,null);assert.equal(f.calls[1].command.action,'set');
    assert(!f.statements.some(statement=>statement.includes(pin)));assert.match(f.statements[1],/"verifier":"[0-9a-f]{64}"/);
    noSecrets({calls:f.calls,errors:f.errors},[pin]);
  }finally{if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});
