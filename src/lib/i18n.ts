export const I18N_STORAGE_KEY = "merchant-space:locale:v1";
export const I18N_GEO_LOCALE_CACHE_KEY = "merchant-space:locale:geo:v1";
export const I18N_COOKIE_KEY = "merchant-space-locale-v1";
export const I18N_URL_PARAM = "uiLocale";
const I18N_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type LanguageOption = {
  code: string;
  label: string;
  region: "asia" | "europe";
  countryCode: string;
};

// Order is intentional: Asian languages first, and European languages roughly follow
// overall usage/popularity while keeping English and Spanish pinned at the top.
const LANGUAGE_OPTION_SEED: LanguageOption[] = [
  { code: "zh-CN", label: "中文（简体）", region: "asia", countryCode: "CN" },
  { code: "zh-TW", label: "中文（繁體）", region: "asia", countryCode: "TW" },
  { code: "ja-JP", label: "日本語", region: "asia", countryCode: "JP" },
  { code: "ko-KR", label: "한국어", region: "asia", countryCode: "KR" },
  { code: "en-GB", label: "English", region: "europe", countryCode: "GB" },
  { code: "es-ES", label: "Español", region: "europe", countryCode: "ES" },
  { code: "de-DE", label: "Deutsch", region: "europe", countryCode: "DE" },
  { code: "fr-FR", label: "Français", region: "europe", countryCode: "FR" },
  { code: "tr-TR", label: "Türkçe", region: "europe", countryCode: "TR" },
  { code: "it-IT", label: "Italiano", region: "europe", countryCode: "IT" },
  { code: "pl-PL", label: "Polski", region: "europe", countryCode: "PL" },
  { code: "uk-UA", label: "Українська", region: "europe", countryCode: "UA" },
  { code: "nl-NL", label: "Nederlands", region: "europe", countryCode: "NL" },
  { code: "ro-RO", label: "Română", region: "europe", countryCode: "RO" },
  { code: "pt-PT", label: "Português", region: "europe", countryCode: "PT" },
  { code: "ru-RU", label: "Русский", region: "europe", countryCode: "RU" },
  { code: "el-GR", label: "Ελληνικά", region: "europe", countryCode: "GR" },
  { code: "cs-CZ", label: "Čeština", region: "europe", countryCode: "CZ" },
  { code: "sv-SE", label: "Svenska", region: "europe", countryCode: "SE" },
  { code: "hu-HU", label: "Magyar", region: "europe", countryCode: "HU" },
  { code: "be-BY", label: "Беларуская", region: "europe", countryCode: "BY" },
  { code: "bg-BG", label: "Български", region: "europe", countryCode: "BG" },
  { code: "sr-RS", label: "Srpski", region: "europe", countryCode: "RS" },
  { code: "da-DK", label: "Dansk", region: "europe", countryCode: "DK" },
  { code: "fi-FI", label: "Suomi", region: "europe", countryCode: "FI" },
  { code: "sk-SK", label: "Slovenčina", region: "europe", countryCode: "SK" },
  { code: "no-NO", label: "Norsk", region: "europe", countryCode: "NO" },
  { code: "hr-HR", label: "Hrvatski", region: "europe", countryCode: "HR" },
  { code: "bs-BA", label: "Bosanski", region: "europe", countryCode: "BA" },
  { code: "sq-AL", label: "Shqip", region: "europe", countryCode: "AL" },
  { code: "lt-LT", label: "Lietuvių", region: "europe", countryCode: "LT" },
  { code: "sl-SI", label: "Slovenščina", region: "europe", countryCode: "SI" },
  { code: "lv-LV", label: "Latviešu", region: "europe", countryCode: "LV" },
  { code: "et-EE", label: "Eesti", region: "europe", countryCode: "EE" },
  { code: "mk-MK", label: "Македонски", region: "europe", countryCode: "MK" },
  { code: "ca-ES", label: "Català", region: "europe", countryCode: "ES" },
  { code: "eu-ES", label: "Euskara", region: "europe", countryCode: "ES" },
  { code: "gl-ES", label: "Galego", region: "europe", countryCode: "ES" },
  { code: "cy-GB", label: "Cymraeg", region: "europe", countryCode: "GB" },
  { code: "is-IS", label: "Íslenska", region: "europe", countryCode: "IS" },
  { code: "ga-IE", label: "Gaeilge", region: "europe", countryCode: "IE" },
  { code: "mt-MT", label: "Malti", region: "europe", countryCode: "MT" },
  { code: "lb-LU", label: "Lëtzebuergesch", region: "europe", countryCode: "LU" },
];

const MULTI_VARIANT_LANGUAGE_CODES = new Set(["zh"]);

export const LANGUAGE_OPTIONS: LanguageOption[] = (() => {
  const seenLanguage = new Set<string>();
  const output: LanguageOption[] = [];
  LANGUAGE_OPTION_SEED.forEach((item) => {
    const language = item.code.split("-")[0]?.toLowerCase();
    if (!language) return;
    if (!MULTI_VARIANT_LANGUAGE_CODES.has(language) && seenLanguage.has(language)) {
      return;
    }
    seenLanguage.add(language);
    output.push(item);
  });
  return output;
})();

export const DEFAULT_LOCALE = "zh-CN";

const languageSubtagDefault: Record<string, string> = LANGUAGE_OPTIONS.reduce<Record<string, string>>(
  (acc, item) => {
    const subtag = item.code.split("-")[0]?.toLowerCase();
    if (!subtag) return acc;
    if (!acc[subtag]) acc[subtag] = item.code;
    return acc;
  },
  {},
);

const supportedLocaleSet = new Set(LANGUAGE_OPTIONS.map((item) => item.code));

const COUNTRY_LOCALE_OVERRIDES: Record<string, string> = {
  ES: "es-ES",
};

export type TranslationKey =
  | "lang.label"
  | "lang.placeholder"
  | "common.loadingPage"
  | "common.loadingPortal"
  | "common.adminLogin"
  | "common.backToLogin"
  | "common.sending"
  | "login.title"
  | "login.email"
  | "login.password"
  | "login.passwordMin6"
  | "login.signIn"
  | "login.signingIn"
  | "login.signUp"
  | "login.signingUp"
  | "login.forgot"
  | "login.resend"
  | "login.firstRegisterTip"
  | "login.firstRegisterTipAutoConfirm"
  | "login.offlineDev"
  | "login.requiredEmail"
  | "login.invalidEmail"
  | "login.requiredPassword"
  | "login.passwordTooShort"
  | "login.emailNotConfirmed"
  | "login.timeout"
  | "login.backendUnavailable"
  | "login.signupSuccess"
  | "login.requestFailed"
  | "login.inputRegisterEmailFirst"
  | "login.resendSuccess"
  | "login.inputEmailBeforeForgot"
  | "login.forgotSuccess"
  | "login.resetCodeLabel"
  | "login.resetCodePlaceholder"
  | "login.verifyResetCode"
  | "login.verifyingResetCode"
  | "reset.title"
  | "reset.newPassword"
  | "reset.confirmPassword"
  | "reset.submit"
  | "reset.submitting"
  | "reset.confirmReset"
  | "reset.requiredNewPassword"
  | "reset.newPasswordTooShort"
  | "reset.requiredConfirmPassword"
  | "reset.passwordMismatch"
  | "reset.sessionExpired"
  | "reset.successRedirect"
  | "reset.inputConfirmPasswordAgain"
  | "reset.email"
  | "reset.code"
  | "reset.codePlaceholder"
  | "reset.verifyCode"
  | "reset.verifyingCode"
  | "reset.resendCode"
  | "reset.resendingCode"
  | "reset.invalidCode"
  | "reset.codeHelp"
  | "superLogin.title"
  | "superLogin.account"
  | "superLogin.accountPlaceholder"
  | "superLogin.password"
  | "superLogin.passwordPlaceholder"
  | "superLogin.signIn"
  | "superLogin.invalid"
  | "superLogin.backMerchant"
  | "portal.noPublish";

type TranslationBundle = Record<TranslationKey, string>;

const EN_BUNDLE: TranslationBundle = {
  "lang.label": "Language",
  "lang.placeholder": "Select language",
  "common.loadingPage": "Loading page...",
  "common.loadingPortal": "Loading portal...",
  "common.adminLogin": "Admin Login",
  "common.backToLogin": "Back to Login",
  "common.sending": "Sending...",
  "login.title": "Merchant Admin Login",
  "login.email": "Email",
  "login.password": "Password",
  "login.passwordMin6": "At least 6 characters",
  "login.signIn": "Sign In",
  "login.signingIn": "Signing in...",
  "login.signUp": "Sign Up",
  "login.signingUp": "Signing up...",
  "login.forgot": "Forgot password (email reset)",
  "login.resend": "Resend verification email",
  "login.firstRegisterTip": "After registration, verify your email first, then sign in.",
  "login.firstRegisterTipAutoConfirm": "After registration, you can sign in immediately with your email and password.",
  "login.offlineDev": "Enter editor offline (dev only)",
  "login.requiredEmail": "Please enter email",
  "login.invalidEmail": "Please enter a valid email",
  "login.requiredPassword": "Please enter password",
  "login.passwordTooShort": "Password must be at least 6 characters",
  "login.emailNotConfirmed": "Email not verified. Please click the verification link first.",
  "login.timeout": "Request timed out. Please try again later.",
  "login.backendUnavailable": "Backend is unavailable. Please try again later.",
  "login.signupSuccess": "Registered. Please verify your email before signing in.",
  "login.requestFailed": "Request failed. Please check your network and try again.",
  "login.inputRegisterEmailFirst": "Enter your registration email first",
  "login.resendSuccess": "Verification email resent. Check inbox and spam.",
  "login.inputEmailBeforeForgot": "Enter your email first, then click forgot password",
  "login.forgotSuccess": "Password reset email sent. Enter the code from the email below, or use the email link if it opens normally.",
  "login.resetCodeLabel": "Email Code",
  "login.resetCodePlaceholder": "Enter the code from the email",
  "login.verifyResetCode": "Verify Reset Code",
  "login.verifyingResetCode": "Verifying reset code...",
  "reset.title": "Reset Password",
  "reset.newPassword": "New Password",
  "reset.confirmPassword": "Confirm New Password",
  "reset.submit": "Submit",
  "reset.submitting": "Submitting...",
  "reset.confirmReset": "Confirm Reset Password",
  "reset.requiredNewPassword": "Please enter new password",
  "reset.newPasswordTooShort": "New password must be at least 6 characters",
  "reset.requiredConfirmPassword": "Please confirm new password",
  "reset.passwordMismatch": "Passwords do not match",
  "reset.sessionExpired": "Reset session expired. Please request a new reset email.",
  "reset.successRedirect": "Password reset successfully. Redirecting to login...",
  "reset.inputConfirmPasswordAgain": "Enter password again",
  "reset.email": "Email",
  "reset.code": "Email Code",
  "reset.codePlaceholder": "Enter the code from the email",
  "reset.verifyCode": "Use Code to Continue",
  "reset.verifyingCode": "Verifying code...",
  "reset.resendCode": "Resend Email Code",
  "reset.resendingCode": "Resending email code...",
  "reset.invalidCode": "The email code is invalid or expired. Please resend and try again.",
  "reset.codeHelp": "If the email link opens as expired on mobile, resend a fresh email code here and enter it directly.",
  "superLogin.title": "Super Admin Login",
  "superLogin.account": "Account",
  "superLogin.accountPlaceholder": "Enter account",
  "superLogin.password": "Password",
  "superLogin.passwordPlaceholder": "Enter password",
  "superLogin.signIn": "Sign In",
  "superLogin.invalid": "Invalid account or password",
  "superLogin.backMerchant": "Back to Merchant Login",
  "portal.noPublish": "Portal visual content has not been published yet. Please publish from super admin editor.",
};

const ZH_CN_BUNDLE: TranslationBundle = {
  ...EN_BUNDLE,
  "lang.label": "语言",
  "lang.placeholder": "选择语言",
  "common.loadingPage": "正在加载页面...",
  "common.loadingPortal": "正在加载总站...",
  "common.adminLogin": "后台登录",
  "common.backToLogin": "返回登录",
  "common.sending": "发送中...",
  "login.title": "商家后台登录",
  "login.email": "邮箱",
  "login.password": "密码",
  "login.passwordMin6": "至少 6 位",
  "login.signIn": "登录",
  "login.signingIn": "登录中...",
  "login.signUp": "注册",
  "login.signingUp": "注册中...",
  "login.forgot": "忘记密码（通过邮箱找回）",
  "login.resend": "重发验证邮件",
  "login.firstRegisterTip": "首次注册后需要先验证邮箱，再进行登录。",
  "login.firstRegisterTipAutoConfirm": "注册后可直接使用邮箱和密码登录。",
  "login.offlineDev": "离线进入编辑器（仅开发）",
  "login.requiredEmail": "请输入邮箱",
  "login.invalidEmail": "请输入正确的邮箱格式",
  "login.requiredPassword": "请输入密码",
  "login.passwordTooShort": "密码至少 6 位",
  "login.emailNotConfirmed": "邮箱未验证，请先去邮箱点击验证链接后再登录。",
  "login.timeout": "请求超时，请稍后重试",
  "login.backendUnavailable": "后台连接不可用，请稍后重试",
  "login.signupSuccess": "注册成功，请检查邮箱完成验证，然后再登录。",
  "login.requestFailed": "请求失败，请检查网络后重试",
  "login.inputRegisterEmailFirst": "请先输入注册邮箱",
  "login.resendSuccess": "验证邮件已重新发送，请检查收件箱和垃圾箱。",
  "login.inputEmailBeforeForgot": "请先输入邮箱，再点击找回密码",
  "login.forgotSuccess": "找回密码邮件已发送。可以直接输入邮件里的验证码，也可以在链接能正常打开时点击邮件链接。",
  "login.resetCodeLabel": "邮件验证码",
  "login.resetCodePlaceholder": "输入邮件里的验证码",
  "login.verifyResetCode": "验证并继续重置",
  "login.verifyingResetCode": "正在验证验证码...",
  "reset.title": "重置密码",
  "reset.newPassword": "新密码",
  "reset.confirmPassword": "确认新密码",
  "reset.submit": "提交",
  "reset.submitting": "提交中...",
  "reset.confirmReset": "确认重置密码",
  "reset.requiredNewPassword": "请输入新密码",
  "reset.newPasswordTooShort": "新密码至少 6 位",
  "reset.requiredConfirmPassword": "请再次输入新密码",
  "reset.passwordMismatch": "两次输入的密码不一致",
  "reset.sessionExpired": "重置会话已失效，请回到登录页重新发送找回密码邮件。",
  "reset.successRedirect": "密码已重置成功，正在跳转到登录页...",
  "reset.inputConfirmPasswordAgain": "再次输入新密码",
  "reset.email": "邮箱",
  "reset.code": "邮件验证码",
  "reset.codePlaceholder": "输入邮件里的验证码",
  "reset.verifyCode": "用邮件验证码继续",
  "reset.verifyingCode": "正在验证验证码...",
  "reset.resendCode": "重新发送邮件验证码",
  "reset.resendingCode": "正在重新发送邮件验证码...",
  "reset.invalidCode": "邮件验证码无效或已过期，请重新发送后再试。",
  "reset.codeHelp": "如果手机里点开邮件链接后直接显示已失效，可以在这里重新发送邮件验证码，再直接输入验证码继续重置。",
  "superLogin.title": "超级后台登录",
  "superLogin.account": "账号",
  "superLogin.accountPlaceholder": "请输入账号",
  "superLogin.password": "密码",
  "superLogin.passwordPlaceholder": "请输入密码",
  "superLogin.signIn": "登录",
  "superLogin.invalid": "账号或密码错误",
  "superLogin.backMerchant": "返回商户登录",
  "portal.noPublish": "总站暂未发布可视化内容，请到超级后台编辑器发布后查看。",
};

const ZH_TW_BUNDLE: TranslationBundle = {
  ...ZH_CN_BUNDLE,
  "lang.label": "語言",
  "lang.placeholder": "選擇語言",
  "common.loadingPage": "正在載入頁面...",
  "common.loadingPortal": "正在載入總站...",
  "common.adminLogin": "後台登入",
  "common.backToLogin": "返回登入",
  "login.title": "商家後台登入",
  "login.email": "信箱",
  "login.password": "密碼",
  "login.passwordMin6": "至少 6 碼",
  "login.signIn": "登入",
  "login.signingIn": "登入中...",
  "login.signUp": "註冊",
  "login.signingUp": "註冊中...",
  "login.forgot": "忘記密碼（透過信箱找回）",
  "login.resend": "重發驗證郵件",
  "login.firstRegisterTip": "首次註冊後需要先驗證信箱，再進行登入。",
  "login.firstRegisterTipAutoConfirm": "註冊後可直接使用信箱與密碼登入。",
  "login.offlineDev": "離線進入編輯器（僅開發）",
  "login.requiredEmail": "請輸入信箱",
  "login.invalidEmail": "請輸入正確的信箱格式",
  "login.requiredPassword": "請輸入密碼",
  "login.passwordTooShort": "密碼至少 6 碼",
  "login.emailNotConfirmed": "信箱尚未驗證，請先至信箱點擊驗證連結後再登入。",
  "login.timeout": "請求超時，請稍後重試",
  "login.backendUnavailable": "後台連線不可用，請稍後重試",
  "login.signupSuccess": "註冊成功，請先到信箱完成驗證，再登入。",
  "login.requestFailed": "請求失敗，請檢查網路後重試",
  "login.inputRegisterEmailFirst": "請先輸入註冊信箱",
  "login.resendSuccess": "驗證郵件已重新發送，請檢查收件匣與垃圾郵件。",
  "login.inputEmailBeforeForgot": "請先輸入信箱，再點擊找回密碼",
  "login.forgotSuccess": "找回密碼郵件已送出，請至信箱點擊連結後重設密碼。",
  "reset.title": "重設密碼",
  "reset.newPassword": "新密碼",
  "reset.confirmPassword": "確認新密碼",
  "reset.confirmReset": "確認重設密碼",
  "reset.requiredNewPassword": "請輸入新密碼",
  "reset.newPasswordTooShort": "新密碼至少 6 碼",
  "reset.requiredConfirmPassword": "請再次輸入新密碼",
  "reset.passwordMismatch": "兩次輸入的密碼不一致",
  "reset.sessionExpired": "重設會話已失效，請回到登入頁重新發送找回密碼郵件。",
  "reset.successRedirect": "密碼重設成功，正在跳轉到登入頁...",
  "reset.inputConfirmPasswordAgain": "再次輸入新密碼",
  "superLogin.title": "超級後台登入",
  "superLogin.account": "帳號",
  "superLogin.accountPlaceholder": "請輸入帳號",
  "superLogin.passwordPlaceholder": "請輸入密碼",
  "superLogin.signIn": "登入",
  "superLogin.invalid": "帳號或密碼錯誤",
  "superLogin.backMerchant": "返回商戶登入",
  "portal.noPublish": "總站尚未發布可視化內容，請至超級後台編輯器發布後查看。",
};

const JA_BUNDLE: TranslationBundle = {
  ...EN_BUNDLE,
  "lang.label": "言語",
  "lang.placeholder": "言語を選択",
  "common.loadingPage": "ページを読み込み中...",
  "common.loadingPortal": "ポータルを読み込み中...",
  "common.adminLogin": "管理者ログイン",
  "common.backToLogin": "ログインに戻る",
  "common.sending": "送信中...",
  "login.title": "店舗管理ログイン",
  "login.email": "メール",
  "login.password": "パスワード",
  "login.passwordMin6": "6文字以上",
  "login.signIn": "ログイン",
  "login.signingIn": "ログイン中...",
  "login.signUp": "登録",
  "login.signingUp": "登録中...",
  "login.forgot": "パスワードを忘れた場合（メール再設定）",
  "login.resend": "確認メールを再送信",
  "login.firstRegisterTip": "初回登録後は、メール確認を完了してからログインしてください。",
  "login.firstRegisterTipAutoConfirm": "登録後すぐにメールアドレスとパスワードでログインできます。",
  "login.offlineDev": "オフラインでエディタに入る（開発専用）",
  "login.requiredEmail": "メールを入力してください",
  "login.invalidEmail": "有効なメールアドレスを入力してください",
  "login.requiredPassword": "パスワードを入力してください",
  "login.passwordTooShort": "パスワードは6文字以上必要です",
  "login.emailNotConfirmed": "メール未確認です。確認リンクを押してからログインしてください。",
  "login.timeout": "リクエストがタイムアウトしました。しばらくして再試行してください。",
  "login.backendUnavailable": "バックエンドに接続できません。しばらくして再試行してください。",
  "login.signupSuccess": "登録成功。メール確認後にログインしてください。",
  "login.requestFailed": "リクエストに失敗しました。ネットワークを確認して再試行してください。",
  "login.inputRegisterEmailFirst": "先に登録メールを入力してください",
  "login.resendSuccess": "確認メールを再送信しました。受信箱と迷惑メールをご確認ください。",
  "login.inputEmailBeforeForgot": "先にメールを入力してから、パスワード再設定を押してください",
  "login.forgotSuccess": "パスワード再設定メールを送信しました。受信箱をご確認ください。",
  "reset.title": "パスワード再設定",
  "reset.newPassword": "新しいパスワード",
  "reset.confirmPassword": "新しいパスワード（確認）",
  "reset.submit": "送信",
  "reset.submitting": "送信中...",
  "reset.confirmReset": "パスワードを再設定",
  "reset.requiredNewPassword": "新しいパスワードを入力してください",
  "reset.newPasswordTooShort": "新しいパスワードは6文字以上必要です",
  "reset.requiredConfirmPassword": "確認用パスワードを入力してください",
  "reset.passwordMismatch": "パスワードが一致しません",
  "reset.sessionExpired": "再設定セッションの期限が切れました。再度メールを送信してください。",
  "reset.successRedirect": "パスワードを再設定しました。ログイン画面へ移動します...",
  "reset.inputConfirmPasswordAgain": "もう一度入力してください",
  "superLogin.title": "スーパー管理者ログイン",
  "superLogin.account": "アカウント",
  "superLogin.accountPlaceholder": "アカウントを入力",
  "superLogin.password": "パスワード",
  "superLogin.passwordPlaceholder": "パスワードを入力",
  "superLogin.signIn": "ログイン",
  "superLogin.invalid": "アカウントまたはパスワードが正しくありません",
  "superLogin.backMerchant": "店舗ログインに戻る",
  "portal.noPublish": "ポータルの可視化コンテンツはまだ公開されていません。スーパー管理者で公開してください。",
};

const KO_BUNDLE: TranslationBundle = {
  ...EN_BUNDLE,
  "lang.label": "언어",
  "lang.placeholder": "언어 선택",
  "common.loadingPage": "페이지 불러오는 중...",
  "common.loadingPortal": "포털 불러오는 중...",
  "common.adminLogin": "관리자 로그인",
  "common.backToLogin": "로그인으로 돌아가기",
  "common.sending": "전송 중...",
  "login.title": "상점 관리자 로그인",
  "login.email": "이메일",
  "login.password": "비밀번호",
  "login.passwordMin6": "최소 6자",
  "login.signIn": "로그인",
  "login.signingIn": "로그인 중...",
  "login.signUp": "회원가입",
  "login.signingUp": "가입 중...",
  "login.forgot": "비밀번호 찾기 (이메일 재설정)",
  "login.resend": "인증 메일 재전송",
  "login.firstRegisterTip": "처음 가입 후 이메일 인증을 완료한 뒤 로그인하세요.",
  "login.firstRegisterTipAutoConfirm": "가입 후 이메일과 비밀번호로 바로 로그인할 수 있습니다.",
  "login.offlineDev": "오프라인 편집기 진입 (개발 전용)",
  "login.requiredEmail": "이메일을 입력하세요",
  "login.invalidEmail": "올바른 이메일 형식을 입력하세요",
  "login.requiredPassword": "비밀번호를 입력하세요",
  "login.passwordTooShort": "비밀번호는 최소 6자 이상이어야 합니다",
  "login.emailNotConfirmed": "이메일 인증이 필요합니다. 인증 링크를 먼저 눌러 주세요.",
  "login.timeout": "요청이 시간 초과되었습니다. 잠시 후 다시 시도하세요.",
  "login.backendUnavailable": "백엔드를 사용할 수 없습니다. 잠시 후 다시 시도하세요.",
  "login.signupSuccess": "가입이 완료되었습니다. 이메일 인증 후 로그인하세요.",
  "login.requestFailed": "요청에 실패했습니다. 네트워크를 확인해 주세요.",
  "login.inputRegisterEmailFirst": "먼저 가입 이메일을 입력하세요",
  "login.resendSuccess": "인증 메일을 다시 보냈습니다. 받은편지함과 스팸함을 확인해 주세요.",
  "login.inputEmailBeforeForgot": "먼저 이메일을 입력한 뒤 비밀번호 찾기를 눌러 주세요",
  "login.forgotSuccess": "비밀번호 재설정 메일을 보냈습니다. 이메일을 확인해 주세요.",
  "reset.title": "비밀번호 재설정",
  "reset.newPassword": "새 비밀번호",
  "reset.confirmPassword": "새 비밀번호 확인",
  "reset.submit": "제출",
  "reset.submitting": "제출 중...",
  "reset.confirmReset": "비밀번호 재설정 확인",
  "reset.requiredNewPassword": "새 비밀번호를 입력하세요",
  "reset.newPasswordTooShort": "새 비밀번호는 최소 6자 이상이어야 합니다",
  "reset.requiredConfirmPassword": "새 비밀번호를 다시 입력하세요",
  "reset.passwordMismatch": "비밀번호가 일치하지 않습니다",
  "reset.sessionExpired": "재설정 세션이 만료되었습니다. 다시 요청해 주세요.",
  "reset.successRedirect": "비밀번호가 재설정되었습니다. 로그인 화면으로 이동합니다...",
  "reset.inputConfirmPasswordAgain": "비밀번호를 다시 입력하세요",
  "superLogin.title": "슈퍼 관리자 로그인",
  "superLogin.account": "계정",
  "superLogin.accountPlaceholder": "계정을 입력하세요",
  "superLogin.password": "비밀번호",
  "superLogin.passwordPlaceholder": "비밀번호를 입력하세요",
  "superLogin.signIn": "로그인",
  "superLogin.invalid": "계정 또는 비밀번호가 올바르지 않습니다",
  "superLogin.backMerchant": "상점 로그인으로 돌아가기",
  "portal.noPublish": "포털 시각 콘텐츠가 아직 게시되지 않았습니다. 슈퍼 관리자에서 게시해 주세요.",
};

export function resolveSupportedLocale(input: string | null | undefined) {
  const resolved = resolveSupportedLocaleCandidate(input);
  return resolved ?? DEFAULT_LOCALE;
}

function resolveSupportedLocaleCandidate(input: string | null | undefined) {
  const normalized = String(input ?? "").trim();
  if (!normalized) return null;
  if (supportedLocaleSet.has(normalized)) return normalized;
  const language = normalized.toLowerCase().split("-")[0] ?? "";
  return languageSubtagDefault[language] ?? null;
}

function resolveLocaleByCountryCode(countryCode: string | null | undefined) {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!code) return null;
  const override = COUNTRY_LOCALE_OVERRIDES[code];
  if (override && supportedLocaleSet.has(override)) {
    return override;
  }
  const matched = LANGUAGE_OPTIONS.find((item) => item.countryCode.toUpperCase() === code);
  return matched ? matched.code : null;
}

function readGeoCachedLocale() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(I18N_GEO_LOCALE_CACHE_KEY);
    if (!raw) return null;
    return resolveSupportedLocale(raw);
  } catch {
    return null;
  }
}

function writeGeoCachedLocale(locale: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(I18N_GEO_LOCALE_CACHE_KEY, resolveSupportedLocale(locale));
  } catch {
    // Ignore write failures.
  }
}

export function getLocaleBundle(locale: string): TranslationBundle {
  const normalized = resolveSupportedLocale(locale).toLowerCase();
  if (normalized === "zh-tw") return ZH_TW_BUNDLE;
  if (normalized.startsWith("zh")) return ZH_CN_BUNDLE;
  if (normalized.startsWith("ja")) return JA_BUNDLE;
  if (normalized.startsWith("ko")) return KO_BUNDLE;
  return EN_BUNDLE;
}

function parseCookieValue(cookie: string | null | undefined, key: string) {
  const source = String(cookie ?? "");
  if (!source) return null;
  const pairs = source.split(";");
  for (const pair of pairs) {
    const [rawName, ...rest] = pair.split("=");
    if (!rawName) continue;
    if (rawName.trim() !== key) continue;
    const rawValue = rest.join("=").trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function resolveExplicitLocaleValue(rawValue: string | null | undefined) {
  const trimmed = String(rawValue ?? "").trim();
  if (!trimmed) return null;
  const resolved = resolveSupportedLocale(trimmed);
  if (resolved !== DEFAULT_LOCALE) return resolved;
  const lowered = trimmed.toLowerCase();
  if (lowered === "zh" || lowered === "zh-cn" || lowered === "zh-hans") {
    return DEFAULT_LOCALE;
  }
  return null;
}

export function readStoredLocaleCookieFromString(cookie: string | null | undefined) {
  const raw = parseCookieValue(cookie, I18N_COOKIE_KEY);
  return resolveExplicitLocaleValue(raw);
}

export function resolveLocaleCookieDomainFromHost(host: string | null | undefined) {
  const normalized = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!normalized) return "";
  const hostname = normalized.startsWith("[")
    ? normalized.replace(/^\[|\](?::\d+)?$/g, "")
    : normalized.replace(/:\d+$/, "");
  if (!hostname) return "";
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    return "";
  }
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  return labels.slice(-2).join(".");
}

export function readRequestedLocaleFromSearch(search: string | null | undefined) {
  const normalized = String(search ?? "").trim();
  if (!normalized) return null;
  try {
    const params = new URLSearchParams(normalized.startsWith("?") ? normalized : `?${normalized}`);
    return resolveExplicitLocaleValue(params.get(I18N_URL_PARAM));
  } catch {
    return null;
  }
}

export function readPreferredLocaleFromAcceptLanguage(header: string | null | undefined) {
  const normalized = String(header ?? "").trim();
  if (!normalized) return null;
  const candidates = normalized.split(",");
  for (const candidate of candidates) {
    const token = candidate.split(";")[0]?.trim() ?? "";
    const resolved = resolveSupportedLocaleCandidate(token);
    if (resolved) return resolved;
  }
  return null;
}

function readStoredLocaleCookie() {
  if (typeof document === "undefined") return null;
  try {
    return readStoredLocaleCookieFromString(document.cookie);
  } catch {
    return null;
  }
}

function writeStoredLocaleCookie(locale: string) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  try {
    const resolved = resolveSupportedLocale(locale);
    const parts = [
      `${I18N_COOKIE_KEY}=${encodeURIComponent(resolved)}`,
      "Path=/",
      `Max-Age=${I18N_COOKIE_MAX_AGE_SECONDS}`,
      "SameSite=Lax",
    ];
    if (window.location.protocol === "https:") {
      parts.push("Secure");
    }
    const domain = resolveLocaleCookieDomainFromHost(window.location.host);
    if (domain) {
      parts.push(`Domain=${domain}`);
    }
    document.cookie = parts.join("; ");
  } catch {
    // Ignore cookie write failures.
  }
}

export function readStoredLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const requested = readRequestedLocaleFromSearch(window.location.search);
  if (requested) return requested;
  try {
    const stored = window.localStorage.getItem(I18N_STORAGE_KEY);
    if (stored) return resolveSupportedLocale(stored);
  } catch {
    // Ignore localStorage read failures.
  }
  return readStoredLocaleCookie() ?? DEFAULT_LOCALE;
}

export function detectPreferredLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const requested = readRequestedLocaleFromSearch(window.location.search);
  if (requested) return requested;
  try {
    const storedRaw = window.localStorage.getItem(I18N_STORAGE_KEY);
    if (storedRaw) return resolveSupportedLocale(storedRaw);
  } catch {
    // Ignore storage read failures.
  }
  const cookieStored = readStoredLocaleCookie();
  if (cookieStored) return cookieStored;
  const geoCached = readGeoCachedLocale();
  if (geoCached) return geoCached;
  const navigatorLanguages = Array.isArray(window.navigator.languages) && window.navigator.languages.length > 0
    ? window.navigator.languages
    : [window.navigator.language];
  for (const item of navigatorLanguages) {
    const resolved = resolveSupportedLocale(item);
    if (resolved) return resolved;
  }
  return DEFAULT_LOCALE;
}

export function writeStoredLocale(locale: string) {
  const resolved = resolveSupportedLocale(locale);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(I18N_STORAGE_KEY, resolved);
  } catch {
    // Ignore write failures.
  }
  writeStoredLocaleCookie(resolved);
}

export function hasStoredLocalePreference() {
  if (typeof window === "undefined" && typeof document === "undefined") return false;
  try {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(I18N_STORAGE_KEY);
      if (raw && raw.trim()) return true;
    }
  } catch {
    // Ignore localStorage read failures.
  }
  return Boolean(readStoredLocaleCookie());
}

export async function detectGeoLocale() {
  if (typeof window === "undefined") return null;

  const cached = readGeoCachedLocale();
  if (cached) return cached;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch("https://ipwho.is/?fields=success,country_code", {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { success?: boolean; country_code?: string };
    if (json?.success !== true) return null;
    const resolved = resolveLocaleByCountryCode(json.country_code);
    if (!resolved) return null;
    writeGeoCachedLocale(resolved);
    return resolved;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
