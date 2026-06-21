const mongoose = require('mongoose');

/**
 * PostExIntegration
 * Stores one PostEx account per admin/store owner.
 * The API token is AES-256-CBC encrypted before saving.
 * The plain token is NEVER returned to the frontend.
 */
const postExIntegrationSchema = new mongoose.Schema({
    // Owner of this integration (the admin user)
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true   // one PostEx account per admin
    },

    // Connection state
    isConnected: {
        type: Boolean,
        default: false
    },
    connectionStatus: {
        type: String,
        enum: ['connected', 'disconnected', 'invalid_token', 'error'],
        default: 'disconnected'
    },

    // Encrypted token — never expose in API responses
    apiTokenEncrypted: {
        type: String,
        default: null,
        select: false   // excluded from all queries by default
    },
    // Masked token for display only — e.g. "NTY2M...****"
    apiTokenMasked: {
        type: String,
        default: null
    },

    // Merchant info fetched from PostEx on verify
    merchantName: { type: String, default: null },

    // Default addresses used when creating shipments
    defaultPickupAddressCode: { type: String, default: null },
    defaultStoreAddressCode:  { type: String, default: null },

    // Audit fields
    lastVerifiedAt: { type: Date, default: null },
    lastErrorMessage: { type: String, default: null },

}, { timestamps: true });

module.exports = mongoose.models.PostExIntegration
    || mongoose.model('PostExIntegration', postExIntegrationSchema);
