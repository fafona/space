import http from 'node:http';
export const CONTACT_WECHAT_PROBE_LIMITS=Object.freeze({milliseconds:20000,bodyBytes:2*1024**2});
export async function contactWechatReleaseProbeFetch(address,options={}){
 const url=new URL(address),headers=new Headers(options.headers);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.hash||options.method&&options.method!=='GET'||options.body!==undefined||options.redirect!=='manual'||headers.get('Host')!=='launch.faolla.com'||[...headers.keys()].some(key=>!['host','connection'].includes(key)))throw Error('contact_wechat_probe_scope_invalid');
 const allowed=new Set(['/api/merchant-enterprise/attendance/admin?siteId=10000000','/api/merchant-enterprise/attendance/self?siteId=10000000','/api/merchant-enterprise/attendance/records?siteId=10000000','/test-harness/enterprise','/test-harness/employee-workspace']);
 if(!allowed.has(url.pathname+url.search))throw Error('contact_wechat_probe_scope_invalid');
 return new Promise((resolve,reject)=>{
  let settled=false,timer,response;
  const finish=(error,value)=>{
   if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   if(error){response?.destroy();request.destroy();reject(error);}else resolve(value);
  };
  const abort=()=>finish(Error('contact_wechat_probe_aborted'));
  const request=http.request(url,{method:'GET',agent:false,headers:{Host:'launch.faolla.com',Connection:'close'},maxHeaderSize:16384},incoming=>{
   response=incoming;let size=0;const chunks=[];
   incoming.on('data',chunk=>{size+=chunk.length;if(size>CONTACT_WECHAT_PROBE_LIMITS.bodyBytes)finish(Error('contact_wechat_probe_body_limit'));else chunks.push(chunk);});
   incoming.on('error',()=>finish(Error('contact_wechat_probe_response_failed')));
   incoming.on('aborted',()=>finish(Error('contact_wechat_probe_response_failed')));
   incoming.on('end',()=>{
    if(settled)return;
    try{
     const responseHeaders=new Headers();for(let i=0;i<incoming.rawHeaders.length;i+=2)responseHeaders.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
     const body=[204,205,304].includes(incoming.statusCode)?null:Buffer.concat(chunks);
     finish(null,new Response(body,{status:incoming.statusCode,headers:responseHeaders}));
    }catch{finish(Error('contact_wechat_probe_response_failed'));}
   });
  });
  request.on('error',()=>finish(Error('contact_wechat_probe_request_failed')));
  timer=setTimeout(()=>finish(Error('contact_wechat_probe_timeout')),CONTACT_WECHAT_PROBE_LIMITS.milliseconds);
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();else request.end();
 });
}
