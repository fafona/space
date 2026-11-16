const LANGUAGE_FLAG_CODES = new Set(["cn","tw","jp","kr","gb","es","de","fr","tr","it","pl","ua","nl","ro","pt","ru","gr","cz","se","hu","by","bg","rs","dk","fi","sk","no","hr","ba","al","lt","si","lv","ee","mk","is","ie","mt","lu"]);

export function languageFlagImageUrl(countryCode: string) {
  const code = countryCode.trim().toLowerCase();
  return `/flags/${LANGUAGE_FLAG_CODES.has(code) ? code : "cn"}.svg`;
}

export function isLocalLanguageFlagPath(pathname: string) {
  const match = /^\/flags\/([a-z]{2})\.svg$/.exec(pathname);
  return Boolean(match && LANGUAGE_FLAG_CODES.has(match[1]));
}
