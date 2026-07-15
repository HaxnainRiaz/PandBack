const mongoose = require('mongoose');

const metaEventLogSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    eventName: { type: String, required: true },
    eventId: { type: String, required: true },
    pixelId: { type: String },
    source: {
        type: String,
        enum: ['browser', 'server'],
        required: true
    },
    status: {
        type: String,
        enum: [
            'queued',
            'processing',
            'sent',
            'failed',
            'dead',
            'skipped',
            'skipped_duplicate',
            'deduplicated',
            'test_sent'
        ],
        default: 'queued'
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextRetryAt: { type: Date, default: Date.now },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date },
    responseTimeMs: { type: Number },
    requestPayloadSafe: Object,
    responsePayloadSafe: Object,
    errorMessage: String,
    fbtraceId: { type: String },
    testEventCodeUsed: String,
    lockedAt: { type: Date },
    lockedBy: { type: String },
    hasFbp: { type: Boolean, default: false },
    hasFbc: { type: Boolean, default: false },
    hasEmailHash: { type: Boolean, default: false },
    hasPhoneHash: { type: Boolean, default: false },
    hasExternalId: { type: Boolean, default: false },
    deduplicationKey: { type: String }
}, { timestamps: true });

metaEventLogSchema.index(
    { eventName: 1, eventId: 1, source: 1 },
    { unique: true, partialFilterExpression: { source: 'server' } }
);

metaEventLogSchema.index({ status: 1, nextRetryAt: 1, createdAt: -1 });
metaEventLogSchema.index({ orderId: 1 });
metaEventLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.MetaEventLog || mongoose.model('MetaEventLog', metaEventLogSchema);
