import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { withAttendanceConcurrencySandbox } from './merchant-attendance-concurrency-sandbox.mjs';
const require = createRequire(import.meta.url);
const { parseTerminalList, parseTerminalDevice } = require('../src/lib/merchantAttendanceTerminal.ts');
export const terminalLiteral = v => "'" + String(v).replaceAll("'", "''") + "'";
export const terminalJson = v => v === null ? 'null' : terminalLiteral(JSON.stringify(v)) + '::jsonb';
export async function checkAttendanceTerminals(native, browserCheck = null) {
  await withAttendanceConcurrencySandbox(native, async ({ schema, sql }) => {
    const { root, query, pass } = native, exec = source => query(sql(source));
    exec(readFileSync(path.join(root, 'scripts/supabase-migrations/202610010104_merchant_attendance_terminals.sql'), 'utf8'));
    const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const owner = id(99), outsider = id(98), location = id(301), site = '99990001', ph = 'a'.repeat(64), dh = 'b'.repeat(64);
    exec(`insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990002','${outsider}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid'),('99990002','UTC');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','合成前台','Europe/Madrid',true),('${id(302)}','99990002','Other','UTC',true);`);
    const queryInput = (terminalId = null, cursor = null) => ({ terminalId, cursor });
    const adminSql = (command = null, { auth = owner, allow = true, terminalId = null, cursor = null, merchant = site } = {}) =>
      `set role service_role; select public.faolla_attendance_terminal_admin_v1('${merchant}','${auth}',${terminalJson(queryInput(terminalId,cursor))},${terminalJson(command)},${allow});`;
    const deviceSql = (terminalId, { secret = ph, device = dh, allow = true, merchant = site } = {}) =>
      `set role service_role; select public.faolla_attendance_terminal_device_v1('${merchant}','${terminalId}','${secret}',${device === null ? 'null' : terminalLiteral(device)},${allow});`;
    const create = n => ({ action: 'create', terminalId: id(n), locationId: location, label: `合成终端 ${n}`, pairHash: ph });
    const read = (command = null, options = {}) => parseTerminalList(JSON.parse(exec(adminSql(command, options))), { siteId: options.merchant ?? site, cursor: options.cursor ?? null, terminalId: command?.terminalId ?? options.terminalId ?? null });
    const pair = (terminalId, options = {}) => parseTerminalDevice(JSON.parse(exec(deviceSql(terminalId, options))), { siteId: options.merchant ?? site, terminalId });
    const snapshot = () => exec(`select jsonb_build_object('terminals',(select jsonb_agg(t order by id) from public.merchant_attendance_terminals t),
      'audit',(select jsonb_agg(a order by terminal_id,action) from public.merchant_attendance_terminal_audit a),
      'events',(select count(*) from public.merchant_attendance_events));`);
    const deny = (source, error) => { const before = snapshot(); assert.throws(() => exec(source), new RegExp(error === '42501' ? 'permission denied|attendance_events_append_only' : error)); assert.equal(snapshot(), before); };
    assert.deepEqual(read().items, []);
    for (const role of ['anon','authenticated']) {
      deny(adminSql().replace('set role service_role', `set role ${role}`), '42501');
      deny(deviceSql(id(1)).replace('set role service_role', `set role ${role}`), '42501');
    }
    deny(adminSql(null,{auth:outsider}), 'attendance_access_denied');
    deny(adminSql({...create(1),locationId:id(302)}),'attendance_location_denied');
    deny(adminSql(create(1),{allow:false}),'attendance_platform_paused');
    pass('terminal admin uses current owner/tenant, defaults off admission; anonymous RPC denied');
    const original = read(create(1)).items[0]; assert.equal(original.state, 'pending');
    assert.deepEqual(read(create(1),{allow:false}).items[0],original);
    deny(adminSql({...create(1),label:'changed'}),'attendance_operation_conflict');
    assert.equal(exec('select count(*) from public.merchant_attendance_terminal_audit;'),'1');
    pass('exact owner creation retry is read-only, preserves five-minute expiry; changed intent denied');
    for (const options of [{secret:'c'.repeat(64)},{merchant:'99990002'},{allow:false},{device:ph}]) deny(deviceSql(id(1),options),'attendance_terminal_denied');
    const paired = pair(id(1)); assert.equal(paired.terminal.state,'active'); assert.equal(paired.clockEnabled,false); assert.equal(paired.attendanceEnabled,false);
    assert.deepEqual(pair(id(1),{secret:dh,device:null,allow:false}),paired);
    deny(deviceSql(id(1)), 'attendance_terminal_denied'); deny(deviceSql(id(1),{secret:ph,device:null}),'attendance_terminal_denied');
    assert(!JSON.stringify(paired).includes(ph)); assert(!JSON.stringify(paired).includes(dh));
    pass('one-use pairing produces attendance-only device metadata; neither pairing replay nor pair token as device credential works');
    const revoke = {action:'revoke',terminalId:id(1)};
    const revoked = read(revoke,{allow:false}); assert.equal(revoked.items[0].state,'revoked'); assert.deepEqual(read(revoke),revoked);
    deny(deviceSql(id(1),{secret:dh,device:null}),'attendance_terminal_denied');
    assert.equal(read(create(1)).items[0].state,'revoked');
    pass('revocation works while attendance paused, is idempotent and cannot be undone by creation/pairing retry');
    for (const statement of ['select * from public.merchant_attendance_terminals','select * from public.merchant_attendance_terminal_audit',
      'update public.merchant_attendance_terminals set revoked_at=null,revoked_by=null','delete from public.merchant_attendance_terminals'])
      deny(`set role service_role;${statement};`,'42501');
    deny("update public.merchant_attendance_terminal_audit set recorded_at=now();",'42501');
    deny('truncate public.merchant_attendance_terminal_audit;','42501');
    assert.equal(exec('begin;grant select on public.merchant_attendance_terminals to authenticated;set role authenticated;select count(*) from public.merchant_attendance_terminals;rollback;'),'0');
    pass('hash tables not readable/writable by API roles; audit immutable and RLS fail-closed');
    read(create(2));
    for (const change of [`update public.merchants set user_id='${outsider}' where id='${site}';`,
      `update public.merchant_attendance_locations set active=false where id='${location}';`,
      `update public.merchant_attendance_locations set time_zone='UTC' where id='${location}';`]) {
      deny('begin;'+change+deviceSql(id(2))+'rollback;','attendance_terminal_denied');
    }
    pass('pairing checks current owner, active location and original time zone under configuration locks');
    // Explicitly synthetic expired/future/active-expired fixtures, no waiting or clock changes.
    exec(`insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at,paired_at,device_hash,device_expires_at)
      values ('${site}','${id(20)}','${location}','expired','Europe/Madrid','${owner}',now()-interval '10 minutes','${ph}',now()-interval '5 minutes',null,null,null),
      ('${site}','${id(21)}','${location}','future','Europe/Madrid','${owner}',now()+interval '1 hour','${ph}',now()+interval '65 minutes',null,null,null),
      ('${site}','${id(22)}','${location}','device expired','Europe/Madrid','${owner}',now()-interval '721 hours','${ph}',now()-interval '721 hours'+interval '5 minutes',now()-interval '721 hours','${dh}',now()-interval '1 hour');`);
    deny(deviceSql(id(20)),'attendance_terminal_denied'); deny(deviceSql(id(21)),'attendance_terminal_denied');
    deny(deviceSql(id(22),{secret:dh,device:null}),'attendance_terminal_denied');
    assert.equal(read(null,{terminalId:id(20)}).items[0].state,'expired');
    pass('expired pair code, backward clock and expired device rejected without writes');
    // Two actual PG sessions: witness lock, then commit first transition.
    async function race(firstSql, secondSql, expectedError) {
      const a = native.connect(), b = native.connect();
      try {
        await a.step(sql('begin;'+firstSql));
        const second = b.step(sql(secondSql)).then(value=>({value}),error=>({error}));
        const deadline=Date.now()+2500; let witnessed=false;
        while(Date.now()<deadline) { if(query(`select count(*) from pg_stat_activity where application_name='${b.name}' and wait_event_type='Lock';`)==='1'){witnessed=true;break;} await new Promise(r=>setTimeout(r,15)); }
        assert(witnessed,'real terminal lock wait required'); await a.step('commit;');
        const r = await second; if(expectedError) assert.match(String(r.error),new RegExp(expectedError)); else assert.equal(r.error,undefined);
      } finally { await a.close(); await b.close(); }
    }
    read(create(3)); await race(deviceSql(id(3)),deviceSql(id(3)),'attendance_terminal_denied');
    assert.equal(exec(`select count(*) from public.merchant_attendance_terminal_audit where terminal_id='${id(3)}' and action='pair';`),'1');
    read(create(4)); await race(adminSql({action:'revoke',terminalId:id(4)}),deviceSql(id(4)),'attendance_terminal_denied');
    read(create(5)); await race(deviceSql(id(5)),adminSql({action:'revoke',terminalId:id(5)}));
    deny(deviceSql(id(5),{secret:dh,device:null}),'attendance_terminal_denied');
    pass('real concurrent pair/pair and pair/revoke races serialize; one activation, final revocation wins');
    // This is credential TTL, NOT a calendar month: session zone must not change it over DST.
    read(create(6));
    const dst = JSON.parse(exec(`set time zone 'Europe/Madrid';`+deviceSql(id(6)))); parseTerminalDevice(dst);
    assert.equal(Date.parse(dst.terminal.deviceExpiresAt)-Date.parse(dst.terminal.pairedAt),30*86400_000);
    pass('device expiry is exactly 720 hours even in a DST-changing database session');
    const quotaCreate={...create(600),locationId:id(302)};
    const activeQuota=`insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at,paired_at,device_hash,device_expires_at)
      select '99990002',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(302)}','active quota','UTC','${outsider}',now()-interval '2 hours','${ph}',now()-interval '115 minutes',now()-interval '2 hours','${dh}',now()+interval '718 hours' from generate_series(2000,2019) n;`;
    deny('begin;'+activeQuota+adminSql(quotaCreate,{merchant:'99990002',auth:outsider})+'rollback;','attendance_terminal_limit');
    const hourlyQuota=`insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at)
      select '99990002',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(302)}','hourly quota','UTC','${outsider}',now(),'${ph}',now()+interval '5 minutes' from generate_series(2100,2109) n;`;
    deny('begin;'+hourlyQuota+adminSql(quotaCreate,{merchant:'99990002',auth:outsider})+'rollback;','attendance_terminal_limit');
    pass('durable per-merchant active-device and hourly-create quotas each reject excess without partial rows');
    if (browserCheck) await browserCheck({...native,exec,sql,schema,id,owner,outsider,location,site,read,create,adminSql,deviceSql});
    exec(`insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at)
      select '${site}',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${location}','history '||n,'Europe/Madrid','${owner}',now()-interval '2 hours','${ph}',now()-interval '115 minutes' from generate_series(1000,1026) n;`);
    const page1=read(),page2=read(null,{cursor:page1.nextCursor}); assert.equal(page1.items.length,25);assert(page1.nextCursor);assert.equal(page2.nextCursor,null);
    assert.equal(new Set([...page1.items,...page2.items].map(i=>i.id)).size,page1.items.length+page2.items.length);
    assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
    pass('bounded keyset history has no duplicate entries; entire device workflow creates zero attendance punches');
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceTerminals);
