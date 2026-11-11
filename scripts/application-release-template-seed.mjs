// Explicit first catalog entry, not an authentication bypass or a data import.
// Run with the active application's existing tsx loader and normal .env.local;
// configured service credentials never leave this server process.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {observeApplicationRelease} from './application-release-audit.mjs';
import {templatePrivateJson} from './application-release-template-database.mjs';
import {templateNeed as need,templateHash} from './application-release-template-contract.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
const SOURCE='10000000',PLAN='plan-3',NAME='乐屿游乐场 · 亲子娱乐',PAGES=['乐园首页','游乐项目','门票套餐','生日派对','到访指南','预约咨询'];
const SEED='/var/lib/faolla-template-schema/first-playland-template.json';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const templateSeedHash=value=>templateHash(JSON.stringify(canonical(value)));
const digest=templateSeedHash;
export async function loadTemplateSeedRuntime(directory){
 const loadRuntime=async name=>{
  const exports=await import(pathToFileURL(directory+'/src/lib/'+name+'.ts').href);
  // tsx follows this repository's CommonJS package boundary; Next's bundled
  // runtime also supports named ESM exports. Normalize both, without rewriting
  // application modules or changing their normal configuration.
  return exports.default??exports;
 };
 return Promise.all(['superAdminServer','merchantDraftStore','websiteTemplateLibrary','websiteTemplateAssets.server','websiteTemplateStore.server'].map(loadRuntime));
}
export async function seedTemplateLibrary(mode,target,reviewedHash){
 need(['inspect','publish'].includes(mode)&&/^[a-f0-9]{40}$/.test(target??''),'seed_invocation');
 need(process.platform==='linux'&&process.getuid?.()===0&&fileURLToPath(import.meta.url)==='/var/lib/faolla-online-code/'+target+'/scripts/application-release-template-seed.mjs','seed_source');
 await observeApplicationRelease(target);
 const active=templatePrivateJson('/var/lib/faolla-online-release/active.json');need(active.target===target,'seed_active');
 const [{createServerSupabaseServiceClient},{loadStoredMerchantDraft},{snapshotWebsiteTemplate,getWebsiteTemplateCover},{freezeWebsiteTemplateAssets},{updateWebsiteTemplate}]=await loadTemplateSeedRuntime(active.directory);
 const db=createServerSupabaseServiceClient();need(db,'seed_database');
 const source=await loadStoredMerchantDraft(db,SOURCE);need(source?.blocks,'seed_source_missing');
 const snapshot=snapshotWebsiteTemplate(source.blocks,PLAN);
 for(const view of ['desktop','mobile'])need(JSON.stringify(snapshot[view].map(p=>p.name))===JSON.stringify(PAGES),'seed_source_pages_changed');
 need(JSON.stringify(snapshot).includes('乐屿'),'seed_brand_changed');
 const design=await freezeWebsiteTemplateAssets(snapshot,[process.env.NEXT_PUBLIC_SUPABASE_URL??'','https://faolla.com','https://launch.faolla.com']);
 const designHash=digest(design),sourceHash=digest(source.blocks);
 need(Buffer.byteLength(JSON.stringify(design))<=6000000,'seed_size');
 if(mode==='inspect')return {sourceSiteId:SOURCE,sourcePlanId:PLAN,sourceUpdatedAt:source.updatedAt,sourceHash,designHash,
  name:NAME,category:'娱乐',desktopPages:design.desktop.map(p=>p.name),mobilePages:design.mobile.map(p=>p.name),sourceWritten:false,catalogWritten:false};
 need(reviewedHash===designHash,'seed_review_changed');
 ownedReleasePath(path.dirname(SEED),{directory:true,privateMode:true});
 if(!fs.existsSync(SEED)){
  const intent={kind:'first-playland-template-intent',id:randomUUID(),revision:randomUUID(),sourceSiteId:SOURCE,sourcePlanId:PLAN,sourceHash,designHash,name:NAME,category:'娱乐'};
  const fd=fs.openSync(SEED,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(intent,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(SEED),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }
 const intent=templatePrivateJson(SEED);need(intent.kind==='first-playland-template-intent'&&intent.sourceSiteId===SOURCE&&intent.sourcePlanId===PLAN&&
  /^[a-f0-9-]{36}$/.test(intent.id??'')&&/^[a-f0-9-]{36}$/.test(intent.revision??'')&&intent.sourceHash===sourceHash&&intent.designHash===designHash&&intent.name===NAME,'seed_intent_changed');
 const row={id:intent.id,revision:intent.revision,name:NAME,category:'娱乐',status:'draft',sort_order:0,design,cover_image_url:getWebsiteTemplateCover(design),
  desktop_page_count:6,mobile_page_count:6,source_site_id:SOURCE,source_plan_id:PLAN};
 // An immutable id and DO NOTHING on conflict make an interrupted insert safe:
 // existing rows, including an existing copy of this entry, are never overwritten.
 const insert=await db.from('website_templates').upsert(row,{onConflict:'id',ignoreDuplicates:true});need(!insert.error,'seed_insert_unconfirmed');
 const read=async()=>{
  const r=await db.from('website_templates').select('*').eq('id',intent.id).single();need(!r.error&&r.data,'seed_read_unconfirmed');
  const value=r.data;need(value.name===NAME&&value.category==='娱乐'&&value.source_site_id===SOURCE&&value.source_plan_id===PLAN&&digest(value.design)===designHash,'seed_row_conflict');return value;
 };
 let current=await read();
 if(current.status!=='published'){
  try{await updateWebsiteTemplate(db,intent.id,current.revision,{name:NAME,category:'娱乐',status:'published',sortOrder:0,reviewed:true});}
  catch{current=await read();need(current.status==='published','seed_publication_unconfirmed');}
 }
 current=await read();need(current.status==='published','seed_not_published');
 const after=await loadStoredMerchantDraft(db,SOURCE);need(after&&digest(after.blocks)===sourceHash&&after.updatedAt===source.updatedAt,'seed_source_changed');
 return {kind:'first-playland-template-published',id:intent.id,name:NAME,designHash,sourceSiteId:SOURCE,sourcePlanId:PLAN,
  desktopPages:6,mobilePages:6,sourceWritten:false,existingUserCopiesWritten:false,mailEnabled:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,target,hash,...extra]=process.argv.slice(2);
 Promise.resolve().then(()=>{need(extra.length===0,'seed_arguments');return seedTemplateLibrary(mode,target,hash);}).then(v=>console.log(JSON.stringify(v)),e=>{
  console.error(/^application_template_[a-z_]+$/.test(e?.message??'')?e.message:'application_template_seed_unconfirmed');process.exitCode=1;
 });
}
