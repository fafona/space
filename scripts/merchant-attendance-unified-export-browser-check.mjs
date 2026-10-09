import assert from 'node:assert/strict';
import {checkUnifiedExport} from './merchant-attendance-unified-export-native.mjs';
import {browserCheck} from './merchant-attendance-unified-report-browser-check.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
const exportChecks=async({page,panel,open,requests,controls,exec,id,pass})=>{
  const section=()=>page.getByRole('region',{name:'含整段申报的受控导出'}),posts=()=>requests.filter(r=>r.method==='POST');let downloads=0;
  page.on('download',()=>{downloads++;});
  const download=async()=>{
    assert.equal(await section().getByRole('button').isEnabled(),false);const before=posts().length;
    await section().getByRole('checkbox').check();const waiting=page.waitForEvent('download');await section().getByRole('button').click();const file=await waiting;
    try{
      assert.match(file.suggestedFilename(),/^attendance-unified-99990001-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-[a-f0-9-]+\.csv$/);
      const stream=await file.createReadStream();assert(stream);const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;assert(size<=4*1024*1024);chunks.push(chunk);}
      const text=Buffer.concat(chunks).toString('utf8');assert(text.startsWith('\ufeff"记录类型",'));assert(text.endsWith('\r\n'));assert.equal(posts().length,before+1);
      await section().getByRole('status').filter({hasText:'请在下载记录确认保存'}).waitFor();assert.equal(await section().getByRole('checkbox').isChecked(),false);return text;
    }finally{await file.delete();}
  };
  const total=text=>{const line=text.split('\r\n').find(row=>row.startsWith('"汇总","selected",'));assert(line);return [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1])[13];};
  await open('owner');const owner=await download();assert.equal(total(owner),'61200000000');assert(owner.includes('整段申报完整'));assert(owner.includes('missing-approved'));
  pass('actual owner page creates a real browser CSV download with combined 17h and separate missing approval sources; temporary download deleted');
  await open('a');assert.equal(total(await download()),'61200000000');await open('b');const other=await download();assert.equal(total(other),'0');assert(!other.includes(id(401)));
  pass('actual employee CSV contains only own authorized sources; other employee export is empty metadata/zero summary without first employee identities');
  await page.setViewportSize({width:390,height:844});await open('manager');assert.equal(total(await download()),'61200000000');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
  pass('authorized manager downloads identical combined scope on 390px layout while platform writes remain paused');
  await open('owner');controls.dropExportResponse=true;let before=downloads;const beforePosts=posts().length;
  await section().getByRole('checkbox').check();await section().getByRole('button').click();await section().getByRole('status').filter({hasText:'结果未确认'}).waitFor();assert.equal(downloads,before);assert.equal(posts().length,beforePosts+1);
  assert.equal(await section().getByRole('checkbox').isChecked(),false);assert.equal(await section().getByRole('button').isEnabled(),false);
  pass('dropping a committed export response leaves an explicit uncertain result, unchecked confirmation and no automatic second request/download');
  await open('manager');exec(`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.reports.export') where id='${id(31)}';`);before=downloads;
  try{
    await section().getByRole('checkbox').check();await section().getByRole('button').click();await page.getByRole('status').filter({hasText:'已清除工时资料'}).waitFor();
    assert.equal(downloads,before);assert.equal(await panel().count(),0);assert.equal(await page.getByRole('article',{name:'可见工时查询结果'}).count(),0);
  }finally{exec(`update public.merchant_enterprise_roles set permissions=array_append(permissions,'attendance.reports.export') where id='${id(31)}';`);}
  pass('revoking actual export permission between viewing and generation rejects download and hides protected parent and combined results');
  assert.equal(downloads,4);assert.equal(posts().length,6);
};
runAttendanceLabelsReuse(process.argv.slice(2),native=>checkUnifiedExport(native,env=>browserCheck(env,{exportEnabled:true,exportChecks}))).catch(e=>{console.error(e);process.exitCode=1;});
