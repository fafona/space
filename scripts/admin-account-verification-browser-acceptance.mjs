// Real UI/client helper with synthetic data only; never opens a person's session.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const account={accountType:'merchant',accountId:'10909096',authUserId:'10000000-0000-4000-8000-000000000001',email:'pending@example.invalid',emailConfirmed:false,emailVerificationKnown:true};
const script=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState,useRef}from'react';import{createRoot}from'react-dom/client';
 import{AccountEmailVerificationStatus,VerifyAccountEmailButton}from'./src/components/admin/AccountEmailVerification';
 import{confirmSuperAdminAccountEmail}from'./src/lib/superAdminAccountEmailVerificationClient';
 function Fixture(){const[a,setAccount]=useState(${JSON.stringify(account)}),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function verify(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await confirmSuperAdminAccountEmail(a,{confirm:m=>window.confirm(m),request:fetch});if(result)setAccount({...a,...result.verification});}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
 return <main className="p-4"><h1>账号管理</h1><section className="mt-4 flex flex-wrap items-start gap-2 rounded border p-4"><span>未建站</span><AccountEmailVerificationStatus account={a}/><VerifyAccountEmailButton account={a} busy={busy} onVerify={verify}/></section><p role="status">{error}</p></main>}
 createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',logLevel:'silent'})).outputFiles[0].text;
const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/admin/AccountEmailVerification.tsx";', {from:path.resolve('account-verification-acceptance.css')})).css;

test('manual account verification is confirmable, non-duplicating, recoverable and responsive',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),requests=[],errors=[],unexpected=[],pending=[];
  let requestStart;
  const nextRequest=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('synthetic request did not start: '+JSON.stringify({requests,errors,unexpected}))),7000);requestStart=()=>{clearTimeout(timer);resolve();};});
  page.setDefaultTimeout(7000);
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const r=route.request(),url=new URL(r.url());
   if(url.origin!=='https://account-verification-audit.invalid'){unexpected.push(r.url());return route.abort();}
   if(r.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.pathname==='/api/super-admin/merchant-accounts'&&r.method()==='POST'){
    requests.push(r.postDataJSON());const completion=new Promise(resolve=>pending.push(resolve));requestStart();
    const result=await completion;return route.fulfill({status:result.status,json:result.body});
   }
   unexpected.push(r.url());return route.abort();
  });
  try{
   await page.goto('https://account-verification-audit.invalid/');await page.addStyleTag({content:css});await page.addScriptTag({content:script});
   const button=page.getByRole('button',{name:'验证账号',exact:true});await button.waitFor();
   await page.getByText('未验证',{exact:true}).waitFor();await page.getByText('未建站',{exact:true}).waitFor();
   page.once('dialog',d=>d.dismiss());await button.click();await button.waitFor();assert.equal(requests.length,0);
   let started=nextRequest();page.once('dialog',d=>{assert(d.message().includes(account.email));return d.accept();});await button.click();await started;
   assert.equal(await page.getByRole('button',{name:'验证处理中…',exact:true}).isDisabled(),true);
   pending.shift()({status:503,body:{message:'暂时无法确认验证结果，请刷新账号状态'}});
   await page.getByRole('status').filter({hasText:'暂时无法确认验证结果'}).waitFor();await button.waitFor();
   assert.equal(await page.getByText('已验证',{exact:true}).count(),0);
   started=nextRequest();page.once('dialog',d=>d.accept());await button.click();await started;
   pending.shift()({status:200,body:{verification:{...account,emailConfirmed:true,emailConfirmedAt:'2026-11-12T15:00:00Z'},alreadyVerified:false}});
   await page.getByText('已验证',{exact:true}).waitFor();assert.equal(await button.count(),0);
   assert.equal(requests.length,2);for(const body of requests)assert.deepEqual(body,{action:'verify_email',authUserId:account.authUserId,accountId:account.accountId,accountType:account.accountType,email:account.email,confirmed:true});
   assert.equal(await page.locator('input,form').count(),0,'no user OTP or password collected by the admin action');
   assert.equal(await page.getByText('未建站',{exact:true}).count(),1,'verification does not pretend a site was created');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  }finally{for(const complete of pending)complete({status:503,body:{}});await context.close();}
 }}finally{await browser.close();}
});
