import test from "node:test";
import assert from "node:assert/strict";
import { handleTrafficCampaign } from "./route-handler";
import { readTrafficCampaign, signTrafficCampaign } from "@/lib/accountTrafficCampaign.server";
const secret="test-campaign-route-signing-secret-32-chars";
const body={siteId:"10000000",url:"https://merchant.faolla.com/",label:"门口海报",medium:"qr"};
const request=(input:unknown=body,origin="https://console.faolla.com")=>new Request("https://console.faolla.com/api/super-admin/traffic/campaign",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(input)});
test("campaign signing requires console authorization, same origin and bounded valid data",async()=>{
  assert.equal((await handleTrafficCampaign(request(),{authorize:async()=>false})).status,401);
  const deps={authorize:async()=>true,sign:()=>{throw Error("must not sign invalid data");}};
  assert.equal((await handleTrafficCampaign(request(body,"https://evil.test"),deps)).status,403);
  for(const invalid of [{...body,siteId:"all"},{...body,label:""},{...body,label:"x".repeat(81)},{...body,url:"javascript:alert(1)"},{...body,medium:"custom"}]) assert.equal((await handleTrafficCampaign(request(invalid),deps)).status,400);
});
test("campaign endpoint signs scope but never rewrites stored cards",async()=>{
  const response=await handleTrafficCampaign(request(),{authorize:async()=>true,sign:(value)=>signTrafficCampaign(value,secret)});
  assert.equal(response.status,200);assert.match(response.headers.get("cache-control")||"",/no-store/);
  const result=await response.json(),url=new URL(result.url);
  assert.equal(url.origin,"https://merchant.faolla.com");
  const value=readTrafficCampaign(url.searchParams.get("faolla_campaign"),"10000000",secret);
  assert.equal(value?.id,result.id);assert.equal(value?.label,"门口海报");assert.equal(value?.medium,"qr");
  assert.equal((await handleTrafficCampaign(request(),{authorize:async()=>true,sign:()=>""})).status,503);
});
