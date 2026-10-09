import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const launcher=read('src/components/enterprise/MerchantAttendanceShiftTemplatesLauncher.tsx');
const panel=read('src/components/enterprise/MerchantAttendanceShiftTemplatesPanel.tsx');
const schedule=read('src/components/enterprise/MerchantAttendanceSchedulePanel.tsx');

test('template library is lazy, owner/site keyed, default-off and inert when the flag is off',()=>{
  assert.match(launcher,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED === "1"/);
  assert.match(launcher,/if \(!enabled\) return null/);
  assert.match(launcher,/lazy\(\(\) => import\("\.\/MerchantAttendanceShiftTemplatesPanel"\)\)/);
  assert.match(launcher,/key=\{`\$\{props\.siteId\}:\$\{props\.ownerId\}`\}/);
  assert.match(launcher,/>班次模板库<\/button>/);
  assert.doesNotMatch(launcher,/disabled=\{props\.(?:applyDisabled|writeDisabled)\}/);
  assert.doesNotMatch(launcher,/AttendanceShiftTemplatesClient|client\.|initialize\(|load\(/);
});

test('opening is request-free and every lifecycle exit clears UI through pause while preserving client-owned pending recovery',()=>{
  const effects=panel.slice(panel.indexOf('useEffect(() =>'),panel.indexOf('const allowReplace'));
  for(const event of ['visibilitychange','pagehide','beforeunload'])assert(effects.includes(event));
  assert.match(effects,/clearDraft\(\); client\.pause\(\)/);
  assert.match(effects,/return \(\) => \{ hide\(\)/);
  assert.doesNotMatch(effects,/client\.(?:initialize|load|next|save|archive|retry)\(/);
  assert.match(panel,/const initialize = async \(\) => \{/);
  assert.match(panel,/await client\.initialize\(\)/);
  assert.match(panel,/onClick=\{\(\) => void initialize\(\)\}>读取模板／查原收据/);
  assert.match(panel,/state\.pending && <button/);
  assert.match(panel,/disabled=\{state\.phase !== "unconfirmed"\}/);
  assert.match(panel,/>用原编号明确重试<\/button>/);
  assert.match(panel,/待确认操作编号保留在当前账号与企业的会话存储中/);
  assert.doesNotMatch(panel+launcher,/setInterval|localStorage|sendBeacon|geolocation|method:\s*["'](?:GET|POST|PUT|PATCH|DELETE)|\/api\/merchant-enterprise/);
});

test('library uses non-nested controls, bounded exact template fields and honest template-day preview',()=>{
  assert.doesNotMatch(panel,/<form\b/);
  for(const text of ['班次模板库','关闭模板库','读取模板／查原收据','查看在用模板','查看已归档模板','下一页模板',
    '新建模板','编辑模板','复制模板','保存模板','归档模板','预览模板日','带入排班草稿'])assert(panel.includes(text)||launcher.includes(text));
  assert.match(panel,/aria-label="模板名称"[^>]+maxLength=\{80\}/);
  assert.match(panel,/draft\.segments\.length >= 4/);
  assert.match(panel,/parseShiftTemplate\(draft\)/);
  assert.match(panel,/templateDaySlots\(template\)/);
  assert.match(panel,/templateNominalMinutes\(template\)/);
  assert.doesNotMatch(panel,/\brequired\b/);
  for(const text of ['不含日期、人员、时区、每周选项或发布理由','不会发布排班','不会生成打卡、缺勤、工时或工资','非实际时长／非工资','夏令时'])assert(panel.includes(text));
  assert.doesNotMatch(panel,/weekdays|setWeekdays|setRepeat|resolveScheduleWallSlots|AttendanceScheduleClient|type="date"/);
});

test('input Enter cannot submit the containing legacy publish form while native button and select keyboard behavior stays intact',()=>{
  const handler=panel.slice(panel.indexOf('onKeyDown={event =>'),panel.indexOf('}>\n    <header'));
  assert.match(handler,/event\.key === "Enter"/);
  assert.match(handler,/event\.target instanceof HTMLInputElement/);
  assert.match(handler,/event\.preventDefault\(\)/);
  assert.doesNotMatch(handler,/stopPropagation|HTMLButtonElement|HTMLSelectElement|event\.currentTarget/);
  assert.match(launcher,/onDirty\?: \(\) => void/);
  assert.match(panel,/setDirty\(true\); onDirty\?\.\(\)/);
  assert.match(schedule,/onDirty=\{onDirty\} onApply=/);
});

test('read, apply and template-write permissions remain separately bounded',()=>{
  assert.match(panel,/const locked = busy \|\| !!state\.pending/);
  assert.match(panel,/const canApply = !applyDisabled && !locked && state\.phase === "ready" && !!result\?\.moduleEnabled/);
  assert.match(panel,/const canWrite = !writeDisabled && !locked && state\.phase === "ready" && !!result\?\.moduleEnabled/);
  assert.match(panel,/disabled=\{busy\} onClick=\{\(\) => void initialize\(\)\}>读取模板／查原收据/);
  assert.match(panel,/selected && !selected\.archived && <button/);
  assert.match(panel,/disabled=\{!canApply \|\| dirty\} onClick=\{\(\) => apply\(selected\)\}/);
  assert.match(panel,/>带入排班草稿<\/button>/);
  assert.equal((panel.match(/>带入排班草稿<\/button>/g)??[]).length,1);
  assert.match(panel,/!item\.archived && <button[^\n]+onClick=\{\(\) => void archive\(item\)\}>归档模板/);
  assert.match(panel,/if \(!canApply \|\| dirty \|\| item\.archived \|\| !window\.confirm/);
  assert.match(panel,/<fieldset disabled=\{!canWrite\}/);
  assert.match(panel,/if \(!canWrite \|\| dirty \|\| item\.archived/);
  assert.match(panel,/模板操作结果仍待确认。关闭不会撤销操作/);
  assert.match(panel,/当前模板草稿尚未保存，关闭后会丢失/);
  const applyButton=panel.indexOf('onClick={() => apply(selected)}');
  const writeFieldset=panel.indexOf('<fieldset disabled={!canWrite}');
  assert(applyButton>0&&writeFieldset>applyButton,'apply must not inherit the template-write fieldset');
});

test('optional apply changes only old unsaved segments and keeps legacy weekly, DST and 32-slot publication path intact',()=>{
  assert.match(schedule,/MerchantAttendanceShiftTemplatesLauncher/);
  assert.match(schedule,/<PublishForm[^>]+siteId=\{siteId\} ownerId=\{actorId\} apiFetch=\{apiFetch\}/);
  assert.match(schedule,/applyDisabled=\{disabled\} writeDisabled=\{!r\.moduleEnabled\}/);
  const publish=schedule.slice(schedule.indexOf('function PublishForm'),schedule.indexOf('function CancelForm'));
  assert(publish.indexOf('<MerchantAttendanceShiftTemplatesLauncher')<publish.indexOf('<fieldset disabled={disabled}'),'launcher must remain in the old form but outside its disabled fieldset');
  const applyStart=schedule.indexOf('onApply={template =>');
  assert.notEqual(applyStart,-1);
  const applyEnd=schedule.indexOf('/>',applyStart);
  const apply=schedule.slice(applyStart,applyEnd);
  assert.match(apply,/setSegments\(template\.segments\.map\(segment => \(\{ start: segment\.start, end: segment\.end, next: segment\.nextDay \}\)\)\)/);
  assert.match(apply,/changed\(\)/);
  assert.doesNotMatch(apply,/setRepeat|setWeekdays|setReason|onSubmit|client\./);
  for(const legacy of ['按每周重复展开当前范围','setWeekdays','result.length > 32','resolveScheduleWallSlots(rows, zone)','correctionTimeOffsets'])assert(schedule.includes(legacy));
});
