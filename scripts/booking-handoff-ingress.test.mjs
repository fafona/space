import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseNginx} from './production-maintenance-nginx-profile.mjs';
import {bookingIngressSnippet,createProductionBookingIngressPlan,bookingIngressRestorationText,
  BOOKING_INGRESS_VHOST,BOOKING_INGRESS_MAIN_SHA256} from './booking-handoff-ingress.mjs';

const window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
test('gate syntax is one server-level classification with only the three approved endpoint families',()=>{
  const snippet=bookingIngressSnippet(window),tree=parseNginx('server {'+snippet+'location / { proxy_pass http://127.0.0.1:3103; }}',BOOKING_INGRESS_VHOST);
  assert.equal(tree.length,1);assert.equal(tree[0].name,'server');
  assert.deepEqual(tree[0].children.map(n=>n.name),['set','if','set','if','if','location']);
  const guards=tree[0].children.filter(n=>n.name==='if');
  assert.ok(guards[0].head.includes('$uri ~* "^/api/bookings(?:/|$)"'));
  assert.ok(guards[1].head.includes('^POST:/api/(?:publish|personal-guest-merge)(?:/|$)'));
  assert.deepEqual(guards[2].children[0].args,['503',JSON.stringify({ok:false,error:'booking_temporarily_paused',operation:window.id})]);
  assert.doesNotMatch(snippet,/proxy_pass|proxy_set_header|auth_request|add_header|error_page|\$request_uri|\$http_|\$cookie_|\$arg_|allow |deny /);
});
test('every method is paused only for bookings; publish and guest merge require POST, with query excluded',()=>{
  const snippet=bookingIngressSnippet(window),booking=new RegExp(snippet.match(/\$uri ~\* "([^"]+)"/)[1],'i'),
    shared=new RegExp(snippet.match(/method_uri ~\* "([^"]+)"/)[1],'i');
  const paused=(method,path)=>booking.test(path)||shared.test(method+':'+path);
  for(const method of ['GET','POST','PATCH','DELETE','OPTIONS'])for(const uri of ['/api/bookings','/api/bookings/','/api/bookings/workbench','/API/BOOKINGS/calendar'])assert.equal(paused(method,uri),true);
  for(const uri of ['/api/publish','/api/publish/','/api/personal-guest-merge']){
    assert.equal(paused('POST',uri),true);assert.equal(paused('GET',uri),false);
  }
  for(const uri of ['/api/orders','/api/auth/signin','/api/merchant-enterprise/attendance','/api/bookings-other','/card/example','/api/publish-preview','/'])
    assert.equal(paused('POST',uri),false);
});
test('operation scope is canonical, time-bounded and has no configurable public bypass',()=>{
  for(const patch of [{id:'arbitrary'},{id:"x';return 200;#"},{deadlineAt:'2026-10-26T10:10:00.001Z'},{extra:true}])
    assert.throws(()=>bookingIngressSnippet({...window,...patch}));
  assert.throws(()=>createProductionBookingIngressPlan({vhostText:'server { listen 443; }',mainSha256:BOOKING_INGRESS_MAIN_SHA256,window}),/baseline_changed/);
  assert.throws(()=>bookingIngressRestorationText({schemaVersion:1,kind:'booking-only-ingress-gate',file:BOOKING_INGRESS_VHOST,window,beforeText:'forged'},'forged'));
  const source=readFileSync(new URL('./booking-handoff-ingress.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"]node:(?:fs|child_process)|process\.env|\bfetch\(|spawnSync\(|writeFileSync\(|setTimeout\(|--skip|--force/);
});
