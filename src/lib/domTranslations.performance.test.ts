import test, { after } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { ensureDomTranslations, isDomTranslationCached, translateDomText } from "./domTranslations";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout,
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } } });
after(async () => {
  await delay(340); // Let the existing bounded persistence timer finish.
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
});
type Request = { text: string; signal: AbortSignal; finish: (translation: string) => void; fail: () => void };
function transport(ignoreAbort = false) {
  const requests: Request[] = [];
  globalThis.fetch = async (input, options) => new Promise<Response>((resolve, reject) => {
    const text = new URL(String(input)).searchParams.get("q") ?? "", signal = options?.signal as AbortSignal;
    const abort = () => { if (!ignoreAbort) reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    const finish = (response: Response) => { signal.removeEventListener("abort", abort); resolve(response); };
    requests.push({ text, signal, finish: translation => finish(Response.json([[[translation, text]]])), fail: () => finish(new Response("", { status: 503 })) });
  });
  return requests;
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await nextTurn(); }
  assert.ok(predicate(), "expected translation state must settle without wall-clock sleeps");
}
async function bounded(work: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("translation did not release its caller")), 500); })]); }
  finally { clearTimeout(timer); }
}

test("completed phrases notify the page without waiting for a slow sibling", async () => {
  const requests = transport(), phrases = ["Una frase rápida para el test", "Una frase lenta para el test"];
  let updates = 0, completed = false;
  const work = ensureDomTranslations(phrases, "en-GB", 2, { onProgress: () => updates++ }).then(() => { completed = true; });
  try {
    assert.equal(requests.length, 2); requests[0].finish("The fast phrase");
    await until(() => updates === 1);
    assert.equal(translateDomText(phrases[0], "en-GB"), "The fast phrase");
    assert.equal(isDomTranslationCached(phrases[1], "en-GB"), false); assert.equal(completed, false);
    requests[1].finish("The slow phrase"); await work; assert.equal(updates, 2);
  } finally { requests.forEach(request => request.fail()); await work; }
});

test("one aborted consumer cannot cancel another consumer sharing the same translation", async () => {
  const requests = transport(), first = new AbortController(), second = new AbortController(), text = "Texto compartido entre dos consumidores";
  let firstUpdates = 0, secondUpdates = 0;
  const a = ensureDomTranslations([text], "en-GB", 1, { signal: first.signal, onProgress: () => firstUpdates++ });
  const b = ensureDomTranslations([text], "en-GB", 1, { signal: second.signal, onProgress: () => secondUpdates++ });
  try {
    assert.equal(requests.length, 1); first.abort(); await bounded(a);
    assert.equal(requests[0].signal.aborted, false); assert.equal(firstUpdates, 0);
    requests[0].finish("A shared translation"); await b;
    assert.equal(secondUpdates, 1); assert.equal(translateDomText(text, "en-GB"), "A shared translation");
  } finally { requests.forEach(request => request.fail()); await Promise.all([a, b]); }
});

test("abandoning a locale aborts owned requests, drops queued phrases and allows a fresh same-language retry", async () => {
  const requests = transport(), signal = new AbortController(), phrases = Array.from({ length: 18 }, (_, i) => `Contenido de la cola abandonada ${i}`);
  let updates = 0;
  const work = ensureDomTranslations(phrases, "es-ES", 2, { signal: signal.signal, onProgress: () => updates++ });
  try {
    assert.equal(requests.length, 2); signal.abort(); await bounded(work);
    assert.ok(requests.every(request => request.signal.aborted)); assert.equal(requests.length, 2); assert.equal(updates, 0);
    assert.equal(isDomTranslationCached(phrases[0], "es-ES"), false);
    const retry = ensureDomTranslations([phrases[0]], "es-ES", 1);
    assert.equal(requests.length, 3); requests[2].finish("Reintento correcto"); await retry;
    assert.equal(translateDomText(phrases[0], "es-ES"), "Reintento correcto");
  } finally { requests.forEach(request => request.fail()); await work; }
});

test("a late response ignoring abort cannot overwrite a new owner or populate the abandoned cache", async () => {
  const requests = transport(true), signal = new AbortController(), text = "Una respuesta antigua no debe reemplazar la actual";
  let abandonedUpdates = 0;
  const abandoned = ensureDomTranslations([text], "es-ES", 1, { signal: signal.signal, onProgress: () => abandonedUpdates++ });
  try {
    signal.abort(); await bounded(abandoned);
    const fresh = ensureDomTranslations([text], "es-ES", 1); assert.equal(requests.length, 2);
    requests[1].finish("Resultado nuevo"); await fresh;
    requests[0].finish("Resultado antiguo"); await nextTurn();
    assert.equal(translateDomText(text, "es-ES"), "Resultado nuevo"); assert.equal(abandonedUpdates, 0);
  } finally { requests.forEach(request => request.fail()); await abandoned; }
});

test("failures remain retryable, warm caches avoid network, and pre-aborted callers start no work", async () => {
  const requests = transport(), text = "La traducción fallida debe poder recuperarse";
  let updates = 0;
  const failed = ensureDomTranslations([text], "en-GB", 1, { onProgress: () => updates++ });
  requests[0].fail(); await failed;
  assert.equal(isDomTranslationCached(text, "en-GB"), false); assert.equal(updates, 0);
  const retry = ensureDomTranslations([text], "en-GB", 1); requests[1].finish("Recovered translation"); await retry;
  await ensureDomTranslations([text], "en-GB"); assert.equal(requests.length, 2);
  const aborted = new AbortController(); aborted.abort();
  await ensureDomTranslations(["No iniciar ninguna petición nueva"], "en-GB", 1, { signal: aborted.signal });
  assert.equal(requests.length, 2);
});
