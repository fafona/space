import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readReviewedApplicationFixture} from './reviewed-application-fixture.mjs';
import {assertRecordsUiReleaseClosure,RECORDS_UI_RELEASE_BASELINE,RECORDS_UI_APPLICATION_FILES,RECORDS_UI_TOOL_FILES} from '../attendance-records-ui-release-policy.mjs';

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

test('a new login change never widens the historical release authority',()=>{
 const files=[...RECORDS_UI_APPLICATION_FILES,...RECORDS_UI_TOOL_FILES];
 assert.match(assertRecordsUiReleaseClosure({baseline:RECORDS_UI_RELEASE_BASELINE,files,readBlob:readReviewedApplicationFixture}),/^[a-f0-9]{64}$/);
 const current=readFileSync(new URL('../../src/app/login/page.tsx',import.meta.url),'utf8').replaceAll('\r\n','\n');
 assert.throws(()=>assertRecordsUiReleaseClosure({baseline:RECORDS_UI_RELEASE_BASELINE,files,readBlob:file=>file==='src/app/login/page.tsx'?current:readReviewedApplicationFixture(file)}),/application_content_rejected/);
});
