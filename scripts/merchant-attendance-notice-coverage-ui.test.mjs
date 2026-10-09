import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const panel=read('src/components/enterprise/MerchantAttendanceNoticeCoveragePanel.tsx');
const client=read('src/lib/merchantAttendanceNoticeCoverageClient.ts');
const parent=read('src/components/enterprise/MerchantAttendanceLocationNoticePanel.tsx');

test('coverage is an independent lazy owner-only default-off child, remounted on every notice/config fence',()=>{
  assert.match(parent,/lazy\(\(\) => import\("\.\/MerchantAttendanceNoticeCoveragePanel"\)\)/);
  assert.match(parent,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_NOTICE_COVERAGE_ENABLED === "1" && access === "owner" && r/);
  assert.match(parent,/<Coverage key=\{`\$\{r\.current\?\.revision \?\? 0\}:\$\{r\.settingsVersion\}:\$\{r\.location\.version\}`\}/);
  assert.match(parent,/ownerId=\{actorId\}/);
});

test('read-only UI explicitly queries and replaces pages without persistence, mutations or automatic initialization',()=>{
  assert.match(panel,/onClick=\{\(\) => void client\.loadFirst\(\)\}/);
  assert.match(panel,/onClick=\{\(\) => void client\.loadNext\(\)\}/);
  assert.match(panel,/disabled=\{busy \|\| !result\?\.nextCursor\}/);
  assert.match(client,/method: "GET"/);
  assert.doesNotMatch(panel+client,/localStorage|sessionStorage|setInterval|geolocation|method:\s*["'](?:POST|PATCH|PUT|DELETE)|navigator\.sendBeacon/);
  const effect=panel.slice(panel.indexOf('useEffect(() =>'),panel.indexOf('return <section'));
  assert.doesNotMatch(effect,/loadFirst|loadNext|fetch\(/);
  for(const event of ['visibilitychange','pagehide'])assert.match(effect,new RegExp(event));
  assert.match(effect,/return \(\) => \{ hide\(\)/);
  assert.match(client,/this\.generation\+\+; this\.controller\?\.abort\(\)/);
  assert.match(client,/if \(generation !== this\.generation\) return/g);
});

test('coverage labels separate live eligibility and acknowledgement from delivery, consent and operational readiness',()=>{
  for(const copy of ['不是送达率、已读率、同意定位或打卡资格证明','实时统计','固定历史快照'])assert((panel+client).includes(copy));
  for(const copy of ['下方仅统计这一历史发布版本','不表示当前可新增确认','未发布或已撤回时不计算本版确认人数','不等于未送达'])assert(panel.includes(copy));
  assert.match(panel,/result\.counts\.confirmed \?\? "—"/);assert.match(panel,/result\.counts\.pending \?\? "—"/);
  assert.match(panel,/result\.observedAt/);assert.match(panel,/COVERAGE_PAGE_SIZE/);
  assert.doesNotMatch(panel,/dangerouslySetInnerHTML/);
});
