// Local Auth-model bridge only. The existing closed protocol fixture owns JWT
// generation/validation and API-key checks; no real Auth service is represented.
const origin='https://attendance-auth.invalid';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const invalidCredentials=()=>Response.json({code:'invalid_credentials',error_code:'invalid_credentials',message:'Invalid credentials'},{status:400});
const invalidResponse=()=>Response.json({code:'bad_jwt',message:'Invalid session'},{status:401});
const nonempty=value=>typeof value==='string'&&value.length>0;

export function createInitialPasswordAuthBridge(protocolFetch,actor,model){
  if(typeof protocolFetch!=='function'||!record(actor)||!/^00000000-0000-4000-8000-\d{12}$/.test(actor.id??'')
    ||typeof actor.email!=='string'||!/^[^@\s]+@example\.test$/.test(actor.email)
    ||!model||typeof model.user!=='function'||typeof model.passwordMatches!=='function'||typeof model.proof!=='function')
    throw Error('initial_password_auth_bridge_configuration_invalid');
  const actorId=actor.id,actorEmail=actor.email;
  const currentModelUser=()=>{
    const user=model.user();
    if(!record(user)||user.id!==actorId||user.email!==actorEmail||!record(user.app_metadata))
      throw Error('initial_password_auth_bridge_model_identity_invalid');
    return user;
  };
  currentModelUser();
  let passwordAttempts=0,passwordRejected=0,passwordAccepted=0,validatedUserReads=0;
  const proof=()=>({passwordAttempts,passwordRejected,passwordAccepted,validatedUserReads});
  const fetch=async(input,init)=>{
    let request,url;
    try{request=new Request(input,init);url=new URL(request.url);}catch{throw Error('initial_password_auth_bridge_request_invalid');}
    if(url.origin!==origin||url.username||url.password||url.hash)throw Error('initial_password_auth_bridge_external_request_forbidden');
    const tokenRequest=url.pathname==='/auth/v1/token'&&request.method==='POST';
    const passwordRequest=tokenRequest&&url.searchParams.get('grant_type')==='password';
    if(passwordRequest){
      passwordAttempts++;
      let body;try{body=await request.clone().json();}catch{passwordRejected++;return invalidCredentials();}
      const current=currentModelUser();
      if(!record(body)||body.email!==actorEmail||typeof body.password!=='string'
        ||model.proof().initialized!==true||current.app_metadata.merchant_staff_password_initialized!==true
        ||!model.passwordMatches(body.password)){
        passwordRejected++;return invalidCredentials();
      }
    }
    let response;
    // The original request, headers and password are delegated unchanged. A
    // caller may opt into the protocol fixture's model-backed password checker.
    try{response=await protocolFetch(request);}catch{
      if(passwordRequest)passwordRejected++;
      throw Error('initial_password_auth_bridge_protocol_failed');
    }
    if(!(response instanceof Response)){
      if(passwordRequest)passwordRejected++;
      throw Error('initial_password_auth_bridge_response_invalid');
    }
    if(!response.ok){if(passwordRequest)passwordRejected++;return response;}
    const userRequest=url.pathname==='/auth/v1/user'&&request.method==='GET';
    if(!tokenRequest&&!userRequest)return response;
    let body;try{body=await response.clone().json();}catch{if(passwordRequest)passwordRejected++;return invalidResponse();}
    const validated=tokenRequest?body?.user:body;
    if(!record(body)||!record(validated)||validated.id!==actorId||validated.email!==actorEmail
      ||(tokenRequest&&(!nonempty(body.access_token)||!nonempty(body.refresh_token)))){
      if(passwordRequest)passwordRejected++;return invalidResponse();
    }
    const current=currentModelUser();
    const user={...validated,app_metadata:{...(record(validated.app_metadata)?validated.app_metadata:{}),...current.app_metadata}};
    if(passwordRequest)passwordAccepted++;
    if(userRequest)validatedUserReads++;
    const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
    return Response.json(tokenRequest?{...body,user}:user,{status:response.status,statusText:response.statusText,headers});
  };
  return {fetch,proof};
}
