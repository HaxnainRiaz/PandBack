const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    announcementBar: {
        enabled: { type: Boolean, default: true },
        text: { type: String, default: 'Free Shipping on Orders Over Rs. 5,000' }
    },
    hero: {
        headline: { type: String, default: 'Natural Beauty, Redefined' },
        subHeadline: { type: String, default: 'Luxury skincare formulated with botanical extracts.' },
        image: { type: String, default: '' }
    },
    homepageToggles: {
        featured: { type: Boolean, default: true },
        bestsellers: { type: Boolean, default: true },
        newsletter: { type: Boolean, default: true },
        testimonials: { type: Boolean, default: true },
        brandStory: { type: Boolean, default: true }
    },
    shipping: {
        fee: { type: Number, default: 200 },
        freeShippingEnabled: { type: Boolean, default: false },
        freeShippingThreshold: { type: Number, default: 5000 },
        freeShippingQuantityThreshold: { type: Number, default: 0 },
        freeShippingMode: {
            type: String,
            enum: ['amount', 'quantity', 'either', 'both'],
            default: 'either'
        }
    }
}, { timestamps: true });

module.exports = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
