import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-period-continuation-live-native.mjs',import.meta.url),'utf8');
test('live extension reuses explicit core arguments and invokes no alternate database or production entry',()=>{
 for(const value of ['runPeriodContinuationNative(args,async ctx=>','ctx.d.syntheticOnly,true','ctx.h.syntheticOnly,true',
  'verifyPeriodContinuationRacesNative(ctx)','verifyPeriodContinuationLiveBrowser(ctx)',
  'cleanupOwnedByParent:true,realAuth:false,productionAccess:false,newCluster:false,deployed:false'])assert(source.includes(value),value);
 assert.doesNotMatch(source,/process\.env|initdb|pg_dump|CREATE DATABASE|spawn\(|listen\(|supabase\.co/i);
});
test('import is inert and runtime errors remain failures',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));assert(!source.includes('rollbackRestored:true'));
});
