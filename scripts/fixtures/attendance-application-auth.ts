// In-memory AUTH PROTOCOL FIXTURE, not a real Supabase login service. Exercises
// the installed SDK + unchanged application resolver without network or secrets.
import assert from "node:assert/strict";
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
type Actor={id:string;email:string};
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>;
type MerchantIdentityFixture={ownerId:string;read:(request:Request)=>Response};
const origin="https://attendance-auth.invalid",anon="attendance-synthetic-anon",service="attendance-synthetic-service";
const flags=["SELF","ADMIN","CORRECTIONS","CORRECTION_REVIEW","CORRECTION_DECISIONS","CURRENT_CORRECTION_DECISIONS","REVISION_REQUESTS","REVISION_CYCLES","REVISION_REVIEW","REVISION_DECISIONS","REVISION_HISTORY"];
export async function withAttendanceApplicationAuth<T>(actors:Actor[],rpc:Rpc|null,check:(fixture:{login:(actor:Actor)=>Promise<string>;issue:(actor:Actor,methods:string[],ttl?:number)=>string;
  revoke:(token:string)=>void;tamper:(token:string,patch:Record<string,unknown>)=>string;userMismatch:(id:string|null)=>void;calls:{path:string;method:string}[]})=>Promise<T>,merchantIdentity?:MerchantIdentityFixture,additionalRead?:(request:Request)=>Response,syntheticPasswordCheck?:(actor:Actor,password:unknown)=>boolean){
  for(const a of actors){assert.match(a.id,/^00000000-0000-4000-8000-\d{12}$/);assert.match(a.email,/@example\.test$/);}
  const environment:Record<string,string>={SUPABASE_INTERNAL_URL:origin,NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,
    NEXT_SUPABASE_SERVICE_ROLE_KEY:service,FAOLLA_CANONICAL_PORTAL_ORIGIN:"https://www.faolla.com",...Object.fromEntries(flags.map(f=>['FAOLLA_ATTENDANCE_'+f+'_ENABLED','1']))};
  const saved=new Map(Object.keys(environment).map(k=>[k,process.env[k]])),previousFetch=globalThis.fetch,secret=randomBytes(32),revoked=new Set<string>(),calls:{path:string;method:string}[]=[];
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const signature=(v:string)=>createHmac('sha256',secret).update(v).digest('base64url');
  const issue=(a:Actor,methods:string[],ttl=3600)=>{const now=Math.floor(Date.now()/1000),payload={sub:a.id,email:a.email,role:'authenticated',aud:'authenticated',iss:origin+'/auth/v1',iat:now,exp:now+ttl,amr:methods.map(method=>({method,timestamp:now})),session_id:randomUUID()};
    const unsigned=encode({alg:'HS256',typ:'JWT'})+'.'+encode(payload);return unsigned+'.'+signature(unsigned);};
  if(merchantIdentity)assert(actors.some(a=>a.id===merchantIdentity.ownerId));
  const metadata=new Map<string,{user_metadata:Record<string,unknown>;app_metadata:Record<string,unknown>}>();
  const user=(a:Actor)=>({...a,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},...metadata.get(a.id),created_at:'2026-01-01T00:00:00Z'});
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  const refreshTokens=new Map<string,{actor:Actor;accessToken:string}>();
  const session=(a:Actor,methods:string[])=>{const token=issue(a,methods),refresh=randomUUID();refreshTokens.set(refresh,{actor:a,accessToken:token});
    return {access_token:token,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:refresh,user:user(a)};};
  let mismatch:string|null=null;
  Object.assign(process.env,environment);
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);assert.equal(url.origin,origin,'fixture_external_request_forbidden');calls.push({path:url.pathname,method:request.method});
    if(url.pathname==='/auth/v1/token'&&request.method==='POST'){
      assert.equal(request.headers.get('apikey'),anon);const body=await request.json();
      if(url.searchParams.get('grant_type')==='refresh_token'){
        const saved=refreshTokens.get(body.refresh_token);refreshTokens.delete(body.refresh_token);
        if(!saved||revoked.has(saved.accessToken))return json({code:'refresh_token_not_found',message:'Invalid refresh token'},400);
        return json(session(saved.actor,['password','token_refresh']));
      }
      assert.equal(url.searchParams.get('grant_type'),'password');const a=actors.find(a=>a.email===body.email);
      if(!a||(syntheticPasswordCheck?!syntheticPasswordCheck(a,body.password):body.password!=='Synthetic-attendance-only!'))return json({code:'invalid_credentials',error_code:'invalid_credentials',message:'Invalid credentials'},400);
      return json(session(a,['password']));
    }
    if(url.pathname==='/auth/v1/logout'&&request.method==='POST'){
      assert.equal(request.headers.get('apikey'),anon);const token=(request.headers.get('authorization')??'').replace(/^Bearer /,'');revoked.add(token);
      for(const [key,value] of refreshTokens)if(value.accessToken===token)refreshTokens.delete(key);
      return new Response(null,{status:204});
    }
    if(url.pathname==='/auth/v1/user'&&request.method==='GET'){
      assert.equal(request.headers.get('apikey'),anon);const token=(request.headers.get('authorization')??'').replace(/^Bearer /,'');
      try{const [header,payload,sig]=token.split('.'),expected=signature(header+'.'+payload),claims=JSON.parse(Buffer.from(payload,'base64url').toString()),a=actors.find(a=>a.id===claims.sub);
        assert(sig&&sig.length===expected.length&&timingSafeEqual(Buffer.from(sig),Buffer.from(expected))&&!revoked.has(token)&&claims.exp>Math.floor(Date.now()/1000)&&a);
        return json({...user(a),...(mismatch?{id:mismatch}:{})});
      }catch{return json({code:'bad_jwt',message:'Invalid session'},401);}
    }
    if(url.pathname.startsWith('/rest/v1/rpc/')&&request.method==='POST'){
      assert(rpc,'fixture_rpc_forbidden');assert.equal(request.headers.get('apikey'),service);assert.equal(request.headers.get('authorization'),'Bearer '+service);
      const response=await rpc(url.pathname.slice('/rest/v1/rpc/'.length),await request.json());return response.error?json({code:'P0001',message:response.error.message},400):json(response.data);
    }
    if(merchantIdentity&&['/rest/v1/merchants','/rest/v1/merchant_enterprise_employees'].includes(url.pathname)){
      assert.equal(request.method,'GET');assert.equal(request.headers.get('apikey'),service);assert.equal(request.headers.get('authorization'),'Bearer '+service);
      return merchantIdentity.read(request);
    }
    // Optional strict local SQL read adapter. It owns a closed table/query
    // allowlist; it cannot add REST writes or another origin to this fixture.
    if(additionalRead&&url.pathname.startsWith('/rest/v1/')&&request.method==='GET'){
      assert.equal(request.headers.get('apikey'),service);assert.equal(request.headers.get('authorization'),'Bearer '+service);
      return additionalRead(request);
    }
    if(merchantIdentity&&url.pathname==='/auth/v1/admin/users/'+merchantIdentity.ownerId){
      assert.equal(request.method,'PUT');assert.equal(request.headers.get('apikey'),service);assert.equal(request.headers.get('authorization'),'Bearer '+service);
      const body=await request.json();assert.deepEqual(Object.keys(body).sort(),['app_metadata','user_metadata']);
      for(const value of [body.app_metadata,body.user_metadata]){assert.equal(value.account_type,'merchant');assert.equal(value.account_id,'99990001');assert.equal(value.merchant_id,'99990001');}
      // The real login handler persists account metadata. Only this synthetic
      // owner's in-memory Auth record can be updated; no table/user API writes.
      metadata.set(merchantIdentity.ownerId,body);return json(user(actors.find(a=>a.id===merchantIdentity.ownerId)!));
    }
    throw Error('fixture_unexpected_endpoint');
  };
  try{return await check({issue,revoke:token=>{revoked.add(token);},tamper:(token,patch)=>{const parts=token.split('.');parts[1]=encode({...JSON.parse(Buffer.from(parts[1],'base64url').toString()),...patch});return parts.join('.');},userMismatch:id=>{mismatch=id;},calls,
    login:async actor=>{const client=createClient(origin,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const result=await client.auth.signInWithPassword({email:actor.email,password:'Synthetic-attendance-only!'});assert.equal(result.error,null);assert(result.data.session?.access_token);return result.data.session.access_token;}});
  }finally{globalThis.fetch=previousFetch;for(const [key,value] of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
