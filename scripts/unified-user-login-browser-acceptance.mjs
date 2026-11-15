// Exercise the real login page, contexts, handlers and navigation helpers.
// Only the external auth SDK/service boundary is synthetic; no real accounts,
// credentials, cookies, user browser profiles or production requests are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const origin = 'https://login-audit.invalid';
const password = 'Synthetic-password-123';
const script = (await build({
  stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {SearchParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
    import {I18nProvider} from './src/components/I18nProvider';
    import LoginPage from './src/app/login/page';
    localStorage.setItem('merchant-space:locale:v1', 'zh-CN');
    localStorage.setItem('merchant-space:locale-source:v1', 'manual');
    createRoot(document.getElementById('root')).render(
      <I18nProvider initialLocale="zh-CN">
        <SearchParamsContext.Provider value={new URLSearchParams(location.search)}>
          <LoginPage/>
        </SearchParamsContext.Provider>
      </I18nProvider>);
  `},
  bundle: true, platform: 'browser', format: 'iife', write: false,
  jsx: 'automatic', logLevel: 'silent',
  define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'},
  plugins: [{name: 'synthetic-auth-sdk', setup(builder) {
    builder.onResolve({filter: /^(?:@\/lib\/supabase)$/}, () => ({path: 'auth-sdk', namespace: 'synthetic'}));
    builder.onLoad({filter: /.*/, namespace: 'synthetic'}, () => ({loader: 'js', contents: `
      export const legacySupabaseAuthStorageKey = 'synthetic-auth-v1';
      export const resolvedSupabaseAuthStorageKey = legacySupabaseAuthStorageKey;
      export const resolvedSupabaseAnonKey = 'synthetic-public-test-key';
      export const getResolvedSupabaseUrl = () => 'https://auth.login-audit.invalid';
      export const canReachSupabaseGateway = async () => true;
      export const supabase = {auth: {
        initialize: async () => ({}),
        getSession: async () => ({data: {session: null}, error: null}),
        signOut: async () => ({error: null}),
        setSession: async () => ({data: {session: null}, error: null}),
        refreshSession: async () => ({data: {session: null}, error: null}),
        signInWithOAuth: async options => {
          await window.recordSyntheticOAuth(options);
          return {data: {url: 'https://accounts.google.test/choose-account'}, error: null};
        }
      }};
    `}));
  }}],
})).outputFiles[0].text;
const css = (await postcss([tailwind()]).process(
  '@import "tailwindcss" source(none);\n@source "./src/app/login/page.tsx";\n@source "./src/components/PasswordField.tsx";\n@source "./src/components/LoadingProgressScreen.tsx";',
  {from: path.resolve('unified-login-acceptance.css')},
)).css;
const logo = await readFile('public/faolla-login-logo.png');
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>';

function identity(accountType) {
  const accountId = accountType === 'merchant' ? '99990001' : '59990001';
  return {
    authenticated: true, accountType, accountId,
    merchantId: accountType === 'merchant' ? accountId : '',
    merchantIds: accountType === 'merchant' ? [accountId] : [],
    user: {id: '10000000-0000-4000-8000-000000000001', email: 'synthetic@example.invalid', user_metadata: {account_type: accountType, account_id: accountId}},
  };
}

async function openFixture(browser, {width = 1440, height = 1000, query = '', accountType = 'personal', loginError = ''} = {}) {
  const context = await browser.newContext({viewport: {width, height}});
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const requests = [], errors = [], unexpected = [], navigations = [], oauthRequests = [];
  await page.exposeFunction('recordSyntheticOAuth', options => oauthRequests.push(options));
  let session = {authenticated: false};
  let signupAccountType = accountType;
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'https://accounts.google.test' && request.isNavigationRequest()) {
      navigations.push(url.href);
      return route.fulfill({contentType: 'text/html', body: '<h1>Synthetic Google account chooser</h1>'});
    }
    if (url.origin === 'https://auth.login-audit.invalid' && url.pathname === '/auth/v1/settings') {
      return route.fulfill({json: {mailer_autoconfirm: false, external: {google: true}}});
    }
    if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
    if (request.isNavigationRequest()) {
      if (url.pathname !== '/login') navigations.push(url.pathname + url.search);
      return route.fulfill({contentType: 'text/html', body: html});
    }
    if (url.pathname === '/faolla-login-logo.png') return route.fulfill({contentType: 'image/png', body: logo});
    if (url.pathname === '/api/auth/merchant-session' && request.method() === 'GET') return route.fulfill({json: session});
    if (url.pathname.startsWith('/api/auth/') && request.method() === 'POST') {
      const body = request.postDataJSON();
      requests.push({path: url.pathname, body});
      if (url.pathname === '/api/auth/merchant-login') {
        if (loginError) return route.fulfill({status: 401, json: {error: loginError}});
        session = identity(accountType);
        return route.fulfill({json: session});
      }
      if (url.pathname === '/api/auth/merchant-signup') {
        signupAccountType = body.accountType;
        return route.fulfill({json: {ok: true, needsConfirmation: true, accountType: body.accountType, codeSent: true, maskedEmail: 'sy***@example.invalid'}});
      }
      if (url.pathname === '/api/auth/merchant-signup/request-code') return route.fulfill({json: {ok: true, codeSent: true, maskedEmail: 'sy***@example.invalid'}});
      if (url.pathname === '/api/auth/merchant-signup/verify-code') return route.fulfill({json: {...identity(signupAccountType), ok: true, verified: true}});
    }
    unexpected.push(request.method() + ' ' + request.url());
    return route.abort();
  });
  await page.goto(origin + '/login' + query);
  await page.addStyleTag({content: css});
  await page.addScriptTag({content: script});
  return {page, requests, navigations, oauthRequests, async close() {
    await context.close();
    assert.deepEqual(errors, [], 'actual page must have no JavaScript errors');
    assert.deepEqual(unexpected, [], 'fixture must not touch any unapproved service');
  }};
}

async function assertNoMixedSignInActions(page) {
  assert.equal(await page.locator('[data-login-signin-actions]').count(), 0);
  assert.equal(await page.locator('[data-auth-primary-action="signin"]').count(), 0);
  assert.equal(await page.getByRole('button', {name: /使用 Google 登录|忘记密码|注册账号/}).count(), 0);
}

test('unified entry, bottom registration and clean verification on desktop and mobile', {timeout: 90000}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const [width, accountType] of [[1440, 'personal'], [1440, 'merchant'], [390, 'merchant'], [320, 'personal']]) {
      const fixture = await openFixture(browser, {width, height: width === 1440 ? 1000 : 844, accountType});
      const {page, requests} = fixture;
      try {
        const entry = page.locator('[data-login-entry-selection]');
        await entry.waitFor();
        assert.equal(await entry.getByRole('button', {name: /^用户登录入口/}).count(), 1);
        assert.equal(await entry.getByRole('button', {name: /^企业员工入口/}).count(), 1);
        assert.equal(await entry.getByRole('button', {name: /^(个人入口|商户入口)/}).count(), 0);
        // Existing merchant journeys can locate the combined entry by its
        // visible explanation; there is still just one user sign-in button.
        assert.equal(await entry.getByRole('button', {name: /商户入口/}).count(), 1);
        const signup = entry.locator('[data-login-entry-footer]').getByRole('button', {name: '用户注册', exact: true});
        assert.equal(await entry.evaluate(el => el.lastElementChild.hasAttribute('data-login-entry-footer')), true);
        await signup.scrollIntoViewIfNeeded();
        const footerBox = await signup.boundingBox();
        assert.ok(footerBox && footerBox.y >= 0 && footerBox.y + footerBox.height <= 844 + (width === 1440 ? 156 : 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.FAOLLA_LOGIN_QA_DIR && accountType === 'merchant') {
          await page.screenshot({path: path.join(process.env.FAOLLA_LOGIN_QA_DIR, `entry-${width}.png`)});
        }
        await signup.click();
        await page.getByRole('radio', {name: '个人用户', exact: true}).waitFor();
        await assertNoMixedSignInActions(page);
        // Both the first and last controls must remain reachable on a tall form.
        await page.getByRole('button', {name: '返回入口选择'}).scrollIntoViewIfNeeded();
        assert.ok((await page.getByRole('button', {name: '返回入口选择'}).boundingBox()).y >= 0);
        await page.getByRole('radio', {name: accountType === 'merchant' ? '商户' : '个人用户', exact: true}).check();
        if (process.env.FAOLLA_LOGIN_QA_DIR && accountType === 'merchant') {
          await page.screenshot({path: path.join(process.env.FAOLLA_LOGIN_QA_DIR, `registration-${width}.png`)});
        }
        await page.locator('input[name="merchant-signup-email"]').fill('synthetic@example.invalid');
        await page.locator('input[name="merchant-signup-password"]').fill(password);
        await page.locator('input[name="merchant-signup-password-confirmation"]').fill(password);
        await page.locator('[data-auth-primary-action="signup"]').click();
        const verify = page.getByRole('button', {name: '验证并完成注册', exact: true});
        await verify.waitFor();
        await assertNoMixedSignInActions(page);
        assert.equal(await page.locator('[data-auth-primary-action]').count(), 0, 'no second registration during verification');
        assert.equal(await page.locator('input[name="merchant-signup-email"]').isDisabled(), true);
        assert.equal(await page.locator('input[name="merchant-signup-password"]').isDisabled(), true);
        assert.equal(await page.getByRole('radio').count(), 0, 'the challenge stays bound to the chosen identity');
        const resend = page.getByRole('button', {name: '重发注册验证码', exact: true});
        if (process.env.FAOLLA_LOGIN_QA_DIR && accountType === 'merchant') {
          await page.screenshot({path: path.join(process.env.FAOLLA_LOGIN_QA_DIR, `verification-${width}.png`)});
        }
        await resend.click();
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent === '发送中...'));
        await page.getByPlaceholder('输入邮件里的验证码', {exact: true}).fill('123456');
        await verify.click();
        await page.waitForURL(url => url.pathname === (accountType === 'merchant' ? '/99990001' : '/me'));
        assert.deepEqual(requests.find(r => r.path === '/api/auth/merchant-signup').body, {email: 'synthetic@example.invalid', password, accountType});
        assert.deepEqual(requests.find(r => r.path === '/api/auth/merchant-signup/verify-code').body, {email: 'synthetic@example.invalid', code: '123456', accountType});
      } finally { await fixture.close(); }
    }
  } finally { await browser.close(); }
});

test('one sign-in form routes email, username and eight-digit IDs by the server identity', {timeout: 60000}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const [accountType, account] of [['personal', 'personal@example.invalid'], ['merchant', 'merchant@example.invalid'], ['personal', 'synthetic-user'], ['merchant', '99990001']]) {
      const fixture = await openFixture(browser, {accountType});
      const {page, requests} = fixture;
      try {
        await page.getByRole('button', {name: /^用户登录入口/}).click();
        await page.locator('input[name="merchant-login-account"]').fill(account);
        await page.locator('input[name="merchant-login-password"]').fill(password);
        assert.equal(await page.getByRole('button', {name: '用户注册', exact: true}).count(), 0);
        await page.locator('[data-auth-primary-action="signin"]').click();
        await page.waitForURL(url => url.pathname === (accountType === 'merchant' ? '/99990001' : '/me'));
        assert.deepEqual(requests.find(r => r.path === '/api/auth/merchant-login').body, {account, password}, 'unified entry must not choose an account type for the server');
      } finally { await fixture.close(); }
    }
  } finally { await browser.close(); }
});

test('legacy entry URLs, Google account choice and isolated employee entry remain usable', {timeout: 60000}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const requested of ['personal', 'merchant']) {
      const fixture = await openFixture(browser, {query: '?accountType=' + requested, accountType: requested === 'personal' ? 'merchant' : 'personal'});
      const {page, requests} = fixture;
      try {
        await page.locator('input[name="merchant-login-account"]').fill('synthetic@example.invalid');
        await page.locator('input[name="merchant-login-password"]').fill(password);
        await page.locator('[data-auth-primary-action="signin"]').click();
        await page.waitForURL(url => url.pathname === (requested === 'personal' ? '/99990001' : '/me'));
        assert.equal(requests[0].body.preferredAccountType, requested, 'old link keeps only its lookup hint, never controls the resulting role');
      } finally { await fixture.close(); }
    }
    const google = await openFixture(browser);
    try {
      await google.page.getByRole('button', {name: /^用户登录入口/}).click();
      await google.page.getByRole('button', {name: '使用 Google 登录', exact: true}).click();
      await google.page.waitForURL('https://accounts.google.test/choose-account');
      assert.equal(google.oauthRequests.length, 1);
      assert.equal(google.oauthRequests[0].provider, 'google');
      assert.equal(google.oauthRequests[0].options.queryParams.prompt, 'select_account');
      assert.equal(google.oauthRequests[0].options.queryParams.login_hint, undefined);
    } finally { await google.close(); }
    const staff = await openFixture(browser);
    try {
      await staff.page.getByRole('button', {name: /^企业员工入口/}).click();
      await staff.page.waitForURL(url => url.pathname === '/enterprise');
      assert.equal(staff.requests.length, 0);
    } finally { await staff.close(); }
  } finally { await browser.close(); }
});

test('an unverified existing account gets only verification actions and can return safely', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true});
  const fixture = await openFixture(browser, {width: 390, height: 740, loginError: 'Email not confirmed'});
  const {page, requests} = fixture;
  try {
    await page.getByRole('button', {name: /^用户登录入口/}).click();
    await page.locator('input[name="merchant-login-account"]').fill('synthetic@example.invalid');
    await page.locator('input[name="merchant-login-password"]').fill(password);
    await page.locator('[data-auth-primary-action="signin"]').click();
    await page.getByRole('button', {name: '验证并完成注册', exact: true}).waitFor();
    await assertNoMixedSignInActions(page);
    await page.getByRole('button', {name: '返回登录', exact: true}).click();
    await page.locator('[data-auth-primary-action="signin"]').waitFor();
    assert.equal(await page.getByRole('button', {name: '验证并完成注册', exact: true}).count(), 0);
    await page.getByRole('button', {name: '返回入口选择'}).click();
    await page.locator('[data-login-entry-selection]').waitFor();
    assert.equal(requests.length, 1, 'navigation must not submit registration or verification implicitly');
  } finally { await fixture.close(); await browser.close(); }
});
