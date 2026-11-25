// Unit tests only, in a fresh owned TEMP app. Native HTTP tests allocate their
// own loopback servers; this is NOT the single-backend production BUILD policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
assert.equal(process.env.FAOLLA_CHECKOUT_UNIT_LOCAL,'1');
const app=fs.realpathSync(process.cwd()),evidence=fs.realpathSync(process.env.FAOLLA_CHECKOUT_UNIT_EVIDENCE_DIR),relative=path.relative(fs.realpathSync(os.tmpdir()),evidence);
// Unit children deliberately use the private evidence directory AS their TEMP.
assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(path.dirname(app),evidence);assert.equal(path.basename(app),'app');assert.ok(path.basename(evidence).startsWith('faolla-checkout-build-'));assert.ok(!fs.readdirSync(app).some(name=>name.startsWith('.env')));
if(process.platform==='linux'){const s=fs.lstatSync(evidence);assert.equal(s.uid,process.geteuid());assert.equal(s.mode&0o777,0o700);}
const audit=path.join(evidence,'unit-network.jsonl'),record=kind=>fs.appendFileSync(audit,JSON.stringify({kind})+'\n',{mode:0o600}),refuse=kind=>{record(kind);throw Error('checkout_unit_external_connection_refused');};
const require=createRequire(import.meta.url),tsxPackage=require.resolve('tsx/package.json');assert.equal(JSON.parse(fs.readFileSync(tsxPackage,'utf8')).version,'4.21.0');
const frames=['client-BQVF1NaW.mjs','client-D6NvIMSC.cjs'].flatMap(name=>{const file=path.join(path.dirname(tsxPackage),'dist',name);return[file+':',pathToFileURL(file).href+':'];});
const uid=process.geteuid?process.geteuid():os.userInfo().username,pipe=path.join(evidence,`tsx-${uid}`,`${process.ppid}.pipe`),ownedPipe=process.platform==='win32'?'\\\\?\\pipe\\'+pipe:pipe;
const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)return refuse('external-fetch-refused');record('unit-loopback-fetch');return nativeFetch(input,init);};
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const values=Array.isArray(args[0])?args[0]:args,option=values[0],port=typeof option==='object'&&option!==null?option.port:option,host=typeof option==='object'&&option!==null?option.host??option.hostname:values[1];
 const stack=new Error().stack?.split('\n').slice(2,8);if(os.tmpdir()===evidence&&option?.path===ownedPipe&&stack?.some(frame=>frames.some(source=>frame.includes(source))))return refuse('owned-unit-tsx-ipc-refused');
 if(host!=='127.0.0.1'||!/^\d{1,5}$/.test(String(port))||Number(port)<1||Number(port)>65535||option?.path)return refuse('external-socket-refused');record('unit-loopback-socket');return Reflect.apply(connect,this,args);};syncBuiltinESMExports();
