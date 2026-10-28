import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {historicalToolTreeRows,parseHistoricalToolTreeFixture} from './test-support/release-toolchain-historical-fixture.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./test-support/release-toolchain-historical-tree.json',import.meta.url),'utf8'));
test('historical policy fixtures are actual complete immutable pre-toolchain Git tree evidence',()=>{
 const rows=historicalToolTreeRows();assert.ok(rows.length>1000);assert.ok(Object.isFrozen(rows));
 assert.ok(rows.some(row=>row.endsWith('\tpackage-lock.json')));
 assert.equal(rows.some(row=>row.endsWith('\tscripts/release-toolchain.mjs')),false);
});
test('historical fixture rejects changed revision, hashes, metadata, extra fields and compressed bytes',()=>{
 const original=fixture();for(const patch of [{revision:'a'.repeat(40)},{rawBytes:1},{rawSha256:'a'.repeat(64)},
 {compressedSha256:'a'.repeat(64)},{encoding:'raw'},{extra:true},{data:'bad'},
 {data:(original.data[0]==='A'?'B':'A')+original.data.slice(1)}])assert.throws(()=>parseHistoricalToolTreeFixture({...original,...patch}));
});
