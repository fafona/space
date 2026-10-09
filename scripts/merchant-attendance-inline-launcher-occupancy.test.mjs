import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const name of ["Schedule", "Terminal", "Leave", "Calendar", "Groups"]) {
  const source = readFileSync(new URL(`../src/components/enterprise/MerchantAttendance${name}Launcher.tsx`, import.meta.url), "utf8");
  test(`${name} reports committed open state, unregisters on unmount, and keeps the callback out of its writer`, () => {
    assert.match(source, /onOpenChange\?: \(open: boolean\) => void/);
    assert.match(source, name === "Leave" ? /function Launcher\(\{ onOpenChange, onTargetClose, \.\.\.props \}/ : /function Launcher\(\{ onOpenChange, \.\.\.props \}/);
    assert.match(source, /useLayoutEffect\(\(\) => \{ onOpenChange\?\.\(open\); return \(\) => onOpenChange\?\.\(false\); \}, \[onOpenChange, open\]\)/);
    assert.match(source, name === "Leave" ? /const \[open, setOpen\] = useState\(!!props.initialSelection\)/ : /const \[open, setOpen\] = useState\(false\)/);
    assert.match(source, name === "Leave" ? /<Panel \{\.\.\.props\} onClose=\{\(\) => \{ setOpen\(false\); onTargetClose\?\.\(\); \}\}/ : /<Panel \{\.\.\.props\} onClose=\{\(\) => setOpen\(false\)\}/);
    assert.match(source, /onClick=\{\(\) => setOpen\(true\)\}/);
    assert.doesNotMatch(source, /apiFetch\(|\.submit\(|\.retry\(|sessionStorage|localStorage/);
  });
}
