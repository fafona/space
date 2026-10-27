import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BOOKING_MIGRATIONS,guardedBookingMigrationSql,validateBookingDatabaseState,assertBookingCompatibilityProof} from './booking-publication-database.mjs';
import {attendanceProductionIdentity} from './attendance-production-database-migrations.mjs';
const manifest=JSON.parse(readFileSync(new URL('./attendance-production-database-migrations.manifest.json',import.meta.url),'utf8'));
const sources=BOOKING_MIGRATIONS.map(m=>readFileSync(new URL('./supabase-migrations/'+m.fileName,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
const registry=[...manifest.baseline,...manifest.migrations.map(({version,name})=>({version,name}))];
const state={...attendanceProductionIdentity,currentUser:'supabase_admin',pagesOwner:'supabase_admin',savedBookingRowsSha256:'a'.repeat(64),registry,bookingTables:0};
test('only exact production identity and complete 210 registry may install the two inactive migrations',()=>{
 validateBookingDatabaseState(state,manifest);
 for(const patch of [{systemIdentifier:'other'},{pagesOwner:'postgres'},{bookingTables:1},{registry:registry.slice(1)},
  {registry:[...registry,{version:'202610250213',name:'unexpected'}]}])assert.throws(()=>validateBookingDatabaseState({...state,...patch},manifest));
 validateBookingDatabaseState({...state,bookingTables:3,registry:[...registry,...BOOKING_MIGRATIONS.map(({version,name})=>({version,name}))]},manifest,{installed:true});
 assert.throws(()=>validateBookingDatabaseState({...state,bookingTables:3},manifest,{installed:true}));
});
test('real PostgreSQL jsonb key order is accepted without weakening exact registry content',()=>{
 const next=BOOKING_MIGRATIONS.map(({version,name})=>({name,version}));
 const check=rows=>validateBookingDatabaseState({...state,bookingTables:3,registry:[...registry,...rows]},manifest,{installed:true});
 assert.doesNotThrow(()=>check(next));
 assert.doesNotThrow(()=>check(next.map(({name,version})=>({version,name}))));
 for(const rows of [next.slice(1),[...next,next[0]],[...next].reverse(),
  [{...next[0],name:'wrong'},next[1]],[{...next[0],version:Number(next[0].version)},next[1]],
  [{...next[0],extra:true},next[1]],[{version:next[0].version},next[1]],
  [{name:next[0].name},next[1]],[next[0],{...next[1],name:null}],
  [next[0],{...next[1],version:'202610250213'}],[...next,{name:'unclassified'}]])assert.throws(()=>check(rows));
 for(const bookingTables of [0,2,4,'3'])assert.throws(()=>validateBookingDatabaseState({...state,bookingTables,registry:[...registry,...next]},manifest,{installed:true}));
 assert.throws(()=>validateBookingDatabaseState({...state,registry:[...registry,...next]},manifest));
});

test('reviewed source bodies execute verbatim once in a bounded all-or-nothing transaction without authority activation',()=>{
 const sql=guardedBookingMigrationSql(sources);
 for(const body of sources.map(source=>source.slice('begin;'.length,source.length-'commit;\n'.length)))assert.ok(sql.includes(body));
 assert.match(sql,/lock_timeout='2s'/);assert.match(sql,/statement_timeout='20s'/);
 assert.ok(sql.includes('lock table public.pages,public.faolla_schema_migrations in share row exclusive mode'));
 assert.ok(sql.includes('booking_install_saved_rows_changed'));assert.ok(sql.includes('booking_install_not_inactive'));
 assert.doesNotMatch(sql,/set\s+active\s*=\s*true/i);assert.equal((sql.match(/^commit;/gm)||[]).length,1);
 for(const value of [[],[...sources].reverse(),[sources[0]+'\n',sources[1]]])assert.throws(()=>guardedBookingMigrationSql(value),/scope_invalid|source_changed/);
});
test('compatibility receipt identity, source, freshness and check mismatches fail closed',()=>{
 const input={target:'a'.repeat(40),baseline:'b'.repeat(40),sourceSha256:sources.map(source=>createHash('sha256').update(source).digest('hex'))};
 const checks=Object.fromEntries(['actualProductionMetadataClone','metadataOnlyNoBusinessRows','postgres15ExactImage','originalSourcesInOneTransaction','inactiveAfterInstall','legacyBookingWriteStillWorks','privateTablesAndRpcAcls','outsideBookingMetadataUnchanged','productionUnchanged'].map(key=>[key,true]));
 const value={schemaVersion:1,...input,checks,databaseSystemIdentifier:attendanceProductionIdentity.systemIdentifier,serverVersionNum:attendanceProductionIdentity.serverVersionNum,completedAt:new Date().toISOString(),evidenceSha256:'f'.repeat(64)};
 assertBookingCompatibilityProof(value,input);
 for(const patch of [{checks:{...checks,productionUnchanged:false}},{target:'c'.repeat(40)},{serverVersionNum:'170010'},{sourceSha256:['wrong']},{completedAt:'invalid'},{evidenceSha256:''}])assert.throws(()=>assertBookingCompatibilityProof({...value,...patch},input),/not_proved/);
});
