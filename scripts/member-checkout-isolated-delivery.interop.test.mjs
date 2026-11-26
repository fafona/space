// Local existing-controller interop: node --import tsx --test <this file>.
// Injected transport/storage and synthetic keys only; not a service or gateway.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {createCredentialRenewalController} from './member-checkout-credential-renewal.mjs';
import {createIsolatedDeliveryPublisher,createIsolatedDeliveryReceiver} from './member-checkout-isolated-delivery.mjs';
const pair=generateKeyPairSync('ed25519'),fingerprint='a'.repeat(64);
function fixture(drop=false){
 let wall=1000000,mono=1000000,signs=0,writes=0,sends=0;
 const p={directory:'/owned/delivery',ownerUid:0,ownerGid:0,access:'owner',algorithm:'EdDSA',issuer:'owned-interop',audience:'owned-runtime'};
 const config={filePolicy:p,recipientId:'owned-interop',peerFingerprint:fingerprint,timeoutMs:100};
 const receiver=createIsolatedDeliveryReceiver(config,{now:()=>wall,verify:async jwt=>{const parts=jwt.split('.');return verify(null,Buffer.from(parts.slice(0,2).join('.')),pair.publicKey,Buffer.from(parts[2],'base64url'));},publish:async(policy,value)=>{assert.deepEqual(policy,p);writes++;return {published:true,generation:value.generation,productionAuthorized:false};}});
 const publisher=createIsolatedDeliveryPublisher(config,{now:()=>wall,send:async q=>{sends++;const body=await receiver.receive(q.body,fingerprint,q.signal);if(drop)throw Error('owned_receipt_lost');return {status:200,peerFingerprint:fingerprint,body};}});
 const controller=createCredentialRenewalController({filePolicy:p,ttlSeconds:30,renewAheadMs:21000,pollMs:50,issueTimeoutMs:100},{wallNow:()=>wall,monotonicNow:()=>mono,sign:async bytes=>{signs++;const claims=JSON.parse(Buffer.from(bytes.toString().split('.')[1],'base64url'));assert.deepEqual(Object.keys(claims).sort(),['aud','exp','iat','iss','jti','role']);assert.equal(claims.role,'faolla_checkout_runtime');assert.equal(claims.iss,p.issuer);assert.equal(claims.aud,p.audience);assert.equal(claims.exp-claims.iat,30);return sign(null,bytes,pair.privateKey);},publish:publisher.publish});
 return {controller,publisher,receiver,counts:()=>({signs,writes,sends}),advance:ms=>{wall+=ms;mono+=ms;}};
}
test('unchanged renewal controller publishes and renews through the new fixed-envelope adapters',async()=>{const f=fixture();assert.equal((await f.controller.tick()).published,1);f.advance(11000);assert.equal((await f.controller.tick()).published,2);assert.equal(f.publisher.snapshot().confirmed,2);assert.equal(f.receiver.snapshot().published,2);assert.deepEqual(f.counts(),{signs:2,writes:2,sends:2});await f.controller.stop();});
test('lost receipt latches transport; explicit supervisor stop is required for the old controller',async()=>{const f=fixture(true);const failed=await f.controller.tick();assert.equal(failed.published,0);assert.equal(failed.reason,'RENEWAL_ISSUE_FAILED');assert.equal(failed.stopped,false);assert.equal(f.publisher.snapshot().halted,true);assert.deepEqual(f.counts(),{signs:1,writes:1,sends:1});await f.controller.stop();f.advance(11000);await f.controller.tick();assert.deepEqual(f.counts(),{signs:1,writes:1,sends:1});});
