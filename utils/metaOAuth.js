const crypto = require('crypto');

const STATE_MAX_AGE_MS = 15 * 60 * 1000;

function getStateSecret() {
    return process.env.META_OAUTH_STATE_SECRET || process.env.JWT_SECRET || 'dev_secret';
}

/**
 * Single source of truth for redirect URI normalization.
 * Never derive from req.hostname, window.location, or seller storefront domains.
 */
function normalizeRedirectUri(uri) {
    if (!uri || uri === 'undefined') return '';

    let normalized = String(uri).trim().replace(/\/+$/, '');

    // Facebook does not support https://localhost for local OAuth callbacks
    if (/^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(normalized)) {
        normalized = normalized.replace(/^https:/i, 'http:');
    }

    // Common misconfiguration: admin panel port used as callback
    normalized = normalized.replace(/localhost:3001/i, 'localhost:5000');
    normalized = normalized.replace(/127\.0\.0\.1:3001/i, '127.0.0.1:5000');

    return normalized;
}

function normalizeBaseUrl(url, fallback) {
    const value = (url && url !== 'undefined' ? url : fallback) || '';
    return String(value).trim().replace(/\/+$/, '');
}

function getCanonicalOAuthConfig() {
    const port = process.env.PORT || 5000;
    const backendUrl = normalizeBaseUrl(
        process.env.BACKEND_URL,
        `http://localhost:${port}`
    );
    const frontendUrl = normalizeBaseUrl(
        process.env.FRONTEND_URL || process.env.ADMIN_APP_URL,
        'http://localhost:3001'
    );

    let redirectUri = normalizeRedirectUri(process.env.META_REDIRECT_URI);

    // Auto-build callback from BACKEND_URL if META_REDIRECT_URI is missing
    if (!redirectUri && backendUrl) {
        redirectUri = `${backendUrl}/api/meta/oauth/callback`;
    }

    const scopes = (process.env.META_OAUTH_SCOPES || 'public_profile,ads_read,business_management,pages_show_list')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(',');

    return {
        appId: process.env.META_APP_ID,
        redirectUri,
        frontendUrl,
        backendUrl,
        scopes,
        graphVersion: process.env.META_GRAPH_API_VERSION || 'v18.0',
    };
}

function hostFromUrl(urlString) {
    try {
        return new URL(urlString).hostname;
    } catch {
        return null;
    }
}

function deriveRequiredAppDomains(config) {
    const domains = new Set();

    const redirectHost = hostFromUrl(config.redirectUri);
    const frontendHost = hostFromUrl(config.frontendUrl);
    const backendHost = hostFromUrl(config.backendUrl);

    [redirectHost, frontendHost, backendHost].forEach((host) => {
        if (!host) return;
        if (host === '127.0.0.1') {
            domains.add('localhost');
        } else {
            domains.add(host);
        }
    });

    return Array.from(domains);
}

function deriveJavascriptSdkDomains(config) {
    const host = hostFromUrl(config.frontendUrl);
    if (!host) return ['localhost'];
    return host === '127.0.0.1' ? ['localhost'] : [host];
}

function buildConfigWarnings(config) {
    const warnings = [];

    if (!config.appId || config.appId === '1234567890') {
        warnings.push({ code: 'missing_env', message: 'META_APP_ID is not configured.' });
    }

    if (!process.env.META_APP_SECRET || process.env.META_APP_SECRET === 'undefined') {
        warnings.push({ code: 'missing_env', message: 'META_APP_SECRET is not configured on the backend.' });
    }

    if (!config.redirectUri) {
        warnings.push({ code: 'missing_env', message: 'META_REDIRECT_URI is not configured.' });
    } else {
        if (!config.redirectUri.endsWith('/api/meta/oauth/callback')) {
            warnings.push({
                code: 'invalid_callback_path',
                message: 'META_REDIRECT_URI should end with /api/meta/oauth/callback',
            });
        }

        if (/localhost:3001|127\.0\.0\.1:3001/i.test(config.redirectUri)) {
            warnings.push({
                code: 'wrong_callback_port',
                message: 'OAuth callback must use the backend port (5000), not the admin panel port (3001).',
            });
        }

        if (/^https:\/\/(localhost|127\.0\.0\.1)/i.test(process.env.META_REDIRECT_URI || '')) {
            warnings.push({
                code: 'https_localhost',
                message: 'Use http:// (not https://) for localhost OAuth callbacks.',
            });
        }

        const redirectHost = hostFromUrl(config.redirectUri);
        const backendHost = hostFromUrl(config.backendUrl);
        if (redirectHost && backendHost && redirectHost !== backendHost && redirectHost !== 'localhost' && backendHost !== 'localhost') {
            warnings.push({
                code: 'backend_domain_mismatch',
                message: 'META_REDIRECT_URI host should match BACKEND_URL host in production.',
            });
        }
    }

    return warnings;
}

exports.buildOAuthConfigCheck = () => {
    const config = getCanonicalOAuthConfig();
    const warnings = buildConfigWarnings(config);

    return {
        appIdExists: !!(config.appId && config.appId !== 'undefined' && config.appId !== '1234567890'),
        appSecretConfigured: !!(process.env.META_APP_SECRET && process.env.META_APP_SECRET !== 'undefined'),
        redirectUri: config.redirectUri,
        frontendUrl: config.frontendUrl,
        backendUrl: config.backendUrl,
        scopes: config.scopes,
        environment: process.env.NODE_ENV || 'development',
        requiredAppDomains: deriveRequiredAppDomains(config),
        requiredValidOAuthRedirectUris: config.redirectUri ? [config.redirectUri] : [],
        requiredJavascriptSdkDomains: deriveJavascriptSdkDomains(config),
        facebookLoginSettings: {
            clientOAuthLogin: true,
            webOAuthLogin: true,
        },
        isConfigValid: warnings.filter((w) => w.code === 'missing_env' || w.code === 'wrong_callback_port').length === 0
            && !!config.redirectUri
            && !!config.appId,
        warnings,
    };
};

exports.createOAuthState = ({ userId, storeId = null, returnUrl = '/meta' } = {}) => {
    const payload = {
        userId: userId ? String(userId) : null,
        storeId: storeId ? String(storeId) : null,
        returnUrl: returnUrl || '/meta',
        nonce: crypto.randomBytes(16).toString('hex'),
        ts: Date.now(),
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', getStateSecret())
        .update(payloadB64)
        .digest('base64url');

    return `${payloadB64}.${signature}`;
};

exports.verifyOAuthState = (state) => {
    if (!state || typeof state !== 'string') {
        const err = new Error('OAuth state is missing or invalid');
        err.code = 'invalid_state';
        throw err;
    }

    const [payloadB64, signature] = state.split('.');
    if (!payloadB64 || !signature) {
        const err = new Error('OAuth state format is invalid');
        err.code = 'invalid_state';
        throw err;
    }

    const expected = crypto
        .createHmac('sha256', getStateSecret())
        .update(payloadB64)
        .digest('base64url');

    if (signature !== expected) {
        const err = new Error('OAuth state signature verification failed');
        err.code = 'invalid_state';
        throw err;
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        const err = new Error('OAuth state payload is corrupt');
        err.code = 'invalid_state';
        throw err;
    }

    if (!payload.ts || Date.now() - payload.ts > STATE_MAX_AGE_MS) {
        const err = new Error('OAuth state has expired. Please try connecting again.');
        err.code = 'invalid_state';
        throw err;
    }

    return payload;
};

exports.getCanonicalOAuthConfig = getCanonicalOAuthConfig;
exports.normalizeRedirectUri = normalizeRedirectUri;

exports.mapFacebookOAuthError = (error, errorMessage, errorCode) => {
    const msg = String(errorMessage || error || '').toLowerCase();

    if (String(errorCode) === '1349048' || msg.includes("domain of this url isn't included")) {
        return {
            code: 'app_domain_mismatch',
            message: "Facebook blocked the redirect URL. Add 'localhost' to App Domains and add the exact callback URL to Valid OAuth Redirect URIs in your Meta app settings.",
        };
    }

    if (msg.includes('redirect_uri') || msg.includes("redirect uri")) {
        return {
            code: 'redirect_uri_mismatch',
            message: 'OAuth redirect_uri mismatch. The callback URL in your Meta app must exactly match META_REDIRECT_URI in the backend .env file.',
        };
    }

    if (error === 'access_denied') {
        return {
            code: 'facebook_denied',
            message: 'Meta authorization was denied. Please approve the requested permissions to connect.',
        };
    }

    return {
        code: 'facebook_denied',
        message: errorMessage || error || 'Meta authorization failed',
    };
};

exports.buildOAuthStartResult = ({ userId, storeId, returnUrl } = {}) => {
    const config = getCanonicalOAuthConfig();
    const { appId, redirectUri, scopes, graphVersion } = config;

    if (!appId || appId === '1234567890' || appId === 'undefined') {
        throw new Error('META_APP_ID is missing or invalid. Please use a real Meta App ID.');
    }

    if (!redirectUri || redirectUri === 'undefined') {
        throw new Error('META_REDIRECT_URI is missing. Set it to your backend callback URL, e.g. http://localhost:5000/api/meta/oauth/callback');
    }

    const state = exports.createOAuthState({ userId, storeId, returnUrl });

    const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        scope: scopes,
        response_type: 'code',
        state,
        display: 'popup',
        auth_type: 'rerequest',
    });

    const oauthUrl = `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`;

    const devDiagnostics = process.env.NODE_ENV !== 'production'
        ? {
              client_id: appId,
              redirect_uri: redirectUri,
              response_type: 'code',
              scope: scopes,
              state_present: true,
              decoded_redirect_uri: redirectUri,
          }
        : undefined;

    if (devDiagnostics) {
        console.log('[Meta OAuth] Dev diagnostics:', devDiagnostics);
    }

    return { oauthUrl, redirectUri, state, devDiagnostics };
};

exports.getRedirectUriForTokenExchange = () => {
    const { redirectUri } = getCanonicalOAuthConfig();
    if (!redirectUri) {
        throw new Error('META_REDIRECT_URI is not configured');
    }
    return redirectUri;
};
