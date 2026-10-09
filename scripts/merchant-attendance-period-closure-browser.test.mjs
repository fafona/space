import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {cleanupPeriodClosureResources,parsePeriodClosureCsv,assertPeriodClosureSavedRows} from './fixtures/attendance-period-closure-browser.mjs';

test('period cleanup executes the real helper object steps, never the legacy mistaken label/tuples shape',async()=>{
  const calls=[];await cleanupPeriodClosureResources([{name:'context',run:()=>calls.push('context')},{name:'browser',run:async()=>{calls.push('browser');}},{name:'HTTP',run:()=>calls.push('HTTP')}]);
  assert.deepEqual(calls,['context','browser','HTTP']);
  await assert.rejects(cleanupPeriodClosureResources('label'),/period_browser_cleanup_shape/);
  await assert.rejects(cleanupPeriodClosureResources([['browser',()=>calls.push('must-not-run')]]),/period_browser_cleanup_shape/);
  assert.deepEqual(calls,['context','browser','HTTP']);
});
test('failed and deadline-expired cleanup does not skip later resources or discard the primary browser failure',async()=>{
  const calls=[],primary=Error('actual browser assertion failure');let failure;
  try{await cleanupPeriodClosureResources([{name:'context',run:()=>{throw Error('context failed');}},{name:'hung',timeoutMs:5,run:()=>new Promise(()=>{})},{name:'HTTP',run:()=>calls.push('HTTP')},{name:'esbuild',run:()=>calls.push('esbuild')}],primary);}catch(error){failure=error;}
  assert.deepEqual(calls,['HTTP','esbuild']);assert(failure instanceof AggregateError);assert.equal(failure.cause,primary);assert.equal(failure.errors[0],primary);
  assert(failure.errors[1] instanceof AggregateError);assert.equal(failure.errors[1].errors.length,2);assert.match(failure.errors[1].errors[0].cause.message,/context failed/);assert.match(failure.errors[1].errors[1].cause.message,/cleanup_timeout:hung/);
});
test('both actual browser finally calls use named object arrays and pass the existing failure; bundling is inside cleanup scope',async()=>{
  const code=await readFile(new URL('./fixtures/attendance-period-closure-browser.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('browser.mjs',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),calls=[];
  const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='cleanupPeriodClosureResources')calls.push(node);ts.forEachChild(node,visit);};visit(ast);
  assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.arguments.length,2);assert.equal(call.arguments[1].getText(ast),'failure');const steps=call.arguments[0];assert(ts.isArrayLiteralExpression(steps));
    for(const step of steps.elements){assert(ts.isObjectLiteralExpression(step));const names=step.properties.map(p=>p.name?.getText(ast));assert(names.includes('name'));assert(names.includes('run'));}}
  assert.match(code,/try\{\s+files=await assets\(\)/);assert.doesNotMatch(code,/runAttendanceCleanupSteps\(['"]/);
});
const artifact=()=>({period:{startAt:'2026-09-01T00:00:00.000000Z',endAt:'2026-09-02T00:00:00.000000Z',timeZone:'UTC',fromDate:'2026-09-01',throughDate:'2026-09-01'},calculationVersion:'timesheet-v2-unified-v1',sourceFingerprint:'a'.repeat(64),
  source:{label:'literal "quote", comma\nnew line',workerId:'worker',context:{pendingCorrections:[],missing:[],leave:[],calendar:[],plans:{items:[],sessions:[]},reviews:[]}},report:{missing:[]}});
function rowsFor(a){const row=(...v)=>Array.from({length:11},(_,n)=>v[n]===undefined?'':String(v[n]));return [row('记录类型','编号／日期','保存版本'),
  row('周期','period',1,'fixed',a.period.startAt,a.period.endAt,'','','','',a.calculationVersion),row('来源指纹',a.sourceFingerprint,1,a.period.timeZone,a.period.fromDate,a.period.throughDate),
  ...Object.entries(a.source.context).map(([key,value])=>row('保存上下文完整证据',key,1,key,'','','','','','',JSON.stringify(value))),
  ...Object.entries(a.source).filter(([key])=>key!=='context').map(([key,value])=>row('保存来源完整字段',key,1,'saved','','','','','','',JSON.stringify(value)))];}
const encode=rows=>'\ufeff'+rows.map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
test('real CSV parser preserves embedded delimiters/quotes/newlines, and valid zero-missing complete source passes',()=>{
  const a=artifact(),rows=rowsFor(a),csv=encode(rows);assert.deepEqual(parsePeriodClosureCsv(csv),rows);assertPeriodClosureSavedRows(parsePeriodClosureCsv(csv),a,'period',1);assertPeriodClosureSavedRows(rows,a,'period',1);
  const quoted=[['literal, comma','quote " escaped','line one\r\nline two']];assert.deepEqual(parsePeriodClosureCsv(encode(quoted)),quoted);
  assert.throws(()=>parsePeriodClosureCsv('"unclosed'),/unterminated/);assert.throws(()=>parsePeriodClosureCsv('notquoted\r\n'),/quoted_cell/);
});
test('equal empty-array categories cannot substitute for missing, duplicate or mislabelled saved context rows',()=>{
  const a=artifact();for(const mutate of [rows=>rows.filter(r=>r[3]!=='leave'),rows=>{const missing=rows.find(r=>r[3]==='missing');rows[rows.findIndex(r=>r[3]==='leave')]=[...missing];return rows;},
    rows=>{rows.find(r=>r[3]==='calendar')[3]='unknown';return rows;},rows=>{rows.find(r=>r[3]==='reviews')[10]='[{}]';return rows;}])assert.throws(()=>assertPeriodClosureSavedRows(mutate(rowsFor(a)),a,'period',1),/period_output_context|period_output_unique/);
});
test('print/CSV row checks bind version, fingerprint and each root source key/value rather than unrelated text',()=>{
  const a=artifact();for(const mutate of [rows=>{rows[1][2]='3';},rows=>{rows[2][1]='b'.repeat(64);},rows=>{rows.find(r=>r[0]==='保存来源完整字段'&&r[1]==='workerId')[10]='"other"';},
    rows=>{rows.find(r=>r[0]==='保存来源完整字段'&&r[1]==='workerId')[1]='label';}]){const rows=rowsFor(a);mutate(rows);assert.throws(()=>assertPeriodClosureSavedRows(rows,a,'period',1));}
});
test('actual date guard changes a different civil day and dialog rejection is handled',async()=>{
  const code=await readFile(new URL('./fixtures/attendance-period-closure-browser.mjs',import.meta.url),'utf8');assert.match(code,/assert\.notEqual\(otherDay,query\.fromDate\)/);assert.match(code,/\.fill\(otherDay\)/);assert.match(code,/period_dialog_failed/);
  assert.match(code,/assertPeriodClosureSavedRows\(printed\.rows,firstVersion\.data\.artifact,pid,1\)/);assert.doesNotMatch(code,/csv\.includes|printed\.includes/);
});
