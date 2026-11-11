import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const helper=readFileSync(new URL('../.github/scripts/install-ci-packages.sh',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
const fixture=[
 "",
 "function . { ID=ubuntu; VERSION_ID=\"${FIXTURE_VERSION:-24.04}\"; }",
 "function dpkg { [ \"$*\" = --print-architecture ] || return 98; printf '%s\\n' \"${FIXTURE_ARCH:-amd64}\"; }",
 "function sudo {",
 "  [ \"$1\" = -n ] || return 97",
 "  shift",
 "  case \"$1\" in",
 "    id) printf '%s\\n' \"${FIXTURE_UID:-0}\" ;;",
 "    install) command install -m 755 \"${@: -2:1}\" \"${@: -1}\" ;;",
 "    stat) printf '%s\\n' '0:755:1' ;;",
 "    sha256sum) shift; command sha256sum \"$@\" ;;",
 "    bash)",
 "      local owned=\"${@: -2:1}\" expected_hash=\"${@: -1}\" actual",
 "      [ -f \"$owned\" ] && [ ! -L \"$owned\" ] || return 96",
 "      actual=\"$(command sha256sum \"$owned\")\"",
 "      [ \"${actual%% *}\" = \"$expected_hash\" ] || return 95",
 "      command rm -- \"$owned\"",
 "      ;;",
 "    env|timeout)",
 "      local args=(\"$@\") source='' mode='' mirror='' part=''",
 "      [[ \" $* \" == *' timeout --signal=TERM --kill-after=10s '* ]] || return 94",
 "      for argument in \"${args[@]}\"; do",
 "        case \"$argument\" in Dir::Etc::sourcelist=*) source=\"${argument#*=}\" ;; Dir::Etc::sourceparts=*) part=\"${argument#*=}\" ;; esac",
 "      done",
 "      [ -f \"$source\" ] && [ -d \"$part\" ] && [ -z \"$(ls -A \"$part\")\" ] || return 93",
 "      grep -q '^Suites: noble noble-updates noble-security$' \"$source\" || return 92",
 "      grep -q '^Signed-By: ' \"$source\" || return 91",
 "      mirror=\"$(sed -n 's/^URIs: //p' \"$source\")\"",
 "      case \"$mirror\" in https://archive.ubuntu.com/ubuntu) mirror=primary ;; https://us.archive.ubuntu.com/ubuntu) mirror=fallback ;; *) return 90 ;; esac",
 "      if [[ \" $* \" == *' update --error-on=any '* ]]; then mode=update",
 "      elif [[ \" $* \" == *' --download-only '* ]]; then mode=download",
 "      elif [[ \" $* \" == *' --no-download '* ]]; then mode=install",
 "      else return 89; fi",
 "      printf '%s:%s\\n' \"$mirror\" \"$mode\" >> \"$FIXTURE_LOG\"",
 "      if [ \"$FIXTURE_CASE\" = both-unavailable ] || [ \"$FIXTURE_CASE\" = bad-signature ]; then return 100; fi",
 "      if [ \"$mirror:$mode:$FIXTURE_CASE\" = primary:update:update-unavailable ]; then return 100; fi",
 "      if [ \"$mirror:$mode:$FIXTURE_CASE\" = primary:download:download-unavailable ]; then return 100; fi",
 "      if [ \"$mirror:$mode:$FIXTURE_CASE\" = primary:download:download-timeout ]; then return 124; fi",
 "      if [ \"$mode:$FIXTURE_CASE\" = download:policy-replaced ]; then printf 'foreign-policy\\n' > \"$FIXTURE_POLICY\"; fi",
 "      if [ \"$mode:$FIXTURE_CASE\" = install:install-failed ]; then return 42; fi",
 "      if [ \"$mode:$FIXTURE_CASE\" = install:install-timeout ]; then return 124; fi",
 "      ;;",
 "    *) return 88 ;;",
 "  esac",
 "}",
].join('\n');

function run({scenario='success',profile='ingress',env={},existingPolicy=false,policySymlink=false}={}){
 const directory=mkdtempSync(path.join(os.tmpdir(),'faolla-ci-package-test-'));
 const policy=path.join(directory,'policy-rc.d'),keyring=path.join(directory,'archive-keyring.gpg'),log=path.join(directory,'calls.log');
 mkdirSync(path.join(directory,'temp'));writeFileSync(keyring,'public-fixture-keyring');writeFileSync(log,'');
 if(existingPolicy)writeFileSync(policy,'original-policy');
 if(policySymlink)symlinkSync(keyring,policy);
 // Only redirect fixed host paths in this unprivileged test copy. The shipped
 // helper has no path override, injected command, or admission bypass option.
 const isolated=helper.replace('policy=/usr/sbin/policy-rc.d','policy='+quote(policy))
  .replace('keyring=/usr/share/keyrings/ubuntu-archive-keyring.gpg','keyring='+quote(keyring));
 const result=spawnSync(bash,['--noprofile','--norc','-c',fixture+'\n'+isolated,'fixture',profile],{
  encoding:'utf8',windowsHide:true,timeout:10000,
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
   RUNNER_TEMP:path.join(directory,'temp'),FIXTURE_LOG:log.replaceAll('\\','/'),FIXTURE_POLICY:policy.replaceAll('\\','/'),FIXTURE_CASE:scenario,PRIVATE_TOKEN:'SECRET_NEVER_PRINT',...env},
 });
 assert.equal(result.error,undefined);assert.equal(result.signal,null);
 assert.doesNotMatch(result.stdout+result.stderr,/SECRET_NEVER_PRINT|PRIVATE_TOKEN/);
 return {result,policy,directory,calls:readFileSync(log,'utf8').trim().split(/\r?\n/).filter(Boolean)};
}

test('both CI consumers use the same fixed installer, with signature checks and bounded downloads',()=>{
 for(const [file,profile] of [['ci.yml','ingress'],['release-toolchain.yml','nginx']]){
  const workflow=readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
  assert.match(workflow,new RegExp('run: bash \\.github/scripts/install-ci-packages\\.sh '+profile));
  assert.doesNotMatch(workflow,/sudo(?: -n)? apt-get/);
 }
 assert.match(helper,/Signed-By: %s/);assert.match(helper,/ubuntu-archive-keyring\.gpg/);
 assert.match(helper,/update --error-on=any/);
 assert.match(helper,/--download-only --no-remove --yes --no-install-recommends install/);
 assert.match(helper,/--no-download --no-remove --yes --no-install-recommends install/);
 assert.match(helper,/90s apt-get/);assert.match(helper,/120s apt-get/);
 assert.match(helper,/Acquire::https::Verify-Peer=true/);assert.match(helper,/Acquire::https::Verify-Host=true/);
 assert.match(helper,/Acquire::AllowInsecureRepositories=false/);assert.match(helper,/APT::Get::AllowUnauthenticated=false/);
 assert.match(helper,/Acquire::Check-Valid-Until=true/);assert.match(helper,/Acquire::Check-Date=true/);
 assert.doesNotMatch(helper,/allow-unauthenticated|allow-insecure|trusted=yes|Check-Valid-Until=false|ignore-missing|fix-missing|azure\.archive|\/etc\/apt\/.*>/);
 assert.ok(helper.indexOf('trap cleanup_policy EXIT')<helper.indexOf('90s apt-get'));
 assert.match(helper,/test "\$\(stat -c "%u:%a:%h" "\$1"\)" = 0:755:1/);
});

for(const profile of ['ingress','nginx'])test('successful '+profile+' installation is once-only and removes only its owned no-start policy',()=>{
 const view=run({profile});assert.equal(view.result.status,0,view.result.stderr);
 assert.deepEqual(view.calls,['primary:update','primary:download','primary:install']);assert.equal(existsSync(view.policy),false);
 assert.match(view.result.stdout,/completed/);
});
for(const scenario of ['update-unavailable','download-unavailable','download-timeout'])test(scenario+' retries download against the second signed official source before installing once',()=>{
 const view=run({scenario});assert.equal(view.result.status,0,view.result.stderr);
 assert.deepEqual(view.calls,scenario==='update-unavailable'?['primary:update','fallback:update','fallback:download','fallback:install']:
  ['primary:update','primary:download','fallback:update','fallback:download','fallback:install']);
 assert.equal(existsSync(view.policy),false);
});
for(const scenario of ['both-unavailable','bad-signature'])test(scenario+' never reaches installation and exhausts only two sources',()=>{
 const view=run({scenario});assert.notEqual(view.result.status,0);assert.deepEqual(view.calls,['primary:update','fallback:update']);assert.equal(existsSync(view.policy),false);
});
for(const [scenario,status] of [['install-failed',42],['install-timeout',124]])test(scenario+' is terminal and never replays package configuration',()=>{
 const view=run({scenario});assert.equal(view.result.status,status);assert.deepEqual(view.calls,['primary:update','primary:download','primary:install']);assert.equal(existsSync(view.policy),false);
});
for(const env of [{GITHUB_ACTIONS:'false'},{RUNNER_ENVIRONMENT:'self-hosted'},{RUNNER_OS:'Windows'},{FIXTURE_VERSION:'22.04'},{FIXTURE_ARCH:'arm64'},{FIXTURE_UID:'1001'}])test('non-admitted host is refused before package access '+JSON.stringify(env),()=>{
 const view=run({env});assert.notEqual(view.result.status,0);assert.deepEqual(view.calls,[]);assert.equal(existsSync(view.policy),false);
});
test('unknown package profile is not an arbitrary root installation interface',()=>{const view=run({profile:'other-package'});assert.equal(view.result.status,64);assert.deepEqual(view.calls,[]);});
test('pre-existing no-start policy is never overwritten or deleted',()=>{const view=run({existingPolicy:true});assert.notEqual(view.result.status,0);assert.deepEqual(view.calls,[]);assert.equal(readFileSync(view.policy,'utf8'),'original-policy');});
test('a replaced no-start policy prevents configuration and is retained rather than deleted',()=>{
 const view=run({scenario:'policy-replaced'});assert.notEqual(view.result.status,0);assert.deepEqual(view.calls,['primary:update','primary:download']);assert.equal(readFileSync(view.policy,'utf8'),'foreign-policy\n');
});
test('a policy symlink is never followed', {skip:process.platform==='win32'},()=>{const view=run({policySymlink:true});assert.notEqual(view.result.status,0);assert.deepEqual(view.calls,[]);assert.equal(readFileSync(view.policy,'utf8'),'public-fixture-keyring');});
test('shell fixture evidence remains inside its own temporary directory',()=>{const view=run();assert.equal(view.result.status,0);assert.ok(readdirSync(path.join(view.directory,'temp')).every(name=>name.startsWith('faolla-ci-apt.')));});
