import test from "node:test";
import assert from "node:assert/strict";
import { recordTrafficOutcome, trafficOutcomeId } from "./accountTrafficOutcome.server";
import { readTrafficCampaign, signTrafficCampaign } from "./accountTrafficCampaign.server";
import { forwardTrafficTags, isTrafficAction } from "./accountTraffic";
const secret="test-independent-campaign-secret-32-chars";
const campaign={siteId:"10000000",id:"10000000-0000-4000-8000-000000000099",label:"秋季·桌牌",medium:"qr" as const};
test("campaign signature binds account, stable activity ID, name and medium",()=>{
  const token=signTrafficCampaign(campaign,secret);
  assert.deepEqual(readTrafficCampaign(token,"10000000",secret),campaign);
  assert.equal(readTrafficCampaign(token,"20000000",secret),null);
  assert.equal(readTrafficCampaign(token+"x","10000000",secret),null);
  assert.equal(readTrafficCampaign(token,"10000000",secret+"x"),null);
  assert.equal(signTrafficCampaign({...campaign,label:"x".repeat(81)},secret),"");
});
test("internal redirects preserve only valid tags without changing destination or share key",()=>{
  const target=new URL("https://faolla.com/share/business-card?shareKey=abc#top");
  assert.equal(forwardTrafficTags(target,new URL("https://faolla.com/card/demo")).href,target.href);
  const result=forwardTrafficTags(target,new URL("https://faolla.com/card/demo?faolla_medium=qr&faolla_campaign=a.b&email=PRIVATE"));
  assert.equal(result.pathname,target.pathname);assert.equal(result.searchParams.get("shareKey"),"abc");assert.equal(result.hash,"#top");
  assert.equal(result.searchParams.get("faolla_medium"),"qr");assert.equal(result.searchParams.get("faolla_campaign"),"a.b");assert.equal(result.searchParams.has("email"),false);
});
test("outcomes are not accepted as browser actions and use stable non-public event IDs",()=>{
  for(const [module,action] of [["booking","booking_created"],["order","order_created"],["poll","poll_submitted"],["membership","membership_joined"]] as const) assert.equal(isTrafficAction(module,action),false);
  const id=trafficOutcomeId("10000000","order","order-private-id");
  assert.equal(id,trafficOutcomeId("10000000","order","order-private-id"));
  assert.notEqual(id,trafficOutcomeId("20000000","order","order-private-id"));
  assert.match(id,/^[a-f0-9-]{14}5/);assert.equal(id.includes("private"),false);
});
test("confirmed outcomes are minimized, idempotent, privacy-aware and failure-isolated",async()=>{
  const input={siteId:"10000000",module:"booking" as const,recordId:"real-business-id",objectId:"booking-1",occurredAt:"2026-09-23T12:00:00Z"};
  const now=Date.parse(input.occurredAt)+1000;
  let rows: unknown, options: unknown;
  const client={from:()=>({upsert:(value:unknown,opts:unknown)=>{rows=value;options=opts;return{abortSignal:async()=>({error:null})};}})};
  const deps={enabled:()=>true,client:()=>client as never,now:()=>now};
  const request=new Request("https://faolla.com/api/bookings",{headers:{referer:"https://faolla.com/?faolla_medium=qr&email=PRIVATE","user-agent":"Chrome"}});
  assert.equal(await recordTrafficOutcome(request,input,deps),true);
  assert.deepEqual(options,{onConflict:"site_id,event_id",ignoreDuplicates:true});
  const row=(rows as Record<string,unknown>[])[0];
  assert.equal(row.action,"booking_created");assert.equal(row.medium,"qr");assert.equal(row.created_at,"2026-09-23T12:00:00.000Z");
  assert.equal(JSON.stringify(row).includes("PRIVATE"),false);assert.equal(JSON.stringify(row).includes(input.recordId),false);
  const noDb={...deps,client:()=>{throw Error("database down");}};
  assert.equal(await recordTrafficOutcome(request,input,noDb),false);
  assert.equal(await recordTrafficOutcome(request,{...input,occurredAt:"2020-01-01"},noDb),false);
  assert.equal(await recordTrafficOutcome(new Request(request,{headers:{dnt:"1"}}),input,noDb),false);
  assert.equal(await recordTrafficOutcome(request,input,{...noDb,enabled:()=>false}),false);
});
