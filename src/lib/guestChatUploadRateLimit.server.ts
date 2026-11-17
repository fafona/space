import {createHash} from "node:crypto";
type Entry={count:number;bytes:number;resetAt:number};
export function createGuestChatUploadLimiter() {
  const entries=new Map<string,Entry>();
  return (identity:string,ip:string,now=Date.now())=>{
    for(const [key,value]of entries)if(value.resetAt<=now)entries.delete(key);
    const rules=[{key:`identity:${identity}`,limit:12,bytes:64*1024*1024},{key:`ip:${ip}`,limit:24,bytes:128*1024*1024}].map(rule=>({...rule,key:createHash("sha256").update(rule.key).digest("hex")}));
    // Never evict a live limit to admit a new identity. Limits cover the one
    // active web process; no durable/global quota is claimed across restarts.
    if(entries.size+rules.filter(rule=>!entries.has(rule.key)).length>4000)return false;
    const rows=rules.map(rule=>({rule,value:entries.get(rule.key)??{count:0,bytes:0,resetAt:now+60000}}));
    if(rows.some(({rule,value})=>value.count>=rule.limit||value.bytes+8*1024*1024>rule.bytes))return false;
    for(const {rule,value}of rows)entries.set(rule.key,{...value,count:value.count+1,bytes:value.bytes+8*1024*1024});
    return true;
  };
}
export const allowGuestChatUpload=createGuestChatUploadLimiter();

export function createGuestChatUploadGate(limit=4) {
  let active=0;
  return()=>{
    if(active>=limit)return null;
    ++active;let released=false;
    return()=>{if(!released){released=true;--active;}};
  };
}
export const acquireGuestChatUpload=createGuestChatUploadGate();
