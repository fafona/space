import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Actual member manager with an injected synthetic employee API. Every real
// network request except the synthetic document is rejected before navigation.
test("member lists and recharge stay quiet; original checkout is visible only inside redemption", { timeout: 90000 }, async () => {
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import Manager from './src/components/admin/MerchantMemberManager';
    import{normalizeMerchantMembershipRecord,toMerchantMembershipListItem}from'./src/lib/merchantMemberships';
    import{normalizeMerchantMembershipSettings}from'./src/lib/merchantMembershipSettings';
    import{MERCHANT_STAFF_BUSINESS_PERMISSIONS}from'./src/lib/merchantStaffBusiness';
    const siteId='10000000',at='2026-11-03T10:00:00.000Z';
    const line={code:'original-item',name:'原单商品',categoryName:'',quantity:2,unitPoints:40,subtotalPoints:80,couponPointDiscount:0,couponDiscountLabel:''};
    const receipt={version:1,operationId:'original-operation',siteId,membershipId:'member-one',transactionId:'transaction-one',createdAt:at,
      beforePointBalance:1000,afterPointBalance:920,totalQuantity:2,grossPoints:80,couponPointDiscountTotal:0,totalPoints:80,couponCount:0,note:'',lines:[line]};
    const state=window.__memberHarness={calls:[],readStarted:false,releaseRead:null,deleted:false,writes:0,checkout:{operationId:receipt.operationId,status:'pending',createdAt:at,acknowledgedAt:null,result:null,
      pendingCart:{version:1,siteId,operationId:receipt.operationId,quote:{totalQuantity:2,grossPoints:80,couponPointDiscountTotal:0,totalPoints:80,couponCount:0,lines:[line]}}}};
    const member=toMerchantMembershipListItem(normalizeMerchantMembershipRecord({id:'member-one',siteId,memberNo:'10000000000001',serial:1,accountId:'synthetic-account',status:'active',name:'合成会员',pointBalance:1000,balanceAmount:200,joinedAt:at,updatedAt:at,transactions:[]}));
    const settings=normalizeMerchantMembershipSettings(siteId,{rechargePlans:[{id:'plan-one',title:'合成充值',enabled:true,rechargeAmount:100,giftAmount:0,giftPoints:10}],redemptionItems:window.__scenario==='retired'?[]:[{id:'new-item',name:'当前商品',enabled:true,pointsCost:100,stock:10}]});
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
    const api=async(path,init={})=>{
      const url=new URL(path,'https://member-audit.invalid'),method=init.method||'GET',body=typeof init.body==='string'?JSON.parse(init.body):{};
      state.calls.push({path:url.pathname,method,body});
      if(url.pathname==='/api/memberships'&&method==='GET')return json({ok:true,memberships:state.deleted?[]:[member],total:state.deleted?0:1,allTotal:state.deleted?0:1,hasMore:false});
      if(url.pathname==='/api/membership-settings'&&method==='GET')return json({ok:true,settings});
      if(url.pathname==='/api/merchant-admin/redemption-checkout'){
        if(method==='GET'){
          state.readStarted=true;
          if(!state.releaseRead&&window.__scenario==='pending')await new Promise(resolve=>{state.releaseRead=resolve;});
          if(window.__scenario==='read-error')return json({error:'merchant_transaction_unavailable'},503);
          return json({ok:true,checkout:state.checkout?.acknowledgedAt?null:state.checkout});
        }
        if(method==='POST'&&body.operationId===receipt.operationId){
          if(body.action==='retry'){if(state.checkout.status!=='committed')state.writes++;state.checkout={operationId:receipt.operationId,status:'committed',createdAt:at,acknowledgedAt:null,result:receipt};if(window.__scenario==='deleted')state.deleted=true;return json({ok:true,replayed:false,receipt});}
          if(body.action==='ack'&&state.checkout.status==='committed'){state.checkout={...state.checkout,acknowledgedAt:at};return json({ok:true,checkout:state.checkout});}
        }
      }
      throw new Error('unexpected_synthetic_api:'+method+' '+url.pathname);
    };
    createRoot(document.getElementById('root')).render(<Manager siteId={siteId} siteName="Synthetic" apiClient={api} permissions={MERCHANT_STAFF_BUSINESS_PERMISSIONS}/>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent", define: { "process.env": "{}" } });
  const css = (await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/admin/MerchantMemberManager.tsx";\n@source "./src/components/admin/MerchantCheckoutRecoveryPanel.tsx";',
    { from: path.resolve("member-recovery-acceptance.css") })).css;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      for (const scenario of ["pending", "read-error", "retired", "deleted"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage(), errors = [], unexpected = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await context.route("**/*", async (route) => {
          if (route.request().isNavigationRequest() && route.request().url() === "https://member-audit.invalid/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
          unexpected.push(route.request().url()); return route.abort();
        });
        try {
          await page.goto("https://member-audit.invalid/");
          await page.addStyleTag({ content: css });
          await page.evaluate((value) => { window.__scenario = value; }, scenario);
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          await page.getByRole("heading", { name: "会员列表", exact: true }).waitFor();
          await page.getByRole("button", { name: "充值", exact: true }).waitFor();
          await page.waitForFunction(() => window.__memberHarness.readStarted);
          assert.equal(await page.getByLabel("原结算恢复", { exact: true }).count(), 0);
          assert.equal(await page.getByRole("alert").count(), 0);
          await page.getByRole("button", { name: "充值", exact: true }).click();
          await page.getByText("会员充值", { exact: true }).waitFor();
          assert.equal(await page.getByLabel("原结算恢复", { exact: true }).count(), 0);
          assert.equal(await page.getByRole("button", { name: "确认", exact: true }).isEnabled(), true);
          await page.getByRole("button", { name: "关闭", exact: true }).click();
          if (scenario === "pending") await page.evaluate(() => window.__memberHarness.releaseRead());
          assert.equal(await page.getByLabel("原结算恢复", { exact: true }).count(), 0);
          if (process.env.FAOLLA_MEMBER_SCREENSHOT_DIR && scenario === "pending") {
            await fs.mkdir(process.env.FAOLLA_MEMBER_SCREENSHOT_DIR, { recursive: true });
            await page.screenshot({ path: path.join(process.env.FAOLLA_MEMBER_SCREENSHOT_DIR, `member-list-${width}.png`) });
          }
          await page.getByRole("button", { name: "兑换", exact: true }).click();
          await page.getByLabel("原结算恢复", { exact: true }).waitFor();
          if (scenario === "read-error") {
            await page.getByRole("alert").filter({ hasText: "暂时无法确认原结算结果" }).waitFor();
            assert.equal(await page.getByRole("button", { name: "确认", exact: true }).isDisabled(), true);
            await page.getByRole("button", { name: "关闭", exact: true }).click();
          } else {
            await page.getByLabel("原单待结算商品", { exact: true }).getByText(/原单商品 × 2/).waitFor();
            const before = await page.evaluate(() => window.__memberHarness.calls.filter((call) => call.method !== "GET"));
            assert.deepEqual(before, [], "browsing/recharge/opening redemption must never retry or acknowledge an original");
            await page.getByRole("button", { name: "核对/重试原结算", exact: true }).click();
            await page.getByLabel("服务器确认的原单金额", { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.__memberHarness.writes), 1);
            if (scenario === "deleted") await page.getByRole("dialog", { name: "兑换结算", exact: true }).waitFor();
            await page.getByRole("button", { name: "确认并开始下一单", exact: true }).click();
            await page.getByLabel("原结算恢复", { exact: true }).waitFor({ state: "detached" });
            const mutations = await page.evaluate(() => window.__memberHarness.calls.filter((call) => call.method !== "GET"));
            assert.deepEqual(mutations.map((call) => call.body), [
              { siteId: "10000000", operationId: "original-operation", action: "retry" },
              { siteId: "10000000", operationId: "original-operation", action: "ack" },
            ]);
            assert.equal(await page.evaluate(() => window.__memberHarness.writes), 1);
          }
          assert.equal(await page.getByLabel("原结算恢复", { exact: true }).count(), 0);
          assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
});
