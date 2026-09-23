import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/traffic-card-v1.js',import.meta.url),'utf8');
function run(search,privacy=false) {
  const handlers={}, timers=[], sent=[];
  const window={addEventListener:()=>{}}; window.top=window;
  runInNewContext(source, {window,navigator:{globalPrivacyControl:privacy},crypto:{randomUUID:()=> 'test-event'},
    document:{currentScript:{getAttribute:()=> 'signed-card-token'},referrer:'https://google.es/?q=PRIVATE',visibilityState:'visible',addEventListener:(name,fn)=>{handlers[name]=fn;}},
    location:{hostname:'faolla.com',search}, URL,URLSearchParams,AbortSignal,Element:class {},
    setTimeout:(fn)=>{timers.push(fn);return 1;}, clearTimeout:()=>{},
    fetch:async(_url,init)=>{sent.push(JSON.parse(init.body));return {};},
  });
  for(const fn of timers) fn();
  return sent;
}
test('standalone card script sends only bounded medium and independent referral',()=>{
  const events=run('?faolla_medium=qr&email=PRIVATE')[0].events;
  assert.deepEqual(events,[{id:'test-event',token:'signed-card-token',action:'view',source:'google',medium:'qr'}]);
  assert.equal(JSON.stringify(events).includes('PRIVATE'),false);
  assert.equal(run('?faolla_medium=qr&faolla_medium=share')[0].events[0].medium,'unknown');
  assert.equal(run('?source=scan')[0].events[0].medium,'unknown');
  assert.deepEqual(run('?faolla_medium=qr',true),[]);
});
