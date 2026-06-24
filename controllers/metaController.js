const MetaIntegration = require('../models/MetaIntegration');
const MetaEventLog = require('../models/MetaEventLog');
const metaService = require('../services/metaService');
const metaOAuth = require('../utils/metaOAuth');
const { encryptToken, decryptToken } = require('../utils/crypto');

const getFrontendUrl = () => {
    const url = process.env.FRONTEND_URL || process.env.ADMIN_APP_URL || 'http://localhost:3001';
    return String(url).trim().replace(/\/+$/, '');
};

/**
 * Renders a minimal HTML page that signals the admin panel via postMessage or redirect.
 */
const renderOAuthCallbackPage = ({ success, errorCode, message }) => {
    const frontendUrl = getFrontendUrl();
    const postMessagePayload = success
        ? { type: 'META_AUTH_SUCCESS' }
        : { type: 'META_AUTH_ERROR', code: errorCode || 'unknown', message: message || 'Meta connection failed' };

    const redirectUrl = success
        ? `${frontendUrl}/meta?meta_connected=1`
        : `${frontendUrl}/meta?meta_error=${encodeURIComponent(errorCode || 'unknown')}`;

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Meta Connection</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center;">
<p>${success ? 'Meta account connected. Closing…' : 'Meta connection failed. Closing…'}</p>
<script>
(function() {
    var payload = ${JSON.stringify(postMessagePayload)};
    var targetOrigin = ${JSON.stringify(frontendUrl)};
    if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, targetOrigin);
        window.close();
    } else {
        window.location.href = ${JSON.stringify(redirectUrl)};
    }
})();
</script>
</body></html>`;
};

/**
 * Returns current integration status.
 * STRICT: Only shows connected if tokens exist and user is verified.
 */
/**
 * Helper to ensure we only ever have ONE Meta integration document.
 * Cleans up duplicates and returns the latest one.
 */
const getSingletonIntegration = async () => {
    const docs = await MetaIntegration.find().sort({ createdAt: -1 });
    if (docs.length === 0) return null;
    
    if (docs.length > 1) {
        console.warn(`[Meta Singleton] Detected ${docs.length} docs. Cleaning up...`);
        const latestId = docs[0]._id;
        await MetaIntegration.deleteMany({ _id: { $ne: latestId } });
        return docs[0];
    }
    return docs[0];
};

exports.getMetaStatus = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        
        let integration = await getSingletonIntegration();
        
        const isActuallyConnected = !!(integration && integration.connectionStatus === 'connected');

        const integrationActive = Boolean(
            isActuallyConnected && 
            integration?.setupCompleted === true && 
            integration?.pixelId && 
            integration?.isPixelEnabled
        );

        // Fetch counts for queue stats
        const totalEvents = await MetaEventLog.countDocuments({});
        const queuedEvents = await MetaEventLog.countDocuments({ status: 'queued' });
        const sentEvents = await MetaEventLog.countDocuments({ status: { $in: ['sent', 'test_sent'] } });
        const failedEvents = await MetaEventLog.countDocuments({ status: { $in: ['failed', 'dead'] } });
        const skippedEvents = await MetaEventLog.countDocuments({ status: 'skipped_duplicate' });

        const statusData = {
            isConnected: isActuallyConnected,
            integrationActive,
            connectionStatus: integration?.connectionStatus || 'disconnected',
            setupCompleted: integration?.setupCompleted || false,
            setupStep: integration?.setupStep || 1,
            isPixelEnabled: integration?.isPixelEnabled || false,
            isCapiEnabled: integration?.isCapiEnabled || false,
            hasCapiToken: !!integration?.capiAccessTokenEncrypted,
            dataSharingLevel: integration?.dataSharingLevel || 'standard',
            deduplicationEnabled: integration?.deduplicationEnabled || false,
            enabledEvents: integration?.enabledEvents || [],
            pixelId: integration?.pixelId || null,
            pixelName: integration?.pixelName || null,
            businessId: integration?.businessId || null,
            businessName: integration?.businessName || null,
            adAccountId: integration?.adAccountId || null,
            adAccountRawId: integration?.adAccountRawId || null,
            adAccountName: integration?.adAccountName || null,
            adAccountCurrency: integration?.adAccountCurrency || null,
            pageId: integration?.pageId || null,
            pageName: integration?.pageName || null,
            metaUserName: integration?.metaUserName || null,
            metaProfilePicture: integration?.metaProfilePicture || null,
            lastErrorMessage: integration?.lastErrorMessage || null,
            trackingHealthScore: integration?.trackingHealthScore !== undefined ? integration.trackingHealthScore : 100,
            lastSuccessfulCapiAt: integration?.lastSuccessfulCapiAt || null,
            testEventCode: integration?.testEventCode || '',
            capiStatus: (() => {
                if (!isActuallyConnected) return 'not_connected';
                if (!integration?.pixelId) return 'connected_missing_pixel';
                if (integration?.lastErrorMessage && /expired|invalid token/i.test(integration.lastErrorMessage)) {
                    return 'token_expired';
                }
                if (!integration?.capiAccessTokenEncrypted) return 'capi_config_incomplete';
                if (integration?.setupCompleted && integration?.pixelId && integration?.capiAccessTokenEncrypted) {
                    return 'connected_ready';
                }
                return 'capi_config_incomplete';
            })(),
            stats: {
                totalEvents,
                queuedEvents,
                sentEvents,
                failedEvents,
                skippedEvents
            }
        };

        res.status(200).json({ 
            success: true, 
            ...statusData,
            data: statusData // For backward compatibility with config = res.data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Generates and returns a valid OAuth URL.
 * Pre-flight checks ensure env vars are present before touching the DB,
 * so misconfiguration returns a clear 500 (not a confusing 401).
 */
exports.startOAuth = async (req, res) => {
    // 1. Guard: verify required env vars exist before anything else
    if (!process.env.META_APP_ID || process.env.META_APP_ID === 'undefined') {
        return res.status(500).json({
            success: false,
            message: 'Server configuration error: META_APP_ID is not set. Please configure it in your .env file.'
        });
    }

    if (!process.env.META_REDIRECT_URI || process.env.META_REDIRECT_URI === 'undefined') {
        return res.status(500).json({
            success: false,
            message: 'Server configuration error: META_REDIRECT_URI is not set. Please configure it in your .env file.'
        });
    }

    // 2. Guard: check DB readiness
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            success: false,
            message: 'Database temporarily unavailable. Please try again in a few moments.'
        });
    }

    try {
        const result = metaService.getOAuthUrl({
            userId: req.user?._id,
            storeId: req.user?.storeId || null,
            returnUrl: '/meta',
        });

        res.status(200).json({
            success: true,
            oauthUrl: result.oauthUrl,
            ...(result.devDiagnostics && { devDiagnostics: result.devDiagnostics }),
        });
    } catch (error) {
        console.error('[Meta OAuth Start] Error generating OAuth URL:', error.message);
        res.status(500).json({ success: false, message: error.message, code: 'missing_env' });
    }
};

/**
 * Sanitized OAuth configuration for admin debugging (no secrets).
 */
exports.oauthConfigCheck = async (req, res) => {
    try {
        const configCheck = metaService.buildOAuthConfigCheck();
        res.status(200).json({ success: true, data: configCheck });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Public Callback: Handles Meta redirect.
 * Exchanges code for token, validates state, closes popup or redirects to frontend.
 */
exports.oauthCallback = async (req, res) => {
    try {
        const { code, state, error, error_message, error_code } = req.query;

        if (error || error_message) {
            const mapped = metaOAuth.mapFacebookOAuthError(error, error_message, error_code);
            console.error('[Meta OAuth Callback] Facebook error:', {
                error,
                error_code,
                message: error_message,
                mappedCode: mapped.code,
            });
            return res.status(200).send(renderOAuthCallbackPage({
                success: false,
                errorCode: mapped.code,
                message: mapped.message,
            }));
        }

        if (!code) {
            console.warn('[Meta OAuth Callback] Missing authorization code');
            return res.status(200).send(renderOAuthCallbackPage({
                success: false,
                errorCode: 'missing_code',
                message: 'Missing Meta authorization code',
            }));
        }

        try {
            metaOAuth.verifyOAuthState(state);
        } catch (stateErr) {
            console.error('[Meta OAuth Callback] State validation failed:', stateErr.message);
            return res.status(200).send(renderOAuthCallbackPage({
                success: false,
                errorCode: stateErr.code || 'invalid_state',
                message: stateErr.message,
            }));
        }

        console.log('[Meta OAuth Callback] Exchanging code for token');

        const tokenData = await metaService.exchangeCodeForToken(code);
        const userData = await metaService.getMetaUser(tokenData.accessToken);

        // 3. FETCH GRANTED PERMISSIONS
        let grantedPermissions = [];
        try {
            const permissionsResponse = await metaService.getGrantedPermissions(tokenData.accessToken);
            // Ensure we handle both raw array and data property
            const rawPerms = Array.isArray(permissionsResponse) 
                ? permissionsResponse 
                : (permissionsResponse?.data || []);
            
            grantedPermissions = rawPerms
                .filter(p => p && p.permission)
                .map(p => ({
                    permission: String(p.permission),
                    status: p.status === 'declined' ? 'declined' : 
                            p.status === 'expired' ? 'expired' : 'granted'
                }));
        } catch (permissionError) {
            console.warn('Could not fetch Meta permissions:', permissionError.message);
        }

        // 4. ONLY NOW save as connected
        let integration = await getSingletonIntegration();
        if (!integration) {
            integration = new MetaIntegration();
        }
        
        integration.accessTokenEncrypted = tokenData.accessToken;
        integration.metaUserId = userData.id;
        integration.metaUserName = userData.name;
        integration.metaProfilePicture = userData.picture?.data?.url;
        integration.connectionStatus = 'connected';
        integration.grantedPermissions = grantedPermissions;
        integration.tokenExpiresAt = tokenData.expiresIn 
            ? new Date(Date.now() + tokenData.expiresIn * 1000)
            : null;
        integration.setupStep = 2;
        integration.setupCompleted = false;
        integration.lastErrorMessage = null;
        
        await integration.save();

        return res.status(200).send(renderOAuthCallbackPage({ success: true }));
    } catch (error) {
        console.error('[Meta OAuth Callback] Error:', error.message);
        const errorCode = error.code || 'token_exchange_failed';
        return res.status(200).send(renderOAuthCallbackPage({
            success: false,
            errorCode,
            message: error.message || 'Meta connection failed',
        }));
    }
};

exports.selectBusiness = async (req, res) => {
    try {
        const { businessId, businessName } = req.body;
        const integration = await getSingletonIntegration();
        if (!integration) throw new Error('Integration not found');

        integration.businessId = businessId;
        integration.businessName = businessName;
        integration.setupStep = 3;
        await integration.save();

        res.status(200).json({ success: true, data: integration });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.selectAdAccount = async (req, res) => {
    try {
        const { adAccountId, adAccountName, adAccountCurrency } = req.body;
        const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
        const rawId = adAccountId.replace('act_', '');

        const integration = await getSingletonIntegration();
        if (!integration) throw new Error('Integration not found');

        integration.adAccountId = actId;
        integration.adAccountName = adAccountName;
        integration.adAccountCurrency = adAccountCurrency;
        integration.setupStep = 4;
        await integration.save();

        res.status(200).json({ success: true, data: integration });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.selectPixel = async (req, res) => {
    try {
        const { pixelId, pixelName } = req.body;

        if (!pixelId) {
            return res.status(400).json({ success: false, message: 'Pixel ID is required.' });
        }

        const integration = await getSingletonIntegration();
        if (!integration) throw new Error('Meta integration not found.');

        integration.pixelId = String(pixelId);
        integration.pixelName = pixelName || 'Meta Pixel';
        integration.isPixelEnabled = true;
        integration.setupStep = 5;
        integration.lastErrorMessage = null;
        await integration.save();

        return res.json({
            success: true,
            message: 'Pixel selected successfully.',
            pixelId: integration.pixelId,
            pixelName: integration.pixelName
        });
    } catch (error) {
        console.error('Select Pixel error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.saveManualPixel = async (req, res) => {
    try {
        const { pixelId, pixelName } = req.body;

        if (!pixelId || !/^\d{10,25}$/.test(String(pixelId))) {
            return res.status(400).json({
                success: false,
                message: 'Valid numeric Pixel ID is required.'
            });
        }

        const integration = await getSingletonIntegration();
        if (!integration) throw new Error('Meta integration not found.');

        integration.pixelId = String(pixelId);
        integration.pixelName = pixelName || 'Manual Pixel';
        integration.isPixelEnabled = true;
        integration.setupStep = 5;
        integration.lastErrorMessage = null;
        await integration.save();

        return res.json({
            success: true,
            message: 'Manual Pixel saved successfully.',
            pixelId: integration.pixelId,
            pixelName: integration.pixelName
        });
    } catch (error) {
        console.error('Manual Pixel save error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.selectPage = async (req, res) => {
    try {
        const { pageId, pageName } = req.body;
        const integration = await getSingletonIntegration();
        if (!integration) throw new Error('Meta integration not found.');

        integration.pageId = pageId;
        integration.pageName = pageName;
        integration.setupStep = 6;
        await integration.save();

        res.status(200).json({ success: true, data: integration });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.saveMetaSettings = async (req, res) => {
    try {
        console.log('POST /api/meta/settings hit');
        console.log('Incoming settings payload received');

        const {
            isPixelEnabled = true,
            isCapiEnabled = true,
            dataSharingLevel = 'maximum',
            deduplicationEnabled = true,
            enabledEvents,
            setupCompleted = true,
            setupStep = 6,
            pixelId,
            pixelName
        } = req.body;

        const integration = await getSingletonIntegration();

        if (!integration) {
            return res.status(404).json({
                success: false,
                message: 'Meta integration not found. Please connect Meta account first.'
            });
        }

        if (req.body.setupCompleted === false) {
            integration.setupCompleted = false;
            integration.setupStep = Number(req.body.setupStep) || 2;
            integration.lastErrorMessage = null;
            await integration.save();

            return res.status(200).json({
                success: true,
                message: 'Setup reconfiguration started.',
                data: {
                    setupCompleted: false,
                    setupStep: integration.setupStep
                }
            });
        }

        // Apply any incoming asset updates first
        if (pixelId) integration.pixelId = pixelId;
        if (pixelName) integration.pixelName = pixelName;

        console.log('Existing integration before save:', integration?._id);

        if (integration.connectionStatus !== 'connected' || !integration.metaUserId) {
            return res.status(400).json({
                success: false,
                message: 'Meta account is not connected. Please reconnect Meta first.'
            });
        }

        if (isPixelEnabled && !integration.pixelId) {
            return res.status(400).json({
                success: false,
                message: 'Pixel ID is missing. Please select or manually enter a Pixel before activation.'
            });
        }

        const finalEvents = Array.isArray(enabledEvents) && enabledEvents.length > 0
            ? enabledEvents
            : ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'Purchase'];

        integration.isPixelEnabled = Boolean(isPixelEnabled);
        integration.isCapiEnabled = Boolean(isCapiEnabled);
        integration.dataSharingLevel = dataSharingLevel;
        integration.deduplicationEnabled = Boolean(deduplicationEnabled);
        integration.enabledEvents = finalEvents;
        
        // Hard force setup completion
        integration.setupCompleted = true;
        integration.setupStep = 7;
        integration.connectionStatus = 'connected';
        integration.lastErrorMessage = null;

        await integration.save();

        console.log('[Meta] Integration ACTIVATED. setupCompleted: true, setupStep: 7');

        return res.status(200).json({
            success: true,
            message: 'Meta integration activated successfully.',
            data: {
                setupCompleted: true,
                setupStep: 7,
                connectionStatus: 'connected'
            }
        });
    } catch (error) {
        console.error('Save Meta settings error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to activate Meta integration.'
        });
    }
};

exports.saveCapiToken = async (req, res) => {
    try {
        const { capiAccessToken } = req.body;

        if (!capiAccessToken || !String(capiAccessToken).trim()) {
            return res.status(400).json({
                success: false,
                message: 'CAPI access token is required.'
            });
        }

        const encryptedToken = encryptToken(String(capiAccessToken).trim());

        const integration = await getSingletonIntegration();
        if (!integration) throw new Error('Integration not found');

        integration.capiAccessTokenEncrypted = encryptedToken;
        integration.isCapiEnabled = true;
        integration.dataSharingLevel = 'maximum';
        integration.lastErrorMessage = null;
        await integration.save();

        if (!integration) {
            return res.status(404).json({
                success: false,
                message: 'Meta integration not found. Connect Meta first.'
            });
        }

        return res.json({
            success: true,
            message: 'CAPI token saved successfully.',
            hasCapiToken: true,
            isCapiEnabled: integration.isCapiEnabled
        });
    } catch (error) {
        console.error('Save CAPI token error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to save CAPI token.'
        });
    }
};

exports.getEventLogs = async (req, res) => {
    try {
        const { page = 1, limit = 15, eventName, status, source } = req.query;
        const filter = {};
        if (eventName) filter.eventName = eventName;
        if (status) filter.status = status;
        if (source) filter.source = source;

        const logs = await MetaEventLog.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('orderId', 'orderNumber');

        const total = await MetaEventLog.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: logs,
            pagination: { total, page: Number(page), limit: Number(limit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.testEvent = async (req, res) => {
    try {
        const {
            eventName = 'TestEvent',
            eventId = `test_${Date.now()}`,
            userData = {},
            customData = {},
            testEventCode
        } = req.body || {};

        const integration = await MetaIntegration.findOne();
        if (!integration?.pixelId) return res.status(400).json({ success: false, message: 'Pixel ID missing' });

        // Temporarily override testEventCode on the integration or use it
        const originalTestCode = integration.testEventCode;
        if (testEventCode !== undefined) {
            integration.testEventCode = testEventCode;
            await integration.save();
        }

        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        let resolvedIp = clientIp;
        if (resolvedIp && resolvedIp.includes(',')) {
            resolvedIp = resolvedIp.split(',')[0].trim();
        }
        if (resolvedIp === '::1') resolvedIp = '127.0.0.1';

        const testData = {
            eventName,
            eventId,
            eventSourceUrl: req.headers.referer || process.env.FRONTEND_URL || process.env.WEBSTORE_URL || 'https://luminelle.org',
            userData: {
                email: userData.email || 'test@example.com',
                phone: userData.phone || '1234567890',
                firstName: userData.firstName || 'Test',
                lastName: userData.lastName || 'User',
                clientIpAddress: userData.clientIpAddress || resolvedIp,
                clientUserAgent: userData.clientUserAgent || req.headers['user-agent'],
                fbp: userData.fbp || `fb.1.${Date.now()}.${Math.round(Math.random() * 2147483647)}`,
                fbc: userData.fbc || null
            },
            customData: {
                ...customData,
                value: customData.value || 0,
                currency: customData.currency || 'USD'
            }
        };

        const response = await metaService.sendCapiEvent(integration, testData);

        // Restore original test code if temporary set
        if (testEventCode !== undefined) {
            integration.testEventCode = originalTestCode;
            await integration.save();
        }

        res.status(200).json({ success: true, data: response, message: 'Test event sent successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.disconnectMeta = async (req, res) => {
    try {
        let integration = await getSingletonIntegration();
        if (integration) {
            integration.connectionStatus = 'disconnected';
            integration.accessTokenEncrypted = null;
            integration.capiAccessTokenEncrypted = null;
            integration.isPixelEnabled = false;
            integration.isCapiEnabled = false;
            integration.setupCompleted = false;
            integration.setupStep = 1;
            integration.metaUserId = null;
            integration.metaUserName = null;
            integration.metaProfilePicture = null;
            integration.businessId = null;
            integration.businessName = null;
            integration.adAccountId = null;
            integration.adAccountName = null;
            integration.pixelId = null;
            integration.pixelName = null;
            await integration.save();
        }
        res.status(200).json({ success: true, message: 'Meta integration disconnected and tokens cleared' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getBusinesses = async (req, res) => {
    try {
        const integration = await MetaIntegration.findOne();
        if (!integration?.accessTokenEncrypted) return res.status(400).json({ success: false, message: 'Not connected' });
        const businesses = await metaService.getBusinesses(integration.accessTokenEncrypted);
        res.status(200).json({ success: true, data: businesses });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message, 
            permissionMissing: error.permissionMissing 
        });
    }
};

exports.getAdAccounts = async (req, res) => {
    try {
        const { businessId } = req.params;
        const integration = await MetaIntegration.findOne();
        if (!integration?.accessTokenEncrypted) return res.status(400).json({ success: false, message: 'Not connected' });
        const accounts = await metaService.getAdAccounts(businessId, integration.accessTokenEncrypted);
        res.status(200).json({ success: true, data: accounts });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message, 
            permissionMissing: error.permissionMissing 
        });
    }
};

exports.getPixels = async (req, res) => {
    try {
        const { adAccountId, businessId } = req.query;
        const integration = await MetaIntegration.findOne();
        if (!integration?.accessTokenEncrypted) return res.status(400).json({ success: false, message: 'Not connected' });
        
        const bId = businessId || integration.businessId;
        const result = await metaService.getPixels({
            adAccountId,
            businessId: bId,
            accessToken: integration.accessTokenEncrypted
        });
        
        res.status(200).json({ 
            success: true, 
            pixels: result.pixels,
            endpointErrors: result.endpointErrors 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message
        });
    }
};

exports.getPermissions = async (req, res) => {
    try {
        const integration = await MetaIntegration.findOne();
        if (!integration?.accessTokenEncrypted) return res.status(400).json({ success: false, message: 'Not connected' });
        const permissions = await metaService.getGrantedPermissions(integration.accessTokenEncrypted);
        res.status(200).json({ success: true, data: permissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getPages = async (req, res) => {
    try {
        const integration = await MetaIntegration.findOne();
        if (!integration?.accessTokenEncrypted) return res.status(400).json({ success: false, message: 'Not connected' });
        const pages = await metaService.getPages(integration.accessTokenEncrypted);
        res.status(200).json({ success: true, data: pages });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message, 
            permissionMissing: error.permissionMissing 
        });
    }
};

/**
 * Manually trigger Conversions API pending queue processing
 */
exports.processPending = async (req, res) => {
    try {
        const { processPendingQueue } = require('../services/metaQueueService');
        const result = await processPendingQueue(50); // process up to 50
        res.status(200).json({
            success: true,
            message: 'Queue processing executed successfully',
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Manually retry a specific failed or dead event
 */
exports.retryLog = async (req, res) => {
    try {
        const { logId } = req.params;
        const log = await MetaEventLog.findById(logId);
        if (!log) {
            return res.status(404).json({ success: false, message: 'Event log not found' });
        }

        // Reset the event status and attempts
        log.status = 'queued';
        log.attempts = 0;
        log.nextRetryAt = new Date();
        log.errorMessage = null;
        await log.save();

        // Fire processor to instantly attempt delivery
        const { processPendingQueue } = require('../services/metaQueueService');
        await processPendingQueue(5);

        res.status(200).json({
            success: true,
            message: 'Event queued and processed for retry'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Manually retry all failed or dead events in a single batch
 */
exports.retryAll = async (req, res) => {
    try {
        const result = await MetaEventLog.updateMany(
            { source: 'server', status: { $in: ['failed', 'dead'] } },
            {
                $set: {
                    status: 'queued',
                    attempts: 0,
                    nextRetryAt: new Date(),
                    errorMessage: null
                }
            }
        );

        // Trigger queue processor to execute retries
        const { processPendingQueue } = require('../services/metaQueueService');
        const queueResult = await processPendingQueue(50);

        res.status(200).json({
            success: true,
            message: `Successfully queued ${result.modifiedCount} failed events for retry.`,
            data: queueResult
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

