import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const component=name=>readFileSync(new URL(`../src/components/enterprise/${name}.tsx`,import.meta.url),'utf8');

test('owner leave launcher resets by identity and explicit parent authorization epoch, not generic failure state',()=>{
  const source=component('MerchantAttendanceAdminPanel');
  assert(source.includes('<LeaveLauncher key={`${siteId}:${ownerId}:${state.authorizationEpoch}:${routingTarget?.family === "leave" ? routingTarget.requestId : "list"}`}'));
  const launcher=source.match(/<LeaveLauncher\b[\s\S]*?\/>/)?.[0];
  assert(launcher);
  assert(!/state\.phase|moduleEnabled|state\.result/.test(launcher));
  assert(source.includes('useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)'));
});

test('both employee child launchers reset together on explicit rejection without permanently gating independent histories',()=>{
  const source=component('MerchantAttendanceSelfPanel');
  for(const [name,prefix] of [['LeaveLauncher','leave'],['LeaveNotificationsLauncher','notifications']]){
    assert(source.includes(`<${name} key={\`${prefix}:\${siteId}:\${employeeId}:\${state.authorizationEpoch}\`}`));
    const launcher=source.match(new RegExp(`<${name}\\b[\\s\\S]*?\\/>`))?.[0];
    assert(launcher);
    assert(!/state\.phase|moduleEnabled|state\.result|canClock/.test(launcher));
  }
  assert(source.includes('useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)'));
});

test('reset child launchers start closed and require explicit user reopen, retaining their existing independent API clients',()=>{
  for(const name of ['MerchantAttendanceLeaveLauncher','MerchantAttendanceLeaveNotificationsLauncher']){
    const source=component(name);
    assert(source.includes(name === 'MerchantAttendanceLeaveLauncher'
      ? 'const [open, setOpen] = useState(!!props.initialSelection)'
      : 'const [open, setOpen] = useState(false)'));
    if (name === 'MerchantAttendanceLeaveLauncher') {
      assert.match(source,/initialSelection\?: ReviewRoutingRequest \| null/);
      assert.match(source,/onClose=\{\(\) => \{ setOpen\(false\); onTargetClose\?\.\(\); \}\}/);
    }
    assert(source.includes('onClick={() => setOpen(true)}'));
    assert(!/sessionStorage|localStorage|removeItem|clear\(/.test(source));
  }
});
