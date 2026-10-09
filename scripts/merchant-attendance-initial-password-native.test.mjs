// Pure checks; importing the runner does not start its optional native CLI.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createInitialPasswordAuthModel,assertCompletedSetupRetryDefect,assertCompletedSetupRetryRecovered} from './merchant-attendance-initial-password-native.mjs';

const actor={id:'00000000-0000-4000-8000-000000000002',email:'synthetic@example.test'};
const attrs=user=>({password:'synthetic-password-only!',app_metadata:{...user.app_metadata,merchant_staff_password_initialized:true}});
const facts=()=>({employees:[{id:'employee',status:'invited',accepted_at:null,initial_password_policy:'completed'}],
  setups:[{employee_id:'employee',state:'completed'}],audits:[]});
const proof=()=>({status:409,body:{ok:false,error:'employee_password_state_unknown'},rpcErrors:['employee_initial_password_not_required'],
  before:facts(),after:facts(),authBefore:{initialized:true,updates:1,reads:2},authAfter:{initialized:true,updates:1,reads:2}});
const source=()=>readFileSync(new URL('./merchant-attendance-initial-password-native.mjs',import.meta.url),'utf8');
const recovered=()=>({...proof(),status:200,body:{ok:true},rpcErrors:[],rpcNames:['faolla_claim_merchant_employee_initial_password_setup_v1'],authAfter:{initialized:true,updates:1,reads:3}});

test('setup Auth model only accepts the synthetic fixture identity and bound explicit session',async()=>{
  assert.throws(()=>createInitialPasswordAuthModel({...actor,email:'user@actual.example'}));
  assert.throws(()=>createInitialPasswordAuthModel({...actor,id:'not-synthetic'}));
  const model=createInitialPasswordAuthModel(actor);
  await assert.rejects(()=>model.resolveAuthUser(new Request('https://local.invalid')));
  const user=await model.resolveAuthUser(new Request('https://local.invalid',{headers:{'x-merchant-access-token':model.sessionToken}}));
  assert.equal(user.id,actor.id);assert.equal(user.app_metadata.merchant_staff_password_initialized,false);
  await assert.rejects(()=>model.getAuthUserById('different-account'));
  assert.deepEqual(model.proof(),{updates:0,reads:0,initialized:false,retained:'unchanged'});
});

test('setup Auth model performs one bounded in-memory update and protects retained server metadata',async()=>{
  const model=createInitialPasswordAuthModel(actor),input=attrs(model.user());
  await assert.rejects(()=>model.updateAuthUserById(actor.id,{...input,extra:true}));
  await assert.rejects(()=>model.updateAuthUserById(actor.id,{...input,app_metadata:{merchant_staff_password_initialized:true}}));
  await assert.rejects(()=>model.updateAuthUserById('another',input));
  assert.equal(model.proof().updates,0);
  const result=await model.updateAuthUserById(actor.id,input);assert.equal(result.error,null);
  assert(model.passwordMatches(input.password));assert(!model.passwordMatches('wrong'));
  input.app_metadata.fixture_retained='client-change';result.user.app_metadata.fixture_retained='reply-change';
  assert.equal(model.user().app_metadata.fixture_retained,'unchanged');
  assert.equal(model.proof().updates,1);
});

test('modeled503 is returned after the Auth write and does not falsely claim an unchanged password',async()=>{
  const model=createInitialPasswordAuthModel(actor),input=attrs(model.user());model.loseNextUpdateReply();
  const result=await model.updateAuthUserById(actor.id,input);assert.equal(result.user,null);assert.equal(result.error.status,503);
  assert.equal(model.proof().initialized,true);assert.equal(model.proof().updates,1);assert(model.passwordMatches(input.password));
  const read=await model.getAuthUserById(actor.id);assert.equal(read.user.app_metadata.merchant_staff_password_initialized,true);
  assert.equal(model.proof().reads,1);assert.equal(model.proof().updates,1);
});

test('completed setup409 is labeled a reproduced defect, never a recovery pass',()=>{
  const value=proof();assert.deepEqual(assertCompletedSetupRetryDefect(value),{completedSetupRetryPassed:false,completedSetupRetryDefectReproduced:true});
  assert.deepEqual(value,proof());
});

test('completed setup diagnosis rejects200, unrelated errors, rewritten facts, missing completion and extra Auth updates',()=>{
  for(const patch of [{status:200},{body:{ok:false,error:'employee_invitation_invalid_or_expired'}},{rpcErrors:[]},
    {rpcErrors:['employee_initial_password_setup_in_progress']},{after:{...facts(),audits:[{id:'new'}]}},
    {authAfter:{initialized:true,updates:2,reads:2}},
    {before:{...facts(),setups:[]},after:{...facts(),setups:[]}},
    {before:{...facts(),employees:[{...facts().employees[0],status:'active'}]},after:{...facts(),employees:[{...facts().employees[0],status:'active'}]}},
    {authBefore:{initialized:false,updates:1,reads:2},authAfter:{initialized:false,updates:1,reads:2}}]){
    assert.throws(()=>assertCompletedSetupRetryDefect({...proof(),...patch}));
  }
});

test('patched completed replay only passes with one claim, one current Auth read and unchanged facts/password',()=>{
  assert.deepEqual(assertCompletedSetupRetryRecovered(recovered()),{completedSetupRetryPassed:true,completedSetupRetryDefectReproduced:false});
  for(const patch of [{status:409},{body:{ok:false}},{rpcErrors:['employee_initial_password_not_required']},{rpcNames:[]},
    {rpcNames:[...recovered().rpcNames,'faolla_complete_merchant_employee_initial_password_setup_v1']},
    {authAfter:proof().authBefore},{authAfter:{initialized:true,updates:2,reads:3}},
    {after:{...facts(),audits:[{id:'unexpected'}]}},{before:{...facts(),setups:[]},after:{...facts(),setups:[]}}]){
    assert.throws(()=>assertCompletedSetupRetryRecovered({...recovered(),...patch}));
  }
});

test('native runner uses unchanged handler and real SQL adapters while explicitly disclosing synthetic identity and reads',()=>{
  const text=source();assert.match(text,/createMerchantEnterpriseInitialPasswordHandler\(/);
  assert.match(text,/loadInvitation:prepared\.loadInvitation,loadRole:prepared\.loadRole,loadStaffIdentity:prepared\.loadStaffIdentity/);
  assert.match(text,/prepared\.initialPasswordRpc\(setupNames\[kind\]/);
  assert.match(text,/defaultSetupDependencies:false,syntheticAuthMutation:true,realAuthService:false,realBrowser:false,realEmail:false/);
  assert.match(text,/assertCompletedSetupRetryDefect\(\{\.\.\.retry,before:completed,after:prepared\.facts\(\),authBefore,authAfter:auth\.proof\(\)\}\)/);
  const expiryStart=text.indexOf('function checkExpiryAfterStatementStart('),expiryEnd=text.indexOf('export async function checkInitialPasswordNative',expiryStart);
  assert(expiryStart>=0&&expiryEnd>expiryStart);
  assert.doesNotMatch(text.slice(0,expiryStart)+text.slice(expiryEnd),/\b(?:insert into|update|delete from)\s+(?:public\.)?merchant_/i);
  assert.match(text.slice(expiryStart,expiryEnd),/prepared\.exec\(`begin;reset role;/);
  assert.match(text.slice(expiryStart,expiryEnd),/rollback;`/);
  assert.match(text.slice(expiryStart,expiryEnd),/assert\.deepEqual\(prepared\.facts\(\),before\)/);
});

test('fallback uses installed SDK and actual accept while treating Auth metadata as modeled and preserving facts',()=>{
  const text=source();assert.match(text,/await protocol\.login\(invite\.actor\)/);
  assert.match(text,/await acceptInvitation\(new Request/);
  assert.match(text,/response=await protocolFetch\(request\)/);
  assert.match(text,/assert\.equal\(user\.id,invite\.actor\.id\)/);
  assert.match(text,/assert\.deepEqual\(final\.setups,completed\.setups\)/);
  assert.match(text,/assert\.equal\(final\.audits\.length,completed\.audits\.length\+1\)/);
  assert.match(text,/assert\.equal\(auth\.proof\(\)\.updates,1\)/);
});

test('diagnostic runner has explicit opt-in CLI, fail-closed network and unconditional fetch/environment restoration',()=>{
  const text=source();assert.match(text,/path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
  assert.match(text,/args=process\.argv\.slice\(2\),patched=args\.includes\('--patched'\)/);
  assert.match(text,/runAttendanceLabelsReuse\(args\.filter\(value=>value!=='--patched'\)/);
  assert.match(text,/globalThis\.fetch=async\(\)=>\{externalRequests\+\+;throw Error/);
  assert.match(text,/finally\{globalThis\.fetch=protocolFetch;\}/);
  assert.match(text,/finally\{\s*globalThis\.fetch=previousFetch;/);
  for(const variable of ['FAOLLA_CANONICAL_PORTAL_ORIGIN','FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE']){
    assert.match(text,new RegExp('delete process\\.env\\.'+variable));
  }
  assert.match(text,/console\.error\(JSON\.stringify\(\{initialPasswordNativeFailed:true,phase\}\)\)/);
  assert.doesNotMatch(text,/console\.(?:log|error)\((?:error|args|input|original|password|completed|authBefore)/);
});

test('patched runs include independent normal first setup, actual rejection matrix and current Auth confirmation gates',()=>{
  const text=source();assert.match(text,/if\(patched\)await checkInitialPasswordNative\(native,\{patched:true,directSuccess:true\}\)/);
  assert.match(text,/applyInitialPasswordReplayFixture\(native,scope,prepared\)/);
  assert.match(text,/checkInitialPasswordReplayRejections\(native,scope,prepared,invite,input\)/);
  assert.match(text,/\['uncommitted','unavailable'\]/);
  assert.match(text,/assert\.deepEqual\(denied\.rpcNames,\[setupNames\.claim\]\)/);
});
