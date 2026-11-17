import test from "node:test";
import assert from "node:assert/strict";
import {chatTranslationParts,createChatTranslationSession,translateChatMessage} from "./chatTranslation";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("private chat translation protects Faolla, URLs and email; uses credential-free existing transport",async()=>{
 const calls:URL[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));calls.push(url);assert.equal(init?.credentials,"omit");assert.equal(init?.referrerPolicy,"no-referrer");assert.equal(init?.cache,"no-store");assert.equal(url.searchParams.get("tl"),"es");return Response.json([[["Hola",url.searchParams.get("q")]]]);};
 const original="Hello Faolla https://example.invalid/page email@example.invalid 12345678 😀";
 const result=await translateChatMessage(original,"es-ES",new AbortController().signal,fetcher);
 assert.equal(result,"Hola Faolla https://example.invalid/page email@example.invalid 12345678 😀");
 assert.equal(calls.length,1);assert.ok(calls.every(url=>url.origin==="https://translate.googleapis.com"));
 assert.ok(chatTranslationParts("😀".repeat(700)+"word").every(part=>Array.from(part.text).length<=600));
});
test("failure, abort and malformed translation always preserve the source, without persistent cache",async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const fetcher:typeof fetch=async()=>{++calls;return Response.json({invalid:true});};
 assert.equal(await translateChatMessage("hello","zh-CN",controller.signal,fetcher),null);assert.equal(calls,0);
 assert.equal(await translateChatMessage("hello","zh-CN",new AbortController().signal,fetcher),null);
 assert.equal(await translateChatMessage("hello","en",new AbortController().signal,async()=>{throw new Error("offline");}),null);
 assert.equal(await translateChatMessage("😀 123","en",new AbortController().signal,fetcher),"😀 123");
});
test("scoped sessions deduplicate, limit concurrency and cancel hidden/disabled conversations",async()=>{
 const pending:Array<{text:string;signal:AbortSignal;resolve:(v:string|null)=>void}>=[];
 const session=createChatTranslationSession("es",(text,_locale,signal)=>new Promise(resolve=>pending.push({text,signal,resolve})));
 const values:string[]=[],release=session.retain();
 const unsub=session.subscribe("one",v=>values.push(v));session.subscribe("one",v=>values.push(v));session.subscribe("two",()=>{});session.subscribe("three",()=>{});
 assert.equal(pending.length,2);unsub();assert.equal(pending[0].signal.aborted,false);
 pending[0].resolve("uno");await tick();assert.deepEqual(values,["uno"]);assert.equal(pending.length,3);
 session.subscribe("one",v=>values.push(v));assert.deepEqual(values,["uno","uno"]);
 release();await tick();assert.equal(pending[1].signal.aborted,true);assert.equal(pending[2].signal.aborted,true);
 session.subscribe("four",()=>assert.fail("disposed session must not deliver"));assert.equal(pending.length,3);
 pending[1].resolve("late");pending[2].resolve("late");await tick();assert.deepEqual(values,["uno","uno"]);
 const other=createChatTranslationSession("es",async()=>"fresh");other.subscribe("one",v=>values.push(v));await tick();assert.equal(values.at(-1),"fresh");other.dispose();
});
test("StrictMode retain/release replay does not dispose the live session",async()=>{
 const session=createChatTranslationSession("en",async text=>text),first=session.retain();first();const second=session.retain();await tick();
 let result="";session.subscribe("still active",v=>{result=v;});await tick();assert.equal(result,"still active");second();await tick();
});
