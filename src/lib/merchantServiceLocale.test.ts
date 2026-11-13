import test from "node:test";
import assert from "node:assert/strict";
import { detectPreferredLocale, writeManualLocale } from "./i18n";
import { ensureDomTranslations, hasTranslatableText, translateDomText, isDomTranslationCached } from "./domTranslations";

test("manual language selection replaces the explicit URL locale without navigating or losing page/hash/state", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window"), documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const data = new Map<string,string>(), state = { scroll: 123 };
  const location = new URL("https://cyberspace.faolla.com/?uiLocale=zh-CN&page=page-2#visit");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string,value: string) => data.set(key,value) }, history: { state, replaceState: (next: unknown,_unused: unknown,href: string) => { assert.equal(next,state); location.href = href; } } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  try {
    assert.equal(detectPreferredLocale(), "zh-CN"); writeManualLocale("es-ES"); assert.equal(detectPreferredLocale(), "es-ES");
    assert.equal(location.searchParams.get("page"), "page-2"); assert.equal(location.hash, "#visit");
    writeManualLocale("en-GB"); writeManualLocale("zh-CN"); assert.equal(detectPreferredLocale(), "zh-CN");
  } finally { if(windowDescriptor) Object.defineProperty(globalThis,"window",windowDescriptor); else Reflect.deleteProperty(globalThis,"window"); if(documentDescriptor) Object.defineProperty(globalThis,"document",documentDescriptor); else Reflect.deleteProperty(globalThis,"document"); }
});
test("merchant Spanish text and single-word navigation translate to Chinese; a failed request remains retryable", async () => {
  const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  try {
    assert.equal(hasTranslatableText("Inicio", "zh-CN"), true); assert.equal(hasTranslatableText("预约", "zh-CN"), false);
    assert.equal(hasTranslatableText("cybersports361@gmail.com", "zh-CN"), false);
    globalThis.fetch = async () => new Response("", { status: 503 });
    await ensureDomTranslations(["Tu próxima partida empieza aquí."], "zh-CN");
    assert.equal(isDomTranslationCached("Tu próxima partida empieza aquí.", "zh-CN"), false);
    globalThis.fetch = async () => Response.json([[["你的下一场游戏从这里开始。", "Tu próxima partida empieza aquí."]]]);
    await ensureDomTranslations(["Tu próxima partida empieza aquí."], "zh-CN");
    assert.equal(translateDomText("Tu próxima partida empieza aquí.", "zh-CN"), "你的下一场游戏从这里开始。");
  } finally { globalThis.fetch = originalFetch; if(descriptor) Object.defineProperty(globalThis,"window",descriptor); else Reflect.deleteProperty(globalThis,"window"); }
});
