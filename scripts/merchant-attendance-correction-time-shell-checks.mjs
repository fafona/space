// DOM-only draft checks inside the actual employee correction workspace.
// Historic/future DST examples below are NEVER submitted. A valid preview is
// not evidence of server policy, employment, overlap or approval acceptance.
import assert from 'node:assert/strict';

function localMilliseconds(instant,zone) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
  const part=name=>parts.find(item=>item.type===name).value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.${instant.slice(20,23)}`;
}
function normalizedControl(value) {
  assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/);
  return new Date(value+'Z').toISOString().slice(0,23);
}
const sixDigits=instant=>instant.slice(0,23)+'000Z';

export async function fillLocalMilliseconds(locator,value) {
  // Playwright requires the string to match the native input's normalized
  // value exactly (.430 becomes .43, and :00.000 may disappear). Normalize
  // through a detached control, then prove this did not change the wall time.
  const canonical=await locator.evaluate((input,wallTime)=>{
    const probe=document.createElement('input');probe.type=input.type;probe.step=input.step;probe.value=wallTime;return probe.value;
  },value);
  assert.equal(normalizedControl(canonical),normalizedControl(value));
  await locator.fill(canonical);
}

export async function checkAttendanceCorrectionTimeShell({employee,prepared,requests,pass,reprepare}) {
  assert.equal(prepared.mode,'prepare');assert.equal(prepared.canRequest,true);assert.equal(typeof reprepare,'function');
  const original=structuredClone(prepared.basis.events),first=original[0],last=original.at(-1),zone=first.timeZone;
  assert.equal(zone,'Europe/Madrid');assert.equal(first.action,'clock_in');assert.equal(last.action,'clock_out');
  for(const event of original)assert.match(event.occurredAt,/\.\d{6}Z$/);
  const startRequest=requests.length;
  const panel=()=>employee.getByRole('region',{name:'本人考勤补正申请',exact:true});
  const editor=()=>panel().locator('form[data-correction-dirty]');
  const start=()=>panel().getByLabel('申请上班时间',{exact:true});
  const end=()=>panel().getByLabel('申请下班时间',{exact:true});
  const startOffset=()=>panel().getByRole('combobox',{name:'申请上班时间 UTC 时差',exact:true});
  const reason=()=>panel().getByRole('textbox',{name:/^申请理由/});
  const ack=()=>panel().getByRole('checkbox',{name:/^我已核对全部时间与休息/});
  const submit=()=>panel().getByRole('button',{name:'明确提交补正申请',exact:true});
  const preview=()=>panel().getByRole('region',{name:'声明差异试算',exact:true});
  const pendingKey=`faolla:attendance:correction:v1:${prepared.siteId}:${prepared.employeeId}`;
  const noWrite=async()=>{
    assert.equal(requests.slice(startRequest).filter(row=>row.method==='POST').length,0,'time_draft_must_not_post');
    assert.equal(await employee.evaluate(key=>sessionStorage.getItem(key),pendingKey),null,'time_draft_must_not_create_pending_operation');
  };
  const utcPreview=async(from,to)=>{
    await preview().waitFor();const disclosure=preview().locator('details');
    if(!await disclosure.evaluate(element=>element.open))await disclosure.locator('summary').click();
    await disclosure.getByText(`${from} → ${to}`,{exact:true}).waitFor({state:'visible'});
    await preview().getByText(/未经审批的声明/).waitFor({state:'visible'});await noWrite();
  };
  const invalid=async()=>{
    await reason().fill('合成时间草稿校验，不提交');await ack().check();
    await editor().getByRole('status').filter({hasText:'未生成有效试算'}).waitFor();
    assert.equal(await preview().count(),0);assert.equal(await submit().isDisabled(),true);await noWrite();
  };
  const reset=async()=>{
    const value=await reprepare();assert.equal(value.mode,'prepare');assert.equal(value.employeeId,prepared.employeeId);assert.equal(value.workerId,prepared.workerId);
    assert.equal(value.revision,prepared.revision);assert.equal(value.pendingRequestId,null);assert.deepEqual(value.basis.events,original,'time_draft_changed_original_basis');
    await panel().locator('form[data-correction-dirty="false"]').waitFor();assert.equal(await reason().inputValue(),'');assert.equal(await ack().isChecked(),false);assert.equal(await submit().isDisabled(),true);
    assert.equal(normalizedControl(await start().inputValue()),localMilliseconds(first.occurredAt,zone));assert.equal(normalizedControl(await end().inputValue()),localMilliseconds(last.occurredAt,zone));
    assert.equal(await panel().getByRole('button',{name:'移除这段声明休息',exact:true}).count(),original.filter(event=>event.action==='break_start').length);
    await utcPreview(first.occurredAt,last.occurredAt);return value;
  };

  await utcPreview(first.occurredAt,last.occurredAt);
  assert.equal(await start().getAttribute('step'),'0.001');assert.equal(await end().getAttribute('step'),'0.001');
  assert.equal(normalizedControl(await start().inputValue()),localMilliseconds(first.occurredAt,zone));
  assert.equal(normalizedControl(await end().inputValue()),localMilliseconds(last.occurredAt,zone));
  // self_v1 deliberately date_truncs ordinary web facts to milliseconds. This
  // real browser sample therefore proves editing and unchanged-time retention,
  // NOT nonzero sub-millisecond precision. The latter remains covered only by
  // merchantAttendanceCorrectionForm.test.ts; never fabricate ledger evidence.
  assert(original.every(event=>event.source==='web'&&/\.\d{3}000Z$/.test(event.occurredAt)),
    'time_editor_expected_real_millisecond_web_basis');
  const edited=new Date(Date.parse(first.occurredAt)-1).toISOString();await fillLocalMilliseconds(start(),localMilliseconds(edited,zone));
  await utcPreview(sixDigits(edited),last.occurredAt);
  assert.equal(await ack().isChecked(),false);
  await start().fill('');await invalid();assert.equal(await startOffset().inputValue(),'');
  // Restore a real local start, then put the end strictly before it. These
  // values remain draft-only; no server request is used to test invalid input.
  await fillLocalMilliseconds(start(),localMilliseconds(first.occurredAt,zone));
  await fillLocalMilliseconds(end(),localMilliseconds(new Date(Date.parse(first.occurredAt)-1000).toISOString(),zone));await invalid();
  await reset();
  pass('real correction Editor draft only: millisecond web samples (.xxx000) support a one-millisecond edit while the untouched original end remains exact in visible UTC preview; missing/reversed times stay invalid even with reason/ack, zero POST and clean reprepare; nonzero microseconds are unit-only evidence');

  // Remove only the draft's original-date breaks so they cannot be an unrelated
  // cause of invalidity in the independent spring/fall wall-time examples.
  const remove=panel().getByRole('button',{name:'移除这段声明休息',exact:true});
  while(await remove.count())await remove.first().click();
  await end().fill('2026-03-29T03:30:00.456');await start().fill('2026-03-29T02:30:00.123');await invalid();
  assert.equal(await startOffset().inputValue(),'');assert.deepEqual(await startOffset().locator('option').evaluateAll(options=>options.map(option=>option.value)),['']);

  await end().fill('2026-10-25T03:30:00.456');await start().fill('2026-10-25T02:30:00.123');await invalid();
  assert.equal(await startOffset().inputValue(),'');assert.deepEqual(await startOffset().locator('option').evaluateAll(options=>options.map(option=>option.value)),['','+01:00','+02:00']);
  await startOffset().getByRole('option',{name:'重复时刻，请选择',exact:true}).waitFor({state:'attached'});
  await startOffset().selectOption('+02:00');assert.equal(await ack().isChecked(),false);
  await utcPreview('2026-10-25T00:30:00.123000Z','2026-10-25T02:30:00.456000Z');assert.equal(await submit().isDisabled(),true);
  await ack().check();await startOffset().selectOption('+01:00');assert.equal(await ack().isChecked(),false);
  await utcPreview('2026-10-25T01:30:00.123000Z','2026-10-25T02:30:00.456000Z');assert.equal(await submit().isDisabled(),true);
  const restored=await reset();await noWrite();assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('Madrid DST draft UI only: spring 02:30 has no valid offset; autumn 02:30 requires an explicit choice and previews the two distinct UTC instants while clearing ack; never submitted or claimed server-admissible, then original times/breaks/reason/ack restored');
  return restored;
}
