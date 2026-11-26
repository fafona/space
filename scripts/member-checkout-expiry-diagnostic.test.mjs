import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {assertExpiryDiagnosticCi, expiryClockOracleClaims, postgrest145TimePredicate, expiryDiagnosticBranch} from './member-checkout-expiry-diagnostic.mjs';

const owned = {GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'fafona/space',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/'+expiryDiagnosticBranch,GITHUB_SHA:'a'.repeat(40),FAOLLA_CHECKOUT_EXPIRY_DIAGNOSTIC:'1',RUNNER_TEMP:'/tmp/owned'};

test('clock oracle admits exactly one whole second, not a replacement expiry policy',()=>{
  const claims=expiryClockOracleClaims(1700000000),accepted=[];
  for(let now=claims.exp-120;now<=claims.exp+120;now++)if(postgrest145TimePredicate(claims,now))accepted.push(now);
  assert.deepEqual(accepted,[claims.exp+30]);assert.ok(Object.isFrozen(claims));
  for(const value of [null,NaN,Infinity,1.2,0,-1,'1700000000',Number.MAX_SAFE_INTEGER])assert.throws(()=>expiryClockOracleClaims(value));
});
test('hosted diagnostic refuses all other branches, events, architectures and configured backends',()=>{
  assert.equal(assertExpiryDiagnosticCi(owned,'linux','x64').tools,'/tmp/owned/faolla-expiry-diagnostic-tools');
  for(const [key,value] of Object.entries({GITHUB_ACTIONS:'false',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'other/space',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'bad',FAOLLA_CHECKOUT_EXPIRY_DIAGNOSTIC:'0',RUNNER_TEMP:''}))
    assert.throws(()=>assertExpiryDiagnosticCi({...owned,[key]:value},'linux','x64'));
  for(const key of ['SUPABASE_URL','STRIPE_SECRET_KEY','SMTP_HOST','DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGDATABASE','PGUSER','FAOLLA_CHECKOUT_RUNTIME_JWT'])
    assert.throws(()=>assertExpiryDiagnosticCi({...owned,[key]:'canary'},'linux','x64'));
  assert.throws(()=>assertExpiryDiagnosticCi(owned,'win32','x64'));assert.throws(()=>assertExpiryDiagnosticCi(owned,'linux','arm64'));
});
test('native diagnosis refuses before filesystem, client import, token creation or backend access',()=>{
  const r=spawnSync(process.execPath,['--test','scripts/member-checkout-expiry-diagnostic-acceptance.mjs'],{env:{},encoding:'utf8',timeout:15000});
  assert.ifError(r.error);assert.equal(r.status,1);assert.match(r.stdout+r.stderr,/AssertionError/);
  assert.doesNotMatch(r.stdout+r.stderr,/ENOENT|ECONNREFUSED|canary|disposable-expiry/);
});
test('diagnostic is independent, loopback PG and owned Unix HTTP only; existing expiry gate and source remain unchanged',async()=>{
  const s=await readFile('scripts/member-checkout-expiry-diagnostic-acceptance.mjs','utf8');
  assert.ok(s.indexOf('assertExpiryDiagnosticCi()')<s.indexOf('await mkdir('));
  assert.ok(s.indexOf('assertExpiryDiagnosticCi()')<s.indexOf("requirePg('pg')"));
  for(const marker of ['PGRST_SERVER_UNIX_SOCKET:socketPath',"host:'127.0.0.1'",'expiryClockOracleClaims(exp)',"PGRST_DB_TX_END:'rollback'",'originalGateChanged:false','productionAuthorized:false','deploymentReady:false','originalFailureClockCaptured:false'])assert.ok(s.includes(marker),marker);
  assert.doesNotMatch(s,/process\.env\.(?:SUPABASE|DATABASE|PG|STRIPE)\w*\s*=|Date\.now\s*=|globalThis\.fetch\s*=|kill\('SIGKILL'\)/);
  const old=await readFile('scripts/member-checkout-group-next-acceptance.mjs','utf8');
  assert.ok(old.includes('v.expiresAt+31000'));assert.ok(old.includes('assert.equal(await catalog(v.jwt),401)'));
});
test('dedicated branch workflow has no application build, deploy authority, secrets, or old workflow changes',async()=>{
  const s=await readFile('.github/workflows/member-checkout-expiry-diagnostic.yml','utf8');
  assert.ok(s.includes('- '+expiryDiagnosticBranch));assert.match(s,/contents: read/);assert.match(s,/persist-credentials: false/);
  assert.match(s,/image: postgres:15.8/);assert.match(s,/127\.0\.0\.1:56464:5432/);assert.match(s,/node-version: 20.20.1/);
  assert.match(s,/FAOLLA_CHECKOUT_EXPIRY_DIAGNOSTIC: '1'/);assert.match(s,/faolla-expiry-boundary-evidence\/report.json/);
  assert.doesNotMatch(s,/secrets\.|contents: write|pull_request:|workflow_dispatch:|sudo |ssh |scp |git merge|git push|npm run build|pm2|STRIPE_SECRET/);
  for(const file of ['.github/workflows/member-checkout-real-auth.yml','.github/workflows/member-checkout-047-real-auth.yml','.github/workflows/member-checkout-full-registry-evidence.yml'])
    assert.doesNotMatch(await readFile(file,'utf8'),/expiry-diagnostic/);
});
