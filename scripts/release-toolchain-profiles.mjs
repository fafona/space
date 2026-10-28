// Explicit tested runtime profiles, not a kernel-version guess or user template.
import * as fs from 'node:fs';import path from 'node:path';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
const STANDARD=Object.freeze({id:'standard',binary:'/usr/sbin/nginx',httpDirectives:'',resources:Object.freeze([])});
const BT=Object.freeze({id:'bt',binary:'/www/server/nginx/sbin/nginx',httpDirectives:'lua_package_path "/www/server/nginx/lib/lua/?.lua;;";',resources:Object.freeze(['/www/server/nginx/lib/lua/resty/core.lua'])});
export function toolchainNginxProfile(binary){const profile=[STANDARD,BT].find(v=>v.binary===binary);need(profile,'invalid_contract');return profile;}
export function inspectToolchainNginxProfile(binary,{lstat=fs.lstatSync,realpath=fs.realpathSync}={}){
 const profile=toolchainNginxProfile(binary);
 function trusted(file){let resolved;try{resolved=realpath(file);}catch{need(false,'bundle_resource_missing');}
  for(const start of [file,resolved]){let current=start;for(;;){let st;try{st=lstat(current);}catch{need(false,'bundle_resource_missing');}
   need(st.uid===0&&(st.mode&0o022)===0,'owned_resource_changed');const next=path.dirname(current);if(next===current)break;current=next;
  }}return resolved;
 }
 const resolved=trusted(profile.binary);need(lstat(resolved).isFile(),'owned_resource_changed');for(const file of profile.resources)need(lstat(trusted(file)).isFile(),'bundle_resource_missing');
 return {...profile,resolvedBinary:resolved};
}
