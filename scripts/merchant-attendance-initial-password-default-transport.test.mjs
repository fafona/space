// Pure protocol/SQL-construction probes. No PostgreSQL or external Auth runs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createInitialPasswordDefaultTransport,validateInitialPasswordDefaultRead} from './merchant-attendance-initial-password-default-transport.mjs';
import {createInvitationBrowserTransport} from './merchant-attendance-invitation-browser-fixture.mjs';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const origin='https://attendance-auth.invalid',service='attendance-synthetic-service',now='2026-10-03T12:00:00.000Z';
const tables={invitation:'merchant_enterprise_employees',role:'merchant_enterprise_roles',identity:'merchant_enterprise_staff_identities'};
const columns={invitation:'id,merchant_id,auth_user_id,email,role_id,status,accepted_at,invitation_version,invitation_token_hash,invitation_expires_at,invitation_revoked_at',
  role:'id,merchant_id,status',identity:'auth_user_id,email_hash,principal_type'};
const queries={
  invitation:()=>({select:columns.invitation,merchant_id:'eq.99990001',auth_user_id:'eq.'+id(2),invitation_version:'eq.7',
    invitation_token_hash:'eq.'+'a'.repeat(64),status:'eq.invited',accepted_at:'is.null',invitation_revoked_at:'is.null',invitation_expires_at:'gt.'+now,limit:'1'}),
  role:()=>({select:columns.role,merchant_id:'eq.99990001',id:'eq.'+id(30),status:'eq.active',limit:'1'}),
  identity:()=>({select:columns.identity,auth_user_id:'eq.'+id(2),email_hash:'eq.'+'b'.repeat(64),principal_type:'eq.merchant_staff',limit:'1'}),
};
const rows={
  invitation:{id:id(102),merchant_id:'99990001',auth_user_id:id(2),email:'invite-retry-2@example.test',role_id:id(30),status:'invited',accepted_at:null,
    invitation_version:7,invitation_token_hash:'a'.repeat(64),invitation_expires_at:'2026-10-04T12:00:00+00:00',invitation_revoked_at:null},
  role:{id:id(30),merchant_id:'99990001',status:'active'},
  identity:{auth_user_id:id(2),email_hash:'b'.repeat(64),principal_type:'merchant_staff'},
};
const request=(kind,query=queries[kind](),init={})=>new Request(origin+'/rest/v1/'+tables[kind]+'?'+new URLSearchParams(query),{
  ...init,headers:{apikey:service,authorization:'Bearer '+service,accept:'application/json',...init.headers}});
function fixture(reply=(source,kind)=>JSON.stringify({role:'service_role',data:[rows[kind]]})){
  const queries=[];let currentOwned=owned;
  const raw=source=>{
    queries.push(source);if(source.includes("'schema',n.nspname"))return JSON.stringify(currentOwned);
    const kind=Object.keys(tables).find(key=>source.includes('from public.'+tables[key]+' where '));assert(kind);return reply(source,kind);
  };
  const prepared=createInvitationBrowserTransport(raw,owned),transport=createInitialPasswordDefaultTransport(prepared);
  return {transport,queries,setOwned:value=>{currentOwned=value;},sql:()=>queries.filter(source=>!source.includes("'schema',n.nspname"))};
}
const sdkRead=(client,kind)=>{
  if(kind==='invitation')return client.from(tables.invitation).select(columns.invitation).eq('merchant_id','99990001').eq('auth_user_id',id(2))
    .eq('invitation_version',7).eq('invitation_token_hash','a'.repeat(64)).eq('status','invited').is('accepted_at',null)
    .is('invitation_revoked_at',null).gt('invitation_expires_at',now).limit(1).maybeSingle();
  if(kind==='role')return client.from(tables.role).select(columns.role).eq('merchant_id','99990001').eq('id',id(30)).eq('status','active').limit(1).maybeSingle();
  return client.from(tables.identity).select(columns.identity).eq('auth_user_id',id(2)).eq('email_hash','b'.repeat(64)).eq('principal_type','merchant_staff').limit(1).maybeSingle();
};

test('only the three exact default SDK shapes and bounded synthetic subjects/roles are accepted',()=>{
  assert.deepEqual(validateInitialPasswordDefaultRead(request('invitation')),{kind:'invitation',actorId:id(2),tokenHash:'a'.repeat(64),nowIso:now});
  assert.deepEqual(validateInitialPasswordDefaultRead(request('role')),{kind:'role',roleId:id(30)});
  assert.deepEqual(validateInitialPasswordDefaultRead(request('identity')),{kind:'identity',actorId:id(2),emailHash:'b'.repeat(64)});
  for(const n of [1,2,3])for(const kind of ['invitation','identity'])assert.equal(validateInitialPasswordDefaultRead(request(kind,{...queries[kind](),auth_user_id:'eq.'+id(n)})).actorId,id(n));
  for(const n of [30,31,32])assert.equal(validateInitialPasswordDefaultRead(request('role',{...queries.role(),id:'eq.'+id(n)})).roleId,id(n));
});

test('tenant, identity, projection, version, hash, date, duplicate and extra-query failures are rejected before data SQL',()=>{
  const h=fixture(),bad=[
    request('invitation',{...queries.invitation(),merchant_id:'eq.99990002'}),
    request('invitation',{...queries.invitation(),auth_user_id:'eq.'+id(99)}),
    request('identity',{...queries.identity(),auth_user_id:'eq.'+id(4)}),request('role',{...queries.role(),id:'eq.'+id(33)}),
    request('invitation',{...queries.invitation(),select:'*'}),request('role',{...queries.role(),select:'id,merchant_id,status,name'}),
    ...['eq.8','eq.07','7','eq.true'].map(invitation_version=>request('invitation',{...queries.invitation(),invitation_version})),
    ...['eq.'+'A'.repeat(64),'eq.x',"eq.';select 1;"].map(invitation_token_hash=>request('invitation',{...queries.invitation(),invitation_token_hash})),
    request('identity',{...queries.identity(),email_hash:'eq.'+'A'.repeat(64)}),
    request('identity',{...queries.identity(),principal_type:'eq.merchant'}),
    ...['gte.'+now,'gt.2026-10-03','gt.2026-02-30T12:00:00.000Z',"gt.';select 1;"].map(invitation_expires_at=>request('invitation',{...queries.invitation(),invitation_expires_at})),
    request('invitation',{...queries.invitation(),status:'eq.active'}),request('invitation',{...queries.invitation(),accepted_at:'not.is.null'}),
    request('invitation',{...queries.invitation(),invitation_revoked_at:'not.is.null'}),
    request('role',{...queries.role(),limit:'2'}),request('role',{...queries.role(),offset:'0'}),
    request('identity',{...queries.identity(),or:'(auth_user_id.not.is.null)'}),
  ];
  const base=request('role');bad.push(new Request(base.url+'&limit=1',{headers:base.headers}));
  bad.push(new Request(base.url.replace('/merchant_enterprise_roles','/unknown'),{headers:base.headers}));
  bad.push(new Request(base.url+'&extra='+'x'.repeat(4096),{headers:base.headers}));
  for(const value of bad)assert.throws(()=>h.transport.read(value),/^Error: initial_password_default_read_forbidden$/);
  assert.deepEqual(h.sql(),[]);assert.deepEqual(h.transport.calls,[]);
});

test('only local GET with exact service credentials and SDK array Accept is permitted, with no header escape routes',()=>{
  const h=fixture(),bad=[...['POST','PUT','PATCH','DELETE','HEAD'].map(method=>request('role',queries.role(),{method})),
    request('role',queries.role(),{headers:{apikey:'attendance-synthetic-anon'}}),request('role',queries.role(),{headers:{authorization:'Bearer other'}}),
    request('role',queries.role(),{headers:{accept:'application/vnd.pgrst.object+json'}}),
    ...['range','range-unit','prefer','content-profile'].map(name=>request('role',queries.role(),{headers:{[name]:'unexpected'}})),
    request('role',queries.role(),{headers:{'accept-profile':'elsewhere'}})];
  const r=request('role');
  for(const url of [r.url.replace(origin,'https://external.example.test'),r.url+'#secret'])bad.push(new Request(url,{headers:r.headers}));
  for(const value of bad)assert.throws(()=>h.transport.read(value),/^Error: initial_password_default_read_forbidden$/);
  assert.deepEqual(h.sql(),[]);
  assert.equal(h.transport.read(request('role',queries.role(),{headers:{'accept-profile':'public'}})).status,200);
});

test('SQL construction keeps exact projections and predicates in owned read-only service transactions, with count-only diagnostics',async()=>{
  const h=fixture();
  for(const kind of Object.keys(tables))assert.deepEqual(await h.transport.read(request(kind)).json(),[rows[kind]]);
  for(const [index,kind] of Object.keys(tables).entries()){
    const sql=h.sql()[index];assert.match(sql,/^begin read only;reset role;do \$owned\$/);
    assert.match(sql,/c\.oid=456 and n\.oid=123/);assert(sql.includes(owned.marker));
    assert.match(sql,/set local role service_role/);assert(sql.includes('select '+columns[kind]+' from public.'+tables[kind]));
    assert.match(sql,/limit 1\) t\)\);commit;$/);
    assert.doesNotMatch(sql,/\b(insert|update|delete|grant|revoke|alter|truncate|drop)\b/i);
  }
  assert.match(h.sql()[0],/invitation_version=7 and invitation_token_hash=/);assert.match(h.sql()[0],/accepted_at is null and invitation_revoked_at is null/);
  assert.match(h.sql()[0],/invitation_expires_at>'2026-10-03T12:00:00\.000Z'::timestamptz/);
  assert.match(h.sql()[1],/status='active'/);assert.match(h.sql()[2],/principal_type='merchant_staff'/);
  assert.deepEqual(h.transport.calls,['invitation','role','identity'].map(kind=>({kind,status:200,error:null})));
  const diagnostics=JSON.stringify({calls:h.transport.calls,errors:h.transport.errors});
  assert(!diagnostics.includes('a'.repeat(64))&&!diagnostics.includes('b'.repeat(64))&&!diagnostics.includes(rows.invitation.email));
});

test('only exact identity-table permission rejection maps to fixed403/42501 without SQL details, while unrelated failures remain fixed errors',async()=>{
  for(const prefix of ['','attendance_reuse_sql_failed:']){
    const h=fixture(()=>{throw Error(prefix+'ERROR:  permission denied for table merchant_enterprise_staff_identities\nDETAIL: '+ 'a'.repeat(64));});
    const reply=h.transport.read(request('identity'));assert.equal(reply.status,403);
    assert.deepEqual(await reply.json(),{code:'42501',message:'permission denied for table merchant_enterprise_staff_identities',details:null,hint:null});
    assert.deepEqual(h.transport.calls,[{kind:'identity',status:403,error:'42501'}]);assert.deepEqual(h.transport.errors,[]);
    assert(!JSON.stringify(h.transport.calls).includes('a'.repeat(64)));
  }
  const bad=['ERROR: permission denied for table merchant_enterprise_employees',
    'ERROR: permission denied for table merchant_enterprise_staff_identities_extra',
    'ERROR: permission denied for table merchant_enterprise_staff_identities secret',
    'DETAIL: ERROR: permission denied for table merchant_enterprise_staff_identities',
    'ERROR: permission denied for table merchant_enterprise_staff_identities\nERROR: other failure',
    'ERROR: internal_error private-value'];
  for(const text of bad){const h=fixture(()=>{throw Error(text);});assert.throws(()=>h.transport.read(request('identity')),/^Error: initial_password_default_read_failed$/);assert.deepEqual(h.transport.errors,['initial_password_default_read_failed']);}
  const wrongKind=fixture(()=>{throw Error('ERROR: permission denied for table merchant_enterprise_staff_identities');});
  assert.throws(()=>wrongKind.transport.read(request('role')),/^Error: initial_password_default_read_failed$/);
});

test('namespace replacement and malformed/non-service/overwide SQL results fail without returning private rows',()=>{
  const changed=fixture();changed.setOwned({...owned,oid:999});
  assert.throws(()=>changed.transport.read(request('identity')),/^Error: initial_password_default_read_failed$/);assert.deepEqual(changed.sql(),[]);
  for(const value of [{role:'postgres',data:[rows.role]},{role:'service_role',data:rows.role},
    {role:'service_role',data:[rows.role,rows.role]},{role:'service_role',data:[{...rows.role,secret:'private-value'}]},
    {role:'service_role',data:[{id:id(30)}]}]){
    const h=fixture(()=>JSON.stringify(value));assert.throws(()=>h.transport.read(request('role')),/^Error: initial_password_default_read_failed$/);
  }
});

test('installed SDK through unchanged application-auth additionalRead consumes arrays, empty matches and actual PostgREST-shaped ACL errors',async()=>{
  let empty=false;
  const h=fixture((sql,kind)=>{
    if(kind==='identity')throw Error('attendance_reuse_sql_failed:ERROR:  permission denied for table merchant_enterprise_staff_identities\n');
    return JSON.stringify({role:'service_role',data:empty?[]:[rows[kind]]});
  });
  const actors=[1,2,3].map(n=>({id:id(n),email:`invite-retry-${n}@example.test`}));
  await withAttendanceApplicationAuth(actors,null,async protocol=>{
    const client=createClient(origin,service,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    for(const kind of ['invitation','role']){
      const result=await sdkRead(client,kind);assert.equal(result.error,null);assert.deepEqual(result.data,rows[kind]);
    }
    empty=true;const absent=await sdkRead(client,'role');assert.equal(absent.error,null);assert.equal(absent.data,null);
    const denied=await sdkRead(client,'identity');assert.equal(denied.data,null);assert.equal(denied.status,403);assert.equal(denied.error?.code,'42501');
    assert.deepEqual(protocol.calls.map(call=>call.path),[tables.invitation,tables.role,tables.role,tables.identity].map(table=>'/rest/v1/'+table));
    assert(protocol.calls.every(call=>call.method==='GET'));
  },undefined,h.transport.read);
  assert.equal(h.sql().length,4);assert.deepEqual(h.transport.errors,[]);
});

test('transport has no privilege installation, privileged fallback, network, model result injection or data writes',()=>{
  const source=readFileSync(new URL('./merchant-attendance-initial-password-default-transport.mjs',import.meta.url),'utf8');
  assert.match(source,/assertLifecycleSandbox\(prepared\.exec\),prepared\.owned/);
  assert.match(source,/begin read only;reset role;set local role service_role/);
  assert.match(source,/assert\.equal\(result\.role,'service_role'\)/);
  assert.doesNotMatch(source,/\b(?:grant|revoke|alter table|insert into|update|delete from|truncate|create schema|drop schema)\s+public\./i);
  assert.doesNotMatch(source,/loadStaffIdentity\(|loadInvitation\(|initialPasswordRpc\(|result\.role,'postgres'|fetch\(|spawn\(|createClient\(|console\.|process\.env/);
});
