import assert from "node:assert/strict";
import test from "node:test";
import { correctionTimeInput, parseCorrectionTimeInput, correctionDraftFromBasis, correctionDraftProposal, correctionTimeOffsets, correctionTimeControlValue } from "./merchantAttendanceCorrectionForm";
import { correctionBasis, correctionId } from "../../scripts/fixtures/attendance-correction-model";
test("local time editor preserves six microseconds without browser timezone assumptions", () => {
  for (const zone of ["UTC", "Europe/Madrid", "Asia/Shanghai", "Asia/Kathmandu", "Pacific/Chatham", "America/St_Johns"]) {
    const utc = "2026-09-28T12:45:33.123456Z"; assert.equal(parseCorrectionTimeInput(correctionTimeInput(utc, zone), zone), utc);
  }
});
test("native control display uses milliseconds without mutating untouched microsecond values",()=>{
  for(const value of ["2026-09-28T12:45:33.123456Z","2026-09-28T12:45:33.000001Z"]){
    const input=correctionTimeInput(value,"Europe/Madrid"),saved=structuredClone(input);
    assert.equal(correctionTimeControlValue(input.local),input.local.slice(0,23));assert.deepEqual(input,saved);
    assert.equal(parseCorrectionTimeInput(input,"Europe/Madrid"),value);
    assert.match(parseCorrectionTimeInput({...input,local:correctionTimeControlValue(input.local)},"Europe/Madrid"),/\d{3}000Z$/);
  }
  assert.equal(correctionTimeControlValue(""),"");assert.equal(correctionTimeControlValue("2026-09-28T12:45"),"2026-09-28T12:45");
});
test("Madrid autumn repeated wall time requires explicit offset and resolves both occurrences", () => {
  const local = "2026-10-25T02:30:00.000001";
  assert.equal(parseCorrectionTimeInput({ local, offset: "+02:00" }, "Europe/Madrid"), "2026-10-25T00:30:00.000001Z");
  assert.equal(parseCorrectionTimeInput({ local, offset: "+01:00" }, "Europe/Madrid"), "2026-10-25T01:30:00.000001Z");
});
test("spring gap, wrong seasonal offset, invalid date and incomplete time are refused", () => {
  for (const value of [{ local: "2026-03-29T02:30", offset: "+01:00" }, { local: "2026-03-29T02:30", offset: "+02:00" },
    { local: "2026-07-01T12:00", offset: "+01:00" }, { local: "2026-02-30T12:00", offset: "+01:00" },
    { local: "2026-09-28T24:00", offset: "+02:00" }, { local: "", offset: "+02:00" }, { local: "2026-09-28T12:00", offset: "2" }])
    assert.throws(() => parseCorrectionTimeInput(value, "Europe/Madrid"));
});
test("minute and fractional second input normalize only explicitly supplied times", () => {
  assert.equal(parseCorrectionTimeInput({ local: "2026-09-28T14:35", offset: "+02:00" }, "Europe/Madrid"), "2026-09-28T12:35:00.000000Z");
  assert.equal(parseCorrectionTimeInput({ local: "2026-09-28T14:35:01.5", offset: "+02:00" }, "Europe/Madrid"), "2026-09-28T12:35:01.500000Z");
});
test("completed draft defaults to exact raw facts, never current time", () => {
  const basis = correctionBasis(), saved = structuredClone(basis), draft = correctionDraftFromBasis(basis);
  const result = correctionDraftProposal(draft, "Europe/Madrid");
  assert.equal(result.startAt, basis.events[0].occurredAt); assert.equal(result.endAt, basis.events[1].occurredAt); assert.deepEqual(basis, saved);
});
test("open session has no guessed end and open break is kept incomplete rather than silently discarded", () => {
  const b = correctionBasis(); const basis = { ...b, events: [{ ...b.events[0] }, { ...b.events[0], sequence: 2, id: correctionId(12), action: "break_start" as const, breakPaid: true, occurredAt: "2026-09-28T10:00:00.000000Z" }] };
  const draft = correctionDraftFromBasis(basis); assert.equal(draft.end.local, ""); assert.equal(draft.breaks[0].end.local, ""); assert.equal(draft.breaks[0].paid, true);
  assert.throws(() => correctionDraftProposal(draft, "Europe/Madrid"));
});
test("cross-midnight and DST changes compute real elapsed time, preserve ordered pauses", () => {
  const draft = { start: { local: "2026-10-25T01:00", offset: "+02:00" }, end: { local: "2026-10-25T04:00", offset: "+01:00" }, breaks: [] };
  const p = correctionDraftProposal(draft, "Europe/Madrid"); assert.equal(Date.parse(p.endAt) - Date.parse(p.startAt), 4 * 3600000);
});
test("offset choices distinguish normal, duplicated and nonexistent local times", () => {
  assert.deepEqual(correctionTimeOffsets("2026-09-28T12:00", "Europe/Madrid"), ["+02:00"]);
  assert.deepEqual(correctionTimeOffsets("2026-10-25T02:30", "Europe/Madrid"), ["+01:00", "+02:00"]);
  assert.deepEqual(correctionTimeOffsets("2026-03-29T02:30", "Europe/Madrid"), []);
  assert.deepEqual(correctionTimeOffsets("2026-09-28T12:00", "Asia/Kathmandu"), ["+05:45"]);
  assert.deepEqual(correctionTimeOffsets("", "UTC"), []);
});
test("offset choices handle half-hour DST folds and a whole skipped date without silent normalization", () => {
  assert.deepEqual(correctionTimeOffsets("2026-04-05T01:45", "Australia/Lord_Howe"), ["+10:30", "+11:00"]);
  assert.deepEqual(correctionTimeOffsets("2011-12-30T12:00", "Pacific/Apia"), []);
});
