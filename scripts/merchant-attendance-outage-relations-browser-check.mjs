// INERT on import. Explicit loopback synthetic server for actual React UI.
// No browser launch, DB, real Auth, production, bundles on disk or new deps.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {createOutageRelationsBrowserModel,outageRelationsBrowserSeed:seed}=require('./fixtures/attendance-outage-relations-browser-model.ts');
const {OUTAGE_APIS,OUTAGE_HTTP_BODY_LIMIT}=require('../src/lib/merchantAttendanceOutageHttp.ts');
const staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export const outageRelationsBrowserHeaders=Object.freeze({
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
});
export function outageRelationsBrowserAllowedRequest(url,method,origin){
  try{
    const expected=new URL(origin),u=new URL(url);
    if(expected.protocol!=='http:'||expected.hostname!=='127.0.0.1'||!expected.port||expected.origin!==origin
      ||expected.username||expected.password||u.origin!==origin||u.username||u.password||u.hash||/[\u0000-\u0020\u007f\\]/.test(url))return false;
    if(staticPaths.has(u.pathname))return method==='GET'&&u.search==='';
    if(u.pathname===OUTAGE_APIS.outages)return method==='GET';
    return u.pathname===OUTAGE_APIS.relations&&(method==='GET'||method==='POST'&&u.search==='');
  }catch{return false;}
}
async function assets(){
  const output=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-outage-relations-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',jsx:'automatic',target:['es2020'],tsconfig:path.join(root,'tsconfig.json'),outfile:'outage-relations-qa.js',logLevel:'warning',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const filename of Object.keys(output.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(filename),'outage_relations_browser_server_import');
  const tokens=new Set();
  for(const filename of Object.keys(output.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach(token=>tokens.add(token));ts.forEachChild(node,visit);};visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...tokens])
    +output.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n')
    +'body{margin:0;background:#f8fafc;color:#111;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px}';
  const js=output.outputFiles.find(file=>file.path.endsWith('.js'));assert(js);return {js:js.contents,css};
}
async function body(request){
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type']??''))throw Error('invalid_content_type');
  const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>OUTAGE_HTTP_BODY_LIMIT))throw Error('body_too_large');
  let bytes=0;const chunks=[],timer=setTimeout(()=>request.destroy(Error('body_timeout')),3000);
  try{for await(const chunk of request){bytes+=chunk.length;if(bytes>OUTAGE_HTTP_BODY_LIMIT)throw Error('body_too_large');chunks.push(chunk);}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  }finally{clearTimeout(timer);}
}

/** Explicit start only. Root owns browser contexts. close() stops the listener,
 * open HTTP connections, delayed synthetic replies and this esbuild service. */
export async function startOutageRelationsBrowserServer({ttlMs=1200000,requestLimit=300}={}){
  assert(Number.isInteger(ttlMs)&&ttlMs>=1000&&ttlMs<=1200000,'outage_relations_ttl');
  assert(Number.isInteger(requestLimit)&&requestLimit>=1&&requestLimit<=1000,'outage_relations_request_limit');
  let files;
  try{files=await assets();}catch(error){stop();throw error;}
  const model=createOutageRelationsBrowserModel(),requests=[],errors=[],delays=new Map();
  let origin=null,closing=false,closePromise=null,deadline,total=0,closedResolve;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const server=createServer((request,response)=>{
    const run=async()=>{
      for(const [key,value] of Object.entries(outageRelationsBrowserHeaders))response.setHeader(key,value);
      if(closing||!origin||request.headers.host!==new URL(origin).host||request.headers.origin&&request.headers.origin!==origin
        ||['cross-site','same-site'].includes(request.headers['sec-fetch-site']??''))return response.writeHead(403).end();
      const url=new URL(request.url??'/',origin),method=request.method??'';
      if(!outageRelationsBrowserAllowedRequest(url.href,method,origin))return response.writeHead(403).end();
      if(++total>requestLimit)return response.writeHead(429).end();
      if(staticPaths.has(url.pathname)){
        if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
        if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>声明关系合成验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
        return response.writeHead(200,{'Content-Type':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/qa.js'?files.js:files.css);
      }
      const actor=request.headers['x-outage-relations-qa-actor'],enabled=request.headers['x-outage-relations-qa-enabled'];
      if(typeof actor!=='string'||!['0','1'].includes(enabled))return response.writeHead(403).end();
      const text=method==='POST'?await body(request):undefined;
      const outcome=model.respond({url:url.href,method,actor,body:text,enabled:enabled==='1'});
      const record={method,path:url.pathname,mode:method==='GET'?url.searchParams.get('mode'):null,actor,status:outcome.status,drop:false};requests.push(record);
      // Save happens in model.respond above. Never fake an uncommitted pending
      // recovery positive or resend a request to produce its receipt.
      if(method==='POST'&&request.headers['x-outage-relations-qa-drop']==='1'&&outcome.status===200){
        // Commit once, then break an already-started success body. Destroying
        // before headers can make Chromium transparently resend the POST.
        record.drop=true;const json=JSON.stringify(outcome.body);
        response.writeHead(200,{'Content-Type':'application/json;charset=utf-8','Content-Length':Buffer.byteLength(json,'utf8')});
        response.flushHeaders();response.write(json.slice(0,8));setImmediate(()=>response.destroy());return;
      }
      if(method==='GET'&&request.headers['x-outage-relations-qa-delay']==='1')await new Promise(resolve=>{const timer=setTimeout(()=>{delays.delete(timer);resolve();},2000);delays.set(timer,resolve);});
      if(closing||response.destroyed)return;
      return response.writeHead(outcome.status,{'Content-Type':'application/json;charset=utf-8'}).end(JSON.stringify(outcome.body));
    };
    void run().catch(error=>{if(!closing)errors.push(String(error.message));if(!response.destroyed)response.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:'attendance_invalid_request'}));});
  });
  const snapshot=()=>({syntheticOnly:true,realSql:false,realAuth:false,listenerActive:server.listening,totalHttpRequests:total,requests:structuredClone(requests),errors:[...errors],model:model.snapshot()});
  const close=()=>{
    if(closePromise)return closePromise;
    closePromise=(async()=>{closing=true;clearTimeout(deadline);for(const [timer,resolve] of delays){clearTimeout(timer);resolve();}delays.clear();
      try{if(server.listening)await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
      finally{stop();closedResolve();}
    })();return closePromise;
  };
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
    deadline=setTimeout(()=>{void close();},ttlMs);
    // Deliberately Node-only. Neither the HTTP router nor browser entry imports
    // or serializes these fixture controls; no client can alter the model state.
    const controls=Object.freeze({
      setIdentityChanged(value){if(closing)throw Error('outage_relations_server_closed');return model.controls.setIdentityChanged(value);},
      prepareHistory(throughRevision){if(closing)throw Error('outage_relations_server_closed');return model.controls.prepareHistory(throughRevision);},
    });
    return {origin,seed,snapshot,controls,close,closed};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==1||args[0]!=='--serve-local'){console.error('Usage: node --import tsx scripts/merchant-attendance-outage-relations-browser-check.mjs --serve-local');process.exitCode=1;}
  else{
    const server=await startOutageRelationsBrowserServer();
    const stopServer=()=>{void server.close();};process.once('SIGINT',stopServer);process.once('SIGTERM',stopServer);
    console.log(JSON.stringify({outageRelationsSyntheticServer:true,origin:server.origin,ttlMs:1200000,requestLimit:300,realSql:false,realAuth:false,seed:server.seed}));
    await server.closed;process.removeListener('SIGINT',stopServer);process.removeListener('SIGTERM',stopServer);
    console.log(JSON.stringify({...server.snapshot(),stopped:true}));
  }
}
