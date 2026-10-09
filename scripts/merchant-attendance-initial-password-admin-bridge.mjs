// Closed, local Auth Admin protocol model for the default setup SDK path.
// This is not a real Auth server. Only the specified synthetic employee can be
// read/updated; all other requests remain subject to the original closed bridge.
import assert from 'node:assert/strict';
import {createInitialPasswordAuthBridge} from './merchant-attendance-initial-password-auth-bridge.mjs';
const origin='https://attendance-auth.invalid',service='attendance-synthetic-service';
export function createInitialPasswordAdminBridge(protocolFetch,actor,model){
  const userBridge=createInitialPasswordAuthBridge(protocolFetch,actor,model);
  assert.equal(typeof model.getAuthUserById,'function');assert.equal(typeof model.updateAuthUserById,'function');
  const calls=[],errors=[];
  const fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);
    if(url.origin!==origin||!url.pathname.startsWith('/auth/v1/admin/'))return userBridge.fetch(request);
    try{
      assert.equal(url.pathname,'/auth/v1/admin/users/'+actor.id);
      assert(!url.search&&!url.hash&&!url.username&&!url.password);
      assert(['GET','PUT'].includes(request.method));
      assert.equal(request.headers.get('apikey'),service);assert.equal(request.headers.get('authorization'),'Bearer '+service);
      const current=model.user();assert.equal(current.id,actor.id);assert.equal(current.email,actor.email);
      let attributes;
      if(request.method==='PUT'){
        assert(['application/json','application/json;charset=UTF-8'].includes(request.headers.get('content-type')));
        const raw=await request.text();assert(Buffer.byteLength(raw,'utf8')<=4096);attributes=JSON.parse(raw);
        assert(attributes&&typeof attributes==='object'&&!Array.isArray(attributes));
        assert.deepEqual(Object.keys(attributes).sort(),['app_metadata','password']);
        assert.equal(typeof attributes.password,'string');assert(attributes.password.length>=8&&attributes.password.length<=128);
        assert.deepEqual(attributes.app_metadata,{...current.app_metadata,merchant_staff_password_initialized:true});
      }else assert.equal(await request.text(),'');
      const call={method:request.method,status:null};calls.push(call);
      const result=request.method==='GET'?await model.getAuthUserById(actor.id):await model.updateAuthUserById(actor.id,attributes);
      if(result.error){
        // Only the model's explicit committed-but-lost response is modeled.
        assert.equal(request.method,'PUT');assert.equal(result.error.status,503);
        assert.equal(result.error.message,'synthetic_auth_reply_lost_after_commit');
        call.status=503;
        return Response.json({code:'unexpected_failure',message:'Synthetic Auth reply unavailable'},{status:503});
      }
      assert(result.user&&result.user.id===actor.id&&result.user.email===actor.email);
      call.status=200;return Response.json({user:result.user},{headers:{'cache-control':'no-store'}});
    }catch{
      errors.push('initial_password_admin_bridge_rejected');throw Error('initial_password_admin_bridge_rejected');
    }
  };
  return {fetch,calls,errors,proof:userBridge.proof};
}
