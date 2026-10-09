// Pure construction/protocol probes. Fake SQL metadata permits exercising the
// real signer, never evidence that pairing, authorization or punches succeeded.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createAttendanceOnsiteManagementTransport,onsiteManagementFixturePlan,prepareAttendanceOnsiteManagement,
  sanitizeOnsiteManagementBody,redactOnsiteManagementDiagnostics} from './merchant-attendance-onsite-management-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {executeOnsiteIssue,executeOnsiteClock,verifyOnsiteToken,signOnsiteToken}=require('../src/lib/merchantAttendanceOnsiteQr.server.ts');
const {executeTerminalAdmin,executeTerminalDevice,terminalHash}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const bound={site:'99990001',ownerId:id(99),employeeAuthId:id(1),workerId:id(201),placeId:id(301)};
const scope={schema:owned.schema,sql:source=>qualifyAttendanceSandbox(source,owned.schema)};
const employeeId=id(101),terminal=id(8701),operation=id(8702),nonce=id(8703),secretHash='d'.repeat(64);
const names={terminal:'faolla_attendance_terminal_admin_v1',device:'faolla_attendance_terminal_device_v1',
  issue:'faolla_attendance_onsite_issue_v1',clock:'faolla_attendance_onsite_clock_v1'};
const command={expectedWorkerId:bound.workerId,expectedEmployeeId:employeeId,operationId:operation,locationId:bound.placeId,action:'clock_in',expectedSequence:0};
const claims={v:1,purpose:'faolla.attendance.onsite',siteId:bound.site,terminalId:terminal,locationId:bound.placeId,
  pairedAtMs:1,issuedAtMs:2,expiresAtMs:45002,nonce};
const argumentsByName={
  [names.terminal]:{p_site:bound.site,p_auth:bound.ownerId,p_query:{terminalId:null,cursor:null},p_command:null,p_allow_create:true},
  [names.device]:{p_site:bound.site,p_id:terminal,p_secret_hash:secretHash,p_device_hash:null,p_allow_pair:true},
  [names.issue]:{p_site:bound.site,p_terminal:terminal,p_secret_hash:secretHash},
  [names.clock]:{p_site:bound.site,p_auth:bound.employeeAuthId,p_claims:null,p_command:null,p_operation:null,p_allow_new:false},
};
const writeArgs={...argumentsByName[names.clock],p_claims:claims,p_command:command};
const marker={opaqueDatabaseMarker:'not-a-business-result'};
function fixture(respond=()=>JSON.stringify({role:'service_role',data:marker})){
  const statements=[];
  const transport=createAttendanceOnsiteManagementTransport(statement=>{
    if(statement.includes('obj_description'))return JSON.stringify(owned);
    statements.push(statement);return respond(statement);
  },bound);
  return {...transport,statements};
}
function noSecrets(value,extra=[]){
  const logged=JSON.stringify(value);
  for(const secret of [secretHash,nonce,...extra])assert(!logged.includes(secret),'sensitive value escaped');
  for(const key of ['token','pairSecret','pairHash','p_secret_hash','p_device_hash','claims','p_claims','nonce','pairedAtMs','issuedAtMs','expiresAtMs'])
    assert(!logged.includes('"'+key+'"'),'sensitive field escaped');
}
async function withSigningKey(run){
  const key='FAOLLA_ATTENDANCE_ONSITE_QR_SECRET',previous=process.env[key];process.env[key]=randomBytes(32).toString('hex');
  try{return await run();}finally{if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
}

test('only original 104/108 migrations are installed byte-for-byte, retaining service-only functions and immutable receipts',()=>{
  const plan=onsiteManagementFixturePlan(root);assert.deepEqual(plan.map(item=>item.name.split('_')[0].slice(-3)),['104','108']);
  for(const item of plan)assert.equal(item.source,readFileSync(path.join(root,'scripts/supabase-migrations',item.name),'utf8'));
  assert.match(plan[1].source,/last_row\.actor_employee_id is distinct from e\.id/);
  assert.match(plan[1].source,/attendance_onsite_receipts_no_rewrite/);
  assert.match(plan[1].source,/revoke all on public\.merchant_attendance_onsite_receipts from public,anon,authenticated,service_role/);
});

test('preparation constructs ownership-rechecked originals, zero business seeds and protected-fact/catalog assertions',async()=>{
  let submitted;const stop=Error('pure construction: SQL not executed');
  const native={root,query:statement=>statement.includes('obj_description')?JSON.stringify(owned):'pure fingerprint',
    querySteps:async steps=>{submitted=steps;throw stop;}};
  await assert.rejects(prepareAttendanceOnsiteManagement(native,scope,bound),error=>error===stop);
  const plan=onsiteManagementFixturePlan(root);assert.equal(submitted.length,5);
  assert.match(submitted[0],/onsite_management_fixture_already_present/);
  for(let n=0;n<plan.length;n++){
    assert(submitted[1+n*2].includes('c.oid=456 and n.oid=123'));assert(submitted[1+n*2].includes(owned.marker));
    assert.match(submitted[1+n*2],/onsite_management_seed_binding_required/);
    assert.equal(submitted[2+n*2],scope.sql(plan[n].source));assert.doesNotMatch(submitted[2+n*2],/\bpublic\./);
  }
  for(const change of [{schema:'public'},{owner:'service_role'},{tableOid:0},{marker:'foreign'}]){
    let called=false;
    await assert.rejects(prepareAttendanceOnsiteManagement({...native,query:()=>JSON.stringify({...owned,...change}),querySteps:async()=>{called=true;}},scope,bound),/lifecycle_owned_schema_required/);
    assert.equal(called,false);
  }
  await assert.rejects(prepareAttendanceOnsiteManagement(native,{...scope,sql:source=>source},bound),/onsite_management_qualifier_required/);
  await assert.rejects(prepareAttendanceOnsiteManagement(native,{...scope,schema:'attendance_race_'+'b'.repeat(32)},bound),/onsite_management_scope_mismatch/);
  const source=readFileSync(new URL('./merchant-attendance-onsite-management-fixture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/insert into|update public\.|delete from|set_config|disable trigger|spawn\(|DATABASE_URL|create schema|drop schema/i);
  assert.match(source,/preparation_changed_protected_facts/);assert.match(source,/tables:3,rows:0,serviceFunctions:4,browserFunctions:0/);
  assert.match(source,/privateSnapshot:false,tableAccess:0/);assert.match(source,/seededBusinessRows:0/);
});

test('only four exact RPCs reach service-role SQL; reads preserve null claims and paused admission without synthetic results',async()=>{
  const f=fixture();assert.deepEqual(f.rpcNames,Object.values(names));assert(Object.isFrozen(f.rpcNames));
  for(const [name,args] of Object.entries(argumentsByName))assert.deepEqual(await f.rpc(name,args),{data:marker,error:null});
  assert.equal(f.statements.length,4);assert.equal(f.calls.length,4);
  for(const statement of f.statements)assert.match(statement,/set role service_role;select jsonb_build_object\('role',current_user,'data'/);
  assert(f.statements[3].endsWith(',null,null,null,false));'));assert.equal(f.calls[3].allowNew,false);
  for(const name of ['faolla_attendance_admin_v1','faolla_attendance_self_v1','faolla_attendance_pin_clock_v1',
    'faolla_update_merchant_enterprise_employee_v1','faolla_attendance_terminal_snapshot_v1','constructor']){
    assert(!f.rpcNames.includes(name));await assert.rejects(f.rpc(name,argumentsByName[names.issue]),/^Error: onsite_management_invalid_rpc_arguments$/);
  }
  assert.equal(f.statements.length,4);noSecrets({calls:f.calls,errors:f.errors});
});

test('fixed synthetic scope plus existing exact validators reject wrong actors, shapes, hashes, query keys and booleans before SQL',async()=>{
  const f=fixture();
  for(const [name,args] of Object.entries(argumentsByName)){
    const invalid=[{...args,p_site:'99990002'},{...args,token:'private'},Object.assign(Object.create({hidden:true}),args)];
    const gate=Object.keys(args).find(key=>key.startsWith('p_allow'));
    if(gate)for(const value of [null,0,1,'true'])invalid.push({...args,[gate]:value});
    if(Object.hasOwn(args,'p_auth'))invalid.push({...args,p_auth:id(2)});
    else invalid.push({...args,p_auth:bound.ownerId});
    if(Object.hasOwn(args,'p_secret_hash'))invalid.push({...args,p_secret_hash:'raw device secret'},{...args,p_secret_hash:'A'.repeat(64)});
    for(const value of invalid)await assert.rejects(f.rpc(name,value),/^Error: onsite_management_invalid_rpc_arguments$/);
  }
  for(const query of [{terminalId:null,cursor:null,extra:true},{terminalId:terminal,cursor:id(999)},{terminalId:'bad',cursor:null}])
    await assert.rejects(f.rpc(names.terminal,{...argumentsByName[names.terminal],p_query:query}),/^Error: onsite_management_invalid_rpc_arguments$/);
  await assert.rejects(f.rpc(names.terminal,{...argumentsByName[names.terminal],p_command:{action:'create',terminalId:terminal,locationId:id(302),label:'Synthetic',pairHash:secretHash}}),/^Error: onsite_management_invalid_rpc_arguments$/);
  assert.equal(f.statements.length,0);assert.equal(f.calls.length,0);assert.deepEqual(f.errors,[]);
  for(const change of [{site:'12345678'},{employeeAuthId:id(2)},{workerId:id(202)},{placeId:id(302)},{extra:true}])
    assert.throws(()=>createAttendanceOnsiteManagementTransport(()=>JSON.stringify(owned),{...bound,...change}),/onsite_management_(?:synthetic_binding_required|binding_fields)/);
});

test('write claims and intent are structurally strict and bound, without moving SQL freshness or authorization into the fixture',async()=>{
  const f=fixture();
  for(const c of [{...command,expectedWorkerId:id(202)},{...command,expectedEmployeeId:id(102)},{...command,locationId:id(302)},
    {...command,extra:true},{...command,action:'start'},{...command,expectedSequence:Number.MAX_SAFE_INTEGER}])
    await assert.rejects(f.rpc(names.clock,{...writeArgs,p_command:c}),/^Error: onsite_management_invalid_rpc_arguments$/);
  for(const c of [{...claims,siteId:'99990002'},{...claims,locationId:id(302)},{...claims,nonce:'bad'},
    {...claims,extra:true},{...claims,v:2},{...claims,expiresAtMs:45003},{...claims,issuedAtMs:'2'},{...claims,pairedAtMs:3}])
    await assert.rejects(f.rpc(names.clock,{...writeArgs,p_claims:c}),/^Error: onsite_management_invalid_rpc_arguments$/);
  await assert.rejects(f.rpc(names.clock,{...writeArgs,p_operation:operation}),/^Error: onsite_management_invalid_rpc_arguments$/);
  await assert.rejects(f.rpc(names.clock,{...argumentsByName[names.clock],p_claims:claims}),/^Error: onsite_management_invalid_rpc_arguments$/);
  assert.equal(f.statements.length,0);
  const input=structuredClone(writeArgs);
  assert.deepEqual(await f.rpc(names.clock,input),{data:marker,error:null},'old but structural claims must reach real SQL replay/freshness checks');
  assert(f.statements[0].includes(nonce));assert(f.statements[0].includes('"expiresAtMs":45002'));
  assert.deepEqual(f.calls[0].command,command);input.p_command.action='clock_out';assert.equal(f.calls[0].command.action,'clock_in');
  noSecrets({calls:f.calls,errors:f.errors});
});

test('known SQL business errors remain typed and actor authorization is not emulated; unknown failures have constant safe diagnostics',async()=>{
  const denied=fixture(()=>{throw Error('ERROR: attendance_access_denied\nCONTEXT: protected statement');});
  assert.deepEqual(await denied.rpc(names.terminal,{...argumentsByName[names.terminal],p_auth:bound.employeeAuthId}),{data:null,error:{message:'attendance_access_denied'}});
  assert.deepEqual(await denied.rpc(names.clock,{...argumentsByName[names.clock],p_auth:bound.ownerId}),{data:null,error:{message:'attendance_access_denied'}});
  assert.equal(denied.statements.length,2,'known principals reach actual SQL authorization');
  for(const code of ['attendance_qr_invalid','attendance_qr_expired','attendance_qr_used','attendance_worker_changed','attendance_operation_conflict','attendance_settings_required']){
    const f=fixture(()=>{throw Error('ERROR: '+code+'\nCONTEXT: '+secretHash);});
    assert.deepEqual(await f.rpc(names.clock,writeArgs),{data:null,error:{message:code}});assert.deepEqual(f.errors,[]);
  }
  for(const respond of [()=>{throw Error('ERROR: attendance_unknown_sensitive\n'+secretHash);},()=>{throw Error('database failure '+nonce);},
    ()=>JSON.stringify({role:'postgres',data:{token:'private'}})]){
    const f=fixture(respond);assert.deepEqual(await f.rpc(names.clock,writeArgs),{data:null,error:{message:'attendance_unavailable'}});
    assert.deepEqual(f.errors,['onsite_management_sql_failure']);noSecrets({calls:f.calls,errors:f.errors});
  }
});

test('four closed HTTP projections retain non-secret intent only, do not mutate handler requests, and reject unknown paths',()=>{
  const prefix='/api/merchant-enterprise/attendance/',token='aq1.synthetic.private',pairSecret='synthetic-secret';
  const requests=[
    ['terminal-device',{action:'pair',token,claims},{action:'pair'}],
    ['terminals',{siteId:bound.site,command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic',pairSecret,pairHash:secretHash}},
      {siteId:bound.site,command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic'}}],
    ['onsite-code',{token,claims},{}],
    ['onsite-clock',{siteId:bound.site,token,claims,command:{...command,nonce}},{siteId:bound.site,command}],
  ];
  for(const [endpoint,body,expected] of requests){const original=structuredClone(body),safe=sanitizeOnsiteManagementBody(prefix+endpoint,body);
    assert.deepEqual(safe,expected);assert.deepEqual(body,original);noSecrets(safe,[token,pairSecret]);}
  assert.equal(sanitizeOnsiteManagementBody('/unknown',{token}),null);
  assert.equal(sanitizeOnsiteManagementBody(prefix+'onsite-clock',null),null);
  assert.equal(sanitizeOnsiteManagementBody(prefix+'terminal-device',[token]),null);
});

test('diagnostics redact complete onsite/pair tokens, JWTs, hashes and opaque values even in URL fragments and fill stacks',()=>{
  const token='aq1.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+'M'.repeat(43);
  const pair=bound.site+'.'+terminal+'.'+'Q'.repeat(43);
  const jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.'+'S'.repeat(43);
  const opaque=['xY9_'.repeat(20),'aB+/'.repeat(20)+'==','A'.repeat(64)];
  const password='Synthetic-attendance-only!',error=new Error('locator.fill: Timeout 15000ms exceeded');
  error.stack+='\nCall log: fill("'+token+'")\nURL https://localhost/enterprise/attendance-scan#'+token
    +'\nCookie '+pair+'\nAuthorization Bearer '+jwt+'\nSQL '+secretHash+'\nOpaque '+opaque.join(' ')+'\nfill("'+password+'")';
  const safe=redactOnsiteManagementDiagnostics(error);
  for(const secret of [token,pair,jwt,secretHash,password,...opaque])assert(!safe.includes(secret),'diagnostic secret escaped');
  assert(!safe.includes('aq1.'));assert(safe.includes('locator.fill: Timeout 15000ms exceeded'));assert(safe.includes('Call log:'));
  assert(safe.includes('[onsite-token-redacted]'));assert(safe.includes('[pair-token-redacted]'));assert(safe.includes('[jwt-redacted]'));
  assert(safe.includes('[hash-redacted]'));assert(safe.includes('[opaque-secret-redacted]'));
  assert.equal(redactOnsiteManagementDiagnostics(safe),safe);
});

test('actual terminal executors hash pairing/device credentials before the strict adapter and preserve SQL denials',async()=>{
  const secret=randomBytes(32).toString('base64url'),deviceSecret=randomBytes(32).toString('base64url');
  const f=fixture(()=>{throw Error('ERROR: attendance_terminal_denied');});
  await assert.rejects(executeTerminalAdmin({siteId:bound.site,authUserId:bound.ownerId,terminalId:null,cursor:null,allowCreate:true,
    command:{action:'create',terminalId:terminal,locationId:bound.placeId,label:'Synthetic',pairSecret:secret}},{rpc:f.rpc}),error=>error.code==='attendance_terminal_denied');
  await assert.rejects(executeTerminalDevice({siteId:bound.site,terminalId:terminal,secret,deviceSecret,allowPair:true},{rpc:f.rpc}),error=>error.code==='attendance_terminal_denied');
  assert(f.statements[0].includes(terminalHash(secret)));assert(f.statements[1].includes(terminalHash(deviceSecret)));
  assert(!f.statements.some(statement=>statement.includes(secret)||statement.includes(deviceSecret)));
  noSecrets({calls:f.calls,errors:f.errors},[secret,deviceSecret,terminalHash(secret),terminalHash(deviceSecret)]);
});

test('actual signing/verification services pass only hashed device proof or authenticated claims; fake SQL clock remains an explicit denial',async()=>{
  await withSigningKey(async()=>{
    const secret=randomBytes(32).toString('base64url');
    // Six metadata fields are a protocol probe, not a claimed issued real code.
    const issued={siteId:bound.site,terminalId:terminal,locationId:bound.placeId,pairedAtMs:1,issuedAtMs:2,expiresAtMs:45002};
    const f=fixture(statement=>{if(statement.includes(names.issue+'('))return JSON.stringify({role:'service_role',data:issued});
      throw Error('ERROR: attendance_access_denied');});
    const result=await executeOnsiteIssue({siteId:bound.site,terminalId:terminal,secret},{rpc:f.rpc});
    const verified=verifyOnsiteToken(result.token);assert.equal(verified.siteId,bound.site);assert.equal(verified.expiresAtMs-verified.issuedAtMs,45000);
    await assert.rejects(executeOnsiteClock({siteId:bound.site,authUserId:bound.employeeAuthId,token:result.token,command,operationId:null,allowNew:false},{rpc:f.rpc}),error=>error.code==='attendance_access_denied');
    assert.deepEqual(f.calls.map(call=>call.name),[names.issue,names.clock]);assert(f.statements[0].includes(terminalHash(secret)));
    assert(f.statements[1].includes(verified.nonce));assert(!f.statements.some(statement=>statement.includes(secret)||statement.includes(result.token)));
    noSecrets({calls:f.calls,errors:f.errors},[secret,result.token,verified.nonce,terminalHash(secret)]);
    for(const token of [result.token.replace(/^aq1\./,'aq2.'),signOnsiteToken({...claims,siteId:'99990002'}),signOnsiteToken({...claims,locationId:id(302)})])
      await assert.rejects(executeOnsiteClock({siteId:bound.site,authUserId:bound.employeeAuthId,token,command,operationId:null,allowNew:true},{rpc:f.rpc}),error=>error.code==='attendance_qr_invalid');
    assert.equal(f.statements.length,2,'wrong signatures or scopes must not reach SQL');
  });
});

test('missing independent signing key blocks issuance before SQL, but null-token authenticated receipt read remains service-backed',async()=>{
  const key='FAOLLA_ATTENDANCE_ONSITE_QR_SECRET',previous=process.env[key];delete process.env[key];
  try{
    const f=fixture(()=>{throw Error('ERROR: attendance_access_denied');});
    await assert.rejects(executeOnsiteIssue({siteId:bound.site,terminalId:terminal,secret:randomBytes(32).toString('base64url')},{rpc:f.rpc}),error=>error.code==='attendance_unavailable');
    assert.equal(f.statements.length,0);
    await assert.rejects(executeOnsiteClock({siteId:bound.site,authUserId:bound.employeeAuthId,token:null,command:null,operationId:operation,allowNew:false},{rpc:f.rpc}),error=>error.code==='attendance_access_denied');
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].operationId,operation);assert.equal(f.calls[0].command,null);noSecrets(f.calls);
  }finally{if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});
