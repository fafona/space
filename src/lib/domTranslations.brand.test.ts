import test, { after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ensureDomTranslations, hasTranslatableText, isDomTranslationCached, reverseTranslateDomText, translateDomText } from "./domTranslations";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), previousFetch = globalThis.fetch;
const storage = new Map([["merchant-space:dom-i18n-cache:v4:zh-CN", JSON.stringify({ Faolla: "积极的", FAOLLA: "积极的", "Welcome to Faolla": "欢迎来到积极的" })], ["merchant-space:dom-i18n-cache:v4:es-ES", JSON.stringify({ Faolla: "积极的", "正常标题": "Título existente" })]]);
Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) } } });
const requests: string[] = [];
globalThis.fetch = async input => {
  const url = new URL(String(input)), source = url.searchParams.get("q") || ""; requests.push(source);
  const translated = source === "Welcome to" ? "欢迎来到" : source === "and" ? "y" : source === "关于" ? "About" : /faolla/i.test(source) ? "积极的" : source;
  return Response.json([[[translated, source]]]);
};
after(async () => { await delay(340); globalThis.fetch = previousFetch; if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); });

test("Faolla spelling and casing remain authored even with a previously poisoned translation cache", async () => {
  for (const locale of ["zh-CN", "es-ES", "fr-FR", "de-DE"]) for (const brand of ["Faolla", "FAOLLA", "faolla", "FaOlLa", " \nFaolla  "]) {
    assert.equal(translateDomText(brand, locale), brand);assert.equal(hasTranslatableText(brand, locale), false);assert.equal(isDomTranslationCached(brand, locale), true);
    await ensureDomTranslations([brand], locale);
  }
  assert.deepEqual(requests, []);
  assert.equal(translateDomText("正常标题", "es-ES"), "Título existente");
  assert.equal(reverseTranslateDomText("积极的", "es-ES"), null, "a real adjective must not be rewritten as the brand by an old bad reverse cache");
});
test("mixed sentences translate only surrounding text and never send the brand to translation", async () => {
  await ensureDomTranslations(["Welcome to Faolla"], "zh-CN");assert.equal(translateDomText("Welcome to Faolla", "zh-CN"), "欢迎来到 Faolla");
  await ensureDomTranslations(["Faolla and FAOLLA"], "es-ES");assert.equal(translateDomText("Faolla and FAOLLA", "es-ES"), "Faolla y FAOLLA");
  await ensureDomTranslations(["关于 Faolla"], "en-GB");assert.equal(translateDomText("关于 Faolla", "en-GB"), "About Faolla");
  assert.equal(isDomTranslationCached("Welcome to Faolla", "zh-CN"), true);assert.ok(requests.every(source => !/faolla/i.test(source)));
  assert.equal(reverseTranslateDomText("About Faolla", "en-GB"), "关于 Faolla");
});
