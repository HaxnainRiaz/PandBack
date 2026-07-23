const express = require('express');
const router = express.Router();
const { optional } = require('../middleware/authMiddleware');
const { queueAndSendMetaEvent } = require('../services/metaQueueService');
const { getClientIp } = require('../utils/getClientIp');

/**
 * @route   POST /api/tracking/meta/event
 * @desc    Receives a client-side Meta event beacon, enriches it, queues and immediately sends CAPI.
 * @access  Public (Optionally authenticated)
 */
router.post('/meta/event', optional, async (req, res) => {
    try {
        const {
            eventName,
            eventId,
            eventSourceUrl,
            userData = {},
            customData = {},
            orderId
        } = req.body;

        if (!eventName || !eventId) {
            return res.status(400).json({
                success: false,
                message: 'eventName and eventId are required parameters'
            });
        }

        const resolvedIp = getClientIp(req);
        const clientUserAgent = req.headers['user-agent'];

        const enrichedUserData = {
            ...userData,
            clientIpAddress: resolvedIp,
            clientUserAgent
        };

        if (req.user) {
            if (!enrichedUserData.email && req.user.email) enrichedUserData.email = req.user.email;
            if (!enrichedUserData.phone && req.user.phone) enrichedUserData.phone = req.user.phone;
            if (!enrichedUserData.firstName && req.user.firstName) enrichedUserData.firstName = req.user.firstName;
            if (!enrichedUserData.lastName && req.user.lastName) enrichedUserData.lastName = req.user.lastName;
            if (!enrichedUserData.externalId && req.user._id) enrichedUserData.externalId = String(req.user._id);
        }

        const reqReferer = req.headers['referer'];
        const reqHost = req.headers['x-forwarded-host'] || req.headers['host'];
        const reqProto = req.headers['x-forwarded-proto'] || 'https';
        const fallbackBeaconSourceUrl = reqHost ? `${reqProto}://${reqHost}/` : `${process.env.WEBSTORE_URL || 'https://pandaemart.com'}/`;
        const resolvedBeaconSourceUrl = (eventSourceUrl && !eventSourceUrl.includes('https://http://'))
            ? eventSourceUrl
            : (reqReferer || fallbackBeaconSourceUrl);

        const result = await queueAndSendMetaEvent({
            eventName,
            eventId,
            orderId,
            eventSourceUrl: resolvedBeaconSourceUrl,
            userData: enrichedUserData,
            customData
        }, { lockedBy: 'tracking-beacon' });

        if (!result.success && !result.skipped) {
            return res.status(500).json({
                success: false,
                message: result.error || result.sendResult?.error || 'Failed to process event'
            });
        }

        return res.status(result.sent ? 200 : 202).json({
            success: true,
            message: result.sent ? 'Event sent to Meta' : 'Event queued for retry',
            eventId,
            status: result.sendResult?.status || (result.sent ? 'sent' : 'queued'),
            fbtraceId: result.sendResult?.fbtraceId
        });
    } catch (error) {
        console.error('[Tracking Endpoint Error]:', error.message);
        return res.status(500).json({
            success: false,
            message: error.message || 'Internal Server Error'
        });
    }
});

module.exports = router;
