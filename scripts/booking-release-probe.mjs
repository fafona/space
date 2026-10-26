// Fixed unauthenticated loopback GETs. Native HTTP preserves Host on Node20.
import http from 'node:http';
export const BOOKING_PROBE_LIMITS=Object.freeze({milliseconds:20000,bodyBytes:2*1024**2});
const paths=new Map([['/booking-manage','launch.faolla.com'],['/api/bookings?siteId=10000000','launch.faolla.com'],
 ['/api/super-admin/data-backups','console.faolla.com']]);
export async function bookingReleaseProbeFetch(address,options={}){
 const url=new URL(address),headers=new Headers(options.headers),host=paths.get(url.pathname+url.search);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.hash||!host||
  options.method&&options.method!=='GET'||options.body!==undefined||options.redirect!=='manual'||headers.get('Host')!==host||
  [...headers.keys()].some(k=>!['host','connection'].includes(k)))throw Error('booking_probe_scope_invalid');
 return new Promise((resolve,reject)=>{
  let settled=false,timer,response;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   if(error){response?.destroy();request.destroy();reject(error);}else resolve(value);};
  const abort=()=>finish(Error('booking_probe_aborted'));
  const request=http.request(url,{method:'GET',agent:false,headers:{Host:host,Connection:'close','X-Forwarded-Proto':'https'},maxHeaderSize:16384},incoming=>{
   response=incoming;let size=0;const chunks=[];
   incoming.on('data',chunk=>{size+=chunk.length;if(size>BOOKING_PROBE_LIMITS.bodyBytes)finish(Error('booking_probe_body_limit'));else chunks.push(chunk);});
   incoming.on('error',()=>finish(Error('booking_probe_response_failed')));incoming.on('aborted',()=>finish(Error('booking_probe_response_failed')));
   incoming.on('end',()=>{if(settled)return;try{const responseHeaders=new Headers();for(let i=0;i<incoming.rawHeaders.length;i+=2)responseHeaders.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
    finish(null,new Response([204,205,304].includes(incoming.statusCode)?null:Buffer.concat(chunks),{status:incoming.statusCode,headers:responseHeaders}));
   }catch{finish(Error('booking_probe_response_failed'));}});
  });
  request.on('error',()=>finish(Error('booking_probe_request_failed')));timer=setTimeout(()=>finish(Error('booking_probe_timeout')),BOOKING_PROBE_LIMITS.milliseconds);
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();else request.end();
 });
}
