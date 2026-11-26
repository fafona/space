// Generates a SOURCE-LOCAL projection, not a connector or approval. The Kong
// response (including plugin config) is processed transiently inside the source.
// It must not be used in production under the earlier no-full-config-read grant.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const kinds=['services','routes','plugins'];
export const checkoutKongMetadataEndpoints=Object.freeze({services:'http://127.0.0.1:8001/services?size=100',routes:'http://127.0.0.1:8001/routes?size=100',plugins:'http://127.0.0.1:8001/plugins?size=100'});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const ids=v=>Array.isArray(v)&&v.length<=30&&new Set(v).size===v.length&&v.every(s=>typeof s==='string'&&UUID.test(s));
export function checkoutKongSourceProjection(kind,scope={serviceIds:[],routeIds:[]}){
 if(!kinds.includes(kind)||!exact(scope,['serviceIds','routeIds'])||!ids(scope.serviceIds)||!ids(scope.routeIds))throw Error('kong_projection_scope_invalid');
 if(kind==='plugins'&&(!scope.serviceIds.length||!scope.routeIds.length))throw Error('kong_projection_scope_invalid');
 const map=a=>'{'+a.map(v=>'["'+v+'"]=true').join(',')+'}';
 return `package.path='/usr/local/openresty/lualib/?.lua;/usr/local/openresty/lualib/?/init.lua'
package.cpath='/usr/local/openresty/lualib/?.so'
local cjson=require('cjson.safe')
local kind=${JSON.stringify(kind)}
local service_ids=${map(scope.serviceIds)}
local route_ids=${map(scope.routeIds)}
local null=cjson.null
local function need(v) if not v then error('projection_rejected',0) end end
local function absent(v) return v==nil or v==null end
local function uuid(v) return type(v)=='string' and #v==36 and v:match('^[a-f0-9%-]+$') and v:sub(9,9)=='-' and v:sub(14,14)=='-' and v:sub(19,19)=='-' and v:sub(24,24)=='-' end
local function token(v,n) return type(v)=='string' and #v>0 and #v<=n and v:match('^[A-Za-z0-9_.%-]+$') end
local function foreign(v) if absent(v) then return null end need(type(v)=='table' and uuid(v.id));return v.id end
local function array(v,n) need(type(v)=='table' and #v<=n);local count=0;for k in pairs(v) do need(type(k)=='number' and k>=1 and k<=#v and k%1==0);count=count+1 end need(count==#v);return v end
local function public_path(v) return type(v)=='string' and #v<=256 and v:match('^/[-A-Za-z0-9_./~]*$') end
local function relevant(p) return p=='/auth/v1' or p=='/rest/v1' or p:sub(1,9)=='/auth/v1/' or p:sub(1,9)=='/rest/v1/' end
local function project()
 local raw=io.read(262145);need(type(raw)=='string' and #raw<=262144 and raw:sub(-4)=='\\n200')
 local body=cjson.decode(raw:sub(1,-5));need(type(body)=='table' and absent(body.next));array(body.data,100)
 local out,seen={},{}
 for _,v in ipairs(body.data) do
  need(type(v)=='table')
  if kind=='services' then
   if type(v.name)=='string' and (v.name=='auth' or v.name=='rest' or v.name:match('^auth%-') or v.name:match('^rest%-')) then
    need(uuid(v.id) and token(v.name,100) and type(v.host)=='string' and #v.host<=253 and v.host:match('^[A-Za-z0-9.:%-]+$') and (v.protocol=='http' or v.protocol=='https') and type(v.port)=='number' and v.port%1==0 and v.port>=1 and v.port<=65535 and (absent(v.path) or public_path(v.path)))
    out[#out+1]={id=v.id,name=v.name,host=v.host,port=v.port,protocol=v.protocol,path=absent(v.path) and null or v.path}
   end
  elseif kind=='routes' then
   local selected=false
   if not absent(v.paths) then for _,p in ipairs(array(v.paths,20)) do need(type(p)=='string');if relevant(p) then selected=true end end end
   if selected then
    need(uuid(v.id) and token(v.name,100) and type(v.strip_path)=='boolean' and type(v.preserve_host)=='boolean');local sid=foreign(v.service);need(sid~=null)
    for _,p in ipairs(v.paths) do need(public_path(p)) end
    for _,p in ipairs(array(v.protocols,4)) do need(p=='http' or p=='https') end
    out[#out+1]={id=v.id,name=v.name,paths=v.paths,protocols=v.protocols,stripPath=v.strip_path,preserveHost=v.preserve_host,serviceId=sid}
   end
  else
   local sid,rid=foreign(v.service),foreign(v.route)
   if absent(v.consumer) and ((sid==null and rid==null) or service_ids[sid] or route_ids[rid]) then
    need(uuid(v.id) and token(v.name,100) and type(v.enabled)=='boolean')
    out[#out+1]={id=v.id,name=v.name,enabled=v.enabled,serviceId=sid,routeId=rid,scope=(sid==null and rid==null) and 'global' or (rid~=null and 'route' or 'service')}
   end
  end
 end
 for _,v in ipairs(out) do need(not seen[v.id]);seen[v.id]=true end
 table.sort(out,function(a,b)return a.id<b.id end)
 local encoded={};for _,v in ipairs(out) do local s=cjson.encode(v);need(s);encoded[#encoded+1]=s end
 return '{"version":1,"kind":'..cjson.encode(kind)..',"items":['..table.concat(encoded,',')..'],"sourceResponseProcessed":true,"fullResponseExported":false,"pluginConfigExported":false,"consumerValuesExported":false,"credentialValuesExported":false,"productionAuthorized":false}'
end
local ok,result=pcall(project)
if ok then io.write(result,'\\n') else io.write('{"error":"kong_source_projection_rejected","productionAuthorized":false}\\n');os.exit(1) end
`;
}
export function validateCheckoutKongProjection(raw,kind){
 const need=v=>{if(!v)throw Error('kong_projected_metadata_invalid');};
 need(typeof raw==='string'&&Buffer.byteLength(raw)<=65536&&kinds.includes(kind));
 let v;try{v=JSON.parse(raw);}catch{throw Error('kong_projected_metadata_invalid');}
 need(exact(v,['version','kind','items','sourceResponseProcessed','fullResponseExported','pluginConfigExported','consumerValuesExported','credentialValuesExported','productionAuthorized'])&&v.version===1&&v.kind===kind&&v.sourceResponseProcessed===true&&v.fullResponseExported===false&&v.pluginConfigExported===false&&v.consumerValuesExported===false&&v.credentialValuesExported===false&&v.productionAuthorized===false);
 need(Array.isArray(v.items)&&v.items.length<=100);
 const token=s=>typeof s==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(s),uid=s=>typeof s==='string'&&UUID.test(s),pub=s=>typeof s==='string'&&s.length<=256&&/^\/[-A-Za-z0-9_./~]*$/.test(s);
 for(const x of v.items){
  if(kind==='services')need(exact(x,['id','name','host','port','protocol','path'])&&uid(x.id)&&token(x.name)&&/^(auth|rest)(-|$)/.test(x.name)&&typeof x.host==='string'&&/^[A-Za-z0-9.:-]{1,253}$/.test(x.host)&&Number.isInteger(x.port)&&x.port>=1&&x.port<=65535&&['http','https'].includes(x.protocol)&&(x.path===null||pub(x.path)));
  else if(kind==='routes')need(exact(x,['id','name','paths','protocols','stripPath','preserveHost','serviceId'])&&uid(x.id)&&token(x.name)&&uid(x.serviceId)&&Array.isArray(x.paths)&&x.paths.length>0&&x.paths.length<=20&&x.paths.every(pub)&&x.paths.some(p=>/^\/(auth|rest)\/v1(?:\/|$)/.test(p))&&Array.isArray(x.protocols)&&x.protocols.length>0&&x.protocols.length<=4&&x.protocols.every(p=>['http','https'].includes(p))&&typeof x.stripPath==='boolean'&&typeof x.preserveHost==='boolean');
  else need(exact(x,['id','name','enabled','serviceId','routeId','scope'])&&uid(x.id)&&token(x.name)&&typeof x.enabled==='boolean'&&(x.serviceId===null||uid(x.serviceId))&&(x.routeId===null||uid(x.routeId))&&x.scope===(x.serviceId===null&&x.routeId===null?'global':x.routeId!==null?'route':'service'));
 }
 need(new Set(v.items.map(x=>x.id)).size===v.items.length);return v;
}

// Uses only Kong's bundled LuaJIT and Linux sockets. Fixed IPv4 loopback port,
// HTTP/1.0 close, GET-only, no redirects/proxy/DNS, 3s deadline, bounded response.
// This remains generated code, NOT permission to execute a production request.
export function checkoutKongHttpSourceProjection(kind,scope){
 const projected=checkoutKongSourceProjection(kind,scope),needle='local raw=io.read(262145)';
 if(projected.split(needle).length!==2)throw Error('kong_projection_source_changed');
 const uri='/'+kind+'?size=100';
 const transport=`local ffi=require('ffi')
ffi.cdef[[
 struct source_sockaddr { unsigned short family; unsigned short port; unsigned int address; char zero[8]; };
 struct source_timeval { long seconds; long microseconds; };
 struct source_timespec { long seconds; long nanoseconds; };
 int socket(int,int,int); int connect(int,const void*,unsigned int); int close(int);
 int setsockopt(int,int,int,const void*,unsigned int); unsigned short htons(unsigned short); unsigned int inet_addr(const char*);
 long send(int,const void*,unsigned long,int); long recv(int,void*,unsigned long,int); int clock_gettime(int,struct source_timespec*);
]]
local function source_http_get()
 local fd=ffi.C.socket(2,1,0);if fd<0 then error('source_socket_unavailable',0) end
 local function need(v)if not v then error('source_http_refused',0)end end
 local function now()local t=ffi.new('struct source_timespec');need(ffi.C.clock_gettime(1,t)==0);return tonumber(t.seconds)+tonumber(t.nanoseconds)/1000000000 end
 local deadline=now()+3
 local function timeout()
  local left=deadline-now();need(left>0);local sec=math.floor(left);local tv=ffi.new('struct source_timeval',{sec,math.floor((left-sec)*1000000)})
  need(ffi.C.setsockopt(fd,1,20,tv,ffi.sizeof(tv))==0 and ffi.C.setsockopt(fd,1,21,tv,ffi.sizeof(tv))==0)
 end
 local function exchange()
  local address=ffi.new('struct source_sockaddr');address.family=2;address.port=ffi.C.htons(8001);address.address=ffi.C.inet_addr('127.0.0.1');timeout();need(ffi.C.connect(fd,address,ffi.sizeof(address))==0)
  local request=${JSON.stringify('GET '+uri+' HTTP/1.0\r\nHost: 127.0.0.1:8001\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n')}
  local buffer=ffi.new('char[?]',#request);ffi.copy(buffer,request);local sent=0
  while sent<#request do timeout();local n=tonumber(ffi.C.send(fd,buffer+sent,#request-sent,16384));need(n>0);sent=sent+n end
  local pieces,total={},0;local chunk=ffi.new('char[4096]')
  while true do timeout();local n=tonumber(ffi.C.recv(fd,chunk,4096,0));need(n>=0);if n==0 then break end;total=total+n;need(total<=278528);pieces[#pieces+1]=ffi.string(chunk,n) end
  local raw=table.concat(pieces);local split=raw:find('\\r\\n\\r\\n',1,true);need(split and split<=16384)
  local headers,body=raw:sub(1,split-1),raw:sub(split+4);need(headers:match('^HTTP/1%.[01] 200[ \\r]') and #body<=262140)
  local seen={};for line in headers:gmatch('[^\\r\\n]+') do
   if not line:match('^HTTP/') then local key,value=line:match('^([A-Za-z0-9%-]+):%s*(.-)%s*$');need(key);key=key:lower();need(not seen[key]);seen[key]=value end
  end
  need(not seen['transfer-encoding'] and (not seen['content-encoding'] or seen['content-encoding']=='identity'))
  if seen['content-length'] then need(seen['content-length']:match('^[0-9]+$') and tonumber(seen['content-length'])==#body) end
  need(seen['content-type'] and seen['content-type']:lower():find('application/json',1,true)==1)
  return body..'\\n200'
 end
 local ok,result=pcall(exchange);ffi.C.close(fd);if not ok then error('source_http_refused',0) end;return result
end
`;
 return transport+projected.replace(needle,'local raw=source_http_get()');
}
