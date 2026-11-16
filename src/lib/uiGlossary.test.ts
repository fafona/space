import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGE_OPTIONS } from "./i18n";
import { findUiGlossarySource, getUiGlossaryLocale, getUiGlossaryText, UI_GLOSSARY_TRANSLATIONS } from "./uiGlossary";

test("glossary reverse lookup preserves source order, overrides and locale fallbacks", () => {
  assert.equal(getUiGlossaryText("先生", "es-ES"), "Sr.");
  assert.equal(findUiGlossarySource("Sr.", "es-ES"), "先生");
  assert.equal(findUiGlossarySource("Señor", "es-ES"), null, "an overridden base value is not a second alias");
  assert.equal(getUiGlossaryText("保存", "zh-CN"), "保存");
  assert.equal(findUiGlossarySource("not a glossary entry", "es-ES"), null);
  assert.equal(getUiGlossaryText("not a glossary entry", "es-ES"), "not a glossary entry");
  const sources = Object.keys(UI_GLOSSARY_TRANSLATIONS);
  for (const { code } of LANGUAGE_OPTIONS) {
    if (getUiGlossaryLocale(code) === "zh-cn") continue;
    const first = new Map<string, string>();
    for (const source of sources) {
      const text = getUiGlossaryText(source, code);
      if (text !== source && !first.has(text)) first.set(text, source);
    }
    for (const [text, source] of first) assert.equal(findUiGlossarySource(text, code), source, `${code}: ${text}`);
  }
});

test("warm reverse misses and hits do not rescan the full glossary per DOM node", () => {
  const source = "保存", locale = "fr-FR", text = getUiGlossaryText(source, locale);
  assert.equal(findUiGlossarySource(text, locale), source);
  const keys = Object.keys;
  let wholeGlossaryEnumerations = 0;
  Object.keys = ((value: object) => {
    if (value === UI_GLOSSARY_TRANSLATIONS) wholeGlossaryEnumerations++;
    return keys(value);
  }) as typeof Object.keys;
  try {
    for (let i = 0; i < 200; i++) {
      assert.equal(findUiGlossarySource("unknown public website phrase " + i, locale), null);
      assert.equal(findUiGlossarySource(text, locale), source);
    }
  } finally { Object.keys = keys; }
  assert.equal(wholeGlossaryEnumerations, 0, "DOM updates must use the reusable reverse index, including misses");
});
