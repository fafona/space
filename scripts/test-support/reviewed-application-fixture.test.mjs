import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readReviewedApplicationFixture} from './reviewed-application-fixture.mjs';

test('historical fixture strings preserve every sealed UTF-8 byte, including the original BOM',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./reviewed-application-fixtures.json',import.meta.url),'utf8'));
 for(const[file,entry]of Object.entries(fixture.entries)){
  const bytes=gunzipSync(Buffer.from(entry.gzipBase64,'base64'));
  assert.equal(bytes.length,entry.bytes,file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,file);
  assert.deepEqual(Buffer.from(readReviewedApplicationFixture(file),'utf8'),bytes,file);
 }
 assert.equal(readReviewedApplicationFixture('src/app/site/[siteId]/SitePageClient.tsx').charCodeAt(0),0xfeff);
});
