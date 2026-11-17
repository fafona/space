import { resolveSupportedLocale } from "./i18n";

// Conversation text deliberately does not enter the DOM/UI translation cache or
// localStorage. Use the site's existing translation transport, bounded and with
// no credentials/referrer. Failure always leaves the original message visible.
const protectedToken = /(https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|faolla)/gi;
export function chatTranslationParts(text: string) {
  return text.split(protectedToken).filter(Boolean).flatMap(part => {
    if (/^(?:https?:\/\/|www\.)/i.test(part) || /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(part) || /^faolla$/i.test(part)) return [{text:part,translate:false}];
    const chars=Array.from(part),parts=[];
    for(let i=0;i<chars.length;i+=600) {const text=chars.slice(i,i+600).join("");parts.push({text,translate:/\p{L}/u.test(text)});}
    return parts;
  });
}
export async function translateChatMessage(text:string,locale:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<string|null> {
  if(signal.aborted||!text||text.length>5000)return null;
  const resolved=resolveSupportedLocale(locale),target=resolved.startsWith("zh-")?resolved:resolved.split("-")[0];
  const translated:string[]=[];
  for(const part of chatTranslationParts(text)) {
    if(signal.aborted)return null;
    if(!part.translate){translated.push(part.text);continue;}
    const leading=part.text.match(/^\s*/)?.[0]??"",trailing=part.text.match(/\s*$/)?.[0]??"";
    const query=new URLSearchParams({client:"gtx",sl:"auto",tl:target,dt:"t",q:part.text.trim()});
    const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(abort,8000);
    try {
      const response=await fetcher(`https://translate.googleapis.com/translate_a/single?${query}`,{signal:controller.signal,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",headers:{accept:"application/json"}});
      if(!response.ok||controller.signal.aborted)return null;
      const data:unknown=await response.json();
      if(!Array.isArray(data)||!Array.isArray(data[0]))return null;
      const value=data[0].map((row:unknown)=>Array.isArray(row)&&typeof row[0]==="string"?row[0]:"").join("").trim();
      if(!value||signal.aborted||controller.signal.aborted)return null;
      translated.push(leading+value+trailing);
    }catch{return null;}finally{clearTimeout(timer);signal.removeEventListener("abort",abort);}
  }
  return translated.join("");
}

type Job={text:string;listeners:Set<(value:string)=>void>;controller:AbortController;started:boolean};
export function createChatTranslationSession(locale:string,translator=translateChatMessage) {
  const cache=new Map<string,string>(),jobs=new Map<string,Job>();let running=0,disposed=false,owners=0;
  function pump() {
    if(disposed)return;
    for(const job of jobs.values()) {
      if(running>=2)break;if(job.started||!job.listeners.size)continue;
      job.started=true;++running;
      void translator(job.text,locale,job.controller.signal).then(value=>{
        if(disposed||job.controller.signal.aborted)return;
        if(value!==null){cache.set(job.text,value);if(cache.size>120)cache.delete(cache.keys().next().value!);}
        for(const listener of job.listeners)listener(value??job.text);
      }).catch(()=>{if(!disposed&&!job.controller.signal.aborted)for(const listener of job.listeners)listener(job.text);}).finally(()=>{
        --running;if(jobs.get(job.text)===job)jobs.delete(job.text);pump();
      });
    }
  }
  return {
    retain(){++owners;return()=>{--owners;queueMicrotask(()=>{if(!owners){disposed=true;for(const job of jobs.values())job.controller.abort();jobs.clear();cache.clear();}});};},
    subscribe(text:string,listener:(value:string)=>void) {
      if(disposed)return()=>{};
      const cached=cache.get(text);if(cached!==undefined){listener(cached);return()=>{};}
      let job=jobs.get(text);
      if(!job){if(jobs.size>=60)return()=>{};job={text,listeners:new Set(),controller:new AbortController(),started:false};jobs.set(text,job);}
      job.listeners.add(listener);pump();
      const selected=job;
      return()=>{selected.listeners.delete(listener);if(!selected.listeners.size){selected.controller.abort();if(jobs.get(text)===selected)jobs.delete(text);}pump();};
    },
    dispose(){disposed=true;for(const job of jobs.values())job.controller.abort();jobs.clear();cache.clear();},
  };
}
