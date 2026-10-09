// Local protocol diagnostic only: exact default SDK GETs -> real read-only
// service_role SQL. No table privileges are changed and no privileged fallback
// supplies a row when the service role cannot read the identity registry.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',origin='https://attendance-auth.invalid',service='attendance-synthetic-service';
const actors=new Set([id(1),id(2),id(3)]),roles=new Set([id(30),id(31),id(32)]);
const columns={
  invitation:'id,merchant_id,auth_user_id,email,role_id,status,accepted_at,invitation_version,invitation_token_hash,invitation_expires_at,invitation_revoked_at',
  role:'id,merchant_id,status',identity:'auth_user_id,email_hash,principal_type',
};
const tables={invitation:'merchant_enterprise_employees',role:'merchant_enterprise_roles',identity:'merchant_enterprise_staff_identities'};
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const exactQuery=(q,keys)=>{
  assert.equal([...q.keys()].length,new Set(q.keys()).size);
  assert.deepEqual([...q.keys()].sort(),[...keys].sort());
};
const filter=(q,key,prefix)=>{
  const value=q.get(key);assert(typeof value==='string'&&value.startsWith(prefix));return value.slice(prefix.length);
};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Closed pure protocol validation, not an authorization decision or SQL reply. */
export function validateInitialPasswordDefaultRead(request){
  assert(request instanceof Request);assert.equal(request.method,'GET');assert(request.url.length<=4096);
  const url=new URL(request.url),q=url.searchParams;
  assert.equal(url.origin,origin);assert(!url.username&&!url.password&&!url.hash);
  assert.equal(request.headers.get('apikey'),service);assert.equal(request.headers.get('authorization'),'Bearer '+service);
  assert.equal(request.headers.get('accept'),'application/json');
  for(const name of ['range','range-unit','prefer','content-profile'])assert.equal(request.headers.get(name),null);
  assert([null,'public'].includes(request.headers.get('accept-profile')));
  assert.equal(q.get('limit'),'1');
  if(url.pathname==='/rest/v1/'+tables.invitation){
    exactQuery(q,['select','merchant_id','auth_user_id','invitation_version','invitation_token_hash','status',
      'accepted_at','invitation_revoked_at','invitation_expires_at','limit']);
    assert.equal(q.get('select'),columns.invitation);assert.equal(q.get('merchant_id'),'eq.'+site);
    const actorId=filter(q,'auth_user_id','eq.');assert(actors.has(actorId));
    assert.equal(q.get('invitation_version'),'eq.7');const tokenHash=filter(q,'invitation_token_hash','eq.');assert(hex(tokenHash));
    assert.equal(q.get('status'),'eq.invited');assert.equal(q.get('accepted_at'),'is.null');assert.equal(q.get('invitation_revoked_at'),'is.null');
    const nowIso=filter(q,'invitation_expires_at','gt.');assert.equal(new Date(nowIso).toISOString(),nowIso);
    return {kind:'invitation',actorId,tokenHash,nowIso};
  }
  if(url.pathname==='/rest/v1/'+tables.role){
    exactQuery(q,['select','merchant_id','id','status','limit']);assert.equal(q.get('select'),columns.role);
    assert.equal(q.get('merchant_id'),'eq.'+site);const roleId=filter(q,'id','eq.');assert(roles.has(roleId));
    assert.equal(q.get('status'),'eq.active');return {kind:'role',roleId};
  }
  if(url.pathname==='/rest/v1/'+tables.identity){
    exactQuery(q,['select','auth_user_id','email_hash','principal_type','limit']);assert.equal(q.get('select'),columns.identity);
    const actorId=filter(q,'auth_user_id','eq.');assert(actors.has(actorId));
    const emailHash=filter(q,'email_hash','eq.');assert(hex(emailHash));assert.equal(q.get('principal_type'),'eq.merchant_staff');
    return {kind:'identity',actorId,emailHash};
  }
  throw Error('initial_password_default_read_forbidden');
}

function exactIdentityPermissionDenied(error){
  if(!(error instanceof Error))return false;
  // The existing native executor prefixes psql stderr with this fixed marker.
  // Match one complete ERROR line only, never a substring or arbitrary detail.
  const lines=error.message.split(/\r?\n/).map(line=>line.replace(/^attendance_reuse_sql_failed:/,''));
  const errors=lines.filter(line=>line.startsWith('ERROR:'));
  return errors.length===1&&/^ERROR:[ \t]+permission denied for table merchant_enterprise_staff_identities[ \t]*$/.test(errors[0]);
}

export function createInitialPasswordDefaultTransport(prepared){
  assert.equal(typeof prepared.exec,'function');
  assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_default_namespace_changed');
  const calls=[],errors=[];
  const response=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  const read=request=>{
    let input;
    try{input=validateInitialPasswordDefaultRead(request);}catch{
      errors.push('initial_password_default_read_forbidden');throw Error('initial_password_default_read_forbidden');
    }
    const {kind}=input,call={kind,status:null,error:null};calls.push(call);
    try{
      assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_default_namespace_changed');
      const where=kind==='invitation'?`merchant_id='${site}' and auth_user_id=${quote(input.actorId)}
        and invitation_version=7 and invitation_token_hash=${quote(input.tokenHash)} and status='invited'
        and accepted_at is null and invitation_revoked_at is null and invitation_expires_at>${quote(input.nowIso)}::timestamptz`:
        kind==='role'?`merchant_id='${site}' and id=${quote(input.roleId)} and status='active'`:
          `auth_user_id=${quote(input.actorId)} and email_hash=${quote(input.emailHash)} and principal_type='merchant_staff'`;
      const result=JSON.parse(prepared.exec(`begin read only;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)
          from(select ${columns[kind]} from public.${tables[kind]} where ${where} limit 1) t));commit;`));
      assert.equal(result.role,'service_role');assert(Array.isArray(result.data)&&result.data.length<=1);
      for(const row of result.data){
        assert(row&&typeof row==='object'&&!Array.isArray(row));
        assert.deepEqual(Object.keys(row).sort(),columns[kind].split(',').sort());
      }
      // GET maybeSingle uses application/json: the installed PostgREST client
      // converts [] to null or a one-row array to the object itself.
      call.status=200;return response(result.data);
    }catch(error){
      if(kind==='identity'&&exactIdentityPermissionDenied(error)){
        call.status=403;call.error='42501';
        return response({code:'42501',message:'permission denied for table merchant_enterprise_staff_identities',details:null,hint:null},403);
      }
      errors.push('initial_password_default_read_failed');throw Error('initial_password_default_read_failed');
    }
  };
  return {read,calls,errors};
}
