import test from 'node:test';import assert from 'node:assert/strict';
import {toolchainNginxProfile,inspectToolchainNginxProfile} from './release-toolchain-profiles.mjs';
const stat=file=>({uid:0,mode:0o755,isFile:()=>file.endsWith('nginx')||file.endsWith('.lua')});
test('standard and BT profiles explicitly describe their runtime resources',()=>{
 assert.equal(toolchainNginxProfile('/usr/sbin/nginx').httpDirectives,'');const bt=toolchainNginxProfile('/www/server/nginx/sbin/nginx');assert.match(bt.httpDirectives,/lua_package_path/);assert.deepEqual(bt.resources,['/www/server/nginx/lib/lua/resty/core.lua']);
 assert.throws(()=>toolchainNginxProfile('/bin/sh'));assert.ok(Object.isFrozen(bt.resources));
});
test('a missing BT runtime library blocks BEFORE a private Nginx is even spawned',()=>{
 assert.throws(()=>inspectToolchainNginxProfile('/www/server/nginx/sbin/nginx',{realpath:file=>{if(file.endsWith('.lua'))throw Error('missing');return file;},lstat:stat}),/bundle_resource_missing/);
});
test('resource ancestry, real target ownership and permissions are checked, not just file existence',()=>{
 for(const change of [file=>({...stat(file),uid:1001}),file=>({...stat(file),mode:0o777})])assert.throws(()=>inspectToolchainNginxProfile('/usr/sbin/nginx',{realpath:file=>file,lstat:change}),/owned_resource_changed/);
 assert.equal(inspectToolchainNginxProfile('/usr/sbin/nginx',{realpath:file=>file,lstat:stat}).id,'standard');
});
