import {buildAttendanceOnlineCandidate} from './attendance-online-build.mjs';
import {CONTACT_WECHAT_RELEASE_BASELINE} from './contact-wechat-release-policy.mjs';
import {readFileSync} from 'node:fs';

const runtimeSystemKeys=new Set(['DBUS_SESSION_BUS_ADDRESS','HISTSIZE','HISTTIMEFORMAT','HOME','LANG','LC_ALL','LESSOPEN','LE_WORKING_DIR','LOGNAME','NEXT_TELEMETRY_DISABLED','NODE_ENV','NODE_OPTIONS','PATH','PM2_HOME','PORT','PWD','SHELL','SHLVL','SSH_CLIENT','SSH_CONNECTION','USER','XDG_RUNTIME_DIR','XDG_SESSION_ID']);
export function assertContactWechatBuildEnvironmentKeys(saved){
 if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('contact_wechat_build_environment_invalid');
 for(const [key,value] of Object.entries(saved))if(typeof value!=='string'||!(/^(?:NEXT_PUBLIC_|FAOLLA_|MERCHANT_|SUPABASE_|GOOGLE_|SMTP_|MAIL_|RESEND_|ORDINARY_)/.test(key)||runtimeSystemKeys.has(key)))throw Error('contact_wechat_build_environment_unreviewed');
}

// Reuse the already-reviewed sandbox without creating a second, looser build
// path. Its attendance-prefixed evidence names describe the reused primitive,
// not permission to run attendance migrations or change rollout settings.
export function buildContactWechatOnlineCandidate(input,build=buildAttendanceOnlineCandidate,readRuntime=full=>JSON.parse(readFileSync(full,'utf8'))){
 if(!input||input.lane!=='contact-wechat-code-only'||input.baseline!==CONTACT_WECHAT_RELEASE_BASELINE)throw Error('contact_wechat_build_scope_invalid');
 if(!/^[a-f0-9]{40}$/.test(input.target??'')||input.directory!==`/www/wwwroot/merchant-space.web-releases/${input.target.slice(0,12)}-online`||input.operation!==`/var/lib/faolla-online-release/${input.target}`)throw Error('contact_wechat_build_scope_invalid');
 assertContactWechatBuildEnvironmentKeys(readRuntime(`${input.operation}/runtime.json`));
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
