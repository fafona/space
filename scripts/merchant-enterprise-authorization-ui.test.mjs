import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=readFileSync(new URL('../src/components/admin/MerchantEnterpriseManager.tsx',import.meta.url),'utf8');
const boundary=source.slice(source.indexOf('function MerchantEnterpriseAuthorizationBoundary('),source.indexOf('function MerchantEnterpriseManagerContent('));
const overview=source.slice(source.indexOf('  const loadOverview = useCallback('),source.indexOf('  const refreshOverview = useCallback('));

test('authoritative overview denial is checked after stale/abort guards but before body parsing or silent-edit suppression',()=>{
  const status=overview.indexOf('if (response.status === 401 || response.status === 403)');assert(status>0);
  assert(overview.indexOf('controller.signal.aborted || requestSequence !== overviewRequestSequenceRef.current')<status);
  assert(status<overview.indexOf('await response.json()'));assert(status<overview.indexOf('if (silent && !canAutoRefreshOnFocusRef.current)'));
  assert.match(overview,/if \(response\.status === 401 \|\| response\.status === 403\) \{\s*accountStatusScope\.current\.accountStatusAuthId = "";\s*periodDelegationScope\.current\.token\+\+;\s*setCurrentAuthUserId\(null\);\s*onAuthorizationInvalid\(response\.status\);\s*return false;/);
  assert.match(overview,/if \(!preserveData\) \{\s*setActor\(null\);\s*setAttendanceAdmission\(null\);\s*setCurrentAuthUserId\(null\);\s*setSnapshot\(EMPTY_SNAPSHOT\)/);
  assert.match(overview,/\[apiFetch, siteId, accessToken, onAuthorizationInvalid\]/);
});

test('denied enterprise identity unmounts all protected drafts, clears external navigation and badges, but preserves recovery storage',()=>{
  assert.match(source,/const accessScopeKey = JSON\.stringify\(\[props\.siteId, props\.accessToken \?\? ""\]\);\s*return <MerchantEnterpriseAuthorizationBoundary key=\{accessScopeKey\}/);
  assert.match(boundary,/const callbacks = useRef\(props\);\s*useEffect\(\(\) => \{\s*callbacks\.current = props;\s*\}, \[props\]\);/);
  assert.match(boundary,/const invalidateAuthorization = useCallback\([\s\S]*?onAvailableViewsChange\?\.\(\[\]\);[\s\S]*?onTodoCountChange\?\.\(0\);\s*\}, \[\]\);/);
  assert.match(boundary,/if \(deniedStatus !== null\) \{[\s\S]*?return <section aria-label="企业身份需重新核验"[\s\S]*?<\/section>;\s*\}\s*return <MerchantEnterpriseManagerContent/);
  assert.match(boundary,/onClick=\{\(\) => setDeniedStatus\(null\)\}/);
  assert.doesNotMatch(boundary,/(?:localStorage|sessionStorage)\.(?:clear|removeItem)|fetch\(/);
});
