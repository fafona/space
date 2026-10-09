import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {partialLeaveBrowserRoleSql,assertPartialLeaveBrowserPrepared,assertPartialLeaveBrowserTransition,partialLeaveBrowserGroups,verifyPosthocPartialLeaveBrowser} from './attendance-plan-posthoc-partial-leave-browser.mjs';
const source=readFileSync(new URL('./attendance-plan-posthoc-partial-leave-browser.mjs',import.meta.url),'utf8');
const prepared=()=>({detail:{latestDecision:{outcome:'excused'},current:{protocol:'plan-exception-source-v3',state:'required',eligible:true,blockers:[],fingerprint:'a'.repeat(64),
 candidate:{late:{state:'not_triggered',rawDeltaUs:'0'},early:{state:'not_triggered',rawDeltaUs:'0'}},leaveEdges:{approvedCoverage:[{},{}],remainingRequired:[{}],pending:[],workLeaveOverlaps:[]}}}});
test('230 import is inert and reuses actual208 bridge without another protocol model',()=>{
 assert.equal(typeof verifyPosthocPartialLeaveBrowser,'function');assert.equal(partialLeaveBrowserGroups.length,5);
 assert(source.includes("from './attendance-plan-posthoc-browser.mjs'"));assert(source.includes('runPlanPosthocBrowserAcceptance({...bridgeCtx'));
 for(const value of ['initdb','CREATE DATABASE','launchPersistentContext','connectOverCDP','userDataDir','model.respond','page.route('])assert(!source.includes(value),value);
 assert(source.includes('perCaseRollback:false'));assert(source.includes('syntheticAuth:true,realAuth:false'));
});
test('runtime service role assertion preserves SQL payload and adds no nested BEGIN or SELECT result',()=>{
 const rpc='select public.faolla_attendance_plan_exception_posthoc_review_v1(\'{"note":"do not change"}\'::jsonb);';
 const value=partialLeaveBrowserRoleSql('set local role service_role;'+rpc);
 assert(value.endsWith(rpc));assert(value.includes("assert current_user='service_role'"));assert(!/^begin;/i.test(value));assert.equal((value.match(/select /g)||[]).length,1);
 for(const invalid of ['',null,'select public.fake();','set local role postgres;select public.faolla_attendance_x();','begin;set local role service_role;select public.faolla_attendance_x();'])assert.throws(()=>partialLeaveBrowserRoleSql(invalid));
});
test('prepared acceptance requires existing case, required state and both actual zero deltas',()=>{
 assert.equal(assertPartialLeaveBrowserPrepared(prepared()),'a'.repeat(64));
 const changes=[p=>p.detail.latestDecision.outcome='cleared',p=>p.detail.current.state='not_applicable',p=>p.detail.current.eligible=false,
  p=>p.detail.current.blockers.push('source_changed'),p=>p.detail.current.candidate.late.state='triggered',p=>p.detail.current.candidate.early.rawDeltaUs='300000000',
  p=>p.detail.current.leaveEdges.approvedCoverage.pop(),p=>p.detail.current.leaveEdges.pending.push({}),p=>p.detail.current.leaveEdges.workLeaveOverlaps.push({})];
 for(const change of changes){const p=prepared();change(p);assert.throws(()=>assertPartialLeaveBrowserPrepared(p));}
});
test('only the head was triggered; suffix changes a real five-minute delta already within ten-minute grace',()=>{
 const before=prepared();before.detail.current.fingerprint='b'.repeat(64);before.detail.current.candidate.late={state:'triggered',rawDeltaUs:'600000000'};
 before.detail.current.candidate.early={state:'not_triggered',rawDeltaUs:'300000000',minutes:10};
 assert.equal(assertPartialLeaveBrowserTransition(before,prepared()),'a'.repeat(64));
 before.detail.current.candidate.early.state='triggered';assert.throws(()=>assertPartialLeaveBrowserTransition(before,prepared()));
 assert.throws(()=>assertPartialLeaveBrowserTransition(null,prepared()));
});
test('cleared is an actual confirmed UI POST followed by real seal/cancel and saved self evidence',()=>{
 for(const marker of ["accept=false;await region().getByRole('button'","assert.equal(posts.length,0)","{method:'POST',mode:'decide'}",
  "operationId=posts[0]","actualClearedDecision:true"]){if(marker==='operationId=posts[0]')assert(source.includes('assert.equal(operationId,posts[0].command.operationId)'));else assert(source.includes(marker),marker);}
 for(const marker of ['await ctx.seal()','await ctx.cancel()',"assert.equal(current.stale,true)",'assert.deepEqual(historical.latestDecision.evidence,evidence)',
  'assert.equal(self.current,null)','assert.equal(self.latestDecision.readAt,null)','headLateChangedToNotTriggered:true','tailWasAlreadyWithinGrace:true'])assert(source.includes(marker),marker);
});
test('bounded browser and ownership cleanup preserve fixed artifacts and do not broaden writes',()=>{
 for(const marker of ['stats.apiRequests<=35','assert.equal(stats.posts,1)','entry.getFactHashUnchanged','ctx.assertPreserved()',
  'port.requestFinish()','await context?.close()','await browser?.close()',"serviceWorkers:'block'",'url.origin!==port.url'])assert(source.includes(marker),marker);
 assert(source.includes('current.artifactText,sealedArchive.artifactText'));assert(source.includes('current.artifactSha256,sealedArchive.artifactSha256'));
});
