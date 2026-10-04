/**
 * Tests for the framing-policy check.
 *
 * Run: node --test scripts/check-framing-headers.test.mjs  (also run by .github/workflows/test.yml)
 *
 * The first suite reads the COMMITTED firebase.json, so CI fails if a hosting
 * entry loses its clickjacking headers. The rest pin the evaluator against the
 * cases that look protective but are not (wrong directive, report-only, a later
 * duplicate directive, a second owner), prove the preservation comparison
 * catches unrelated cache/CSP/routing edits, and drive live mode against local
 * synthetic servers — redirects, gateways, non-HTML, errors — never the network.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

import {
  HOSTING_DIR,
  EXPECTED_POLICY,
  EXPECTED_HOSTING,
  evaluateFraming,
  checkHostingConfig,
  compareHostingConfigs,
  compareSnapshots,
  hostingEntries,
  entryLabel,
  stripFramingHeaders,
  emulatorEntry,
  liveCheck,
  parseLiveTargets,
} from './check-framing-headers.mjs';

const readJson = (name) => {
  const path = join(HOSTING_DIR, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
};

// The evaluator/config cases below are written against an explicit policy so
// they hold whichever policy this repo selects in EXPECTED_POLICY.
const DENY = Object.freeze({ frameAncestors: ["'none'"], xFrameOptions: 'DENY' });
const SAMEORIGIN = Object.freeze({ frameAncestors: ["'self'"], xFrameOptions: 'SAMEORIGIN' });

const FRAMING_RULE = {
  source: '**',
  headers: [
    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    { key: 'X-Frame-Options', value: 'DENY' },
  ],
};

describe('committed firebase.json', () => {
  test('every hosting entry carries the framing rule', () => {
    assert.deepEqual(
      checkHostingConfig(readJson('firebase.json'), readJson('.firebaserc'), EXPECTED_POLICY),
      [],
    );
  });

  test('every deployed site/target is still configured', () => {
    // Losing an entry would leave that site deploying without any header rule.
    const labels = hostingEntries(readJson('firebase.json')).map(entryLabel);
    assert.deepEqual(labels.sort(), [...EXPECTED_HOSTING].sort());
  });
});

describe('evaluateFraming', () => {
  // Raw header pairs, as fetched: one array entry per header FIELD.
  const ok = (pairs, policy = DENY) => evaluateFraming(pairs, policy).ok;
  const CSP = ['content-security-policy', "frame-ancestors 'none'"];
  const XFO = ['x-frame-options', 'DENY'];

  test('expected CSP + XFO passes', () => {
    assert.equal(ok([CSP, XFO]), true);
  });

  test('case and whitespace do not matter', () => {
    assert.equal(ok([['content-security-policy', "  FRAME-ANCESTORS\t'NONE' "], ['x-frame-options', ' deny ']]), true);
  });

  test('frame-ancestors inside a full resource policy passes', () => {
    const csp = "default-src 'self'; frame-ancestors 'none'; img-src 'self' data:";
    assert.equal(ok([['content-security-policy', csp], XFO]), true);
  });

  test('an extra CSP field without frame-ancestors is fine (separate resource policy)', () => {
    assert.equal(ok([CSP, ['content-security-policy', "script-src 'self'"], XFO]), true);
  });

  test('no headers fails', () => {
    assert.equal(ok([]), false);
  });

  test('default-src / frame-src are not substitutes for frame-ancestors', () => {
    assert.equal(ok([['content-security-policy', "default-src 'none'"], XFO]), false);
    assert.equal(ok([['content-security-policy', "frame-src 'none'"], XFO]), false);
  });

  test('report-only CSP does not count', () => {
    assert.equal(ok([['content-security-policy-report-only', "frame-ancestors 'none'"], XFO]), false);
  });

  test('first frame-ancestors in a policy wins; a later duplicate is ignored', () => {
    assert.equal(ok([['content-security-policy', "frame-ancestors *; frame-ancestors 'none'"], XFO]), false);
  });

  test('a second policy stating frame-ancestors is a second owner — as a field or comma-joined', () => {
    assert.equal(ok([CSP, ['content-security-policy', 'frame-ancestors *'], XFO]), false);
    assert.equal(ok([CSP, CSP, XFO]), false);
    assert.equal(ok([['content-security-policy', "frame-ancestors 'none', frame-ancestors *"], XFO]), false);
  });

  test("'none' mixed with another source is not deny-all", () => {
    assert.equal(ok([['content-security-policy', "frame-ancestors 'none' *"], XFO]), false);
  });

  test('X-Frame-Options must be exactly one field with exactly DENY', () => {
    assert.equal(ok([CSP]), false);
    assert.equal(ok([CSP, ['x-frame-options', 'SAMEORIGIN']]), false);
    assert.equal(ok([CSP, ['x-frame-options', 'ALLOW-FROM https://example.com']]), false);
    assert.equal(ok([CSP, ['x-frame-options', 'DENY, SAMEORIGIN']]), false);
    // Browsers tolerate these, but they mean two owners / a malformed value.
    assert.equal(ok([CSP, XFO, XFO]), false);
    assert.equal(ok([CSP, ['x-frame-options', 'DENY, DENY']]), false);
  });

  test('same-origin policy: exact self + SAMEORIGIN passes, DENY or a wildcard does not', () => {
    const self = ['content-security-policy', "frame-ancestors 'self'"];
    assert.equal(ok([self, ['x-frame-options', 'sameorigin']], SAMEORIGIN), true);
    assert.equal(ok([['content-security-policy', "frame-ancestors 'self' *"], ['x-frame-options', 'SAMEORIGIN']], SAMEORIGIN), false);
    assert.equal(ok([self, XFO], SAMEORIGIN), false);
  });

  test('reads a plain firebase.json-style record too', () => {
    assert.equal(ok({ 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' }), true);
  });
});

describe('checkHostingConfig', () => {
  const site = (headers) => ({ target: 'app', public: 'dist', headers });

  test('a target without the rule is reported', () => {
    const problems = checkHostingConfig({ hosting: [site([FRAMING_RULE]), { target: 'dev', public: 'dist' }] }, {}, DENY);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /target "dev"/);
  });

  test('a rule scoped to /index.html only is rejected — deep links would be bare', () => {
    assert.equal(checkHostingConfig({ hosting: site([{ ...FRAMING_RULE, source: '/index.html' }]) }, {}, DENY).length, 1);
  });

  test('a later rule that could override a framing header is rejected', () => {
    const override = { source: '/assets/**', headers: [{ key: 'x-frame-options', value: 'SAMEORIGIN' }] };
    assert.equal(checkHostingConfig({ hosting: site([FRAMING_RULE, override]) }, {}, DENY).length, 1);
  });

  test('wrong values on the catch-all rule are rejected', () => {
    const weak = { source: '**', headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }, { key: 'X-Frame-Options', value: 'DENY' }] };
    assert.equal(checkHostingConfig({ hosting: site([weak]) }, {}, DENY).length, 1);
  });

  test('a .firebaserc hosting target with no config entry is reported', () => {
    const rc = { targets: { 'demo-project': { hosting: { app: ['demo-app'], staging: ['demo-staging'] } } } };
    assert.deepEqual(checkHostingConfig({ hosting: site([FRAMING_RULE]) }, rc, DENY), [
      '.firebaserc target "staging" (project demo-project) has no hosting entry',
    ]);
  });
});

describe('preservation against a baseline config', () => {
  const CACHE = { source: '/assets/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000' }] };
  const base = {
    hosting: [{
      target: 'app',
      public: 'dist',
      rewrites: [{ source: '**', destination: '/index.html' }],
      headers: [CACHE, { source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }] }],
    }],
  };
  // The legitimate change: frame-ancestors merged into the existing CSP, plus XFO.
  const framed = structuredClone(base);
  framed.hosting[0].headers[1].headers = [
    { key: 'Content-Security-Policy', value: "default-src 'self'; frame-ancestors 'none'" },
    { key: 'X-Frame-Options', value: 'DENY' },
  ];

  test('a framing-only change passes', () => {
    assert.deepEqual(compareHostingConfigs(base, framed), []);
  });

  test('a dropped or altered cache rule fails', () => {
    const mutated = structuredClone(framed);
    mutated.hosting[0].headers[0].headers[0].value = 'no-cache';
    assert.equal(compareHostingConfigs(base, mutated).length, 1);
    mutated.hosting[0].headers.shift();
    assert.equal(compareHostingConfigs(base, mutated).length, 1);
  });

  test('a CSP resource directive lost while adding frame-ancestors fails', () => {
    const mutated = structuredClone(framed);
    mutated.hosting[0].headers[1].headers[0].value = "frame-ancestors 'none'";
    assert.equal(compareHostingConfigs(base, mutated).length, 1);
  });

  test('a resource policy after a comma is compared, not discarded with frame-ancestors', () => {
    // Base already carries two serialized policies in one value.
    const twoPolicies = structuredClone(base);
    twoPolicies.hosting[0].headers[1].headers = [
      { key: 'Content-Security-Policy', value: "default-src 'self', script-src 'self'" },
    ];
    const kept = structuredClone(twoPolicies);
    kept.hosting[0].headers[1].headers = [
      { key: 'Content-Security-Policy', value: "default-src 'self'; frame-ancestors 'none', script-src 'self'" },
      { key: 'X-Frame-Options', value: 'DENY' },
    ];
    assert.deepEqual(compareHostingConfigs(twoPolicies, kept), []);
    const lost = structuredClone(kept);
    lost.hosting[0].headers[1].headers[0].value = "default-src 'self'; frame-ancestors 'none'";
    assert.equal(compareHostingConfigs(twoPolicies, lost).length, 1);
    // Same at runtime: a whole policy after the comma must survive stripping.
    const snap = (csp) => ({ '/': { status: 200, headers: [['content-security-policy', csp]] } });
    assert.equal(compareSnapshots(snap("frame-ancestors 'none', script-src 'self'"), snap("frame-ancestors 'none'")).length, 1);
    assert.deepEqual(compareSnapshots(snap("script-src 'self'"), snap("frame-ancestors 'none', script-src 'self'")), []);
  });

  test('a routing change (rewrite, public dir) or a dropped site fails', () => {
    const rewrite = structuredClone(framed);
    rewrite.hosting[0].rewrites = [];
    assert.equal(compareHostingConfigs(base, rewrite).length, 1);
    const pub = structuredClone(framed);
    pub.hosting[0].public = 'build';
    assert.equal(compareHostingConfigs(base, pub).length, 1);
    assert.deepEqual(compareHostingConfigs(base, { hosting: [] }), ['hosting entry app removed']);
  });

  test('runtime snapshots: only framing headers may differ', () => {
    const baseSnap = { '/': { status: 200, headers: [['cache-control', 'no-cache'], ['content-type', 'text/html'], ['date', 'x']] } };
    const good = { '/': { status: 200, headers: [['cache-control', 'no-cache'], ['content-type', 'text/html'], ['date', 'y'], ['x-frame-options', 'DENY'], ['content-security-policy', "frame-ancestors 'none'"]] } };
    assert.deepEqual(compareSnapshots(baseSnap, good), []);
    const cache = structuredClone(good);
    cache['/'].headers[0][1] = 'max-age=60';
    assert.equal(compareSnapshots(baseSnap, cache).length, 1);
    const status = structuredClone(good);
    status['/'].status = 404;
    assert.equal(compareSnapshots(baseSnap, status).length, 1);
  });

  test("the emulator's built-in 404 CSP is ignored only on declared 404 routes", () => {
    const html = ['content-type', 'text/html'];
    const base404 = { '/x': { status: 404, headers: [html, ['content-security-policy', "default-src 'none'"]] } };
    const cur404 = { '/x': { status: 404, headers: [html, ['content-security-policy', "frame-ancestors 'none'"], ['x-frame-options', 'DENY']] } };
    assert.equal(compareSnapshots(base404, cur404).length, 1, 'undeclared: reported');
    assert.deepEqual(compareSnapshots(base404, cur404, ['/x']), []);
    // Declared, but another header changed: still reported.
    const cache = structuredClone(cur404);
    cache['/x'].headers.push(['cache-control', 'max-age=60']);
    assert.equal(compareSnapshots(base404, cache, ['/x']).length, 1);
    // Declared, but the route is not a 404 in the baseline: CSP compared as usual.
    const ok200 = { '/x': { status: 200, headers: [html, ['content-security-policy', "default-src 'none'"]] } };
    assert.equal(compareSnapshots(ok200, { '/x': { ...cur404['/x'], status: 200 } }, ['/x']).length, 1);
  });

  test('baseline stripping keeps other CSP directives', () => {
    const rules = [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; frame-ancestors 'none'" }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Cache-Control', value: 'no-cache' }] }, FRAMING_RULE];
    assert.deepEqual(stripFramingHeaders(rules), [
      { source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }, { key: 'Cache-Control', value: 'no-cache' }] },
    ]);
  });

  test('emulator copy drops function/run rewrites and deploy hooks', () => {
    const entry = {
      target: 'app',
      public: 'dist',
      predeploy: ['echo build'],
      rewrites: [
        { source: '/api/**', function: { functionId: 'api' } },
        { source: '/run/**', run: { serviceId: 'svc' } },
        { source: '**', destination: '/index.html' },
      ],
    };
    const copy = emulatorEntry(entry);
    assert.deepEqual(copy.rewrites, [{ source: '**', destination: '/index.html' }]);
    assert.equal(copy.predeploy, undefined);
    assert.equal(copy.target, undefined);
    assert.equal(copy.public, 'public');
    assert.equal(entry.rewrites.length, 3, 'the committed entry itself is not mutated');
  });
});

describe('live mode against local synthetic servers', () => {
  const MARKER = /<div id="app-marker">/;
  const APP_HTML = '<!doctype html><div id="app-marker"></div>';
  const GOOD = { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY' };
  let app; // the "requested" origin
  let other; // a different origin (different port): gateway / alias
  let appOrigin;
  let otherOrigin;
  const otherHits = []; // paths the foreign origin actually served
  const pathOf = (req) => new URL(req.url, 'http://fixture.example').pathname;

  const listen = (handler) =>
    new Promise((resolveListen) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolveListen(server));
    });
  const send = (res, status, headers, body = '') => {
    res.writeHead(status, headers);
    res.end(body);
  };

  before(async () => {
    other = await listen((req, res) => {
      const html = { 'content-type': 'text/html; charset=utf-8', ...GOOD };
      otherHits.push(pathOf(req));
      // A login gateway on another origin: protected and HTML, but not the app.
      if (pathOf(req) === '/login') return send(res, 200, html, '<!doctype html>sign in');
      if (pathOf(req) === '/alias') return send(res, 200, html, APP_HTML);
      return send(res, 404, html, 'nope');
    });
    otherOrigin = `http://127.0.0.1:${other.address().port}`;
    app = await listen((req, res) => {
      const html = { 'content-type': 'text/html; charset=utf-8' };
      // Dispatch on the path so requests carrying a query reach their handler.
      switch (pathOf(req)) {
        case '/ok': return send(res, 200, { ...html, ...GOOD }, APP_HTML);
        case '/bare': return send(res, 200, html, APP_HTML);
        case '/foreign': return send(res, 302, { location: `${otherOrigin}/login?token=s3cret-token` });
        case '/alias': return send(res, 301, { location: `${otherOrigin}/alias` });
        case '/moved': return send(res, 302, { location: '/ok' });
        case '/json': return send(res, 200, { 'content-type': 'application/json', ...GOOD }, '{}');
        case '/gateway': return send(res, 401, { ...html, ...GOOD }, APP_HTML);
        case '/challenge': return send(res, 200, { ...html, ...GOOD }, '<!doctype html>checking your browser');
        case '/dup': {
          res.setHeader('content-type', 'text/html');
          res.setHeader('content-security-policy', "frame-ancestors 'none'");
          res.setHeader('x-frame-options', ['DENY', 'DENY']);
          return res.end(APP_HTML);
        }
        default: return send(res, 404, { ...html, ...GOOD }, '<!doctype html>not found');
      }
    });
    appOrigin = `http://127.0.0.1:${app.address().port}`;
  });

  after(() => {
    app.close();
    other.close();
  });

  const run = async (targets, aliases = {}) => {
    const lines = [];
    const results = await liveCheck(targets, { print: (l) => lines.push(l), marker: MARKER, aliases, expected: DENY });
    return { results, output: lines.join('\n') };
  };
  const verdictOf = async (path, extra = {}) =>
    (await run([{ url: `${appOrigin}${path}`, ...extra }], extra.aliases)).results[0].verdict;

  test('the app document with the policy passes; without it fails', async () => {
    assert.equal(await verdictOf('/ok'), 'PASS');
    assert.equal(await verdictOf('/bare'), 'FAIL');
  });

  test('a protected foreign login gateway is UNKNOWN, and its token never reaches output', async () => {
    otherHits.length = 0;
    const { results, output } = await run([{ url: `${appOrigin}/foreign?session=s3cret-query` }]);
    // The 302 was really followed to the gateway (not a 404 on the app origin)…
    assert.deepEqual(otherHits, ['/login']);
    assert.match(output, /hop 0: http:\/\/127\.0\.0\.1:\d+ status=302/);
    assert.equal(results[0].verdict, 'UNKNOWN');
    assert.match(results[0].reasons.join(' '), /redirected away/);
    assert.doesNotMatch(output, /s3cret/);
    assert.doesNotMatch(output, /\/login/);
  });

  test('a cross-origin redirect passes only when that alias is allow-listed', async () => {
    assert.equal(await verdictOf('/alias'), 'UNKNOWN');
    const aliases = { [appOrigin]: [otherOrigin] };
    assert.equal((await run([{ url: `${appOrigin}/alias` }], aliases)).results[0].verdict, 'PASS');
  });

  test('a same-origin redirect to another path is UNKNOWN for the requested route', async () => {
    assert.equal(await verdictOf('/moved'), 'UNKNOWN');
  });

  test('non-HTML, auth status, challenge page and missing route are UNKNOWN', async () => {
    assert.equal(await verdictOf('/json'), 'UNKNOWN');
    assert.equal(await verdictOf('/gateway'), 'UNKNOWN');
    assert.equal(await verdictOf('/challenge'), 'UNKNOWN');
    assert.equal(await verdictOf('/no-such-route'), 'UNKNOWN');
  });

  test('a deliberately requested error page is judged on its own expected status', async () => {
    assert.equal(await verdictOf('/no-such-route', { expectStatus: 404 }), 'PASS');
  });

  test('two X-Frame-Options fields are seen as two (raw header boundaries kept)', async () => {
    assert.equal(await verdictOf('/dup'), 'FAIL');
  });

  test('a connection failure is UNKNOWN, not PASS', async () => {
    const closed = await listen(() => {});
    const { port } = closed.address();
    closed.close();
    assert.equal((await run([{ url: `http://127.0.0.1:${port}/ok` }])).results[0].verdict, 'UNKNOWN');
  });

  test('--error-page applies to the next URL only', () => {
    assert.deepEqual(parseLiveTargets(['--error-page', 'https://example.com/x', 'https://example.com/']), [
      { url: 'https://example.com/x', expectStatus: 404 },
      { url: 'https://example.com/', expectStatus: 200 },
    ]);
  });
});
