import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {outagePrintAllowedRequest,outagePrintBrowserHeaders,outagePrintScreenshotPaths} from './merchant-attendance-outage-print-browser-check.mjs';
const require=createRequire(import.meta.url);
const {outagePrintSeed:seed,outagePrintSyntheticResponse,outagePrintModel,outagePrintPendingSeed,outagePrintLongModel}=require('./fixtures/attendance-outage-print-model.ts');
const {OUTAGE_APIS,outageHttpQueryString,parseOutageHttpBody}=require('../src/lib/merchantAttendanceOutageHttp.ts');
const {buildOutageBlankPrintDocument,buildOutageHandoffPrintDocument}=require('../src/lib/merchantAttendanceOutagePrintDocument.ts');
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:54321';
const driver=readFileSync(new URL('./merchant-attendance-outage-print-browser-check.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./fixtures/attendance-outage-print-browser.tsx',import.meta.url),'utf8');
test('closed request allowlist permits only exact local assets or two GET endpoints',()=>{
  const permittedApis=[OUTAGE_APIS.outages,OUTAGE_APIS.reviews];
  for(const p of ['/','/qa.js','/qa.css',...permittedApis])assert(outagePrintAllowedRequest(origin+p,'GET',origin));
  for(const p of Object.values(OUTAGE_APIS).filter(p=>!permittedApis.includes(p)))assert(!outagePrintAllowedRequest(origin+p,'GET',origin));
  for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS'])assert(!outagePrintAllowedRequest(origin+OUTAGE_APIS.outages,method,origin));
  for(const url of [origin+'/api/anything',origin+OUTAGE_APIS.links,origin+'/qa.js?x=1',origin+'/qa.js#x','https://example.com/qa.js','http://user@127.0.0.1:54321/qa.js','not a URL'])assert(!outagePrintAllowedRequest(url,'GET',origin));
});
test('host page keeps sensitive middleware frame/CSP/cache headers',()=>{
  assert.equal(outagePrintBrowserHeaders['X-Frame-Options'],'DENY');assert.equal(outagePrintBrowserHeaders['X-Content-Type-Options'],'nosniff');
  assert.equal(outagePrintBrowserHeaders['Cache-Control'],'no-store');assert.match(outagePrintBrowserHeaders['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.match(driver,/request\.headers\.host!==new URL\(origin\)\.host/);assert.match(driver,/request\.headers\.origin!==origin/);
});
test('synthetic owner wires undergo actual projector/http validation and canWrite false is printable',()=>{
  const d={siteId:seed.siteId,access:'owner',mode:'declaration',declarationId:seed.declarationId},r={...d,mode:'detail'};
  const dw=outagePrintSyntheticResponse(origin+OUTAGE_APIS.outages+'?'+outageHttpQueryString('outages',d),seed.owner);
  const rw=outagePrintSyntheticResponse(origin+OUTAGE_APIS.reviews+'?'+outageHttpQueryString('reviews',r),seed.owner);
  assert.equal(dw.canWrite,false);assert.equal(rw.canWrite,false);assert.equal(dw.data.canWrite,false);assert.equal(rw.data.status.resolved,true);
  const html=buildOutageHandoffPrintDocument(dw.data,rw.data);assert(html.includes('当前已核完'));assert(html.includes(seed.employeeId));
  assert(!html.includes(seed.owner)&&!html.includes(seed.self));assert(!html.includes('<script>不执行'));
  assert.throws(()=>outagePrintSyntheticResponse(origin+OUTAGE_APIS.outages+'?'+outageHttpQueryString('outages',d),seed.other));
  assert.throws(()=>outagePrintSyntheticResponse(origin+OUTAGE_APIS.links+'?'+outageHttpQueryString('reviews',r),seed.owner));
});
test('distinct declaration selection and self current actor remain valid but self cannot print handoff',()=>{
  const a=outagePrintModel(),b=outagePrintModel(seed.otherDeclarationId),self=outagePrintModel(seed.declarationId,'self');
  assert.notEqual(a.declaration.detail.id,b.declaration.detail.id);assert.notEqual(a.review.proposal.resultFingerprint,b.review.proposal.resultFingerprint);
  assert.equal(self.declaration.actorId,seed.self);assert.throws(()=>buildOutageHandoffPrintDocument(self.declaration,self.review));
  const html=buildOutageBlankPrintDocument();for(const value of Object.values(seed))assert(!html.includes(value));
});
test('pending fixture is exact durable intent only, and tests prohibit submitting it',()=>{
  for(const kind of ['outages','links','reviews']){
    const p=outagePrintPendingSeed(kind),raw=JSON.parse(p.raw);assert.deepEqual(Object.keys(raw).sort(),['version','kind','actorId','query','command'].sort());
    assert.equal(raw.kind,kind);assert.equal(raw.actorId,seed.owner);assert.equal(raw.command.operationId,p.operationId);assert.equal(raw.version,1);
    parseOutageHttpBody(kind,{query:raw.query,command:raw.command},seed.owner);assert(p.key.endsWith(':owner:'+seed.owner));
  }
  assert.match(driver,/pendingSeed\.raw/);assert.match(driver,/postRequests:0/);
  assert.match(driver,/for\(const kind of \['outages','links','reviews'\]\)/);assert.match(driver,/state\.insertedPending\.push\(pending\)/);
  assert.match(driver,/sessionStorage\.setItem\(p\.key,p\.raw\)/);assert.match(driver,/for\(const p of expectedPending\)/);
});
test('actual launcher with both switches, real print adapter interception and all lifetime cases are wired',()=>{
  assert.match(entry,/import OutageLauncher/);assert.match(entry,/<OutageLauncher/);assert.match(entry,/enabled=\{true\}/);assert.match(entry,/printEnabled=\{config\.printEnabled\}/);
  assert.match(driver,/installPrintProbe/);assert.match(driver,/document\.addEventListener\('load'/);assert.match(driver,/Object\.defineProperty\(win,'print'/);
  assert.match(driver,/new win\.Event\('afterprint'\)/);assert.match(driver,/for\(const status of \[401,403\]\)/);
  assert.match(driver,/\['actor','declaration','close','hidden'\]/);assert.match(driver,/dirty incident draft/);assert.match(driver,/exact pending/);
  assert.match(driver,/checks,14/);assert.match(driver,/viewport:\{width:390,height:844\}/);
});
test('import is inert and run cleans browser/loopback/esbuild without persistent bundles or database',()=>{
  assert.match(driver,/write:false/);assert.match(driver,/server\.listen\(0,'127\.0\.0\.1'/);assert.match(driver,/args\.includes\('--run-local'\)/);
  assert.match(driver,/finally\{/);for(const label of ['outage-print-contexts','outage-print-browser','outage-print-routes','outage-print-server','outage-print-esbuild'])assert(driver.includes(label));
  assert.doesNotMatch(driver,/execFile|spawn\(|pg_ctl|initdb|writeFile|mkdir|\.pdf\(/);
});
test('screenshots are opt-in PNG only in root already-created exact directory',()=>{
  const allowed=path.join(root,'.tmp','attendance-outage-print-220-qa');assert.deepEqual(outagePrintScreenshotPaths(allowed),[path.join(allowed,'blank.png'),path.join(allowed,'handoff.png')]);
  for(const dir of [root,path.dirname(allowed),path.join(allowed,'nested')])assert.throws(()=>outagePrintScreenshotPaths(dir));
  assert.match(driver,/screenshots=false/);assert.match(driver,/await realpath\(dir\),dir/);assert.match(driver,/await stat\(dir\)/);assert.match(driver,/retainedFiles:shotPaths\.length/);
});
test('long model uses maximum legitimate text/source sizes and print-media checks actual A4 content bounds',()=>{
  const m=outagePrintLongModel();assert.equal(m.declaration.detail.statement.length,1000);assert.equal(m.declaration.detail.paperReference.length,120);
  for(const entry of [m.review.proposal,m.review.response,m.review.current])assert.equal(entry.reason.length,1000);
  assert.equal(m.review.proposal.evidence.linkEvidence.items.length,10);assert(buildOutageHandoffPrintDocument(m.declaration,m.review).includes('共 10 条'));
  assert.match(driver,/269\*96\/25\.4/);assert.match(driver,/style\.width='182mm'/);assert.match(driver,/layout\.pages\.length,2/);assert.match(driver,/layout\.overflowing,0/);
  assert.match(driver,/page\.emulateMedia\(\{media:'print'\}\)/);assert.doesNotMatch(driver,/page\.pdf\(/);
});
