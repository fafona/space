// Development-side packer. Runtime bundles need only Node built-ins, not npm.
import path from 'node:path';
import {createRequire,isBuiltin} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleManifest,writeNewBundle} from './release-toolchain-bundle.mjs';
import {safeRelativePath,requireToolchain as need,sha256,publicFailure} from './release-toolchain-contracts.mjs';
const require=createRequire(import.meta.url);
export function toolchainImportGraph({entrypoints,resources=[],readBlob}){
 const ts=require('typescript'),files=new Map(),visiting=new Set();
 function read(file,role){safeRelativePath(file);let bytes;try{bytes=readBlob(file);}catch{need(false,'bundle_missing_file');}
  need(Buffer.isBuffer(bytes)&&bytes.length<=4*1024**2,'invalid_bundle');files.set(file,{path:file,role,bytes:bytes.length,sha256:sha256(bytes)});return bytes;
 }
 function visit(file){if(visiting.has(file))return;visiting.add(file);need(file.endsWith('.mjs'),'bundle_import_unsupported');
  const bytes=read(file,'code'),ast=ts.createSourceFile(file,bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);need(ast.parseDiagnostics.length===0,'invalid_bundle');
  function dependency(specifier){if(isBuiltin(specifier))return;
   need(specifier.startsWith('./')||specifier.startsWith('../'),'bundle_import_unsupported');const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));safeRelativePath(target);
   if(target.endsWith('.mjs'))visit(target);else{need(resources.includes(target),'bundle_resource_missing');read(target,'resource');}
  }
  function scan(node){
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){need(ts.isStringLiteral(node.moduleSpecifier),'bundle_import_unsupported');dependency(node.moduleSpecifier.text);}
   if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){
    need(node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]),'bundle_import_unsupported');dependency(node.arguments[0].text);
   }
   if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.[1]?.getText(ast)==='import.meta.url'){
    need(ts.isStringLiteral(node.arguments[0]),'bundle_import_unsupported');const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),node.arguments[0].text));
    safeRelativePath(target);need(resources.includes(target),'bundle_resource_missing');read(target,'resource');
   }
   ts.forEachChild(node,scan);
  }scan(ast);
 }
 need(Array.isArray(entrypoints)&&entrypoints.length>0&&new Set(entrypoints).size===entrypoints.length&&new Set(resources).size===resources.length,'invalid_bundle');
 for(const entry of entrypoints)visit(entry);for(const resource of resources){need(!visiting.has(resource),'invalid_bundle');read(resource,'resource');}
 return [...files.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function git(repo,args){const r=spawnSync('git',args,{cwd:repo,encoding:null,maxBuffer:8*1024**2,timeout:15000,windowsHide:true});need(r.status===0&&!r.error&&!r.signal,'source_changed');return r.stdout;}
export const TOOLCHAIN_ENTRYPOINTS=Object.freeze(['scripts/release-toolchain.mjs','scripts/release-toolchain-interrupt-acceptance.mjs']);
export function packCommittedToolchain({repository,revision,directory,entrypoints=TOOLCHAIN_ENTRYPOINTS,resources=[]}){
 need(/^[a-f0-9]{40}$/.test(revision??''),'invalid_contract');const repo=path.resolve(repository);need(git(repo,['rev-parse',revision+'^{commit}']).toString().trim()===revision,'source_changed');
 const readBlob=file=>{safeRelativePath(file);const row=git(repo,['ls-tree',revision,'--',file]).toString().trim();
  need(row.startsWith('100644 blob ')||row.startsWith('100755 blob '),'bundle_missing_file');return git(repo,['show',revision+':'+file]);};
 const files=toolchainImportGraph({entrypoints,resources,readBlob}),manifest=bundleManifest({toolRevision:revision,entrypoints,files});
 return {directory:path.resolve(directory),...writeNewBundle(directory,{manifest,readBlob})};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{need(process.argv.length===6&&process.argv[2]==='pack','invalid_contract');console.log(JSON.stringify(packCommittedToolchain({repository:process.argv[3],revision:process.argv[4],directory:process.argv[5]})));}
 catch(error){console.error(JSON.stringify(publicFailure(error,{stage:'bundle'})));process.exitCode=1;}
}
export const TOOLCHAIN_PACK_SOURCE=fileURLToPath(import.meta.url);
