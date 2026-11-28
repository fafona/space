// Owned, isolated CI fixture only. Not a deployment or production router.
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { canonicalStaticPath } from './member-checkout-static-versions.mjs';

const host = 'portal.checkout-auth.test';
const loopback = '127.0.0.1';
const cancellationPath = '/api/member-checkout/original-service/cancel';
const retainedApi = new Map([
  ['/api/member-checkout/resource', 'GET'],
  ['/api/member-checkout/history/pending', 'POST'],
  ['/api/member-checkout/history/recover', 'POST'],
  ['/api/member-checkout/history/retained', 'POST'],
  ['/api/member-checkout/original-service/review', 'POST'],
  [cancellationPath, 'POST'],
  // The orchestration must close the creation gates before entering retained.
  ['/api/member-checkout/single/points/submit', 'POST'],
]);
const checkoutNamespaces = ['/api/member-checkout', '/api/merchant-checkout', '/member-checkout'];
const inNamespace = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix + '/');
const staticNamespace = pathname => inNamespace(pathname.toLowerCase(), '/_next/static');

export function createPgCutoverPolicy({ site, operationKey }) {
  assert.ok(typeof site === 'string' && /^\d{8}$/.test(site), 'pg_cutover_invalid_site');
  assert.ok(typeof operationKey === 'string' && /^[a-f0-9]{64}$/.test(operationKey), 'pg_cutover_invalid_operation');
  const servicePath = `/member-checkout/${site}/service/${operationKey}`;
  const resumePath = `/member-checkout/${site}/resume`;
  let mode = 'old', generation = 0, busy = false;
  const snapshot = () => ({ mode, generation });
  const target = (method, pathname) => {
    if (typeof method !== 'string' || !/^[A-Z]+$/.test(method) || typeof pathname !== 'string'
      || !/^\/[A-Za-z0-9_./@~+-]*$/.test(pathname) || pathname.includes('//')
      || pathname.split('/').some(segment => segment === '.' || segment === '..') || staticNamespace(pathname)) return null;
    if (mode === 'candidate') return 'candidate';
    if (!checkoutNamespaces.some(prefix => inNamespace(pathname.toLowerCase(), prefix))) return 'old';
    if (mode === 'retained' && (retainedApi.get(pathname) === method
      || method === 'GET' && (pathname === servicePath || pathname === resumePath))) return 'candidate';
    return null;
  };
  const promote = async (next, expected, probe) => {
    assert.ok(!busy, 'cutover_already_in_progress');
    assert.ok(expected === generation, 'cutover_stale_generation');
    assert.ok(mode === 'old' && next === 'candidate' || mode === 'candidate' && next === 'retained'
      || mode === 'retained' && next === 'candidate', 'cutover_transition_refused');
    assert.ok(typeof probe === 'function', 'cutover_readiness_required');
    busy = true;
    try {
      assert.ok(await probe(next) === true, 'cutover_readiness_refused');
      assert.ok(expected === generation, 'cutover_stale_generation');
      mode = next;
      generation++;
      return snapshot();
    } finally { busy = false; }
  };
  return Object.freeze({ snapshot, target, promote });
}

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection',
  'te', 'trailer', 'transfer-encoding', 'upgrade']);

function endToEndHeaders(headers) {
  const connection = new Set(String(headers.connection ?? '').toLowerCase().split(',').map(value => value.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => value !== undefined
    && !hopHeaders.has(name) && !connection.has(name) && name !== 'forwarded' && !name.startsWith('x-forwarded-')
    && !name.startsWith('x-middleware-') && name !== 'x-owned-source-version'));
}

function destination({ port, certificate, version }) {
  assert.ok(Number.isInteger(port) && port > 1023 && port <= 65535, 'pg_cutover_invalid_port');
  assert.ok(Buffer.isBuffer(certificate) && certificate.length > 0, 'pg_cutover_certificate_required');
  assert.ok(typeof version === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(version), 'pg_cutover_invalid_version');
  const ca = Buffer.from(certificate);
  let fingerprint;
  try {
    const cert = new X509Certificate(ca);
    assert.ok(cert.checkHost(host) === host);
    assert.ok(cert.checkIP(loopback) === loopback);
    fingerprint = cert.fingerprint256;
  } catch { throw new Error('pg_cutover_invalid_certificate'); }
  return { port, ca, version, fingerprint };
}

function requestTarget(url) {
  if (typeof url !== 'string' || url.length > 8192 || !url.startsWith('/') || /[\\#\u0000-\u0020\u007f]/.test(url)) return null;
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

export async function startOwnedPgCutoverProxy({ policy, candidate, old, key, assets }) {
  assert.ok(process.platform === 'linux' && process.arch === 'x64' && process.getuid() > 0
    && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
    && process.env.GITHUB_REPOSITORY === 'fafona/space'
    && process.env.GITHUB_REF === 'refs/heads/acceptance/member-checkout-pg-app-20261128', 'pg_cutover_owned_ci_only');
  assert.ok(policy?.snapshot?.().mode === 'old' && policy.snapshot().generation === 0 && typeof policy.target === 'function', 'pg_cutover_policy_required');
  assert.ok(Buffer.isBuffer(key) && key.length > 0 && typeof assets?.read === 'function', 'pg_cutover_fixtures_required');
  const destinations = { candidate: destination(candidate), old: destination(old) };
  assert.ok(destinations.old.port !== destinations.candidate.port && destinations.old.version !== destinations.candidate.version,
    'pg_cutover_distinct_destinations_required');
  const upstreams = new Set();
  const stats = { candidateRequests: 0, oldRequests: 0, deniedRequests: 0, assetReads: 0, droppedCancellationReplies: 0 };
  let cancellationReplyArmed = false, cancellationReplyClaimed = false, retainedUnavailable = false, closed = false, closing;
  let authority;
  const fail = (res, status) => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"error":"owned_cutover_unavailable"}');
  };
  const snapshot = () => ({ ...stats, activeUpstreams: upstreams.size, cancellationReplyArmed, retainedUnavailable, closed });
  const handler = (req, res) => {
    const refuse = status => { stats.deniedRequests++; req.resume(); fail(res, status); };
    const pathname = requestTarget(req.url);
    if (!authority || req.headers.host !== authority || !pathname) { refuse(400); return; }
    if (staticNamespace(pathname)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { refuse(405); return; }
      if (!canonicalStaticPath(pathname)) { refuse(404); return; }
      req.resume();
      void (async () => {
        try {
          const asset = await assets.read(pathname);
          if (!asset) { refuse(404); return; }
          if (res.destroyed || res.writableEnded) return;
          stats.assetReads++;
          res.writeHead(200, { 'content-type': asset.type, 'content-length': asset.body.length,
            'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', etag: '"' + asset.sha256 + '"' });
          res.end(req.method === 'HEAD' ? undefined : asset.body);
        } catch { fail(res, 503); }
      })();
      return;
    }
    const name = policy.target(req.method, pathname);
    if ((name !== 'old' && name !== 'candidate') || (retainedUnavailable && name === 'candidate' && policy.snapshot().mode === 'retained')) {
      refuse(503); return;
    }
    const { port, ca, fingerprint, version } = destinations[name];
    stats[name === 'candidate' ? 'candidateRequests' : 'oldRequests']++;
    const upstream = https.request({ hostname: loopback, servername: host, port, ca, rejectUnauthorized: true,
      checkServerIdentity(servername, peer) { return checkServerIdentity(servername, peer)
        ?? (peer.fingerprint256 === fingerprint ? undefined : new Error('pg_cutover_certificate_mismatch')); },
      method: req.method, path: req.url, headers: { ...endToEndHeaders(req.headers), host: authority, connection: 'close' },
      agent: false, timeout: 60_000 }, reply => {
      const code = reply.statusCode;
      if (reply.headers.location !== undefined || reply.headers.refresh !== undefined || !Number.isInteger(code)) {
        reply.resume(); fail(res, 502); return;
      }
      if (name === 'candidate' && req.method === 'POST' && pathname === cancellationPath && code >= 200 && code < 300
        && cancellationReplyArmed && !cancellationReplyClaimed) {
        cancellationReplyClaimed = true;
        reply.once('end', () => {
          cancellationReplyClaimed = false;
          if (!reply.complete) { fail(res, 502); return; }
          cancellationReplyArmed = false;
          stats.droppedCancellationReplies++;
          fail(res, 503);
        });
        reply.once('error', () => { cancellationReplyClaimed = false; fail(res, 502); });
        reply.resume();
        return;
      }
      reply.once('error', () => fail(res, 502));
      res.writeHead(code, { ...endToEndHeaders(reply.headers), 'x-owned-source-version': version });
      reply.pipe(res);
    });
    upstreams.add(upstream);
    upstream.once('close', () => upstreams.delete(upstream));
    upstream.once('timeout', () => upstream.destroy(new Error('pg_cutover_upstream_timeout')));
    upstream.once('error', () => fail(res, 502));
    req.once('error', () => upstream.destroy());
    res.once('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  };
  let server;
  try {
    server = https.createServer({ key: Buffer.from(key), cert: destinations.candidate.ca, minVersion: 'TLSv1.2',
      headersTimeout: 10_000, requestTimeout: 65_000, keepAliveTimeout: 1_000 }, handler);
  } catch { throw new Error('pg_cutover_listener_configuration_failed'); }
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    const onError = () => reject(new Error('pg_cutover_listener_failed'));
    server.once('error', onError);
    server.listen(0, loopback, () => { server.off('error', onError); resolve(); });
  });
  const listening = server.address();
  assert.ok(listening && listening.address === loopback, 'pg_cutover_listener_not_loopback');
  authority = `${host}:${listening.port}`;
  return Object.freeze({ origin: `https://${authority}`,
    dropNextCancellationReply() {
      assert.ok(!closed && !closing && !cancellationReplyArmed && !cancellationReplyClaimed, 'pg_cutover_cancellation_fault_already_armed');
      cancellationReplyArmed = true;
    },
    setRetainedUnavailable(value) {
      assert.ok(!closed && !closing && typeof value === 'boolean', 'pg_cutover_invalid_retained_fault');
      retainedUnavailable = value;
    },
    snapshot,
    close() {
      closing ??= (async () => {
        const listenerClosed = new Promise((resolve, reject) => {
          server.close(error => error ? reject(new Error('pg_cutover_listener_cleanup_failed')) : resolve());
        });
        const upstreamsClosed = [...upstreams].map(upstream => new Promise(resolve => {
          upstream.once('close', resolve);
          upstream.destroy();
        }));
        for (const socket of sockets) socket.destroy();
        await Promise.all([listenerClosed, ...upstreamsClosed]);
        closed = true;
        return snapshot();
      })();
      return closing;
    },
  });
}
