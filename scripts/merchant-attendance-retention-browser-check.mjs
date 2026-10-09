// Inert on import; explicit bounded loopback server, in-memory assets only.
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
const {createRetentionBrowserModel,retentionBrowserSeed:seed}=require('./fixtures/attendance-retention-browser-model.ts');
const RETENTION='/api/merchant-enterprise/attendance/retention';
const directories=new Set(['/api/merchant-enterprise/attendance/admin','/api/merchant-enterprise/attendance/period-closures']);
const staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export const retentionBrowserLimits=Object.freeze({ttlMs:300000,requestLimit:80,postLimit:6});
export const retentionBrowserHeaders=Object.freeze({'Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
export function retentionBrowserAllowedRequest(raw,method,origin){
  try{const base=new URL(origin),url=new URL(raw);
    if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.origin!==origin||url.origin!==origin||url.username||url.password||url.hash
      ||/[\u0000-\u0020\u007f\\]/.test(raw))return false;
    if(staticPaths.has(url.pathname))return method==='GET'&&!url.search;
    if(directories.has(url.pathname))return method==='GET';
    return url.pathname===RETENTION&&(method==='GET'||method==='POST'&&!url.search);
  }catch{return false;}
}
async function assets(){
  const output=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-retention-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',jsx:'automatic',target:['es2020'],tsconfig:path.join(root,'tsconfig.json'),outfile:'retention-qa.js',logLevel:'warning',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__RETENTION_SEED__:JSON.stringify(seed)}});
  for(const filename of Object.keys(output.metafile.inputs))assert(!/node:crypto|\.server\.ts$|browser-model/.test(filename),'retention_qa_server_import');
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
async function readBody(request){
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type']??''))throw Error('invalid_content_type');
  const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>8192))throw Error('body_too_large');
  const chunks=[];let bytes=0;const timer=setTimeout(()=>request.destroy(Error('body_timeout')),3000);
  try{for await(const chunk of request){bytes+=chunk.length;if(bytes>8192)throw Error('body_too_large');chunks.push(chunk);}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}finally{clearTimeout(timer);}
}
export async function startRetentionBrowserServer({ttlMs=300000,requestLimit=80,postLimit=6}={}){
  assert(Number.isInteger(ttlMs)&&ttlMs>=1000&&ttlMs<=300000,'retention_qa_ttl');
  assert(Number.isInteger(requestLimit)&&requestLimit>=1&&requestLimit<=80,'retention_qa_request_limit');
  assert(Number.isInteger(postLimit)&&postLimit>=1&&postLimit<=6,'retention_qa_post_limit');
  let files;try{files=await assets();}catch(error){stop();throw error;}
  const model=createRetentionBrowserModel(),requests=[],errors=[];let origin=null,total=0,posts=0,closing=false,deadline,closePromise,closedResolve;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const server=createServer((request,response)=>{void(async()=>{
    for(const [key,value] of Object.entries(retentionBrowserHeaders))response.setHeader(key,value);
    if(closing||!origin||request.headers.host!==new URL(origin).host||request.headers.origin&&request.headers.origin!==origin
      ||['cross-site','same-site'].includes(request.headers['sec-fetch-site']??''))return response.writeHead(403).end();
    const url=new URL(request.url??'/',origin),method=request.method??'';
    if(!retentionBrowserAllowedRequest(url.href,method,origin))return response.writeHead(403).end();
    if(++total>requestLimit||method==='POST'&&++posts>postLimit)return response.writeHead(429).end();
    if(staticPaths.has(url.pathname)){
      if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
      if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C23 合成资料保留验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
      return response.writeHead(200,{'Content-Type':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/qa.js'?files.js:files.css);
    }
    const actor=request.headers['x-retention-qa-actor'],enabled=request.headers['x-retention-qa-enabled'];
    if(typeof actor!=='string'||!['0','1'].includes(enabled))return response.writeHead(403).end();
    const outcome=model.respond({url:url.href,method,actor,enabled:enabled==='1',body:method==='POST'?await readBody(request):undefined});
    requests.push({method,path:url.pathname,mode:method==='GET'?url.searchParams.get('mode'):null,actor,status:outcome.status});
    return response.writeHead(outcome.status,{'Content-Type':'application/json;charset=utf-8'}).end(JSON.stringify(outcome.body));
  })().catch(error=>{if(!closing)errors.push(error.message);if(!response.destroyed)response.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:'attendance_invalid_request'}));});});
  const snapshot=()=>({syntheticOnly:true,realSql:false,realAuth:false,listenerActive:server.listening,totalHttpRequests:total,postAttempts:posts,
    requests:structuredClone(requests),errors:[...errors],model:model.snapshot()});
  const close=()=>closePromise??=(async()=>{closing=true;clearTimeout(deadline);
    try{if(server.listening)await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
    finally{stop();closedResolve();}})();
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
    deadline=setTimeout(()=>{void close();},ttlMs);return {origin,seed,snapshot,close,closed};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--serve-local'){console.error('Usage: node --import tsx scripts/merchant-attendance-retention-browser-check.mjs --serve-local');process.exitCode=1;}
  else{const server=await startRetentionBrowserServer();const close=()=>{void server.close();};process.once('SIGINT',close);process.once('SIGTERM',close);
    console.log(JSON.stringify({syntheticRetentionServer:true,origin:server.origin,...retentionBrowserLimits,realSql:false,realAuth:false}));await server.closed;
    process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);console.log(JSON.stringify({...server.snapshot(),closed:true}));}
}
