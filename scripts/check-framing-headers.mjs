#!/usr/bin/env node
/**
 * Clickjacking (framing) policy check for this repo's Firebase Hosting sites.
 *
 *   node scripts/check-framing-headers.mjs config [--baseline <git-ref>]
 *     Static check of firebase.json: every hosting entry carries the framing
 *     rule on `source: "**"` and no other rule can override it. With
 *     --baseline, also diffs every hosting entry against firebase.json at that
 *     git ref (e.g. the PR base) and fails on any difference other than the
 *     framing rule — rewrites, redirects, cache headers, public dir, ignore.
 *
 *   node scripts/check-framing-headers.mjs emulator [--baseline <git-ref>]
 *     Runs the config check, then serves each hosting entry through the
 *     Firebase Hosting emulator (the real header/rewrite/redirect engine) and
 *     GETs the routes in EMULATOR_ROUTES, asserting the framing policy, the
 *     expected status and an HTML content type. With --baseline, the config at
 *     that ref is served too and every route's status and non-framing headers
 *     must match it.
 *
 *   node scripts/check-framing-headers.mjs live [--error-page] <url> ...
 *     Read-only GET of deployed URLs after an authorized deploy. A URL only
 *     PASSes if the final response is the app's own HTML document at the
 *     requested origin and path (or an alias in LIVE_ORIGIN_ALIASES) with the
 *     expected status; anything else — foreign redirect, login gateway,
 *     challenge page, non-HTML, unexpected status, network error — is UNKNOWN,
 *     because then the app document was never inspected. `--error-page`
 *     marks the following URL as a deliberately requested 404 page.
 *     Prints origins, paths, statuses and framing headers only — never
 *     queries, Location values, cookies or bodies.
 *
 * Exit codes: 0 all PASS, 1 any FAIL, 2 usage/runtime error, 3 any UNKNOWN.
 *
 * This is a conformance check for THIS repo's chosen policy, not a general
 * framing auditor: it requires exactly one header owner stating the exact
 * expected `frame-ancestors` list and X-Frame-Options value. Header instances
 * are read raw (node:http rawHeaders), so two separate header fields are not
 * confused with one comma-joined field.
 *
 * Standard library only (node >= 20), so it adds no dependency just to verify
 * two headers.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Repo-specific settings. Everything below this block is repo-agnostic.
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Directory holding firebase.json / .firebaserc (repo root). */
export const HOSTING_DIR = resolve(SCRIPT_DIR, '..');

/**
 * No page of the web bundle is embedded by another page over HTTP and there
 * is no partner embedding, so nothing may frame it. Map Corridors' answer-
 * sheet print frame is a `srcdoc` document built in the page, not an HTTP
 * response, so it is unaffected (browser-verified under 'none'/DENY,
 * 2026-10-03).
 */
export const EXPECTED_POLICY = Object.freeze({
  frameAncestors: ["'none'"],
  xFrameOptions: 'DENY',
});

/**
 * Paths requested in emulator mode, with the status the committed routing must
 * produce (`html: false` marks a static asset, checked for headers but not
 * for an HTML content type). The landing is served without a rewrite, the two
 * sub-apps through their own `**` rewrites, and a missing page through
 * Hosting's 404 — all must carry the policy, because header globs match the
 * REQUESTED path. The asset pins the immutable Cache-Control rule.
 */
export const EMULATOR_ROUTES = Object.freeze([
  { path: '/', status: 200 },
  { path: '/index.html', status: 200 },
  { path: '/photo-helper/', status: 200 },
  { path: '/photo-helper/some/deep/route', status: 200 },
  { path: '/map-corridors/', status: 200 },
  { path: '/map-corridors/index.html', status: 200 },
  { path: '/map-corridors/some/deep/route', status: 200 },
  // Hosting's default 404 (no 404.html in the bundle); see compareSnapshots.
  { path: '/no-such-page', status: 404, emulator404: true },
  { path: '/map-corridors/assets/index-fixture.js', status: 200, html: false },
]);

/** Fixture files served instead of a build, so the check needs no web build. */
export const FIXTURE_FILES = Object.freeze({
  'index.html': '<!doctype html><title>framing-check landing</title><div id="root"></div>',
  'photo-helper/index.html': '<!doctype html><title>framing-check photo-helper</title><div id="root"></div>',
  'map-corridors/index.html': '<!doctype html><title>framing-check map-corridors</title><div id="root"></div>',
  'map-corridors/assets/index-fixture.js': 'export {};\n',
});

/**
 * The firebase-tools pinned in frontend/package.json and locked in
 * frontend/pnpm-lock.yaml (same CLI scripts/deploy-web.sh uses). Install it
 * first: `pnpm --dir frontend install --frozen-lockfile`.
 */
export const FIREBASE_CLI = Object.freeze([resolve(HOSTING_DIR, 'frontend/node_modules/.bin/firebase')]);

/** Hosting entries firebase.json must define (labels as printed by entryLabel). */
export const EXPECTED_HOSTING = Object.freeze(['hosting[0] (default site)']);

/**
 * Live mode: the final document must contain this, proving it is one of the
 * bundle's own index.html files (Vite's mount point), not a gateway page.
 */
export const LIVE_HTML_MARKER = /<div id="root"><\/div>/;

/**
 * Live mode: origin changes accepted during redirects (from -> allowed final
 * origins), path unchanged. Empty: every documented URL is requested over
 * https on the host that serves it, so ANY redirect means the intended
 * document was not inspected.
 */
export const LIVE_ORIGIN_ALIASES = Object.freeze({});

// ---------------------------------------------------------------------------
// Header parsing and evaluation
// ---------------------------------------------------------------------------

const FRAMING_HEADER_KEYS = Object.freeze([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
]);

/**
 * Parse ONE CSP header field into its policies.
 *
 * Returns `[Map<directive, string[]>]`. A comma inside one field separates
 * policies (CSP3 "parse a serialized CSP list"), a semicolon separates
 * directives. Only the FIRST occurrence of a directive within one policy
 * counts — browsers ignore a later duplicate, so it must be ignored here too.
 */
export function parseCsp(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((policy) => {
      const directives = new Map();
      for (const raw of policy.split(';')) {
        const tokens = raw.trim().split(/[\t\n\f\r ]+/).filter(Boolean);
        if (tokens.length === 0) continue;
        const name = tokens[0].toLowerCase();
        if (!directives.has(name)) directives.set(name, tokens.slice(1));
      }
      return directives;
    })
    .filter((directives) => directives.size > 0);
}

/** Lower-case keywords/hosts so `'NONE'` and `'none'` compare equal. */
function normaliseSources(sources) {
  return [...new Set(sources.map((s) => s.toLowerCase()))].sort();
}

/**
 * Group raw header fields into per-header lists of instances.
 *
 * Accepts `[[name, value], ...]` (raw pairs, as fetched — keeps duplicates)
 * or a plain `{ name: value }` record (one firebase.json rule). Returns
 * `{ 'content-security-policy': [..], 'content-security-policy-report-only': [..],
 *    'x-frame-options': [..] }`.
 */
export function framingInstances(headers) {
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers);
  const out = Object.fromEntries(FRAMING_HEADER_KEYS.map((k) => [k, []]));
  for (const [name, value] of pairs) {
    const key = String(name).toLowerCase();
    if (key in out && value !== undefined && value !== null) out[key].push(String(value));
  }
  return out;
}

/**
 * Decide whether headers carry exactly the expected, singly-owned framing policy.
 *
 * Returns `{ ok, reasons }`. Deliberately strict, because it checks what we
 * AUTHORED rather than what a browser would merely tolerate:
 *  - exactly one enforcing CSP policy states frame-ancestors, with exactly the
 *    expected source list (a second policy means a second owner);
 *  - exactly one X-Frame-Options field, whose whole value is the expected
 *    keyword (repeated or comma-joined values are a configuration defect).
 * Report-only CSP is ignored: it blocks nothing, so it can never satisfy the
 * check. A CSP <meta> cannot carry frame-ancestors, so only headers are read.
 */
export function evaluateFraming(headers, expected = EXPECTED_POLICY) {
  const inst = framingInstances(headers);
  const reasons = [];

  const ancestorLists = inst['content-security-policy']
    .flatMap(parseCsp)
    .filter((policy) => policy.has('frame-ancestors'))
    .map((policy) => normaliseSources(policy.get('frame-ancestors')));
  const want = normaliseSources(expected.frameAncestors).join(' ');
  if (ancestorLists.length === 0) {
    reasons.push('no enforcing Content-Security-Policy frame-ancestors');
  } else if (ancestorLists.length > 1) {
    reasons.push(`frame-ancestors stated by ${ancestorLists.length} policies, expected exactly one`);
  }
  for (const list of ancestorLists) {
    if (list.join(' ') !== want) {
      reasons.push(`frame-ancestors is "${list.join(' ')}", expected "${want}"`);
    }
  }

  const xfo = inst['x-frame-options'];
  if (xfo.length !== 1) {
    reasons.push(`X-Frame-Options sent ${xfo.length} time(s), expected exactly once`);
  } else if (xfo[0].trim().toLowerCase() !== expected.xFrameOptions.toLowerCase()) {
    reasons.push(`X-Frame-Options is "${xfo[0]}", expected "${expected.xFrameOptions}"`);
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Static firebase.json checks
// ---------------------------------------------------------------------------

/** firebase.json allows `hosting` as one object or an array of sites/targets. */
export function hostingEntries(firebaseJson) {
  const hosting = firebaseJson.hosting;
  if (!hosting) return [];
  return Array.isArray(hosting) ? hosting : [hosting];
}

/** Human-readable name for a hosting entry in messages. */
export function entryLabel(entry, index) {
  if (entry.target) return `target "${entry.target}"`;
  if (entry.site) return `site "${entry.site}"`;
  return `hosting[${index}] (default site)`;
}

const isFramingKey = (key) => FRAMING_HEADER_KEYS.includes(String(key).toLowerCase());

/**
 * Check every hosting entry for the framing rule. Returns problems (empty = pass).
 *
 *  - a `source: "**"` rule sets both headers with the expected values, because
 *    `**` is the only glob guaranteed to match SPA deep links and 404s;
 *  - no OTHER rule sets either header (or CSP-Report-Only): Hosting applies
 *    matching rules in order with the last value per key winning, so a later
 *    narrower rule could silently weaken the policy on its paths;
 *  - every hosting target named in .firebaserc has an entry.
 */
export function checkHostingConfig(firebaseJson, firebaserc = {}, expected = EXPECTED_POLICY) {
  const problems = [];
  const entries = hostingEntries(firebaseJson);
  if (entries.length === 0) problems.push('firebase.json has no hosting entries');

  entries.forEach((entry, index) => {
    const label = entryLabel(entry, index);
    const framingRules = (entry.headers ?? []).filter((rule) =>
      (rule.headers ?? []).some((h) => isFramingKey(h.key)),
    );
    const catchAll = framingRules.filter((rule) => rule.source === '**');
    if (catchAll.length !== 1 || framingRules.length !== 1) {
      problems.push(
        `${label}: expected exactly one framing rule and it must use source "**" ` +
          `(found ${framingRules.length} framing rule(s), ${catchAll.length} on "**")`,
      );
      return;
    }
    const pairs = catchAll[0].headers.map((h) => [h.key, h.value]);
    if (framingInstances(pairs)['content-security-policy-report-only'].length > 0) {
      problems.push(`${label}: framing rule must not use Content-Security-Policy-Report-Only`);
    }
    for (const reason of evaluateFraming(pairs, expected).reasons) problems.push(`${label}: ${reason}`);
  });

  const configuredTargets = new Set(entries.map((e) => e.target).filter(Boolean));
  for (const [project, kinds] of Object.entries(firebaserc.targets ?? {})) {
    for (const target of Object.keys(kinds.hosting ?? {})) {
      if (!configuredTargets.has(target)) {
        problems.push(`.firebaserc target "${target}" (project ${project}) has no hosting entry`);
      }
    }
  }
  return problems;
}

/**
 * Remove frame-ancestors from a CSP value; null when nothing else remains.
 *
 * Works per serialized policy (comma-separated), so in
 * `frame-ancestors 'none', script-src 'self'` the second policy survives
 * intact instead of being dropped along with the first.
 */
function cspWithoutFrameAncestors(value) {
  const policies = String(value)
    .split(',')
    .map((policy) =>
      policy
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^frame-ancestors(\s|$)/i.test(d))
        .join('; '),
    )
    .filter(Boolean);
  return policies.length ? policies.join(', ') : null;
}

/**
 * Remove the framing policy from header rules. A CSP carrying other
 * directives keeps them — only frame-ancestors goes — so a full resource
 * policy is still compared directive-for-directive.
 */
export function stripFramingHeaders(rules) {
  return rules
    .map((rule) => ({
      ...rule,
      headers: (rule.headers ?? []).flatMap((h) => {
        const key = String(h.key).toLowerCase();
        if (key === 'x-frame-options') return [];
        if (key !== 'content-security-policy') return [h];
        const rest = cspWithoutFrameAncestors(h.value);
        return rest ? [{ ...h, value: rest }] : [];
      }),
    }))
    .filter((rule) => rule.headers.length > 0);
}

/** A hosting entry with the framing policy removed (headers dropped if empty). */
function withoutFraming(entry) {
  const copy = structuredClone(entry);
  if (copy.headers) {
    copy.headers = stripFramingHeaders(copy.headers);
    if (copy.headers.length === 0) delete copy.headers;
  }
  return copy;
}

/**
 * Compare two firebase.json files' hosting sections ignoring only the framing
 * policy. Returns differences (empty = the change is framing-only).
 *
 * This is what proves preservation: the baseline is the config at an
 * immutable git ref, not something derived from the edited file.
 */
export function compareHostingConfigs(baseJson, currentJson) {
  const key = (entry, i) => entry.target ?? entry.site ?? `#${i}`;
  const base = new Map(hostingEntries(baseJson).map((e, i) => [key(e, i), withoutFraming(e)]));
  const current = new Map(hostingEntries(currentJson).map((e, i) => [key(e, i), withoutFraming(e)]));
  const diffs = [];
  for (const name of new Set([...base.keys(), ...current.keys()])) {
    const a = base.get(name);
    const b = current.get(name);
    if (!a) diffs.push(`hosting entry ${name} added`);
    else if (!b) diffs.push(`hosting entry ${name} removed`);
    else if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push(`hosting entry ${name} changed beyond framing:\n  base    ${JSON.stringify(a)}\n  current ${JSON.stringify(b)}`);
    }
  }
  return diffs;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadHostingConfig() {
  const rcPath = join(HOSTING_DIR, '.firebaserc');
  return {
    firebaseJson: readJson(join(HOSTING_DIR, 'firebase.json')),
    firebaserc: existsSync(rcPath) ? readJson(rcPath) : {},
  };
}

/** firebase.json as committed at a git ref (read-only `git show`). */
function loadBaselineConfig(ref) {
  const result = spawnSync('git', ['-C', HOSTING_DIR, 'show', `${ref}:./firebase.json`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`cannot read firebase.json at ${ref}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// HTTP fetching (emulator + live)
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 10;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * One GET with node:http(s). Returns `{ status, headers, body }` where
 * `headers` is `[[lower-case name, value], ...]` straight from rawHeaders, so
 * two header fields stay two entries. No cookies or credentials are sent.
 */
export function httpGet(url, { timeoutMs = 30_000 } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = client.get(
      target,
      { headers: { 'user-agent': 'framing-header-check/2', accept: 'text/html' } },
      (res) => {
        const headers = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          headers.push([res.rawHeaders[i].toLowerCase(), res.rawHeaders[i + 1]]);
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          // Enough to find the app marker; never buffer an unbounded body.
          if (size <= MAX_BODY_BYTES) chunks.push(chunk);
        });
        res.on('end', () =>
          resolvePromise({ status: res.statusCode, headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on('error', reject);
  });
}

const headerValue = (headers, name) => headers.find(([k]) => k === name)?.[1] ?? null;

/**
 * GET a URL, following redirects by hand so every hop is visible.
 *
 * Returns `{ hops: [{ origin, status }], final: { url, status, headers, body } }`.
 * The FINAL response is what a browser would frame; a protective header on an
 * intermediate 301 counts for nothing. Hops keep only the origin, so a token
 * in a redirect path or query never reaches output.
 */
export async function fetchChain(url, options = {}) {
  const hops = [];
  let current = new URL(url);
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    if (!['http:', 'https:'].includes(current.protocol)) {
      throw new Error(`refusing redirect to non-HTTP(S) scheme ${current.protocol}`);
    }
    const response = await httpGet(current, options);
    hops.push({ origin: current.origin, status: response.status });
    const location = headerValue(response.headers, 'location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    return { hops, final: { url: current, ...response } };
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects`);
}

/** Origin + path only: drops userinfo, query and fragment. */
export function sanitiseUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

// ---------------------------------------------------------------------------
// Live verdicts
// ---------------------------------------------------------------------------

/**
 * Judge one fetched chain for one requested URL. Pure, so it is unit-tested
 * against synthetic chains. Returns `{ verdict: 'PASS'|'FAIL'|'UNKNOWN', reasons }`.
 *
 * UNKNOWN means "the intended document was not what we looked at": the final
 * response came from another origin/path, had an unexpected status, was not
 * HTML, or lacked the app marker (a login gateway or bot challenge serving
 * its own page). Only once the right document is established do the framing
 * headers decide PASS or FAIL.
 */
export function judgeLive(requestedUrl, chain, {
  expectStatus = 200,
  marker = LIVE_HTML_MARKER,
  aliases = LIVE_ORIGIN_ALIASES,
  expected = EXPECTED_POLICY,
} = {}) {
  const requested = new URL(requestedUrl);
  const final = chain.final;
  const reasons = [];
  const allowedOrigins = new Set([requested.origin, ...(aliases[requested.origin] ?? [])]);
  if (!allowedOrigins.has(final.url.origin) || final.url.pathname !== requested.pathname) {
    reasons.push('redirected away from the requested origin/path');
  }
  if (final.status !== expectStatus) {
    reasons.push(`final status ${final.status}, expected ${expectStatus}`);
  }
  const contentType = headerValue(final.headers, 'content-type') ?? '';
  if (!/^text\/html\b/i.test(contentType)) {
    reasons.push(`final content type "${contentType}" is not HTML`);
  }
  if (expectStatus === 200 && marker && !marker.test(final.body ?? '')) {
    reasons.push('final HTML is not the app document (marker missing: gateway, challenge or other page?)');
  }
  if (reasons.length) return { verdict: 'UNKNOWN', reasons };

  const framing = evaluateFraming(final.headers, expected);
  return framing.ok ? { verdict: 'PASS', reasons: [] } : { verdict: 'FAIL', reasons: framing.reasons };
}

/**
 * Fetch and judge each target. `targets` is `[{ url, expectStatus }]`.
 * Returns result objects; output goes through `print` so tests can capture it.
 */
export async function liveCheck(targets, { print = console.log, ...options } = {}) {
  const results = [];
  print(`checked_at_utc=${new Date().toISOString()}`);
  for (const { url, expectStatus = 200 } of targets) {
    const shown = sanitiseUrl(url);
    let chain;
    try {
      chain = await fetchChain(url, options);
    } catch (error) {
      // A fetch failure is UNKNOWN, not a pass: nothing was observed.
      results.push({ url: shown, verdict: 'UNKNOWN', reasons: [error.message] });
      print(`UNKNOWN ${shown}: ${error.message}`);
      continue;
    }
    const { verdict, reasons } = judgeLive(url, chain, { expectStatus, ...options });
    results.push({ url: shown, verdict, reasons });
    print(`${verdict} ${shown} (expected status ${expectStatus})`);
    chain.hops.forEach((hop, i) => print(`  hop ${i}: ${hop.origin} status=${hop.status}`));
    print(`  final: ${chain.final.url.origin} content-type=${headerValue(chain.final.headers, 'content-type') ?? '-'}`);
    for (const [key, value] of chain.final.headers) {
      if (FRAMING_HEADER_KEYS.includes(key)) print(`    ${key}: ${value}`);
    }
    for (const reason of reasons) print(`    reason: ${reason}`);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Emulator mode
// ---------------------------------------------------------------------------

// Fixed, uncommon ports so the run neither depends on nor collides with a
// developer's default emulator ports (4000/4400/5000/8080).
const EMULATOR_PORTS = Object.freeze({ hosting: 5089, hub: 4489, logging: 4589 });

/**
 * Copy a hosting entry for the emulator: fixture public dir, no predeploy or
 * postdeploy hooks, no target/site binding (served as the default site), and
 * no function/Cloud Run rewrites — the emulator would proxy those to the
 * DEPLOYED backend, which a header check must never call.
 */
export function emulatorEntry(entry) {
  const copy = structuredClone(entry);
  delete copy.target;
  delete copy.site;
  delete copy.predeploy;
  delete copy.postdeploy;
  copy.public = 'public';
  if (copy.rewrites) copy.rewrites = copy.rewrites.filter((r) => !r.function && !r.run);
  return copy;
}

// Headers that legitimately differ between two runs of the same config.
const VOLATILE_HEADERS = new Set(['date', 'etag', 'last-modified', 'connection', 'keep-alive']);

/**
 * A response's non-volatile headers with the framing policy removed, as a
 * sorted list of `name: value` strings (duplicates kept).
 */
export function comparableHeaders(headers) {
  const out = [];
  for (const [key, value] of headers) {
    if (VOLATILE_HEADERS.has(key) || key === 'x-frame-options') continue;
    if (key === 'content-security-policy') {
      const rest = cspWithoutFrameAncestors(value);
      if (rest) out.push(`${key}: ${rest}`);
      continue;
    }
    out.push(`${key}: ${value}`);
  }
  return out.sort();
}

/**
 * Compare per-route snapshots (`{ [path]: { status, headers } }`) from the
 * baseline and current config. Any status or non-framing header difference is
 * reported — this is the runtime half of the preservation proof.
 *
 * `emulator404Paths` lists routes answered by the emulator's BUILT-IN 404
 * page. The emulator (superstatic) stamps that page with its own
 * `Content-Security-Policy: default-src 'none'`, which any configured CSP
 * header replaces. Production Hosting's default 404 sends no CSP at all
 * (checked by GET on 2026-10-03), so for those routes only the CSP header is
 * left out of the comparison; status and every other header still count.
 */
export function compareSnapshots(base, current, emulator404Paths = []) {
  const diffs = [];
  const withoutCsp = (headers) => headers.filter(([k]) => k !== 'content-security-policy');
  for (const path of Object.keys(current)) {
    const a = base[path];
    const b = current[path];
    if (!a) {
      diffs.push(`${path}: missing from baseline run`);
      continue;
    }
    if (a.status !== b.status) diffs.push(`${path}: status ${b.status}, baseline ${a.status}`);
    const skipCsp = emulator404Paths.includes(path) && a.status === 404;
    const ha = JSON.stringify(comparableHeaders(skipCsp ? withoutCsp(a.headers) : a.headers));
    const hb = JSON.stringify(comparableHeaders(skipCsp ? withoutCsp(b.headers) : b.headers));
    if (ha !== hb) diffs.push(`${path}: non-framing headers changed\n  baseline ${ha}\n  current  ${hb}`);
  }
  return diffs;
}

/** Fetch every route from a running emulator and write a JSON snapshot. */
async function snapshotRoutes(baseUrl, outPath) {
  const snapshot = {};
  for (const { path } of EMULATOR_ROUTES) {
    const { final, hops } = await fetchChain(new URL(path, baseUrl).href);
    snapshot[path] = {
      status: final.status,
      finalPath: final.url.pathname,
      redirects: hops.length - 1,
      headers: final.headers,
    };
  }
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
}

/** Serve one hosting entry in the emulator and snapshot all routes. */
function runEmulator(entry, label) {
  // Outside the repo, so no fixture can end up in a deployed public dir.
  const dir = mkdtempSync(join(tmpdir(), 'framing-check-'));
  for (const [file, body] of Object.entries(FIXTURE_FILES)) {
    mkdirSync(dirname(join(dir, 'public', file)), { recursive: true });
    writeFileSync(join(dir, 'public', file), body);
  }
  writeFileSync(
    join(dir, 'firebase.json'),
    JSON.stringify({
      hosting: emulatorEntry(entry),
      emulators: {
        hosting: { port: EMULATOR_PORTS.hosting, host: '127.0.0.1' },
        hub: { port: EMULATOR_PORTS.hub, host: '127.0.0.1' },
        logging: { port: EMULATOR_PORTS.logging, host: '127.0.0.1' },
        ui: { enabled: false },
      },
    }),
  );
  const outPath = join(dir, 'snapshot.json');
  const inner = [
    process.execPath,
    fileURLToPath(import.meta.url),
    '__snapshot',
    `http://127.0.0.1:${EMULATOR_PORTS.hosting}`,
    outPath,
  ]
    .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
    .join(' ');
  if (FIREBASE_CLI[0].includes('/') && !existsSync(FIREBASE_CLI[0])) {
    throw new Error(`Firebase CLI not installed at ${FIREBASE_CLI[0]} — install its locked deps first`);
  }
  // A demo- project id keeps the emulator offline: no project lookup, no
  // credentials, no calls to deployed resources.
  const result = spawnSync(
    FIREBASE_CLI[0],
    [...FIREBASE_CLI.slice(1), 'emulators:exec', '--only', 'hosting', '--project', 'demo-framing-check', inner],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0 || !existsSync(outPath)) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`hosting emulator run failed for ${label} (exit ${result.status})`);
  }
  return readJson(outPath);
}

async function emulatorMode(baselineRef) {
  const { firebaseJson, firebaserc } = loadHostingConfig();
  const failures = checkHostingConfig(firebaseJson, firebaserc);
  const baseJson = baselineRef ? loadBaselineConfig(baselineRef) : null;
  if (baseJson) failures.push(...compareHostingConfigs(baseJson, firebaseJson));
  if (failures.length) return failures;

  const baseEntries = baseJson ? hostingEntries(baseJson) : [];
  hostingEntries(firebaseJson).forEach((entry, index) => {
    const label = entryLabel(entry, index);
    const actual = runEmulator(entry, label);
    for (const { path, status, html = true } of EMULATOR_ROUTES) {
      const got = actual[path];
      const problems = [...evaluateFraming(got.headers).reasons];
      if (got.status !== status) problems.push(`status ${got.status}, expected ${status}`);
      if (html && !/^text\/html\b/i.test(headerValue(got.headers, 'content-type') ?? '')) {
        problems.push('response is not HTML');
      }
      console.log(`${problems.length ? 'FAIL' : 'PASS'} ${label} GET ${path} -> ${got.status}`);
      for (const p of problems) failures.push(`${label} ${path}: ${p}`);
    }
    if (baseJson) {
      // compareHostingConfigs already proved the entry exists in the baseline.
      const baseEntry = baseEntries.find((e) => entryLabel(e, index) === label) ?? baseEntries[index];
      const baseline = runEmulator(baseEntry, `${label} (baseline ${baselineRef})`);
      const emulator404Paths = EMULATOR_ROUTES.filter((r) => r.emulator404).map((r) => r.path);
      const diffs = compareSnapshots(baseline, actual, emulator404Paths);
      console.log(`${diffs.length ? 'FAIL' : 'PASS'} ${label} matches ${baselineRef} apart from framing headers`);
      for (const d of diffs) failures.push(`${label} vs ${baselineRef}: ${d}`);
    }
  });
  return failures;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Pull `--baseline <ref>` out of argv. */
function takeBaseline(args) {
  const i = args.indexOf('--baseline');
  if (i === -1) return null;
  const ref = args[i + 1];
  if (!ref || ref.startsWith('--')) throw new Error('--baseline needs a git ref');
  return ref;
}

/** `live` args: URLs, each optionally preceded by --error-page (expects 404). */
export function parseLiveTargets(args) {
  const targets = [];
  let expectStatus = 200;
  for (const arg of args) {
    if (arg === '--error-page') {
      expectStatus = 404;
      continue;
    }
    targets.push({ url: new URL(arg).href, expectStatus });
    expectStatus = 200;
  }
  return targets;
}

async function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === 'config') {
    const { firebaseJson, firebaserc } = loadHostingConfig();
    const failures = checkHostingConfig(firebaseJson, firebaserc);
    const ref = takeBaseline(rest);
    if (ref) failures.push(...compareHostingConfigs(loadBaselineConfig(ref), firebaseJson));
    for (const f of failures) console.error(`FAIL ${f}`);
    if (failures.length === 0) {
      const labels = hostingEntries(firebaseJson).map(entryLabel).join(', ');
      console.log(`PASS framing rule present on ${labels}${ref ? `; otherwise identical to ${ref}` : ''}`);
    }
    return failures.length ? 1 : 0;
  }
  if (mode === 'emulator') {
    const failures = await emulatorMode(takeBaseline(rest));
    for (const f of failures) console.error(`FAIL ${f}`);
    return failures.length ? 1 : 0;
  }
  if (mode === 'live') {
    const targets = parseLiveTargets(rest);
    if (targets.length === 0) throw new Error('live mode needs at least one URL');
    const results = await liveCheck(targets);
    if (results.some((r) => r.verdict === 'FAIL')) return 1;
    return results.some((r) => r.verdict === 'UNKNOWN') ? 3 : 0;
  }
  if (mode === '__snapshot') {
    await snapshotRoutes(rest[0], rest[1]);
    return 0;
  }
  console.error('usage: check-framing-headers.mjs config|emulator [--baseline <ref>] | live [--error-page] <url>...');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
}
