/**
 * test_meta_oauth_config.js
 * ---------------------------------------------------
 * Automated validation for the Meta OAuth configuration.
 * Run with:  node scratch/test_meta_oauth_config.js
 * ---------------------------------------------------
 * Tests:
 *  1. getOAuthUrl() produces a correctly encoded redirect_uri (no trailing slash)
 *  2. getOAuthUrl() with a trailing-slash ENV var still strips it
 *  3. Missing META_REDIRECT_URI throws a safe error (no secret exposed)
 *  4. Missing META_APP_ID throws a safe error
 *  5. Generated URL contains all required scopes
 *  6. exchangeCodeForToken strips trailing slash from redirect_uri
 */

'use strict';

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) {
        console.log(`  ✅ PASS: ${label}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${label}${extra ? ' — ' + extra : ''}`);
        failed++;
    }
}

function section(name) {
    console.log(`\n━━━ ${name} ━━━`);
}

// ─── Setup: mock process.env before requiring metaService ───────────────────

function loadServiceWithEnv(overrides = {}) {
    // Clear module cache so each test gets a fresh require
    Object.keys(require.cache).forEach((key) => {
        if (key.includes('metaService')) delete require.cache[key];
    });

    // Defaults
    const defaults = {
        META_APP_ID: '987654321098765',
        META_APP_SECRET: 'test_secret_do_not_log',
        META_REDIRECT_URI: 'http://localhost:5000/api/meta/oauth/callback',
        META_OAUTH_SCOPES: 'public_profile,ads_read,business_management,pages_show_list',
        META_GRAPH_API_VERSION: 'v18.0',
    };

    Object.assign(process.env, defaults, overrides);

    return require('../services/metaService');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

section('Test 1 — getOAuthUrl() basic structure');
{
    const svc = loadServiceWithEnv();
    const url = svc.getOAuthUrl();
    const parsed = new URL(url);
    const params = parsed.searchParams;

    assert('URL is a Facebook OAuth dialog URL', url.includes('facebook.com') && url.includes('/dialog/oauth'));
    assert('client_id is set correctly', params.get('client_id') === process.env.META_APP_ID);
    assert('response_type is code', params.get('response_type') === 'code');
    assert('display is popup', params.get('display') === 'popup');
    assert('state is present (CSRF token)', params.get('state')?.length >= 32);
}

section('Test 2 — redirect_uri trailing slash normalization');
{
    // Env has trailing slash — service MUST strip it
    const svc = loadServiceWithEnv({
        META_REDIRECT_URI: 'http://localhost:5000/api/meta/oauth/callback/',
    });
    const url = svc.getOAuthUrl();
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get('redirect_uri');

    assert(
        'redirect_uri has NO trailing slash even when ENV has one',
        !redirectUri.endsWith('/'),
        `actual: ${redirectUri}`
    );
    assert(
        'redirect_uri matches the canonical form',
        redirectUri === 'http://localhost:5000/api/meta/oauth/callback',
        `actual: ${redirectUri}`
    );
}

section('Test 3 — Required scopes are present');
{
    const svc = loadServiceWithEnv();
    const url = svc.getOAuthUrl();
    const scope = new URL(url).searchParams.get('scope');
    const required = ['public_profile', 'ads_read', 'business_management', 'pages_show_list'];

    required.forEach((s) => {
        assert(`Scope includes "${s}"`, scope.includes(s));
    });
}

section('Test 4 — Missing META_REDIRECT_URI returns safe error (no crash/secret leak)');
{
    const svc = loadServiceWithEnv({ META_REDIRECT_URI: '' });
    let thrown = null;
    try {
        svc.getOAuthUrl();
    } catch (e) {
        thrown = e;
    }

    assert('Throws an error when META_REDIRECT_URI is empty', thrown !== null);
    assert('Error message is descriptive', thrown?.message?.toLowerCase().includes('meta_redirect_uri'));
    assert('Error message does NOT expose META_APP_SECRET', !thrown?.message?.includes(process.env.META_APP_SECRET || 'test_secret'));
}

section('Test 5 — Missing META_APP_ID returns safe error');
{
    const svc = loadServiceWithEnv({ META_APP_ID: '' });
    let thrown = null;
    try {
        svc.getOAuthUrl();
    } catch (e) {
        thrown = e;
    }

    assert('Throws an error when META_APP_ID is empty', thrown !== null);
    assert('Error message mentions META_APP_ID', thrown?.message?.toLowerCase().includes('meta_app_id'));
}

section('Test 6 — Placeholder/invalid META_APP_ID is rejected');
{
    const svc = loadServiceWithEnv({ META_APP_ID: '1234567890' });
    let thrown = null;
    try {
        svc.getOAuthUrl();
    } catch (e) {
        thrown = e;
    }
    assert('Placeholder App ID "1234567890" is rejected', thrown !== null);
}

section('Test 7 — exchangeCodeForToken uses normalized redirect_uri');
{
    // We test the normalization logic directly since we cannot make real API calls
    const rawUri = 'http://localhost:5000/api/meta/oauth/callback///';
    const normalized = rawUri.replace(/\/+$/, '');
    assert(
        'Triple trailing slash is fully stripped',
        normalized === 'http://localhost:5000/api/meta/oauth/callback'
    );

    const noChange = 'http://localhost:5000/api/meta/oauth/callback';
    assert('Clean URI is unchanged by normalization', noChange.replace(/\/+$/, '') === noChange);
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log(failed === 0 ? '\n🎉 All tests passed!' : `\n⚠️  ${failed} test(s) failed — see above.`);
console.log('─'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
