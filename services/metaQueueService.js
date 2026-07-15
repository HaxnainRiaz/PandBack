const axios = require('axios');
const MetaIntegration = require('../models/MetaIntegration');
const MetaEventLog = require('../models/MetaEventLog');
const { decryptToken } = require('../utils/crypto');
const { hashField } = require('../utils/hash');

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

let _lastNoIntegrationLogTime = 0;
const NO_INTEGRATION_LOG_INTERVAL_MS = 5 * 60 * 1000;

const normalizeStatus = (status) => {
    const map = { success: 'sent', error: 'failed', pending: 'queued' };
    return map[status] || status;
};

/**
 * Normalizes, hashes and prepares user data for storage & Meta transmission.
 */
const prepareUserData = (rawUserData) => {
    if (!rawUserData) return {};

    const userData = {};

    if (rawUserData.email) {
        userData.em = [hashField(rawUserData.email, 'email')];
    } else if (rawUserData.em) {
        userData.em = Array.isArray(rawUserData.em) ? rawUserData.em : [rawUserData.em];
    }

    if (rawUserData.phone) {
        userData.ph = [hashField(rawUserData.phone, 'phone')];
    } else if (rawUserData.ph) {
        userData.ph = Array.isArray(rawUserData.ph) ? rawUserData.ph : [rawUserData.ph];
    }

    if (rawUserData.firstName) {
        userData.fn = [hashField(rawUserData.firstName, 'string')];
    } else if (rawUserData.first_name) {
        userData.fn = [hashField(rawUserData.first_name, 'string')];
    } else if (rawUserData.fn) {
        userData.fn = Array.isArray(rawUserData.fn) ? rawUserData.fn : [rawUserData.fn];
    }

    if (rawUserData.lastName) {
        userData.ln = [hashField(rawUserData.lastName, 'string')];
    } else if (rawUserData.last_name) {
        userData.ln = [hashField(rawUserData.last_name, 'string')];
    } else if (rawUserData.ln) {
        userData.ln = Array.isArray(rawUserData.ln) ? rawUserData.ln : [rawUserData.ln];
    }

    if (rawUserData.city) {
        userData.ct = [hashField(rawUserData.city, 'string')];
    } else if (rawUserData.ct) {
        userData.ct = Array.isArray(rawUserData.ct) ? rawUserData.ct : [rawUserData.ct];
    }

    if (rawUserData.country) {
        userData.country = [hashField(rawUserData.country, 'string')];
    }

    if (rawUserData.postalCode || rawUserData.zip) {
        userData.zp = [hashField(rawUserData.postalCode || rawUserData.zip, 'string')];
    } else if (rawUserData.zp) {
        userData.zp = Array.isArray(rawUserData.zp) ? rawUserData.zp : [rawUserData.zp];
    }

    if (rawUserData.externalId) {
        userData.external_id = [hashField(rawUserData.externalId, 'raw')];
    } else if (rawUserData.external_id) {
        userData.external_id = Array.isArray(rawUserData.external_id) ? rawUserData.external_id : [rawUserData.external_id];
    }

    if (rawUserData.client_ip_address) userData.client_ip_address = rawUserData.client_ip_address;
    if (rawUserData.clientIpAddress) userData.client_ip_address = rawUserData.clientIpAddress;

    if (rawUserData.client_user_agent) userData.client_user_agent = rawUserData.client_user_agent;
    if (rawUserData.clientUserAgent) userData.client_user_agent = rawUserData.clientUserAgent;

    if (rawUserData.fbp) userData.fbp = rawUserData.fbp;
    if (rawUserData.fbc) userData.fbc = rawUserData.fbc;

    return Object.fromEntries(
        Object.entries(userData).filter(([_, v]) => v !== undefined && v !== null)
    );
};

const getAccessToken = async (integration) => {
    let accessToken = integration.capiAccessTokenEncrypted || integration.accessTokenEncrypted;
    if (!accessToken) {
        throw new Error('Access token missing or cleared');
    }
    if (accessToken.includes(':')) {
        accessToken = decryptToken(accessToken);
    }
    return accessToken;
};

/**
 * Sends a prepared CAPI payload to Meta Graph API.
 * Returns success only when events_received >= 1.
 */
const sendPayloadToMeta = async (integration, requestPayloadSafe, options = {}) => {
    const { testEventCode, timeout = 5000 } = options;
    const accessToken = await getAccessToken(integration);

    const capiPayload = { data: [requestPayloadSafe] };
    if (testEventCode) {
        capiPayload.test_event_code = testEventCode;
    }

    const startTime = Date.now();
    const response = await axios.post(
        `${GRAPH_API_BASE_URL}/${integration.pixelId}/events`,
        capiPayload,
        {
            params: { access_token: accessToken },
            headers: { 'Content-Type': 'application/json' },
            timeout
        }
    );

    const responseTimeMs = Date.now() - startTime;
    const eventsReceived = Number(response.data?.events_received ?? 0);
    const fbtraceId = response.data?.fbtrace_id || null;

    return {
        success: eventsReceived >= 1,
        eventsReceived,
        fbtraceId,
        response: response.data,
        responseTimeMs
    };
};

const applySendResultToLog = (eventLog, result, testCode) => {
    eventLog.responseTimeMs = result.responseTimeMs;
    eventLog.responsePayloadSafe = result.response;
    eventLog.fbtraceId = result.fbtraceId;

    if (result.success) {
        eventLog.status = testCode ? 'test_sent' : 'sent';
        eventLog.sentAt = new Date();
        eventLog.errorMessage = null;
        eventLog.lockedAt = null;
        eventLog.lockedBy = null;
        return true;
    }

    eventLog.errorMessage = 'Meta did not confirm event receipt (events_received < 1)';
    return false;
};

const applySendErrorToLog = (eventLog, error) => {
    const errData = error.response?.data?.error;
    const errMsg = errData?.message || error.message;
    eventLog.errorMessage = errMsg;
    eventLog.responsePayloadSafe = error.response?.data || null;
    eventLog.fbtraceId = error.response?.data?.fbtrace_id || null;

    const isClientError = error.response?.status >= 400 && error.response?.status < 500;
    const isDeadToken = errData?.code === 190 || errData?.code === 102;

    if (isClientError && !isDeadToken) {
        eventLog.status = 'dead';
    } else if (eventLog.attempts >= eventLog.maxAttempts) {
        eventLog.status = 'failed';
    } else {
        eventLog.status = 'failed';
        const backoffMinutes = Math.pow(2, eventLog.attempts);
        eventLog.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
    }

    eventLog.lockedAt = null;
    eventLog.lockedBy = null;
    return { errMsg, isDeadToken };
};

/**
 * Pushes a tracking event into the DB-backed Conversions API queue.
 */
const queueMetaEvent = async (eventDetails) => {
    const startTime = Date.now();
    try {
        const {
            eventName,
            eventId,
            orderId,
            eventTime = Math.floor(Date.now() / 1000),
            eventSourceUrl,
            userData: rawUserData = {},
            customData = {},
            testEventCode
        } = eventDetails;

        if (!eventName || !eventId) {
            return { success: false, error: 'eventName and eventId are required' };
        }

        const integration = await MetaIntegration.findOne();
        if (!integration) {
            return { success: false, error: 'Meta integration not configured' };
        }

        if (!integration.pixelId) {
            return { success: false, error: 'Pixel ID not configured' };
        }

        if (!integration.isCapiEnabled) {
            const skippedLog = await MetaEventLog.findOneAndUpdate(
                { eventName, eventId, source: 'server' },
                {
                    $setOnInsert: {
                        orderId: orderId || null,
                        pixelId: integration.pixelId,
                        deduplicationKey: `${eventName}:${eventId}`
                    },
                    $set: {
                        status: 'skipped',
                        errorMessage: 'CAPI is disabled in settings'
                    }
                },
                { upsert: true, new: true }
            );
            return { success: false, error: 'CAPI disabled', logId: skippedLog._id, skipped: true };
        }

        const user_data = prepareUserData(rawUserData);
        const requestPayloadSafe = {
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: 'website',
            event_source_url: eventSourceUrl || process.env.WEBSTORE_URL || 'https://http://localhost:3000',
            user_data,
            custom_data: {
                ...customData,
                currency: customData.currency || 'PKR'
            }
        };

        const hasFbp = !!user_data.fbp;
        const hasFbc = !!user_data.fbc;
        const hasEmailHash = !!(user_data.em && user_data.em.length > 0);
        const hasPhoneHash = !!(user_data.ph && user_data.ph.length > 0);
        const hasExternalId = !!(user_data.external_id && user_data.external_id.length > 0);
        const testEventCodeUsed = testEventCode || '';

        const existingSent = await MetaEventLog.findOne({
            eventName,
            eventId,
            source: 'server',
            status: { $in: ['sent', 'test_sent', 'deduplicated'] }
        });
        if (existingSent) {
            return { success: true, logId: existingSent._id, deduplicated: true, durationMs: Date.now() - startTime };
        }

        const log = await MetaEventLog.findOneAndUpdate(
            { eventName, eventId, source: 'server' },
            {
                $setOnInsert: {
                    orderId: orderId || null,
                    pixelId: integration.pixelId || null,
                    attempts: 0,
                    maxAttempts: 3,
                    hasFbp,
                    hasFbc,
                    hasEmailHash,
                    hasPhoneHash,
                    hasExternalId,
                    deduplicationKey: `${eventName}:${eventId}`,
                    testEventCodeUsed
                },
                $set: {
                    status: 'queued',
                    nextRetryAt: new Date(),
                    requestPayloadSafe,
                    testEventCodeUsed
                }
            },
            { upsert: true, new: true }
        );

        return { success: true, logId: log._id, durationMs: Date.now() - startTime };
    } catch (error) {
        console.error('[Meta Queue] Error in queueMetaEvent:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Immediately sends a single queued event log to Meta.
 */
const sendEventLogImmediately = async (logId, lockedBy = 'immediate') => {
    const eventLog = await MetaEventLog.findById(logId);
    if (!eventLog) {
        return { success: false, error: 'Event log not found' };
    }

    if (['sent', 'test_sent', 'deduplicated', 'skipped'].includes(eventLog.status)) {
        return { success: true, status: eventLog.status, alreadySent: true };
    }

    if (eventLog.status === 'processing' && eventLog.lockedAt && (Date.now() - eventLog.lockedAt.getTime()) < 30000) {
        return { success: false, error: 'Event is currently being processed' };
    }

    const integration = await MetaIntegration.findOne();
    if (!integration || !integration.pixelId || !integration.isCapiEnabled) {
        return { success: false, error: 'CAPI not configured or disabled' };
    }

    eventLog.status = 'processing';
    eventLog.lockedAt = new Date();
    eventLog.lockedBy = lockedBy;
    eventLog.lastAttemptAt = new Date();
    eventLog.attempts += 1;
    await eventLog.save();

    const testCode = eventLog.testEventCodeUsed || null;

    try {
        const result = await sendPayloadToMeta(integration, eventLog.requestPayloadSafe, { testEventCode: testCode || undefined });

        if (applySendResultToLog(eventLog, result, testCode)) {
            integration.lastSuccessfulCapiAt = new Date();
            integration.lastEventSentAt = new Date();
            integration.lastErrorMessage = null;
            integration.connectionStatus = 'connected';
            await integration.save();
        } else {
            if (eventLog.attempts >= eventLog.maxAttempts) {
                eventLog.status = 'failed';
            } else {
                eventLog.status = 'queued';
                const backoffMinutes = Math.pow(2, eventLog.attempts);
                eventLog.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
            }
        }
    } catch (error) {
        const { errMsg, isDeadToken } = applySendErrorToLog(eventLog, error);
        if (isDeadToken) {
            integration.connectionStatus = 'error';
            integration.lastErrorMessage = errMsg;
            await integration.save();
        }
        await eventLog.save();
        return { success: false, error: errMsg, status: eventLog.status };
    }

    await eventLog.save();
    const isSuccess = eventLog.status === 'sent' || eventLog.status === 'test_sent';
    return {
        success: isSuccess,
        status: eventLog.status,
        fbtraceId: eventLog.fbtraceId,
        eventsReceived: eventLog.responsePayloadSafe?.events_received
    };
};

/**
 * Queues an event and immediately attempts delivery (critical for Purchase on Vercel).
 */
const queueAndSendMetaEvent = async (eventDetails, options = {}) => {
    const queueResult = await queueMetaEvent(eventDetails);
    if (!queueResult.success) {
        return { ...queueResult, sent: false };
    }
    if (queueResult.deduplicated) {
        return { ...queueResult, sent: true, deduplicated: true };
    }

    const sendResult = await sendEventLogImmediately(queueResult.logId, options.lockedBy || 'immediate');
    return {
        ...queueResult,
        sent: sendResult.success,
        sendResult
    };
};

/**
 * Background batch processor for queued database records.
 */
const processPendingQueue = async (batchSize = 20, lockedBy = 'queue-worker') => {
    const queueStartTime = Date.now();
    const TIMEOUT_LIMIT_MS = 8000;

    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        return { processed: 0, status: 'db_unavailable' };
    }

    const integration = await MetaIntegration.findOne();
    if (!integration || !integration.pixelId) {
        const now = Date.now();
        if (now - _lastNoIntegrationLogTime >= NO_INTEGRATION_LOG_INTERVAL_MS) {
            _lastNoIntegrationLogTime = now;
        }
        return { processed: 0, status: 'no_integration' };
    }

    if (!integration.isCapiEnabled) {
        return { processed: 0, status: 'capi_disabled' };
    }

    try {
        await getAccessToken(integration);
    } catch (tokenErr) {
        integration.connectionStatus = 'error';
        integration.lastErrorMessage = tokenErr.message;
        await integration.save();
        return { processed: 0, status: 'token_error' };
    }

    const pendingEvents = await MetaEventLog.find({
        source: 'server',
        status: { $in: ['queued', 'failed'] },
        attempts: { $lt: 3 },
        nextRetryAt: { $lte: new Date() },
        $or: [
            { lockedAt: null },
            { lockedAt: { $lt: new Date(Date.now() - 60000) } }
        ]
    })
        .sort({ createdAt: 1 })
        .limit(batchSize);

    if (pendingEvents.length === 0) {
        return { processed: 0, status: 'idle' };
    }

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const eventLog of pendingEvents) {
        if (Date.now() - queueStartTime > TIMEOUT_LIMIT_MS) break;

        const sendResult = await sendEventLogImmediately(eventLog._id, lockedBy);
        processedCount++;
        if (sendResult.success) {
            successCount++;
        } else {
            failedCount++;
        }
    }

    try {
        const totalLogs = await MetaEventLog.countDocuments({ source: 'server' });
        const failedLogs = await MetaEventLog.countDocuments({ source: 'server', status: { $in: ['failed', 'dead'] } });
        integration.trackingHealthScore = totalLogs > 0
            ? Math.max(0, Math.round(((totalLogs - failedLogs) / totalLogs) * 100))
            : 100;
        await integration.save();
    } catch (saveErr) {
        console.error('[Meta Queue Worker] Failed to update health score:', saveErr.message);
    }

    return {
        processed: processedCount,
        success: successCount,
        failed: failedCount,
        status: 'completed'
    };
};

module.exports = {
    prepareUserData,
    sendPayloadToMeta,
    queueMetaEvent,
    sendEventLogImmediately,
    queueAndSendMetaEvent,
    processPendingQueue,
    normalizeStatus,
    GRAPH_API_BASE_URL
};
