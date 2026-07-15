const axios = require('axios');
const MetaEventLog = require('../models/MetaEventLog');
const { decryptToken } = require('../utils/crypto');
const {
    prepareUserData,
    sendPayloadToMeta,
    normalizeStatus,
    GRAPH_API_BASE_URL
} = require('./metaQueueService');

/**
 * Sends a Conversions API event to Meta (direct path for sandbox/test events).
 * Only marks status as sent when Meta confirms events_received >= 1.
 */
exports.sendCapiEvent = async (config, { eventName, eventId, eventTime, eventSourceUrl, userData, customData, orderId, testEventCode }) => {
    const pixelId = config.pixelId;
    let accessToken = config.capiAccessTokenEncrypted || config.accessTokenEncrypted;

    if (!pixelId || !accessToken) {
        throw new Error('Meta Pixel ID or Access Token missing');
    }

    if (accessToken.includes(':')) {
        accessToken = decryptToken(accessToken);
    }

    const user_data = prepareUserData(userData);
    const requestPayloadSafe = {
        event_name: eventName,
        event_time: Math.floor((eventTime || Date.now()) / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: eventSourceUrl || process.env.WEBSTORE_URL || 'https://http://localhost:3000',
        user_data,
        custom_data: {
            ...customData,
            currency: customData?.currency || 'PKR'
        }
    };

    const hasFbp = !!user_data.fbp;
    const hasFbc = !!user_data.fbc;
    const hasEmailHash = !!(user_data.em && user_data.em.length > 0);
    const hasPhoneHash = !!(user_data.ph && user_data.ph.length > 0);
    const hasExternalId = !!(user_data.external_id && user_data.external_id.length > 0);
    const testCode = testEventCode || null;

    let log = await MetaEventLog.findOne({ eventName, eventId, source: 'server' });
    if (!log) {
        log = new MetaEventLog({
            orderId: orderId || null,
            eventName,
            eventId,
            pixelId,
            source: 'server',
            status: 'processing',
            attempts: 1,
            lastAttemptAt: new Date(),
            requestPayloadSafe,
            deduplicationKey: `${eventName}:${eventId}`,
            testEventCodeUsed: testCode || '',
            hasFbp,
            hasFbc,
            hasEmailHash,
            hasPhoneHash,
            hasExternalId
        });
    } else if (['sent', 'test_sent'].includes(log.status)) {
        return log.responsePayloadSafe || { events_received: 1, fbtrace_id: log.fbtraceId };
    } else {
        log.status = 'processing';
        log.attempts += 1;
        log.lastAttemptAt = new Date();
        log.requestPayloadSafe = requestPayloadSafe;
        if (testCode) log.testEventCodeUsed = testCode;
    }

    try {
        const result = await sendPayloadToMeta(config, requestPayloadSafe, { testEventCode: testCode || undefined });

        log.responseTimeMs = result.responseTimeMs;
        log.responsePayloadSafe = result.response;
        log.fbtraceId = result.fbtraceId;

        if (result.success) {
            log.status = testCode ? 'test_sent' : 'sent';
            log.sentAt = new Date();
            log.errorMessage = null;
        } else {
            log.status = 'failed';
            log.errorMessage = 'Meta did not confirm event receipt (events_received < 1)';
            await log.save();
            throw new Error(log.errorMessage);
        }

        await log.save();
        return result.response;
    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        log.status = normalizeStatus('failed');
        log.errorMessage = errMsg;
        log.responsePayloadSafe = error.response?.data || log.responsePayloadSafe;
        log.fbtraceId = error.response?.data?.fbtrace_id || log.fbtraceId;
        await log.save().catch(() => { });
        throw new Error(`Meta CAPI Error: ${errMsg}`);
    }
};

/**
 * Meta OAuth Flow — canonical redirect URI from env only (never dynamic).
 */
const metaOAuth = require('../utils/metaOAuth');

exports.getOAuthUrl = (options = {}) => metaOAuth.buildOAuthStartResult(options);
exports.buildOAuthConfigCheck = () => metaOAuth.buildOAuthConfigCheck();

exports.exchangeCodeForToken = async (code) => {
    try {
        const redirectUri = metaOAuth.getRedirectUriForTokenExchange();
        const res = await axios.get(`${GRAPH_API_BASE_URL}/oauth/access_token`, {
            params: {
                client_id: process.env.META_APP_ID,
                client_secret: process.env.META_APP_SECRET,
                redirect_uri: redirectUri,
                code
            }
        });
        return { accessToken: res.data.access_token, expiresIn: res.data.expires_in };
    } catch (error) {
        const fbMsg = error.response?.data?.error?.message || error.message;
        const err = new Error(`Meta OAuth Exchange failed: ${fbMsg}`);
        if (String(fbMsg).toLowerCase().includes('redirect_uri')) {
            err.code = 'redirect_uri_mismatch';
        } else {
            err.code = 'token_exchange_failed';
        }
        throw err;
    }
};

exports.getMetaUser = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me`, {
            params: { access_token: accessToken, fields: 'id,name,picture' }
        });
        return res.data;
    } catch (error) {
        throw new Error(`Meta User Validation failed: ${error.response?.data?.error?.message || error.message}`);
    }
};

exports.getGrantedPermissions = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me/permissions`, {
            params: { access_token: accessToken }
        });
        return res.data.data;
    } catch (error) {
        console.error('Failed to fetch Meta permissions:', error.message);
        return [];
    }
};

exports.getBusinesses = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me/businesses`, {
            params: { access_token: accessToken, fields: 'id,name,verification_status' }
        });
        return res.data.data;
    } catch (error) {
        const err = new Error(`Failed to fetch Meta businesses: ${error.response?.data?.error?.message || error.message}`);
        err.permissionMissing = error.response?.data?.error?.code === 200 || error.response?.data?.error?.error_subcode === 1341018;
        throw err;
    }
};

exports.getAdAccounts = async (businessId, accessToken) => {
    try {
        const [ownedRes, clientRes] = await Promise.all([
            axios.get(`${GRAPH_API_BASE_URL}/${businessId}/owned_ad_accounts`, {
                params: { access_token: accessToken, fields: 'id,account_id,name,currency,account_status' }
            }).catch(() => ({ data: { data: [] } })),
            axios.get(`${GRAPH_API_BASE_URL}/${businessId}/client_ad_accounts`, {
                params: { access_token: accessToken, fields: 'id,account_id,name,currency,account_status' }
            }).catch(() => ({ data: { data: [] } }))
        ]);

        const owned = (ownedRes.data?.data || []).map(a => ({ ...a, source: 'owned' }));
        const client = (clientRes.data?.data || []).map(a => ({ ...a, source: 'client' }));
        const merged = [...owned, ...client];

        if (merged.length === 0) {
            try {
                const meRes = await axios.get(`${GRAPH_API_BASE_URL}/me/adaccounts`, {
                    params: { access_token: accessToken, fields: 'id,account_id,name,currency,account_status' }
                });
                merged.push(...(meRes.data?.data || []).map(a => ({ ...a, source: 'personal' })));
            } catch (e) {
                console.warn(`[Meta] Personal fallback failed: ${e.message}`);
            }
        }

        const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
        return unique.map(acc => {
            const rawId = acc.account_id || acc.id.replace('act_', '');
            return { ...acc, account_id: rawId, actId: `act_${rawId}`, currency: acc.currency || 'USD' };
        });
    } catch (error) {
        const err = new Error(`Failed to fetch Ad Accounts: ${error.response?.data?.error?.message || error.message}`);
        err.permissionMissing = error.response?.data?.error?.code === 200;
        throw err;
    }
};

exports.getPixels = async (params) => {
    const { adAccountId, businessId, accessToken } = params;
    try {
        const actId = adAccountId ? (adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`) : null;
        let allPixels = [];
        const endpointErrors = [];

        if (actId) {
            try {
                const res = await axios.get(`${GRAPH_API_BASE_URL}/${actId}/adspixels`, {
                    params: { access_token: accessToken, fields: 'id,name,creation_time,last_fired_time' }
                });
                allPixels = [...allPixels, ...(res.data.data || []).map(p => ({ ...p, source: 'ad_account_pixels' }))];
            } catch (e) {
                endpointErrors.push({ endpoint: 'adspixels', error: e.response?.data?.error?.message || e.message });
            }
        }

        if (businessId) {
            for (const [endpoint, source] of [['owned_pixels', 'business_owned_pixels'], ['client_pixels', 'business_client_pixels']]) {
                try {
                    const res = await axios.get(`${GRAPH_API_BASE_URL}/${businessId}/${endpoint}`, {
                        params: { access_token: accessToken, fields: 'id,name,creation_time,last_fired_time' }
                    });
                    allPixels = [...allPixels, ...(res.data.data || []).map(p => ({ ...p, source }))];
                } catch (e) {
                    endpointErrors.push({ endpoint, error: e.response?.data?.error?.message || e.message });
                }
            }
        }

        const unique = Array.from(new Map(allPixels.map(item => [item.id, item])).values());
        return { pixels: unique, endpointErrors };
    } catch (error) {
        throw new Error(`Pixel Discovery Failed: ${error.message}`);
    }
};

exports.getPages = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me/accounts`, {
            params: { access_token: accessToken, fields: 'id,name,picture' }
        });
        return res.data.data;
    } catch (error) {
        const err = new Error(`Failed to fetch Pages: ${error.response?.data?.error?.message || error.message}`);
        err.permissionMissing = error.response?.data?.error?.code === 200;
        throw err;
    }
};
