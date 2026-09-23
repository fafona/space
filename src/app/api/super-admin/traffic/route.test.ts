import test from "node:test";
import assert from "node:assert/strict";
import { handleTrafficReport } from "./route-handler";
import type { AccountTrafficReport } from "@/lib/accountTraffic";
const request = (query = "siteId=10000000") => new Request(`https://console.faolla.com/api/super-admin/traffic?${query}`);
test("unauthenticated reports never access DB", async () => {
  const result = await handleTrafficReport(request(), { authorize: async () => false, client: () => { throw new Error("unexpected db"); } });
  assert.equal(result.status, 401);
  assert.match(result.headers.get("cache-control") ?? "", /no-store/);
});

test("CSV requires the same authorization and exports a single scoped snapshot", async () => {
  assert.equal((await handleTrafficReport(request("siteId=10000000&format=csv"), { authorize: async () => false, client: () => { throw new Error("no db"); } })).status, 401);
  const report: AccountTrafficReport = { timezone: "Europe/Madrid", from: "2026-09-01", to: "2026-09-23", firstCollectedAt: null,
    totalEvents: 0, views: 0, exposures: 0, actions: 0, objectCount: 0, objects: [], daily: [], modules: [], sources: [], browsers: [], devices: [], actionTypes: [] };
  let calls = 0;
  const client = { rpc: (_name: string, args: unknown) => { calls++; assert.deepEqual(args, { p_site_id: "10000000", p_days: 7, p_offset: 50, p_module: "card", p_object_id: "card-1" }); return { abortSignal: async () => ({ data: report, error: null }) }; } };
  const response = await handleTrafficReport(request("siteId=10000000&days=7&offset=50&module=card&objectId=card-1&format=csv"), { authorize: async () => true, client: () => client as never });
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.match(response.headers.get("content-type") || "", /text\/csv/); assert.match(response.headers.get("content-disposition") || "", /10000000-7d-page2.csv/);
  assert.match(response.headers.get("cache-control") || "", /no-store/); assert.match(await response.text(), /"对象 ID","card-1"/);
  assert.equal((await handleTrafficReport(request("siteId=10000000&format=xlsx"), { authorize: async () => true })).status, 400);
  assert.equal((await handleTrafficReport(request("siteId=10000000&format=csv"), { authorize: async () => true, client: () => null })).status, 503);
});
test("report limits dates and scopes; service failure is not a zero report", async () => {
  for (const query of ["siteId=all", "siteId=10000000&days=1000", "siteId=10000000&days=NaN", "siteId=10000000&offset=-1"]) {
    assert.equal((await handleTrafficReport(request(query), { authorize: async () => true })).status, 400);
  }
  assert.equal((await handleTrafficReport(request(), { authorize: async () => true, client: () => null })).status, 503);
});
test("report passes one exact account and object offset to aggregate RPC", async () => {
  let args: unknown;
  const client = { rpc: (name: string, input: unknown) => { assert.equal(name, "faolla_account_traffic_report"); args = input; return { abortSignal: async () => ({ data: { views: 2000 }, error: null }) }; } };
  const result = await handleTrafficReport(request("siteId=10000000&days=7&offset=50"), { authorize: async () => true, client: () => client as never, enabled: () => false });
  assert.deepEqual(args, { p_site_id: "10000000", p_days: 7, p_offset: 50, p_module: null, p_object_id: null });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).report.views, 2000);
});

test("full CSV ignores page offset, uses full snapshot RPC and rejects truncated data",async()=>{
  const fixture={timezone:"Europe/Madrid",from:"2026-09-01",to:"2026-09-23",views:100,exposures:0,actions:0,objects:Array.from({length:55},(_,i)=>({key:`card-${i}`,module:"card",label:`Card ${i}`,count:1})),objectCount:55,daily:[],modules:[],sources:[],browsers:[],devices:[],actionTypes:[],exportScope:"all"};
  const client={rpc:(name:string,args:unknown)=>{assert.equal(name,"faolla_account_traffic_report_full");assert.deepEqual(args,{p_site_id:"10000000",p_days:30,p_module:null,p_object_id:null});return{abortSignal:async()=>({data:fixture,error:null})};}};
  const deps={authorize:async()=>true,client:()=>client as never};
  const result=await handleTrafficReport(request("siteId=10000000&offset=50&format=csv-all"),deps);
  assert.equal(result.status,200);assert.match(result.headers.get("content-disposition")||"",/-all.csv/);assert.match(await result.text(),/card-54/);
  fixture.objects=fixture.objects.slice(0,50);
  assert.equal((await handleTrafficReport(request("siteId=10000000&format=csv-all"),deps)).status,503);
});
