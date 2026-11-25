// Classification only: callers still ABORT every non-owned browser request.
// Optional translation failure must not be confused with a broken local page.
export function ownedPageRequest(value, origin, method = 'GET') {
  const url = new URL(value);
  if (url.origin === origin && !url.username && !url.password) return { kind: 'owned' };
  const params = url.searchParams, keys = [...params.keys()].sort();
  const translation = method === 'GET' && !url.username && !url.password && !url.hash
    && url.origin === 'https://translate.googleapis.com' && url.pathname === '/translate_a/single'
    && JSON.stringify(keys) === JSON.stringify(['client', 'dt', 'q', 'sl', 'tl'])
    && params.get('client') === 'gtx' && params.get('sl') === 'auto' && params.get('dt') === 't'
    && /^(?:[a-z]{2,3}|zh-CN|zh-TW)$/.test(params.get('tl')) && params.get('q').length <= 320;
  return { kind: translation ? 'translation-refused' : 'external-refused', origin: url.origin, pathname: url.pathname.slice(0, 200) };
}
