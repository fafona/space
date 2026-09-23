// Optional isolated DB verification; never connects to the configured Supabase.
// Set FAOLLA_PGLITE_MODULE to a local PGlite ESM URL if not installed in this repo.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.FAOLLA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const migration = async (name) => db.exec(await readFile(new URL('./supabase-migrations/' + name, import.meta.url),'utf8'));
const first = '202609230049_account_traffic_analytics.sql';
const second = '202609230050_account_traffic_rollup_retention.sql';
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table faolla_schema_migrations(version bigint primary key,name text);
    create table page_events(event_type text,channel text,page_path text,created_at timestamptz default now());
    grant select on page_events to service_role;`);
  await migration(first);
  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device)
    select '10000000',md5('a'||i)::uuid,'card','card-'||(i%55),'Card '||(i%55),'view','direct_unknown','wechat','mobile' from generate_series(1,2500) i;
    insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device)
    select '20000000',md5('b'||i)::uuid,'website','home','Other merchant','view','google','chrome','desktop' from generate_series(1,1300) i;
    insert into page_events(event_type,channel) select 'page_view','site:10000000:page-1' from generate_series(1,2500);`);
  const report = async (site='10000000',days=30,offset=0,module=null,object=null) =>
    (await db.query('select faolla_account_traffic_report($1,$2,$3,$4,$5) as r',[site,days,offset,module,object])).rows[0].r;
  const legacy = await report();
  await migration(second);
  await migration(second);
  const summary = await report();
  for (const key of ['views','exposures','actions','totalEvents','objectCount','daily','modules','sources','browsers','devices']) assert.deepEqual(summary[key],legacy[key],key);
  assert.equal(summary.views,2500);
  assert.equal(summary.objects.length,50);
  assert.equal((await report('10000000',30,50)).objects.length,5);
  assert.equal((await report('20000000')).views,1300);
  console.log('PASS rollup backfill, migration replay, >1000 rows, exact totals, tenant isolation and object pagination');
  await db.exec(`insert into account_traffic_events select * from account_traffic_events on conflict(site_id,event_id) do nothing;`);
  assert.equal((await report()).views,2500);
  assert.equal(Number((await db.query('select sum(event_count) as n from account_traffic_daily')).rows[0].n),3800);
  console.log('PASS duplicate ingestion never fires an extra rollup increment');

  await db.exec(`set role service_role;
    insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device)
    values('10000000','11111111-0000-4000-8000-000000000001','card','card-1','Renamed card','website_click','google','chrome','desktop');
    reset role;`);
  const card = await report('10000000',30,0,'card','card-1');
  assert.equal(card.objectCount,1);assert.equal(card.actions,1);assert.equal(card.objects[0].label,'Renamed card');
  assert.equal(card.sources.reduce((n,r)=>n+r.count,0),card.views);
  console.log('PASS service-role atomic trigger, per-card source drilldown, rename identity and click/view separation');

  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device)
    values('10000000','22222222-0000-4000-8000-000000000001','coupon','coupon-block','Coupon','claim_attempt','direct_unknown','other','mobile'),
    ('10000000','22222222-0000-4000-8000-000000000002','poll','poll-block/poll-1','Poll','submit_attempt','direct_unknown','other','mobile'),
    ('10000000','22222222-0000-4000-8000-000000000003','membership','membership-entry','Member','join_attempt','direct_unknown','other','mobile');`);
  for(const moduleName of ['coupon','poll','membership']) assert.equal((await report('10000000',30,0,moduleName)).actions,1);
  assert.equal((await report('30000000')).views,0);
  console.log('PASS new module enums and empty reports');
  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device)
    values('10000000','22222222-0000-4000-8000-000000000004','poll','poll-block/poll-1','Poll','exposure','google','chrome','mobile');`);
  const poll = await report('10000000',30,0,'poll');
  assert.equal(poll.views,0);assert.equal(poll.exposures,1);assert.equal(poll.actions,1);
  assert.deepEqual(poll.sources,[{key:'google',count:1}]);
  console.log('PASS exposure-only modules retain sources without counting submit attempts as views');
  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device,medium,created_at)
    select '40000000',md5('medium'||i)::uuid,'card','channel-card','Channels','view','google','wechat','mobile',
      case when i<=2 then 'qr' else 'share' end,now()-interval '120 days' from generate_series(1,3) i;`);
  const mediaReport = await report('40000000',730);
  assert.deepEqual(mediaReport.media,[{key:'qr',count:2},{key:'share',count:1}]);
  assert.deepEqual(mediaReport.sources,[{key:'google',count:3}]);
  assert.deepEqual(mediaReport.browsers,[{key:'wechat',count:3}]);
  await assert.rejects(db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device,medium)
    values('40000000',md5('badmedium')::uuid,'card','channel-card','Channels','view','google','wechat','mobile','private-value')`),/check constraint/);
  console.log('PASS channel media remain independent of referrer/browser and reject arbitrary labels');

  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device,created_at)
    select '10000000',md5('old'||i)::uuid,'card','old-card','Old card','view','direct_unknown','other','desktop',now()-interval '120 days' from generate_series(1,9) i;
    insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device,created_at)
    select '10000000',md5('ancient'||i)::uuid,'card','ancient-card','Ancient card','view','direct_unknown','other','desktop',now()-interval '26 months' from generate_series(1,3) i;`);
  const retention = async (apply=false,batch=5000) => (await db.query('select faolla_account_traffic_retention($1,$2) as r',[apply,batch])).rows[0].r;
  const beforeRetention = await report('10000000',730);
  const preview = await retention();
  assert.equal(preview.expiredRaw,15);assert.equal(preview.removedRaw,0);
  assert.equal((await report('10000000',730)).views,beforeRetention.views);
  const batch = await retention(true,2);
  assert.equal(batch.removedRaw,2);assert.equal(batch.removedDaily,0);
  const applied = await retention(true,20);
  assert.equal(applied.removedRaw,13);assert.equal(applied.removedDaily,1);
  assert.deepEqual((await report('40000000',730)).media,mediaReport.media);
  assert.equal((await report('10000000',730)).views,beforeRetention.views);
  assert.equal((await report('10000000',730,0,'card','old-card')).views,9);
  assert.equal((await db.query("select count(*) as n from account_traffic_events where object_id='old-card'")).rows[0].n,0);
  assert.equal((await db.query('select count(*) as n from page_events')).rows[0].n,2500);
  assert.equal((await retention(true)).removedRaw,0);
  await assert.rejects(retention(true,0),/invalid_retention_options/);
  console.log('PASS preview leaves data intact; bounded pruning retains 2-year reports, protects young raw data, and never touches legacy data');

  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device,created_at)
    values('10000000','33333333-0000-4000-8000-000000000001','card','guard-card','Guard','view','direct_unknown','other','desktop',now()-interval '100 days');
    delete from account_traffic_daily where object_id='guard-card';`);
  const blocked = await retention(true);
  assert.equal(blocked.blockedMissingRollups,1);assert.equal(blocked.removedRaw,0);
  console.log('PASS absent rollup fails closed before raw deletion');

  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    await assert.rejects(db.query('select * from account_traffic_daily'),/permission denied/);
    await assert.rejects(report(),/permission denied/);
    await assert.rejects(retention(true),/permission denied/);
    await db.exec('reset role');
  }
  const dst = (await db.query(`select extract(epoch from (('2026-03-30'::timestamp at time zone 'Europe/Madrid')-('2026-03-29'::timestamp at time zone 'Europe/Madrid')))/3600 as spring,
    extract(epoch from (('2026-10-26'::timestamp at time zone 'Europe/Madrid')-('2026-10-25'::timestamp at time zone 'Europe/Madrid')))/3600 as autumn`)).rows[0];
  assert.equal(Number(dst.spring),23);assert.equal(Number(dst.autumn),25);
  console.log('PASS private aggregates/retention ACL and Madrid DST calendar boundaries');
  await migration('202609230051_account_traffic_outcomes_campaigns_export.sql');
  await migration('202609230051_account_traffic_outcomes_campaigns_export.sql');
  const full = async(site='10000000')=>(await db.query('select faolla_account_traffic_report_full($1,730,null,null) as r',[site])).rows[0].r;
  assert.equal((await full()).exportScope,'all');
  assert.equal((await full()).objects.length,(await full()).objectCount);
  assert.ok((await full()).objectCount>50);
  await db.exec(`insert into account_traffic_events(site_id,event_id,module,object_id,object_label,action,source,browser,device,medium,campaign_id,campaign_label)
    values('40000000','44444444-0000-5000-8000-000000000001','order','order-block','Orders','order_created','direct_unknown','chrome','desktop','qr','40000000-0000-4000-8000-000000000001','Store poster'),
    ('40000000','44444444-0000-4000-8000-000000000002','card','card-campaign','Card','view','google','chrome','desktop','qr','40000000-0000-4000-8000-000000000001','Store poster');
    insert into account_traffic_events select * from account_traffic_events where site_id='40000000' on conflict(site_id,event_id) do nothing;`);
  const outcomes=await full('40000000');
  assert.deepEqual(outcomes.outcomes,[{key:'order_created',count:1}]);assert.equal(outcomes.actions,0);
  assert.equal(outcomes.campaigns.length,1);assert.equal(outcomes.campaigns[0].successes,1);assert.equal(outcomes.campaigns[0].views,1);
  assert.equal(outcomes.objects.find(r=>r.module==='order').successes,1);
  for(const role of ['anon','authenticated']) {await db.exec('set role '+role);await assert.rejects(full(),/permission denied/);await db.exec('reset role');}
  console.log('PASS full export is unpaginated, campaign/confirmed outcomes stay separate and deduplicated, new RPC remains private');
} finally { await db.close(); }
