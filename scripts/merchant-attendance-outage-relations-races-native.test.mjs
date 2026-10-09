import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-relations-races-native.mjs',import.meta.url),'utf8');
const has=(...tokens)=>tokens.forEach(token=>assert(source.includes(token),token));
test('223 reuses222 checked original context and adds no installation, runtime or production transport',()=>{
 has('runAttendanceOutageRelationsNative(args,async ctx=>','outageRelationsFoundation.phase,222','outageRelationsFoundation.rollbackRestored,true',
  "['oldFunctionsUnchanged','oldFactsUnchanged','old155ArchivePreserved','actualSealedArchivePreserved']",'assertLifecycleSandbox','assert.deepEqual',
  'verifyAttendanceOutageRelationsRacesNative(ctx)');
 for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','spawn(','playwright','listen(','supabase.co','MigrationBody','migrations/','writeFile'])
  assert(!source.includes(forbidden),forbidden);
});
test('driver protects original rows even in permitted append tables plus old definitions and archives',()=>{
 has('filter(name=>!allowed.includes(name))','d.fingerprint(protectedNames),before','d.definitions(),definitions','d.tableCatalog(),catalog',
  'jsonb_array_elements(${json(oldRows[name])}) old_row','where to_jsonb(r)=old_row',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,saved.artifactText','periodArchive().artifactSha256,saved.artifactSha256',
  'assert(current.period.sealed);assert.equal(current.sourceChanged,false)');
});
test('optional extension follows verified cleanup boundary and import never starts native',()=>{
 has("after===null||typeof after==='function'",'await after({...ctx,outageRelationsRacesFoundation:result})',
  'path.resolve(process.argv[1])===fileURLToPath(import.meta.url)','process.exitCode=1',
  'caller-owned synthetic schema; outer lifecycle removes it and checks persistent baseline',
  'browser:false,newCluster:false,productionAccess:false,deployed:false');
 assert(source.indexOf('assert.equal(current.sourceChanged,false)')<source.indexOf('await after('));
});
