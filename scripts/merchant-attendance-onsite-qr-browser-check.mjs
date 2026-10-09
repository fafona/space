// Actual display/phone React + installed login SDK/auth parser + HTTP/service/SQL.
// Auth protocol and enterprise entitlement are synthetic; all traffic is intercepted.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import net from 'node:net';
import sharp from 'sharp';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {chromium} from 'playwright';
import {checkOnsiteQr} from './merchant-attendance-onsite-qr-native.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {buildOnsiteScanUrl}=require('../src/lib/merchantAttendanceOnsiteQrBrowser.ts');
const {executeOnsiteIssue,executeOnsiteClock}=require('../src/lib/merchantAttendanceOnsiteQr.server.ts');
const {handleOnsiteCode}=require('../src/app/api/merchant-enterprise/attendance/onsite-code/route-handler.ts');
const {handleOnsiteClock}=require('../src/app/api/merchant-enterprise/attendance/onsite-clock/route-handler.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
const {middleware}=require('../middleware.ts');
const {NextRequest}=require('next/server');
async function check(env){
  const {root,exec,id,site,terminalId,location,secret,service,issue,pass}=env;
  const actors=[4,5].map(n=>({id:id(n),email:`onsite-ui-${n}@example.test`}));
  for(const n of [4,5])exec(`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
    values('${id(100+n)}','${site}','${id(n)}','onsite-ui-${n}@example.test','扫码合成人员 ${n}','${id(30)}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
    values('${id(200+n)}','${site}','${id(100+n)}','QR-UI-${n}','扫码合成人员 ${n}','${location}',true);
    insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on) values('${id(400+n)}','${site}','${id(200+n)}','2020-01-01');`);
  const origin='https://www.faolla.com',local='http://127.0.0.1:3131',requests=[],errors=[],external=[];
  let browser,child,lose=true,moduleEnabled=true,holdPost=false,heldPost=null,holdLogin=false,heldLogin=null;
  const flagKeys=['FAOLLA_ATTENDANCE_TERMINALS_ENABLED','FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED'],savedFlags=new Map(flagKeys.map(key=>[key,process.env[key]]));
  const events=n=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(e) order by sequence),'[]'::jsonb) from public.merchant_attendance_events e where worker_id='${id(200+n)}';`));
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  try{
    for(const key of flagKeys)process.env[key]='1';
    child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--onsite-qr'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('onsite_harness_timeout')),20000);
      child.stdout.on('data',v=>{out+=v;if(out.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('onsite_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth(actors,null,async()=>{
      const newPage=async(label,terminal=false)=>{
        const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
        if(terminal)await ctx.addCookies([{name:TERMINAL_COOKIE,value:`${site}.${terminalId}.${secret}`,url:origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
        await ctx.route('**/*',async route=>{
          const r=route.request(),url=new URL(r.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
          assert(!url.searchParams.has('token')&&!url.search.includes('aq1.'),'qr_must_not_enter_http_url');
          if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/v1/')){
            if(!['/','/enterprise/attendance-scan','/enterprise/attendance-terminal/onsite','/harness.js','/harness.css'].includes(url.pathname))return route.abort();
            const response=await ctx.request.get(local+(['/harness.js','/harness.css'].includes(url.pathname)?url.pathname:'/'));
            if(['/harness.js','/harness.css'].includes(url.pathname))return route.fulfill({response});
            const security=await middleware(new NextRequest(r.url())),headers={...response.headers()};
            assert.equal(security.status,200);
            for(const name of ['permissions-policy','referrer-policy','x-frame-options'])headers[name]=security.headers.get(name);
            return route.fulfill({response,headers});
          }
          try{
            const headers=await r.allHeaders(),request=new Request(r.url(),{method:r.method(),headers,body:r.postData()??undefined});let response;
            if(url.pathname.startsWith('/auth/v1/')){
              if(holdLogin&&url.pathname.endsWith('/token')){holdLogin=false;await new Promise(resolve=>{heldLogin=resolve;});}
              response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,request));
            }
            else{
              const code=url.pathname.endsWith('/onsite-code');assert(code||url.pathname.endsWith('/onsite-clock'));
              const d={enabled:()=>true,allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}})};
              if(!code&&r.method()==='POST'&&holdPost){holdPost=false;await new Promise(resolve=>{heldPost=resolve;});}
              response=code?await handleOnsiteCode(request,{...d,execute:i=>executeOnsiteIssue(i,service)}):await handleOnsiteClock(request,{...d,execute:i=>executeOnsiteClock(i,service)});
              requests.push({label,kind:code?'issue':'clock',method:r.method(),status:response.status});
              if(!code&&r.method()==='POST'&&response.status===200&&lose){lose=false;return route.abort('connectionfailed');}
              if(!code)assert.equal(headers.cookie,undefined,'employee_uses_explicit_token_not_terminal_cookie');
            }
            await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
          }catch(e){errors.push(String(e));await route.abort();}
        });
        const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));
        return {ctx,page};
      };
      const shared=await newPage('display',true),display=shared.page;
      await display.goto(origin+'/enterprise/attendance-terminal/onsite');const qr=display.getByRole('img',{name:'门店动态现场码，请用本人手机扫描后登录并选择打卡动作'});await qr.waitFor();
      const image=await qr.getAttribute('src'),raw=await sharp(Buffer.from(image.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const link=jsQR(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height)?.data;assert(link?.startsWith(origin+'/enterprise/attendance-scan?siteId='+site+'#qr=aq1.'));
      assert.equal(raw.info.width,512);assert.equal(requests.filter(r=>r.kind==='issue').length,1);assert.equal(events(4).length,0);
      assert.equal(await display.evaluate(()=>Object.keys(sessionStorage).length+Object.keys(localStorage).length),0);
      assert.equal(await display.evaluate(()=>document.featurePolicy.allowsFeature('camera')),false);
      assert(await display.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await display.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await qr.waitFor({state:'detached'});
      const hiddenCalls=requests.length;await display.waitForTimeout(1100);assert.equal(requests.length,hiddenCalls);
      pass('actual 512px terminal QR decodes to canonical phone fragment URL; display writes no storage/events and hidden tab erases QR without new requests');

      const personal=await newPage('phone'),phone=personal.page;await phone.goto(link);
      await phone.getByRole('heading',{name:'先登录本人员工账号'}).waitFor();assert(!phone.url().includes('#'));assert.equal(events(4).length,0);
      assert.equal(await phone.evaluate(()=>document.featurePolicy.allowsFeature('camera')),true);
      assert.equal(requests.filter(r=>r.label==='phone').length,0);
      await phone.getByLabel('员工邮箱',{exact:true}).fill(actors[0].email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
      await phone.getByRole('button',{name:'登录后核对打卡',exact:true}).click();await phone.getByRole('region',{name:'当前登录员工'}).getByText('本人账号：'+actors[0].email,{exact:true}).waitFor();
      const confirmation=phone.getByRole('region',{name:'本人现场打卡确认'});
      await confirmation.getByText('当前：未上班',{exact:true}).waitFor();
      const paste=async(page,target)=>{const detail=page.getByText('无法使用摄像头？粘贴现场码链接',{exact:true});
        if(!await page.getByLabel('现场码链接',{exact:true}).isVisible())await detail.click();
        await page.getByLabel('现场码链接',{exact:true}).fill(target);await page.getByRole('button',{name:'读取现场码（不打卡）',exact:true}).click();};
      await paste(phone,buildOnsiteScanUrl(origin,(await issue()).token));
      await confirmation.getByRole('button',{name:'确认上班',exact:true}).click();
      await confirmation.getByRole('status').filter({hasText:'原操作编号'}).waitFor();
      assert.equal(events(4).length,1);
      const intents=await phone.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('faolla:attendance:onsite-clock:')));
      assert.equal(intents.length,1);assert(!intents[0][1].includes('aq1.'));assert(!intents[0][1].includes('Synthetic-attendance'));
      const pending=JSON.parse(intents[0][1]);assert.equal(events(4)[0].operation_id,pending.command.operationId);
      const posts=requests.filter(r=>r.kind==='clock'&&r.method==='POST').length;
      await phone.reload();await confirmation.getByRole('status').filter({hasText:'打卡已由服务器确认'}).waitFor();
      assert.equal(events(4).length,1);assert.equal(requests.filter(r=>r.kind==='clock'&&r.method==='POST').length,posts);
      assert.equal(await phone.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('faolla:attendance:onsite-clock:')).length),0);
      pass('real phone login form/SDK and auth resolver reach original handler/SQL; POST response loss survives reload by GET-only original receipt with no QR/password in pending storage');

      const next=buildOnsiteScanUrl(origin,(await issue()).token);await paste(phone,next);
      await phone.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      await confirmation.getByText('未持有可用现场码；可重新扫码，查询原结果无需扫码。',{exact:true}).waitFor();
      assert(await confirmation.getByRole('button',{name:'确认下班',exact:true}).isDisabled());
      await phone.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      const beforeRescan=requests.length,rescan=buildOnsiteScanUrl(origin,(await issue()).token);
      await phone.evaluate(target=>{window.location.hash=new URL(target).hash;},rescan);
      await confirmation.getByText(/当前现场码剩余约/).waitFor();
      await phone.waitForFunction(()=>!location.hash);assert.equal(requests.length,beforeRescan);assert.equal(events(4).length,1);
      assert(await confirmation.getByRole('button',{name:'确认下班',exact:true}).isEnabled());
      await paste(phone,rescan.replace(site,'99990002'));
      await confirmation.getByText('未持有可用现场码；可重新扫码，查询原结果无需扫码。',{exact:true}).waitFor();
      assert(await confirmation.getByRole('button',{name:'确认下班',exact:true}).isDisabled());
      assert.equal(requests.length,beforeRescan);
      await phone.evaluate(target=>{window.location.hash=new URL(target).hash;},rescan);
      await confirmation.getByText(/当前现场码剩余约/).waitFor();await phone.waitForFunction(()=>!location.hash);
      await phone.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      await confirmation.getByText('未持有可用现场码；可重新扫码，查询原结果无需扫码。',{exact:true}).waitFor();
      assert(await confirmation.getByRole('button',{name:'确认下班',exact:true}).isDisabled());
      pass('same-document rescan scrubs fresh fragment with no request; rejected later scan and pagehide both clear the previous capability');
      const beforeCamera=requests.length;await phone.evaluate(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new DOMException('Synthetic denial','NotAllowedError');}}});});
      await phone.getByRole('button',{name:'打开摄像头扫码',exact:true}).click();await phone.getByText('无法使用摄像头或未获授权。可用手机相机扫码，或粘贴刚读取的现场码链接。',{exact:true}).waitFor();
      assert.equal(requests.length,beforeCamera);assert.equal(events(4).length,1);
      await paste(phone,next.replace(site,'99990002'));assert(await confirmation.getByRole('button',{name:'确认下班',exact:true}).isDisabled());
      pass('hiding phone clears capability and disables action; camera denial offers manual fallback without requests and foreign/malformed links cannot authorize a punch');

      const cameraUrl=buildOnsiteScanUrl(origin,(await issue()).token),cameraImage=await QRCode.toDataURL(cameraUrl,{width:512,margin:4,errorCorrectionLevel:'M'});
      await phone.evaluate(async image=>{
        const img=new Image();img.src=image;await img.decode();const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;canvas.getContext('2d').drawImage(img,0,0);
        const stream=canvas.captureStream(10);window.__onsiteSyntheticStream=stream;
        Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>stream}});
      },cameraImage);
      await phone.getByRole('button',{name:'打开摄像头扫码',exact:true}).click();await phone.getByText('已读取二维码，摄像头已停止。尚未打卡。',{exact:true}).waitFor();
      assert(await phone.evaluate(()=>window.__onsiteSyntheticStream.getTracks().every(t=>t.readyState==='ended')));
      assert.equal(events(4).length,1);assert.equal(await confirmation.getByRole('button',{name:'确认下班',exact:true}).isEnabled(),true);
      moduleEnabled=false;await confirmation.getByRole('button',{name:'只读核对当前状态／原操作',exact:true}).click();await confirmation.getByText('暂停新上班／休息；仍可按当前权限核对结果、结束已有休息或下班。',{exact:true}).waitFor();
      assert(await confirmation.getByRole('button',{name:'确认开始休息',exact:true}).isDisabled());
      await confirmation.getByRole('button',{name:'确认下班',exact:true}).click();await confirmation.getByText('当前：未上班',{exact:true}).waitFor();assert.equal(events(4).length,2);moduleEnabled=true;
      pass('actual local jsQR camera pipeline decodes a synthetic video frame and stops tracks; scan never submits, explicit authorized finish works during platform admission pause');

      await phone.getByRole('button',{name:'退出／更换账号',exact:true}).click();await phone.getByRole('heading',{name:'先登录本人员工账号'}).waitFor();
      assert.equal(await confirmation.count(),0);
      // Camera permission may resolve after login disabled the scanner and the
      // page became hidden. It must stop, never resume on busy=false by itself.
      await phone.evaluate(()=>{
        window.__onsiteCameraCalls=0;
        Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{window.__onsiteCameraCalls++;return new Promise(resolve=>{window.__onsiteResolveCamera=resolve;});}}});
      });
      await phone.getByRole('button',{name:'打开摄像头扫码',exact:true}).click();await phone.waitForFunction(()=>window.__onsiteCameraCalls===1);
      holdLogin=true;
      await phone.getByLabel('员工邮箱',{exact:true}).fill(actors[1].email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await phone.getByRole('button',{name:'登录后核对打卡',exact:true}).click();
      for(let n=0;n<40&&!heldLogin;n++)await phone.waitForTimeout(20);assert(heldLogin);
      await phone.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      heldLogin();heldLogin=null;
      await confirmation.getByText('当前：未上班',{exact:true}).waitFor();assert.equal(await confirmation.getByText(/原操作收据/).count(),0);assert.equal(events(5).length,0);
      await phone.getByRole('button',{name:'打开摄像头扫码',exact:true}).waitFor();
      await phone.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;window.__onsiteLateStream=canvas.captureStream(1);window.__onsiteResolveCamera(window.__onsiteLateStream);});
      await phone.waitForFunction(()=>window.__onsiteLateStream.getTracks().every(t=>t.readyState==='ended'));
      assert.equal(await phone.evaluate(()=>window.__onsiteCameraCalls),1);
      await phone.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      await phone.waitForTimeout(300);assert.equal(await phone.evaluate(()=>window.__onsiteCameraCalls),1);
      pass('camera disabled during login never restarts while hidden or on return; permission completing late stops every track without a second camera request');
      await paste(phone,buildOnsiteScanUrl(origin,(await issue()).token));
      exec(`update public.merchant_enterprise_employees set status='disabled' where id='${id(105)}';`);
      await confirmation.getByRole('button',{name:'确认上班',exact:true}).click();await confirmation.getByRole('status').filter({hasText:/权限|身份|访问/}).waitFor();
      assert.equal(events(5).length,0);assert.equal(await confirmation.getByText('当前：未上班',{exact:true}).count(),0);
      exec(`update public.merchant_enterprise_employees set status='active' where id='${id(105)}';`);
      assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      pass('account replacement discards previous visible state and codes; revocation before action preflight denies without a new event; phone layout fits 390px');

      // A POST paused before handler execution models cancellation after intent,
      // not a failed-write assumption. Keep original command for explicit retry.
      await confirmation.getByRole('button',{name:'只读核对当前状态／原操作',exact:true}).click();await confirmation.getByText('当前：未上班',{exact:true}).waitFor();
      await paste(phone,buildOnsiteScanUrl(origin,(await issue()).token));holdPost=true;
      await confirmation.getByRole('button',{name:'确认上班',exact:true}).click();
      for(let n=0;n<30&&!heldPost;n++)await phone.waitForTimeout(20);assert(heldPost);
      const rawIntent=await phone.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('faolla:attendance:onsite-clock:')));assert.equal(rawIntent.length,1);
      // Let it complete then navigate: original intent must be recoverable either way.
      heldPost();heldPost=null;await confirmation.getByRole('status').filter({hasText:'打卡已由服务器确认'}).waitFor();
      assert.equal(events(5).length,1);assert.equal(events(5)[0].operation_id,JSON.parse(rawIntent[0][1]).command.operationId);
      pass('intent is persisted before network POST and remains bound to current account/company and original operation');

      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      await personal.ctx.close();await shared.ctx.close();
      console.log(JSON.stringify({onsiteQrBrowser:true,productionAccess:false,realAuth:false,authSdkAndResolver:true,syntheticCamera:true,phoneRealDevice:false,artifacts:false}));
    });
  }catch(e){console.error(JSON.stringify({requests,errors,external}));throw e;}
  finally{if(heldPost)heldPost();if(heldLogin)heldLogin();await browser?.close();if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
    for(const [key,value] of savedFlags){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkOnsiteQr(native,check));
