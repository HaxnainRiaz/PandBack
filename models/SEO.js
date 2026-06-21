const mongoose = require('mongoose');

const seoSchema = new mongoose.Schema({
    entityType: {
        type: String,
        enum: ['product', 'category', 'page'],
        required: true
    },
    entityId: {
        type: mongoose.Schema.ObjectId,
        required: true,
        index: true
    },
    metaTitle: {
        type: String,
        required: true
    },
    metaDescription: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.models.SEO || mongoose.model('SEO', seoSchema);
