// Booking-only server-rewrite gate. No writer, reload, timer, or bypass token.
// The bounded host controller must arm its independent recovery watchdog before
// installing this text. This does NOT claim a drain or a ten-minute rehearsal.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseNginx} from './production-maintenance-nginx-profile.mjs';
import {assertBookingHandoffWindow} from './booking-handoff-policy.mjs';

export const BOOKING_INGRESS_VHOST='/www/server/panel/vhost/nginx/www.faolla.com.conf';
export const BOOKING_INGRESS_VHOST_SHA256='d16686e4b1b9eae2fba6ba0c592d3c22597d75b606eed383af13eead3af213f1';
export const BOOKING_INGRESS_MAIN_SHA256='7e60b4200cf51f0dfdb99f88f9f106380d54d6378bf4fac8f255e3d82d2a0228';
const hash=value=>createHash('sha256').update(value).digest('hex');
const need=(v,code)=>{if(!v)throw Error('booking_handoff_ingress_'+code);};

export function bookingIngressSnippet(window){
  assertBookingHandoffWindow(window);
  return `\n    # BEGIN faolla booking handoff ${window.id}
    set $faolla_booking_handoff_blocked 0;
    if ($uri ~* "^/api/bookings(?:/|$)") { set $faolla_booking_handoff_blocked 1; }
    set $faolla_booking_handoff_method_uri "$request_method:$uri";
    if ($faolla_booking_handoff_method_uri ~* "^POST:/api/(?:publish|personal-guest-merge)(?:/|$)") { set $faolla_booking_handoff_blocked 1; }
    if ($faolla_booking_handoff_blocked = 1) { return 503 '{"ok":false,"error":"booking_temporarily_paused","operation":"${window.id}"}'; }
    # END faolla booking handoff ${window.id}\n`;
}
export function createProductionBookingIngressPlan({vhostText,mainSha256,window}){
  need(typeof vhostText==='string'&&hash(vhostText)===BOOKING_INGRESS_VHOST_SHA256&&
    mainSha256===BOOKING_INGRESS_MAIN_SHA256&&!/faolla_booking_handoff|faolla_maintenance_/i.test(vhostText),'baseline_changed');
  const tree=parseNginx(vhostText,BOOKING_INGRESS_VHOST),servers=tree.filter(n=>n.name==='server');
  need(tree.length===1&&servers.length===1&&Array.isArray(servers[0].children),'server_scope');
  const server=servers[0],names=server.children.filter(n=>n.name==='server_name').flatMap(n=>n.args).sort();
  need(JSON.stringify(names)===JSON.stringify(['*.faolla.com','faolla.com','www.faolla.com']),'host_scope');
  const snippet=bookingIngressSnippet(window),afterText=vhostText.slice(0,server.body)+snippet+vhostText.slice(server.body);
  const afterTree=parseNginx(afterText,BOOKING_INGRESS_VHOST);
  need(afterTree.length===1&&afterTree[0].children?.filter(n=>n.name==='if').length===
    server.children.filter(n=>n.name==='if').length+3,'rewrite_scope');
  return {schemaVersion:1,kind:'booking-only-ingress-gate',file:BOOKING_INGRESS_VHOST,window:structuredClone(window),
    beforeSha256:hash(vhostText),afterSha256:hash(afterText),snippetSha256:hash(snippet),beforeText:vhostText,afterText};
}
export function bookingIngressRestorationText(plan,currentText){
  need(plan?.schemaVersion===1&&plan.kind==='booking-only-ingress-gate'&&plan.file===BOOKING_INGRESS_VHOST,'plan');
  const reconstructed=createProductionBookingIngressPlan({vhostText:plan.beforeText,mainSha256:BOOKING_INGRESS_MAIN_SHA256,window:plan.window});
  need(isDeepStrictEqual(reconstructed,plan)&&typeof currentText==='string'&&
    hash(currentText)===plan.afterSha256&&currentText===plan.afterText,'restoration_drift');
  return plan.beforeText;
}
