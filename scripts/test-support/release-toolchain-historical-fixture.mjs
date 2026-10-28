// Test evidence only. Never imported by a production source-admission guard.
// Raw `git ls-tree -r -z 38a3ba02...` captured before toolchain-v2 changes.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const revision='38a3ba02a3f2b2165994043e2ac78ea1d90d0282';
const rawBytes=537839;
const rawSha256='26c5a8318e5f78da0a14ce3d58713954756c847050de8e2be5008159b4722fab';
const compressedSha256='4468a4fcef6db8fba1a1a846b793cedbbff64107dfb719ee75514d3402438a9a';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function parseHistoricalToolTreeFixture(fixture){
 assert.deepEqual(Object.keys(fixture).sort(),['compressedSha256','data','encoding','rawBytes','rawSha256','revision']);
 assert.equal(fixture.revision,revision);assert.equal(fixture.rawBytes,rawBytes);
 assert.equal(fixture.rawSha256,rawSha256);assert.equal(fixture.compressedSha256,compressedSha256);
 assert.equal(fixture.encoding,'gzip-base64');assert.equal(typeof fixture.data,'string');
 assert.equal(fixture.data.length,207804);assert.match(fixture.data,/^[A-Za-z0-9+/]+={0,2}$/);
 const compressed=Buffer.from(fixture.data,'base64');assert.equal(hash(compressed),compressedSha256);
 const raw=gunzipSync(compressed,{maxOutputLength:rawBytes});
 assert.equal(raw.length,rawBytes);assert.equal(hash(raw),rawSha256);
 const text=raw.toString('utf8');assert.equal(text.endsWith('\0'),true);
 const rows=text.slice(0,-1).split('\0');
 assert.ok(rows.every(row=>/^100(?:644|755) blob [a-f0-9]{40}\t[^\0\r\n]+$/.test(row)));
 assert.equal(new Set(rows.map(row=>row.slice(row.indexOf('\t')+1))).size,rows.length);
 return Object.freeze(rows);
}
export function historicalToolTreeRows(){
 return parseHistoricalToolTreeFixture(JSON.parse(readFileSync(new URL('./release-toolchain-historical-tree.json',import.meta.url),'utf8')));
}
export const HISTORICAL_CI_FILES=Object.freeze(['.github/workflows/ci.yml','scripts/ci-workflow-contract.test.mjs',
 'scripts/production-maintenance-ingress-acceptance.mjs','scripts/production-maintenance-ingress-acceptance.test.mjs']);
export function parseHistoricalCiFixture(fixture){
 assert.deepEqual(Object.keys(fixture).sort(),['data','encoding']);assert.equal(fixture.encoding,'gzip-base64');
 assert.equal(typeof fixture.data,'string');assert.ok(fixture.data.length<=65536);assert.match(fixture.data,/^[A-Za-z0-9+/]+={0,2}$/);
 const value=JSON.parse(gunzipSync(Buffer.from(fixture.data,'base64'),{maxOutputLength:256*1024}).toString('utf8'));
 assert.deepEqual(Object.keys(value).sort(),['blobs','revision']);assert.equal(value.revision,revision);
 assert.deepEqual(Object.keys(value.blobs).sort(),[...HISTORICAL_CI_FILES].sort());const tree=historicalToolTreeRows();
 for(const file of HISTORICAL_CI_FILES){
  assert.equal(typeof value.blobs[file],'string');const bytes=Buffer.from(value.blobs[file],'utf8');
  const oid=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.ok(tree.includes('100644 blob '+oid+'\t'+file),'historical blob must match actual immutable Git tree');
 }
 return Object.freeze(value.blobs);
}
export function readHistoricalCiBlob(file){
 assert.ok(HISTORICAL_CI_FILES.includes(file));
 return parseHistoricalCiFixture(JSON.parse(readFileSync(new URL('./release-toolchain-historical-ci.json',import.meta.url),'utf8')))[file];
}
export function parseHistoricalBootstrapFixture(fixture){
 assert.deepEqual(Object.keys(fixture).sort(),['data','encoding']);assert.equal(fixture.encoding,'gzip-base64');assert.match(fixture.data,/^[A-Za-z0-9+/]+={0,2}$/);assert.ok(fixture.data.length<2*1024**2);
 const value=JSON.parse(gunzipSync(Buffer.from(fixture.data,'base64'),{maxOutputLength:4*1024**2}).toString('utf8'));assert.deepEqual(Object.keys(value).sort(),['blobs','revision']);assert.equal(value.revision,revision);assert.equal(Object.keys(value.blobs).length,28);
 const tree=historicalToolTreeRows();for(const [file,text]of Object.entries(value.blobs)){assert.match(file,/^scripts\/[a-z0-9-]+\.mjs$/);assert.equal(typeof text,'string');const bytes=Buffer.from(text,'utf8'),oid=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');assert.ok(tree.includes('100644 blob '+oid+'\t'+file),'historical bootstrap blob must match its immutable tree');}
 return Object.freeze(value.blobs);
}
export function historicalBootstrapBlobs(){return parseHistoricalBootstrapFixture(JSON.parse(readFileSync(new URL('./release-toolchain-historical-bootstrap.json',import.meta.url),'utf8')));}
