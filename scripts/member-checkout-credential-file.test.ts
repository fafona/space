import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import http from "node:http";
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {createCredentialFileReader,publishCredentialFile,validateCredentialEnvelope,type CredentialFilePolicy,type CredentialEnvelope} from "./fixtures/merchant-checkout-credential-file";
import {createFileDeliveryRuntimeClient as create} from "./fixtures/merchant-checkout-runtime-delivery";
const at=1_790_000_000_000,method="faolla_member_checkout_catalog_snapshot_v1",args={p_site_id:"10909992"},key=randomBytes(48),unavailable={data:null,error:{message:"checkout_runtime_unavailable"}};
const base:CredentialFilePolicy={directory:"/tmp/owned-unused-credential",ownerUid:0,ownerGid:0,access:"owner",algorithm:"HS256",issuer:"owned-checkout-issuer",audience:"owned-checkout-audience"};
const jwt=(now=at,changes:Record<string,unknown>={},header:Record<string,unknown>={alg:"HS256",typ:"JWT"})=>{
 const body=[header,{role:"faolla_checkout_runtime",iss:base.issuer,aud:base.audience,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+30,jti:randomUUID(),...changes}].map(v=>Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");return body+"."+createHmac("sha256",key).update(body).digest("base64url");};
const envelope=(now=at,changes:Record<string,unknown>={}):CredentialEnvelope=>({version:1,purpose:"faolla-checkout-runtime-v1",generation:randomUUID(),jwt:jwt(now,changes)});
const linux={skip:process.platform!=="linux"};
const owned=()=>{const directory=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),"faolla-checkout-credential-test-"));fs.chmodSync(directory,0o700);return {...base,directory,ownerUid:process.getuid!(),ownerGid:process.getgid!()};};
const environment=(p:CredentialFilePolicy)=>({SUPABASE_INTERNAL_URL:"https://credential.synthetic.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"sb_publishable_synthetic123456",FAOLLA_CHECKOUT_RUNTIME_JWT:jwt(),
 FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_SOURCE:"file",FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_DIRECTORY:p.directory,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_UID:String(p.ownerUid),FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_GID:String(p.ownerGid),
 FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ACCESS:p.access,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ALGORITHM:p.algorithm,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ISSUER:p.issuer,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_AUDIENCE:p.audience});
const read=async(p:CredentialFilePolicy)=>await createCredentialFileReader(p).read(AbortSignal.timeout(1000),()=>at,at+500);
test("capability envelope pins purpose, role, algorithm, issuer, audience and a five-minute maximum lifetime",()=>{
 assert.ok(validateCredentialEnvelope(envelope(),base,at,at+1000));
 for(const fields of [{role:"service_role"},{role:"authenticated"},{iss:"other"},{aud:"other"},{iat:at/1000+1},{iat:at/1000-301},{exp:at/1000+301},{exp:at/1000+3},{exp:1.5},{nbf:at/1000+1},{jti:"bad value"},{extra:"claim"}])assert.throws(()=>validateCredentialEnvelope(envelope(at,fields),base,at,at+1000),/^Error: checkout_runtime_unavailable$/);
 for(const header of [{alg:"none",typ:"JWT"},{alg:"RS256",typ:"JWT"},{alg:"HS256",typ:"not-JWT"},{alg:"HS256",typ:"JWT",jku:"https://not-used.invalid"}])assert.throws(()=>validateCredentialEnvelope({...envelope(),jwt:jwt(at,{},header)},base,at,at));
 const parts=jwt().split("."),duplicate=Buffer.from(parts[1],"base64url").toString().replace('"role":','"role":"service_role","role":'),body=parts[0]+"."+Buffer.from(duplicate).toString("base64url");
 assert.throws(()=>validateCredentialEnvelope({...envelope(),jwt:body+"."+createHmac("sha256",key).update(body).digest("base64url")},base,at,at));
});
test("malformed, duplicate-shape, accessor and proxy envelopes are rejected without invoking application getters",()=>{
 let called=0;const getter=Object.defineProperty({...envelope()},"jwt",{enumerable:true,get(){called++;return jwt();}});
 for(const value of [null,{}, {...envelope(),extra:true},{...envelope(),generation:"../escape"},{...envelope(),jwt:"secret\r\nheader"},getter,new Proxy(envelope(),{})])assert.throws(()=>validateCredentialEnvelope(value,base,at,at));assert.equal(called,0);
});
test("default and explicit ENV modes preserve the old client without attempting file delivery",async()=>{
 for(const source of [undefined,"env"]){let reads=0,sent=0;const env={...environment(base),FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_SOURCE:source};
  const client=create({environment:env,now:()=>at,fetch:async()=>{sent++;return Response.json({ok:true});},readCredential:async()=>{reads++;throw Error("must-not-read");}})!;
  assert.ok(client);assert.equal((await client.rpc(method,args)).error,null);assert.equal(reads,0);assert.equal(sent,1);
 }
 for(const source of ["","FILE","file ","service_role"])assert.equal(create({environment:{...environment(base),FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_SOURCE:source},now:()=>at}),null);
 if(process.platform!=="linux")assert.equal(create({environment:environment(base),now:()=>at}),null);
});
test("private atomic publications rotate real files; removal never returns a cached or ENV credential",linux,async()=>{
 const p=owned(),reader=createCredentialFileReader(p);let prior="";
 for(let i=0;i<3;i++){const value=envelope();const receipt=await publishCredentialFile(p,value,at);assert.equal(receipt.published,true);const current=await reader.read(AbortSignal.timeout(1000),()=>at,at+500);assert.ok(current.jwt===value.jwt);assert.notEqual(current.generation,prior);prior=current.generation;}
 assert.equal(fs.statSync(path.join(p.directory,"runtime.json")).mode&0o777,0o600);fs.renameSync(path.join(p.directory,"runtime.json"),path.join(p.directory,"runtime.retained"));await assert.rejects(reader.read(AbortSignal.timeout(1000),()=>at,at));
 let sent=0;const client=create({environment:environment(p),now:()=>at,fetch:async()=>{sent++;return Response.json({});}})!;assert.deepEqual(await client.rpc(method,args),unavailable);assert.equal(sent,0);
});
test("file links, mode, wrong UID/GID, BOM, invalid UTF-8, truncation and oversized content fail closed",linux,async()=>{
 for(const scenario of ["symlink","hardlink","mode","uid","gid","bom","utf8","truncated","oversize"]){const p=owned(),value=envelope();await publishCredentialFile(p,value,at);const file=path.join(p.directory,"runtime.json");
  if(scenario==="symlink"){fs.renameSync(file,file+".retained");fs.symlinkSync(file+".retained",file);}if(scenario==="hardlink")fs.linkSync(file,file+".second");if(scenario==="mode")fs.chmodSync(file,0o644);
  if(scenario==="bom")fs.writeFileSync(file,Buffer.concat([Buffer.from([239,187,191]),fs.readFileSync(file)]));if(scenario==="utf8")fs.writeFileSync(file,Buffer.from([195,40]));if(scenario==="truncated")fs.writeFileSync(file,"{");if(scenario==="oversize")fs.writeFileSync(file," ".repeat(32769));
  await assert.rejects(read(scenario==="uid"?{...p,ownerUid:p.ownerUid+1}:scenario==="gid"?{...p,ownerGid:p.ownerGid+1}:p),/^Error: checkout_runtime_unavailable$/);
 }
});
test("root replacement and unsafe paths refuse rather than repinning or repairing permissions",linux,async()=>{
 const p=owned();await publishCredentialFile(p,envelope(),at);const reader=createCredentialFileReader(p);await reader.read(AbortSignal.timeout(1000),()=>at,at);
 fs.renameSync(p.directory,p.directory+".retained");fs.mkdirSync(p.directory,{mode:0o700});await publishCredentialFile(p,envelope(),at);await assert.rejects(reader.read(AbortSignal.timeout(1000),()=>at,at));
 for(const directory of [p.directory+"/..",p.directory+"/",p.directory+"\0", "relative"]){assert.throws(()=>createCredentialFileReader({...p,directory}));}
 fs.chmodSync(p.directory,0o755);await assert.rejects(read(p));assert.equal(fs.statSync(p.directory).mode&0o777,0o755);
});
test("publication preserves invalid prior targets and retains failed temporary evidence; it never changes modes",linux,async()=>{
 const p=owned(),file=path.join(p.directory,"runtime.json"),retained=path.join(p.directory,"retained.json");fs.writeFileSync(retained,"retained",{mode:0o600,flag:"wx"});fs.symlinkSync(retained,file);
 await assert.rejects(publishCredentialFile(p,envelope(),at));assert.equal(fs.readFileSync(retained,"utf8"),"retained");assert.equal(fs.lstatSync(file).isSymbolicLink(),true);assert.ok(fs.readdirSync(p.directory).some(name=>name.endsWith(".tmp")));
 const group={...owned(),access:"group" as const};fs.chmodSync(group.directory,0o750);await publishCredentialFile(group,envelope(),at);
 if(process.getuid!()!==0)assert.throws(()=>createCredentialFileReader(group)); // Does not claim a distinct-UID reader was exercised.
});
test("same runtime client reads three file generations and preserves lazy snapshots and one dispatch per call",linux,async()=>{
 const p=owned();let time=at,attempts=0;const requests:{generation:string;body:unknown}[]=[],tokens=new Map<string,string>();
 const server=http.createServer((req,res)=>{
  attempts++;
  const token=req.headers.authorization?.slice(7)??"",parts=token.split("."),expected=createHmac("sha256",key).update(parts.slice(0,2).join(".")).digest(),actual=Buffer.from(parts[2]??"","base64url");
  const payload=parts[1]?JSON.parse(Buffer.from(parts[1],"base64url").toString()):{};
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)||payload.exp*1000<=time||!tokens.has(token)){res.writeHead(401,{"content-type":"application/json"});res.end('{}');return;}
  const chunks:Buffer[]=[];req.on("data",chunk=>chunks.push(chunk));req.on("end",()=>{requests.push({generation:tokens.get(token)!,body:JSON.parse(Buffer.concat(chunks).toString())});res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({generation:tokens.get(token)}));});
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address==="object");const env={...environment(p),SUPABASE_INTERNAL_URL:`http://127.0.0.1:${address.port}`};const client=create({environment:env,now:()=>time,timeoutMs:1000})!;assert.ok(client);const pid=process.pid;
  for(let i=0;i<3;i++){const value=envelope(time);tokens.set(value.jwt,value.generation);await publishCredentialFile(p,value,time);const input={...args},call=client.rpc(method,input);input.p_site_id="59999999";assert.equal(requests.length,i);
   const result=await call;assert.equal(result.error,null);assert.equal((result.data as {generation:string}).generation,value.generation);assert.deepEqual(await call,result);assert.equal(requests.length,i+1);assert.equal(process.pid,pid);time+=31000;
  }
  assert.deepEqual(requests.map(v=>v.body),Array(3).fill({p_function:method,p_arguments:args}));assert.equal(new Set(requests.map(v=>v.generation)).size,3);
  // Controlled clock advances, not a claim of actual PostgREST/JWT expiry or Next integration.
  assert.deepEqual(await client.rpc(method,args),unavailable);assert.equal(requests.length,3);
  const bad=envelope(time),parts=bad.jwt.split(".");parts[2]=(parts[2][0]==="A"?"B":"A")+parts[2].slice(1);bad.jwt=parts.join(".");await publishCredentialFile(p,bad,time);
  // File parsing is sanity, never signature verification; this test HTTP peer
  // verifies the HMAC and refuses it. No retry with the valid ENV credential.
  const denied=client.rpc(method,args);assert.deepEqual(await denied,unavailable);assert.deepEqual(await denied,unavailable);assert.equal(attempts,4);assert.equal(requests.length,3);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test("unknown methods and accessor plans fail before reading any credential or forwarding anything",linux,()=>{
 const p=owned();let reads=0,sent=0;const client=create({environment:environment(p),now:()=>at,readCredential:async()=>{reads++;return envelope();},fetch:async()=>{sent++;return Response.json({});}})!;
 for(const name of ["toString","__proto__","faolla_commit_redemption_v1"])assert.throws(()=>client.rpc(name,{}));let getters=0;const input=Object.defineProperty({},"p_site_id",{enumerable:true,get(){getters++;return "10909992";}});assert.throws(()=>client.rpc(method,input));
 assert.throws(()=>client.rpc(method,new Proxy(args,{})));assert.throws(()=>client.rpc(method,{...args,extra:true}));assert.equal(getters,0);assert.equal(reads,0);assert.equal(sent,0);
});
test("late credential reads cannot dispatch after timeout, even if they ignore AbortSignal",{...linux,timeout:5000},async()=>{
 const p=owned();let finish!:(value:CredentialEnvelope)=>void,started!:()=>void,sent=0;const began=new Promise<void>(resolve=>{started=resolve;});
 const client=create({environment:environment(p),now:()=>at,timeoutMs:25,readCredential:async()=>{started();return new Promise(resolve=>{finish=resolve;});},fetch:async()=>{sent++;return Response.json({});}})!;
 const call=client.rpc(method,args),pending=Promise.resolve(call);await began;assert.deepEqual(await pending,unavailable);finish(envelope());await new Promise<void>(resolve=>setImmediate(resolve));assert.deepEqual(await call,unavailable);assert.equal(sent,0);
});
test("pre-abort never reads and cancellation during file delivery never reaches transport",linux,async()=>{
 const p=owned();let reads=0,sent=0,finish!:(value:CredentialEnvelope)=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
 const client=create({environment:environment(p),now:()=>at,readCredential:async()=>{reads++;started();return new Promise(resolve=>{finish=resolve;});},fetch:async()=>{sent++;return Response.json({});}})!;
 const pre=new AbortController();pre.abort();assert.deepEqual(await client.rpc(method,args).abortSignal(pre.signal),unavailable);assert.equal(reads,0);
 const mid=new AbortController(),call=client.rpc(method,args).abortSignal(mid.signal),pending=Promise.resolve(call);await began;mid.abort();assert.deepEqual(await pending,unavailable);finish(envelope());await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(sent,0);
});
test("ambiguous transport failure is not retried or replaced by an ENV token; errors remain fixed",linux,async()=>{
 const p=owned();await publishCredentialFile(p,envelope(),at);let sent=0;const client=create({environment:environment(p),now:()=>at,fetch:async()=>{sent++;throw Error("PRIVATE_TOKEN_OR_PATH");}})!;
 const call=client.rpc(method,args);assert.deepEqual(await call,unavailable);assert.deepEqual(await call,unavailable);assert.equal(sent,1);assert.equal(JSON.stringify(client),"{}");
});
test("rotation races expose only complete valid generations, never a partial credential or unbounded retry",linux,async()=>{
 const p=owned(),reader=createCredentialFileReader(p),values=[envelope(),envelope(),envelope()];await publishCredentialFile(p,values[0],at);
 const results=await Promise.all([...Array(20)].map(async()=>{try{return await reader.read(AbortSignal.timeout(2000),()=>at,at+500);}catch{return null;}}).concat([publishCredentialFile(p,values[1],at).then(()=>null)]));
 for(const value of results)if(value)assert.ok(values.some(expected=>value.jwt===expected.jwt&&value.generation===expected.generation));
 await publishCredentialFile(p,values[2],at);assert.ok((await reader.read(AbortSignal.timeout(1000),()=>at,at+500)).jwt===values[2].jwt);
});
test("delivery source is independent, has no key/env discovery or mutations of frozen app and shares the original deadline",()=>{
 const file=fs.readFileSync(new URL("./fixtures/merchant-checkout-credential-file.ts",import.meta.url),"utf8"),wrapper=fs.readFileSync(new URL("./fixtures/merchant-checkout-runtime-delivery.ts",import.meta.url),"utf8");
 assert.doesNotMatch(file,/process\.env|\bfetch\s*\(|createHmac|createSign|readPrivateKey|chmod\(|chown\(|unlink\(|rm\(|console\./);assert.match(file,/O_EXCL\|constants.O_NOFOLLOW/);assert.match(file,/directory!\.sync\(\)/);assert.match(file,/attempt<2/);
 assert.match(wrapper,/source===undefined\|\|source==="env"\)return legacy\(options\)/);assert.match(wrapper,/deadline=start\+timeout/);assert.match(wrapper,/Math.ceil\(deadline-performance.now\(\)\)/);assert.match(wrapper,/performance.now\(\)>=deadline/);assert.doesNotMatch(wrapper,/SERVICE_ROLE|createHmac|console\./);
});
