// Owned hosted-CI rehearsal only. Never accepts a connection URL or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {assertIsolatedCi} from './member-checkout-real-auth-support.mjs';
export const interruptionPhases=Object.freeze(['after-ddl','after-prepared','before-commit','after-commit']);
export function assertCheckout047InterruptionCi(env=process.env,platform=process.platform,arch=process.arch){
 const owned=assertIsolatedCi(env,platform,arch);assert.equal(owned.profileName,'current-auth');
 assert.equal(env.FAOLLA_CHECKOUT_047_INTERRUPTION_ACCEPTANCE,'1','owned_047_interruption_opt_in_required');return owned;
}
export function checkout047InterruptionEnvironment(env=process.env){
 assertCheckout047InterruptionCi(env);
 return Object.fromEntries(['GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA','RUNNER_TEMP',
  'FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE','FAOLLA_CHECKOUT_AUTH_TEST_PROFILE','FAOLLA_CHECKOUT_047_INTERRUPTION_ACCEPTANCE'].map(key=>[key,env[key]]));
}
export function assertCheckout047InterruptionRequest(value){
 assertCheckout047InterruptionCi();assert.ok(value&&Object.getPrototypeOf(value)===Object.prototype);
 assert.deepEqual(Object.keys(value).sort(),['operationId','phase','roots']);assert.ok(interruptionPhases.includes(value.phase));
 assert.match(value.operationId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.deepEqual(Object.keys(value.roots).sort(),['dataRoot','locatorRoot']);
 const parent=path.dirname(value.roots.dataRoot);assert.equal(path.dirname(parent),fs.realpathSync(tmpdir()));
 assert.match(path.basename(parent),/^faolla-checkout-evidence-test-[A-Za-z0-9]+$/);
 assert.equal(value.roots.dataRoot,path.join(parent,'data'));assert.equal(value.roots.locatorRoot,path.join(parent,'locators'));
 return value;
}
