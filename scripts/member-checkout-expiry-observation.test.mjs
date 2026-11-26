import assert from 'node:assert/strict';
import test from 'node:test';
import {observeOwnedGatewayExpiry,ownedExpiryObservationPolicy} from './member-checkout-expiry-observation.mjs';
import {verifyArchivedGroupNextRevision,loadArchivedGroupNextRevision} from './member-checkout-group-next-archive.mjs';
import {readFile} from 'node:fs/promises';

function fixture({offset=30000,statuses=[200,401],budget=110000}={}){
  const expiresAt=1700000000000,events=[],controller=new AbortController();let elapsed=offset,reads=0;
  const clock={wall:()=>expiresAt+elapsed,mono:()=>elapsed,sleep:async ms=>{elapsed+=ms;}};
  const options={expiresAt,deadline:offset+budget,signal:controller.signal,record:r=>events.push(r),readStatus:async()=>{reads++;const value=statuses[reads-1];if(value instanceof Error)throw value;return value;}};
  return{options,clock,events,controller,get reads(){return reads;}};
}

test('31-second observation is retained and the same reader must prove actual 401 at a fixed later time',async()=>{
  const f=fixture(),r=await observeOwnedGatewayExpiry(f.options,f.clock);assert.deepEqual(ownedExpiryObservationPolicy,{version:1,observationAfterMs:31000,proofAfterMs:34000,reads:2});
  assert.equal(f.reads,2);assert.deepEqual(f.events,[{phase:'observation',startedPastExpiryMs:31000,endedPastExpiryMs:31000,status:200},{phase:'proof',startedPastExpiryMs:34000,endedPastExpiryMs:34000,status:401}]);
  assert.equal(r.postgrestExpiredStatus,401);assert.equal(r.retriedOnFailure,false);assert.equal(r.waitedPastExpiryMs,34000);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.proof));
});
test('already expired generations retain both actual statuses without waiting or forging a response',async()=>{
  const f=fixture({offset:43000,statuses:[401,401]}),r=await observeOwnedGatewayExpiry(f.options,f.clock);assert.equal(f.reads,2);assert.equal(r.observation.startedPastExpiryMs,43000);assert.equal(r.proof.startedPastExpiryMs,43000);
});
test('a 200 at the final proof fails once and preserves both observations without retrying',async()=>{
  const f=fixture({statuses:[200,200]});await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),/owned_expiry_original_token_not_refused/);assert.equal(f.reads,2);assert.equal(f.events[1].status,200);
});
test('a late first 200 fails immediately, not after a second chance',async()=>{
  const f=fixture({offset:34000});await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),/owned_expiry_late_observation_not_refused/);assert.equal(f.reads,1);assert.equal(f.events[0].status,200);
});
test('unexpected, redirect and transport failures are never retried or promoted',async()=>{
  for(const status of [201,302,400,403,429,500,503]){const f=fixture({statuses:[status,401]});await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),/owned_expiry_status_unexpected/);assert.equal(f.reads,1);assert.equal(f.events[0].status,status);}
  const error=Object.assign(Error('owned transport failure'),{code:'ECONNRESET'}),f=fixture({statuses:[error]});await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),e=>e===error);assert.equal(f.reads,1);assert.equal(f.events.length,0);
});
test('exhausted global budget or aborted test cannot dispatch any observation',async()=>{
  const f=fixture({budget:0});await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),/deadline_exceeded/);assert.equal(f.reads,0);
  const a=fixture();a.controller.abort();await assert.rejects(observeOwnedGatewayExpiry(a.options,a.clock),e=>e.name==='AbortError');assert.equal(a.reads,0);
  const b=fixture({offset:30000,budget:500});await assert.rejects(observeOwnedGatewayExpiry(b.options,b.clock),/deadline_exceeded/);assert.equal(b.reads,0);
});
test('deadline expiry after a read preserves evidence but cannot return success',async()=>{
  const f=fixture({offset:34000,budget:1000,statuses:[401,401]});f.options.readStatus=async()=>{f.clock.mono=()=>35000;return 401;};await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),/deadline_exceeded/);assert.equal(f.events.length,1);
});
test('clock reversal, invalid inputs and failure to preserve a sample refuse rather than hide evidence',async()=>{
  const f=fixture();f.options.readStatus=async()=>{f.clock.wall=()=>f.options.expiresAt+30999;return 200;};await assert.rejects(observeOwnedGatewayExpiry(f.options,f.clock),/clock_reversed/);assert.equal(f.events.length,1);
  for(const expiresAt of [NaN,-1,0,1.5,Number.MAX_SAFE_INTEGER]){const f=fixture();await assert.rejects(observeOwnedGatewayExpiry({...f.options,expiresAt},f.clock));assert.equal(f.reads,0);}
  const p=fixture();p.options.record=()=>{throw Error('private recording failed');};await assert.rejects(observeOwnedGatewayExpiry(p.options,p.clock),/private recording failed/);assert.equal(p.reads,1);
});
test('original c4 source is archived and fully hash-checked separately from the changed active test',async()=>{
  const r=await loadArchivedGroupNextRevision();assert.equal(r.sha256,'a476794f63fec4151027e416b410d0bb94b971f08edc1fa0882654eae0f774f2');assert.equal(r.material.sources.length,6);assert.equal(r.material.productionAuthorized,false);assert.ok(Object.isFrozen(r.material));
  const wire=await readFile('scripts/fixtures/member-checkout-group-next-c4-source.json','utf8'),a=JSON.parse(wire);assert.equal(a.sources.length,6);
  for(const change of [a=>a.commit='0'.repeat(40),a=>a.revision.sha256='0'.repeat(64),a=>a.sources[3].body+='\n',a=>a.revision.material.productionAuthorized=true,a=>a.sources.pop()]){const a=JSON.parse(wire);change(a);assert.throws(()=>verifyArchivedGroupNextRevision(JSON.stringify(a)));}
  assert.ok(a.sources[3].body.includes('assert.equal(await catalog(v.jwt),401)'));
});
test('helper never calls a backend, issues tokens, changes clocks or modifies the application policy',async()=>{
  const s=await readFile('scripts/member-checkout-expiry-observation.mjs','utf8');assert.doesNotMatch(s,/\bfetch\s*\(|child_process|process\.env|Date\.now\s*=|createHmac|writeFile|from ['"]pg['"]|while\s*\([^)]*status/);
  assert.match(s,/signal.throwIfAborted/);assert.match(s,/clock.mono\(\)<deadline/);assert.match(s,/assert.equal\(proof.status,401/);
});
